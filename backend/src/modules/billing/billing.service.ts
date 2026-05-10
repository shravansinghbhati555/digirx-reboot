import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { computeTotals } from './billing.utils';
import { BillNumberingService } from './bill-numbering.service';
import { CreditNotesService } from '../credit-notes/credit-notes.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { Bill, BillLineItem, BillStatus } from './schemas/bill.schema';
import { Payment } from './schemas/payment.schema';
import { ServiceCatalogItem } from './schemas/service-catalog-item.schema';
import { Appointment } from '../appointments/schemas/appointment.schema';
import { Encounter } from '../encounters/schemas/encounter.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';

const CURRENCY_RE = /^[A-Z]{3}$/;

@Injectable()
export class BillingService {
  constructor(
    @InjectModel(Bill.name) private readonly billModel: Model<Bill>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(ServiceCatalogItem.name)
    private readonly serviceModel: Model<ServiceCatalogItem>,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
    @InjectModel(Encounter.name)
    private readonly encounterModel: Model<Encounter>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    private readonly numbering: BillNumberingService,
    // forwardRef breaks the BillingModule ↔ CreditNotesModule cycle: each
    // depends on the other (this for void-blocking; CN service for the Bill
    // schema). Nest resolves it after both modules have initialized.
    @Inject(forwardRef(() => CreditNotesService))
    private readonly creditNotes: CreditNotesService,
  ) { }

  async createBill(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    dto: CreateBillDto,
  ) {
    const branchId = this.toObjectId(dto.branchId, 'branchId');
    const patientId = this.toObjectId(dto.patientId, 'patientId');
    const appointmentId = dto.appointmentId
      ? this.toObjectId(dto.appointmentId, 'appointmentId')
      : undefined;
    const encounterId = dto.encounterId
      ? this.toObjectId(dto.encounterId, 'encounterId')
      : undefined;

    // Check for existing bill for this context (Upsert logic)
    if (appointmentId || encounterId) {
      const existing = await this.billModel.findOne({
        clinicId,
        $or: [
          ...(appointmentId ? [{ appointmentId }] : []),
          ...(encounterId ? [{ encounterId }] : []),
        ],
        status: { $ne: BillStatus.Void },
      });

      if (existing) {
        if (existing.status === BillStatus.Paid) {
          throw new BadRequestException('A paid bill already exists for this visit');
        }
        if (existing.status === BillStatus.Issued) {
          throw new BadRequestException('A bill has already been issued for this visit. Void it if you need to make changes.');
        }
        // Patch the existing DRAFT bill
        const dtoForUpdate = {
          items: dto.items,
          discount: dto.discount,
          tax: dto.tax,
        };
        return await this.updateBill(clinicId, existing._id.toHexString(), dtoForUpdate);
      }
    }

    // Constraints:
    if (appointmentId) {
      const appt = await this.appointmentModel.findOne({ _id: appointmentId, clinicId });
      if (!appt) throw new BadRequestException('Appointment not found');
      if (appt.status !== 'DONE') {
        throw new BadRequestException('Bill can only be created for DONE appointments');
      }
    }

    if (encounterId) {
      const encounter = await this.encounterModel.findOne({ _id: encounterId, clinicId });
      if (!encounter) throw new BadRequestException('Encounter not found');
      if (encounter.status !== 'SIGNED') {
        throw new BadRequestException('Bill can only be created for SIGNED encounters');
      }
    }

    const items = await this.mapItems(clinicId, dto.items);
    const { subtotal, discount, tax, total } = computeTotals({
      items,
      discount: dto.discount,
      tax: dto.tax,
    });

    const currency = await this.resolveCurrency(clinicId, dto.currency);

    return await this.billModel.create({
      clinicId,
      branchId,
      patientId,
      appointmentId,
      encounterId,
      currency,
      items,
      subtotal,
      discount,
      tax,
      total,
      status: BillStatus.Draft,
      notes: dto.notes?.trim() || undefined,
      createdBy: actorUserId,
    });
  }

