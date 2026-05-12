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
import { Bill, BillKind, BillLineItem, BillStatus } from './schemas/bill.schema';
import { Payment } from './schemas/payment.schema';
import { ServiceCatalogItem } from './schemas/service-catalog-item.schema';
import { Appointment } from '../appointments/schemas/appointment.schema';
import { Encounter } from '../encounters/schemas/encounter.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { Prescription } from '../prescriptions/schemas/prescription.schema';
import { InventoryItem } from '../inventory/schemas/inventory-item.schema';
import { InventoryService } from '../inventory/inventory.service';

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
    // Read-only deps for the medicine-bill-from-prescription drafter
    // (Slice 3). The drafter only needs to look up the prescription and
    // resolve each item to an inventory row, so we inject the models
    // directly rather than the services.
    @InjectModel(Prescription.name) private readonly prescriptionModel: Model<Prescription>,
    @InjectModel(InventoryItem.name) private readonly inventoryItemModel: Model<InventoryItem>,
    // Slice 5 — used to FIFO-dispense each line of a fully-paid medicine
    // bill. Reused as-is so the same overdraft guard + FIFO ordering
    // applies whether the dispense is manual (Inventory drawer) or
    // auto-triggered by a payment.
    private readonly inventory: InventoryService,
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
      // Defaults to SERVICE on the schema; explicit pass-through here so
      // the pharmacy flow (Slice 3) can stamp MEDICINE.
      kind: dto.kind ?? BillKind.Service,
      notes: dto.notes?.trim() || undefined,
      createdBy: actorUserId,
    });
  }

  /**
   * Draft a kind=MEDICINE bill seeded from a prescription's items. The
   * receptionist will adjust unit prices and quantities in the draft, then
   * issue + collect payment via the existing flows. Slice 5 will hook the
   * "fully paid" transition to FIFO-deduct inventory.
   *
   * Idempotent: if a non-void medicine bill already references this
   * prescription's encounter, returns it unchanged. Avoids a double-click
   * spawning two drafts.
   *
   * Items resolve in this order:
   *   1. By `medicineCatalogItemId` → InventoryItem.medicineCatalogItemId
   *      (the strong link the typeahead writes when the doctor picked
   *      from inventory).
   *   2. By case-insensitive name match against InventoryItem.name (the
   *      free-text fallback for doctors who typed without picking).
   * Items that match neither still appear on the bill — receptionist
   * either removes them or links the catalog manually.
   */
  async createBillFromPrescription(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    prescriptionIdOrNo: string,
  ): Promise<Bill> {
    // Accept either a 24-char ObjectId hex (programmatic callers, FE
    // recent-prescriptions list) or the human-readable prescriptionNo
    // ("RX-000123") that's printed on the slip. Pharmacist types the
    // latter most often — that's the whole point of the readable
    // number we mint at sign time.
    const trimmed = (prescriptionIdOrNo ?? '').trim();
    if (!trimmed) throw new NotFoundException('Prescription not found');

    let rx: Prescription | null = null;
    if (Types.ObjectId.isValid(trimmed) && trimmed.length === 24) {
      rx = await this.prescriptionModel.findOne({ _id: trimmed, clinicId });
    } else {
      // Match the print-side casing; pharmacist may type "rx-000123" too.
      rx = await this.prescriptionModel.findOne({
        clinicId,
        prescriptionNo: trimmed.toUpperCase(),
      });
    }
    if (!rx) throw new NotFoundException('Prescription not found');
    if (!rx.items || rx.items.length === 0) {
      throw new BadRequestException(
        'Prescription has no items — nothing to bill',
      );
    }

    // Idempotency: a medicine bill already drafted/issued/paid for this
    // prescription's encounter is the canonical record. Re-issue would be
    // a double-charge; instead the receptionist edits the existing one.
    const existing = await this.billModel.findOne({
      clinicId,
      encounterId: rx.encounterId,
      kind: BillKind.Medicine,
      status: { $ne: BillStatus.Void },
    });
    if (existing) return existing;

    // Resolve each prescription item to an inventory row (or leave the
    // line as a customName-only entry if no match).
    const catalogIds = rx.items
      .map((it) => it.medicineCatalogItemId)
      .filter((id): id is Types.ObjectId => !!id);

    const itemsByCatalog = new Map<string, InventoryItem & { _id: Types.ObjectId }>();
    if (catalogIds.length) {
      const found = await this.inventoryItemModel.find({
        clinicId,
        branchId: rx.branchId,
        medicineCatalogItemId: { $in: catalogIds },
        active: true,
      });
      for (const it of found as Array<InventoryItem & { _id: Types.ObjectId }>) {
        if (it.medicineCatalogItemId) {
          itemsByCatalog.set(it.medicineCatalogItemId.toHexString(), it);
        }
      }
    }

    // For free-text rows, look up by name. We do one combined query with
    // an OR of the candidate names so the lookup is O(1) round trips.
    const freeTextNames = rx.items
      .filter((it) => !it.medicineCatalogItemId && it.customName)
      .map((it) => it.customName!.trim())
      .filter((n) => n.length > 0);

    const itemsByName = new Map<string, InventoryItem & { _id: Types.ObjectId }>();
    if (freeTextNames.length) {
      const escaped = freeTextNames.map((n) =>
        n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      );
      const found = await this.inventoryItemModel.find({
        clinicId,
        branchId: rx.branchId,
        active: true,
        $or: escaped.map((n) => ({
          name: { $regex: `^${n}$`, $options: 'i' },
        })),
      });
      for (const it of found as Array<InventoryItem & { _id: Types.ObjectId }>) {
        itemsByName.set(it.name.toLowerCase(), it);
      }
    }

    const lineItems = rx.items.map((it) => {
      const catalogMatch = it.medicineCatalogItemId
        ? itemsByCatalog.get(it.medicineCatalogItemId.toHexString())
        : undefined;
      const nameMatch =
        !catalogMatch && it.customName
          ? itemsByName.get(it.customName.trim().toLowerCase())
          : undefined;
      const inventoryItem = catalogMatch ?? nameMatch;
      const quantity =
        Number.isInteger(it.quantity) && (it.quantity ?? 0) > 0
          ? (it.quantity as number)
          : 1;
      return {
        // Medicine bill items don't reference the service catalog.
        serviceCatalogItemId: undefined,
        inventoryItemId: inventoryItem?._id,
        // Display name: prefer inventory name (canonical) over the
        // doctor's free text. Falls back to customName when neither
        // resolved, so even unmatched lines render with a label.
        customName:
          inventoryItem?.name ?? it.customName?.trim() ?? 'Medicine',
        quantity,
        // Default to 0 — receptionist sets the price before issuing.
        // Pulling unitCost from the latest batch would conflate cost and
        // price; clinics mark up by varying amounts and we shouldn't guess.
        unitPrice: 0,
        amount: 0,
      };
    });

    const { subtotal, discount, tax, total } = computeTotals({
      items: lineItems,
    });
    const currency = await this.resolveCurrency(clinicId, undefined);

    return await this.billModel.create({
      clinicId,
      branchId: rx.branchId,
      patientId: rx.patientId,
      // encounterId, but NOT appointmentId — the existing
      // unique-bill-per-appointment index is for service bills. Keeping
      // appointmentId null on medicine bills lets a single visit have
      // both a service bill and a medicine bill without an index conflict.
      encounterId: rx.encounterId,
      currency,
      items: lineItems,
      subtotal,
      discount,
      tax,
      total,
      status: BillStatus.Draft,
      kind: BillKind.Medicine,
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
      // findOneAndUpdate (not updateOne) so we can branch on whether
      // this caller actually won the Issued → Paid transition. Two
      // concurrent payments racing past the total: only one will see
      // the matching status and trigger the dispense.
      const flipped = await this.billModel.findOneAndUpdate(
        { _id: bill._id, clinicId, status: BillStatus.Issued },
        { $set: { status: BillStatus.Paid, paidAt: new Date() } },
        { new: true },
      );

      // Slice 5 — auto-dispense inventory for medicine bills the moment
      // they become fully paid. Three guards in order:
      //   1. We won the status flip (lost-race callers exit here).
      //   2. Bill kind is MEDICINE.
      //   3. inventoryDispensedAt is still null (idempotency stamp wins
      //      over best-effort retries).
      if (flipped && flipped.kind === BillKind.Medicine) {
        await this.dispenseMedicineBill(flipped, actorUserId);
      }
    }

    return { payment, replayed };
  }

  /**
   * FIFO-deduct each medicine-bill line from inventory. Called once per
   * bill at the moment its status flips to Paid. Idempotent: a follow-up
   * call (refund-then-pay race) sees `inventoryDispensedAt` already
   * stamped and exits without touching stock again.
   *
   * Per-line behaviour:
   *   - Lines with `inventoryItemId`: dispense `quantity`. Insufficient
   *     stock throws ConflictException, which we swallow and continue —
   *     receptionist already saw the chip at billing time, we don't
   *     pretend to roll back the payment over a stockout.
   *   - Lines without `inventoryItemId` (free-text / unmatched): skipped.
   */
  private async dispenseMedicineBill(
    bill: Bill & { _id: Types.ObjectId },
    actorUserId: Types.ObjectId | undefined,
  ): Promise<void> {
    // Idempotency anchor: claim the dispense slot atomically before
    // doing any inventory work. If another caller already stamped, we
    // skip cleanly. The claim has no movement IDs yet — we'll patch
    // them in below once dispenses complete.
    //
    // Filter is `as any` because Mongoose's strict typing rejects the
    // `$in: [null, undefined]` idiom we want here (matches both rows
    // that explicitly have null and rows that lack the field on legacy
    // bills written before the Slice 1 schema change).
    const claim = await this.billModel.findOneAndUpdate(
      {
        _id: bill._id,
        clinicId: bill.clinicId,
        kind: BillKind.Medicine,
        inventoryDispensedAt: { $in: [null, undefined] },
      } as any,
      { $set: { inventoryDispensedAt: new Date() } },
      { new: true },
    );
    if (!claim) return; // Already dispensed by a sibling caller — done.

    const movementIds: Types.ObjectId[] = [];
    for (const line of bill.items ?? []) {
      if (!line.inventoryItemId || !line.quantity) continue;
      try {
        const result = await this.inventory.dispenseStock(
          bill.clinicId,
          actorUserId,
          line.inventoryItemId.toHexString(),
          {
            quantity: Number(line.quantity),
            billId: bill._id.toHexString(),
            reason: `Auto-dispense from medicine bill ${bill.billNo ?? bill._id.toHexString().slice(-6)}`,
          },
        );
        for (const m of result.movements ?? []) {
          if ((m as any)._id) movementIds.push((m as any)._id as Types.ObjectId);
        }
      } catch (err) {
        // ConflictException (insufficient stock) is the expected miss
        // case; the receptionist saw the warning chip at billing time
        // and accepted it. Anything else (DB errors etc.) we also
        // swallow here so a stock-side hiccup doesn't strand the bill
        // in a half-paid state — operator can manually reconcile via
        // the inventory drawer.
        // eslint-disable-next-line no-console
        console.warn(
          `[BillingService] auto-dispense failed for bill ${bill._id.toHexString()} item ${line.inventoryItemId.toHexString()}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (movementIds.length > 0) {
      await this.billModel.updateOne(
        { _id: bill._id, clinicId: bill.clinicId },
        { $set: { inventoryMovementIds: movementIds } },
      );
    }
  }

  async getBill(clinicId: Types.ObjectId, id: string) {
    const bill = await this.billModel.findOne({ _id: id, clinicId });
    if (!bill) throw new NotFoundException('Bill not found');
    return bill;
  }

  async listBills(
    clinicId: Types.ObjectId,
    opts: {
      branchId?: string;
      patientId?: string;
      status?: string;
      kind?: string;
      limit?: number;
    } = {},
  ) {
    const { branchId, patientId, status, kind, limit = 100 } = opts;
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
    // Kind filter — Pharmacy screen passes 'MEDICINE'; the existing
    // BillingScreen lists everything (or filters to SERVICE later in
    // Slice 6). Unknown values are ignored rather than rejected.
    if (kind) {
      const upper = kind.toUpperCase();
      if (upper === BillKind.Service || upper === BillKind.Medicine) {
        match.kind = upper;
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
      // Hard cap at 2000 so the "Load older" expansion path on the FE
      // can reach the historical tail of busy clinics without a full
      // cursor-pager. Above 2000 the FE ought to switch to filtered
      // search rather than paginate.
      { $limit: Math.max(1, Math.min(2000, limit)) },
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
      // Set on MEDICINE-bill lines so dispense (Slice 5) can resolve
      // the stock row directly. SERVICE-bill lines won't carry this.
      inventoryItemId?: string;
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
      const hasInventory =
        typeof i.inventoryItemId === 'string' &&
        i.inventoryItemId.length > 0;
      const hasCustom =
        typeof i.customName === 'string' && i.customName.trim().length > 0;
      // A MEDICINE line resolves via inventoryItemId; SERVICE lines via
      // serviceCatalogItemId. Either can also carry a free-text name.
      if (!hasCatalog && !hasInventory && !hasCustom)
        throw new BadRequestException(
          'Each item must have serviceCatalogItemId, inventoryItemId, or customName',
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
        inventoryItemId: hasInventory
          ? new Types.ObjectId(i.inventoryItemId)
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