  async updateBill(clinicId: Types.ObjectId, id: string, dto: UpdateBillDto) {
    const bill = await this.getBill(clinicId, id);
    if (bill.status !== BillStatus.Draft && dto.status !== BillStatus.Void) {
      throw new BadRequestException('Only draft bills can be edited');
    }

    if (dto.status === BillStatus.Void) {
      bill.status = BillStatus.Void;
      await bill.save();
      return bill;
    }

    if (dto.items) bill.items = await this.mapItems(clinicId, dto.items);
    if (dto.discount !== undefined) bill.discount = dto.discount;
    if (dto.tax !== undefined) bill.tax = dto.tax;

    const totals = computeTotals({
      items: bill.items,
      discount: bill.discount,
      tax: bill.tax,
    });
    bill.subtotal = totals.subtotal;
    bill.discount = totals.discount;
    bill.tax = totals.tax;
    bill.total = totals.total;

    await bill.save();
    return bill;
  }

  async issueBill(clinicId: Types.ObjectId, id: string) {
    const bill = await this.getBill(clinicId, id);
    if (bill.status !== BillStatus.Draft) {
      throw new BadRequestException('Only draft bills can be issued');
    }

    const issuedAt = new Date();
    const billNo = await this.numbering.mint(
      clinicId,
      bill.branchId,
      issuedAt,
    );

    // Status-gated atomic update so two concurrent issue calls on the same
    // DRAFT bill don't both set a billNo. The "loser" sees a null match
    // and returns the bill as it stands; the minted number on the loser's
    // counter is wasted (sequence may have a gap) — auditors prefer gaps
    // to duplicates.
    const updated = await this.billModel.findOneAndUpdate(
      { _id: bill._id, clinicId, status: BillStatus.Draft },
      { $set: { billNo, status: BillStatus.Issued, issuedAt } },
      { new: true },
    );
    if (updated) return updated;

    return await this.getBill(clinicId, id);
  }

  /**
   * Void a bill with a required reason. Allowed transitions:
   *   - DRAFT  → 400 (delete the draft instead — voiding it would muddy reports)
   *   - ISSUED → VOID  (cash, if any, stays recorded; refund via credit note)
   *   - PAID   → VOID  (same — voiding does NOT refund)
   *   - VOID   → idempotent no-op, returns the existing void record
   */
  async voidBill(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    id: string,
    reason: string,
  ): Promise<Bill> {
    const bill = await this.getBill(clinicId, id);

    if (bill.status === BillStatus.Void) {
      // Idempotent: a retry that finds the bill already voided gets the same
      // record back without bumping voidedAt or overwriting the reason.
      return bill;
    }
    if (bill.status === BillStatus.Draft) {
      throw new BadRequestException(
        'Cannot void a draft bill — delete it instead, or issue it first',
      );
    }

    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('reason is required');

    // Block void when active credit notes exist. Voiding here would leave
    // the books unbalanced — the CN amount counts as a refund obligation
    // against a bill that no longer exists for revenue purposes. Operators
    // must explicitly cancel any ISSUED CNs before voiding the bill.
    const credited = await this.creditNotes.sumActiveCredits(
      clinicId,
      bill._id,
    );
    if (credited > 0) {
      throw new BadRequestException(
        `Cannot void: bill has active credit notes totalling ${credited.toFixed(
          2,
        )}. Refund or cancel them first.`,
      );
    }

    // Status-gated atomic update so a concurrent payment / second void can't
    // race past us. The CAS filter accepts ISSUED|PAID; any other transition
    // (DRAFT, VOID) was already handled above.
    const updated = await this.billModel.findOneAndUpdate(
      {
        _id: bill._id,
        clinicId,
        status: { $in: [BillStatus.Issued, BillStatus.Paid] },
      },
      {
        $set: {
          status: BillStatus.Void,
          voidReason: trimmed,
          voidedAt: new Date(),
          voidedBy: actorUserId,
        },
      },
      { new: true },
    );
    if (!updated) {
      // Lost a race — re-fetch and let the idempotent VOID branch above
      // (called by the caller's retry, if any) handle it.
      return await this.getBill(clinicId, id);
    }
    return updated;
  }

  async addPayment(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    billId: string,
    dto: CreatePaymentDto,
  ): Promise<{ payment: Payment; replayed: boolean }> {
    const bill = await this.getBill(clinicId, billId);
    if (bill.status !== BillStatus.Issued)
      throw new BadRequestException(
        'Payments can be added only to issued bills',
      );

    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('Invalid amount');

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (isNaN(paidAt.getTime()))
      throw new BadRequestException('Invalid paidAt');

    let payment: Payment;
    let replayed = false;
    try {
      payment = await this.paymentModel.create({
        clinicId,
        branchId: bill.branchId,
        billId: bill._id,
        method: dto.method,
        amount,
        providerRef: dto.providerRef,
        paidAt,
        receivedBy: actorUserId,
        idempotencyKey: dto.idempotencyKey,
      });
    } catch (err: any) {
      if (err && err.code === 11000) {
        const original = await this.paymentModel.findOne({
          clinicId,
          billId: bill._id,
          idempotencyKey: dto.idempotencyKey,
        });
        if (original) {
          payment = original;
          replayed = true;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // Recompute paid total and auto-close the bill when fully settled.
    // We do this even on a replay so concurrent races converge correctly.
    const sumAgg = await this.paymentModel.aggregate<{ total: number }>([
      { $match: { clinicId, billId: bill._id } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalPaid = sumAgg[0]?.total ?? 0;
    if (
      bill.status === BillStatus.Issued &&
      totalPaid >= bill.total &&
      bill.total > 0
    ) {
      await this.billModel.updateOne(
        { _id: bill._id, clinicId, status: BillStatus.Issued },
        { $set: { status: BillStatus.Paid, paidAt: new Date() } },
      );
    }

    return { payment, replayed };
  }

  async getBill(clinicId: Types.ObjectId, id: string) {
    const bill = await this.billModel.findOne({ _id: id, clinicId });
    if (!bill) throw new NotFoundException('Bill not found');
    return bill;
  }

  async listBills(
    clinicId: Types.ObjectId,
    opts: { branchId?: string; patientId?: string; status?: string; limit?: number } = {},
  ) {
    const { branchId, patientId, status, limit = 100 } = opts;
    const match: Record<string, unknown> = { clinicId };
    if (branchId) match.branchId = new Types.ObjectId(branchId);
    // Patient filter — without this, /bills?patientId=… returned every bill
    // in the clinic and the FE rendered them under whichever patient was
    // currently selected. Real cross-patient leak inside a tenant.
    if (patientId && Types.ObjectId.isValid(patientId)) {
      match.patientId = new Types.ObjectId(patientId);
    }
    if (status) {
      const upper = status.toUpperCase();
      if (
        upper === BillStatus.Draft ||
        upper === BillStatus.Issued ||
        upper === BillStatus.Paid ||
        upper === BillStatus.Void
      ) {
        match.status = upper;
      }
    }

    const rows = await this.billModel.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'payments',
          localField: '_id',
          foreignField: 'billId',
          as: 'payments',
        },
      },
      { $addFields: { totalPaid: { $sum: '$payments.amount' } } },
      {
        $addFields: {
          outstanding: { $max: [0, { $subtract: ['$total', '$totalPaid'] }] },
        },
      },
      {
        $lookup: {
          from: 'patients',
          let: { pid: '$patientId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$pid'] } } },
            { $project: { fullName: 1 } },
          ],
          as: 'patient',
        },
      },
      {
        $addFields: {
          patientName: { $first: '$patient.fullName' },
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: Math.max(1, Math.min(500, limit)) },
      { $project: { payments: 0, patient: 0 } },
    ]);

    return { branchId: branchId ?? null, count: rows.length, rows };
  }

  async listPayments(clinicId: Types.ObjectId, billId: string) {
    return await this.paymentModel
      .find({ clinicId, billId: new Types.ObjectId(billId) })
      .sort({ paidAt: -1 });
  }

  async createService(
    clinicId: Types.ObjectId,
    name: string,
    defaultPrice: number,
  ) {
    return await this.serviceModel.create({
      clinicId,
      name: name.trim(),
      defaultPrice,
      active: true,
    });
  }

  async listServices(
    clinicId: Types.ObjectId,
    opts: { query?: string; activeOnly?: boolean; limit?: number } = {},
  ) {
    const limit = Math.max(1, Math.min(200, opts.limit ?? 200));
    const filter: Record<string, unknown> = { clinicId };
    if (opts.activeOnly !== false) filter.active = true;

    const q = (opts.query ?? '').trim();
    if (q) {
      // Try the text index first (matches whole-word tokens). If it returns
      // nothing — common for 2-3 char autocomplete prefixes that the text
      // index doesn't tokenise — fall back to a regex prefix match.
      const textHits = await this.serviceModel
        .find(
          { ...filter, $text: { $search: q } },
          { score: { $meta: 'textScore' } },
        )
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit);
      if (textHits.length) return textHits;

      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return await this.serviceModel
        .find({ ...filter, name: { $regex: escaped, $options: 'i' } })
        .sort({ name: 1 })
        .limit(limit);
    }

    return await this.serviceModel
      .find(filter)
      .sort({ name: 1 })
      .limit(limit);
  }

  /**
   * If the caller passes a currency, validate it's an ISO-4217 3-letter
   * code; otherwise default to the clinic's configured currency. Final
   * fallback is 'INR' so the service is never blocked on a clinic doc
   * that's missing the field.
   */
  private async resolveCurrency(
    clinicId: Types.ObjectId,
    requested: string | undefined,
  ): Promise<string> {
    if (requested !== undefined) {
      const upper = requested.trim().toUpperCase();
      if (!CURRENCY_RE.test(upper)) {
        throw new BadRequestException(
          'currency must be a 3-letter ISO 4217 code (e.g. INR, USD)',
        );
      }
      return upper;
    }
    const clinic = await this.clinicModel.findById(clinicId);
    return (clinic?.currency || 'INR').toUpperCase();
  }

  async findByContext(
    clinicId: Types.ObjectId,
    opts: { encounterId?: string; appointmentId?: string },
  ) {
    const { encounterId, appointmentId } = opts;
    const match: any = { clinicId };
    if (encounterId)
      match.encounterId = this.toObjectId(encounterId, 'encounterId');
    if (appointmentId)
      match.appointmentId = this.toObjectId(appointmentId, 'appointmentId');

    if (!encounterId && !appointmentId) return null;

    return await this.billModel.findOne(match).sort({ createdAt: -1 });
  }

  private async mapItems(
    clinicId: Types.ObjectId,
    items: Array<{
      serviceCatalogItemId?: string;
      customName?: string;
      quantity: number;
      unitPrice: number;
    }>,
  ) {
    if (!Array.isArray(items) || items.length === 0)
      throw new BadRequestException('items is required');

    const catalogIds = items
      .map((i) => i.serviceCatalogItemId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((id) => new Types.ObjectId(id));

    const catalogById = new Map<string, ServiceCatalogItem>();
    if (catalogIds.length) {
      const found = await this.serviceModel.find({
        clinicId,
        _id: { $in: catalogIds },
      });
      for (const s of found) catalogById.set(s._id.toHexString(), s);
    }

    const mapped: BillLineItem[] = items.map((i) => {
      const qty = Number(i.quantity);
      const unitPrice = Number(i.unitPrice);

      const hasCatalog =
        typeof i.serviceCatalogItemId === 'string' &&
        i.serviceCatalogItemId.length > 0;
      const hasCustom =
        typeof i.customName === 'string' && i.customName.trim().length > 0;
      if (!hasCatalog && !hasCustom)
        throw new BadRequestException(
          'Each item must have serviceCatalogItemId or customName',
        );

      const service = hasCatalog
        ? catalogById.get(i.serviceCatalogItemId!)
        : undefined;
      if (hasCatalog && !service)
        throw new BadRequestException('Invalid serviceCatalogItemId');

      return {
        serviceCatalogItemId: hasCatalog
          ? new Types.ObjectId(i.serviceCatalogItemId)
          : undefined,
        customName: hasCustom ? i.customName!.trim() : service?.name,
        quantity: qty,
        unitPrice,
        amount: 0,
      };
    });

    // computeTotals will fill amount and validate numeric fields
    computeTotals({ items: mapped });
    return mapped;
  }

  private toObjectId(id: string, name: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${name}: ${id}`);
    }
    return new Types.ObjectId(id);
  }
}
