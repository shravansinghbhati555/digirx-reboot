import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bill, BillStatus } from '../billing/schemas/bill.schema';
import { CreditNoteNumberingService } from './credit-note-numbering.service';
import {
  CreditNote,
  CreditNoteStatus,
} from './schemas/credit-note.schema';
import { CancelCreditNoteDto } from './dto/cancel-credit-note.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { RefundCreditNoteDto } from './dto/refund-credit-note.dto';

const COUNTING_STATUSES = [
  CreditNoteStatus.Issued,
  CreditNoteStatus.Refunded,
];

@Injectable()
export class CreditNotesService {
  constructor(
    @InjectModel(CreditNote.name)
    private readonly cnModel: Model<CreditNote>,
    @InjectModel(Bill.name) private readonly billModel: Model<Bill>,
    private readonly numbering: CreditNoteNumberingService,
  ) {}

  async create(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    billId: string,
    dto: CreateCreditNoteDto,
  ): Promise<CreditNote> {
    const bill = await this.loadBillForCredit(clinicId, billId);

    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('amount must be > 0');
    }

    const alreadyCredited = await this.sumActiveCredits(clinicId, bill._id);
    if (alreadyCredited + dto.amount > bill.total + 0.0001) {
      throw new BadRequestException(
        `Credit ${dto.amount} would exceed bill total. Max creditable: ${(
          bill.total - alreadyCredited
        ).toFixed(2)}`,
      );
    }

    const issuedAt = new Date();
    const creditNoteNo = await this.numbering.mint(
      clinicId,
      bill.branchId,
      issuedAt,
    );

    return await this.cnModel.create({
      clinicId,
      branchId: bill.branchId,
      billId: bill._id,
      creditNoteNo,
      items: dto.items.map((it) => ({
        serviceCatalogItemId: it.serviceCatalogItemId
          ? new Types.ObjectId(it.serviceCatalogItemId)
          : undefined,
        customName: it.customName?.trim(),
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        amount: it.quantity * it.unitPrice,
      })),
      amount: dto.amount,
      reason: dto.reason.trim(),
      status: CreditNoteStatus.Issued,
      createdBy: actorUserId,
    });
  }

  async listForBill(clinicId: Types.ObjectId, billId: string) {
    if (!Types.ObjectId.isValid(billId)) {
      throw new NotFoundException('Bill not found');
    }
    return await this.cnModel
      .find({ clinicId, billId: new Types.ObjectId(billId) })
      .sort({ createdAt: -1 });
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Credit note not found');
    }
    const cn = await this.cnModel.findOne({ _id: id, clinicId });
    if (!cn) throw new NotFoundException('Credit note not found');
    return cn;
  }

  /**
   * Record the actual cash going out. Flips ISSUED → REFUNDED. Idempotent
   * via `idempotencyKey` — a retry returns the same record without
   * double-stamping refundedAt.
   */
  async refund(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    id: string,
    dto: RefundCreditNoteDto,
  ): Promise<CreditNote> {
    const cn = await this.getById(clinicId, id);

    if (cn.status === CreditNoteStatus.Refunded) {
      // Replay-friendly: same key → same record; different key on a refunded
      // CN → 409 (operator must explicitly cancel + re-issue).
      if (cn.refundIdempotencyKey === dto.idempotencyKey) return cn;
      throw new ConflictException(
        'Credit note already refunded with a different idempotency key',
      );
    }
    if (cn.status === CreditNoteStatus.Cancelled) {
      throw new BadRequestException('Cannot refund a cancelled credit note');
    }

    const refundedAt = dto.refundedAt ? new Date(dto.refundedAt) : new Date();
    if (isNaN(refundedAt.getTime())) {
      throw new BadRequestException('Invalid refundedAt');
    }

    // Status-gated atomic update. The CAS filter accepts only ISSUED so a
    // concurrent second refund call on the same CN can't double-stamp.
    const updated = await this.cnModel.findOneAndUpdate(
      {
        _id: cn._id,
        clinicId,
        status: CreditNoteStatus.Issued,
      },
      {
        $set: {
          status: CreditNoteStatus.Refunded,
          refundedAt,
          refundedVia: dto.method,
          refundProviderRef: dto.providerRef?.trim() || undefined,
          refundedBy: actorUserId,
          refundIdempotencyKey: dto.idempotencyKey,
        },
      },
      { new: true },
    );
    if (updated) return updated;

    // Lost the race — re-fetch and resolve idempotency against the winner.
    const fresh = await this.getById(clinicId, id);
    if (
      fresh.status === CreditNoteStatus.Refunded &&
      fresh.refundIdempotencyKey === dto.idempotencyKey
    ) {
      return fresh;
    }
    throw new ConflictException(
      'Credit note refund raced and resolved with a different key',
    );
  }

  /**
   * Mark the CN as issued-by-mistake. The amount no longer counts toward the
   * bill's credited total, so the bill becomes void-eligible again.
   */
  async cancel(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    id: string,
    dto: CancelCreditNoteDto,
  ): Promise<CreditNote> {
    const cn = await this.getById(clinicId, id);

    if (cn.status === CreditNoteStatus.Cancelled) return cn;
    if (cn.status === CreditNoteStatus.Refunded) {
      throw new BadRequestException(
        'Cannot cancel a refunded credit note — money has already walked',
      );
    }

    const updated = await this.cnModel.findOneAndUpdate(
      {
        _id: cn._id,
        clinicId,
        status: CreditNoteStatus.Issued,
      },
      {
        $set: {
          status: CreditNoteStatus.Cancelled,
          cancelledAt: new Date(),
          cancellationReason: dto.reason.trim(),
          cancelledBy: actorUserId,
        },
      },
      { new: true },
    );
    return updated ?? (await this.getById(clinicId, id));
  }

  /**
   * Returns the sum of CN amounts that count against `bill.total` — i.e.
   * everything that's ISSUED or REFUNDED. CANCELLED CNs don't count.
   * Exposed so BillingService can block voiding bills with active credits.
   */
  async sumActiveCredits(
    clinicId: Types.ObjectId,
    billId: Types.ObjectId,
  ): Promise<number> {
    const out = await this.cnModel.aggregate<{ total: number }>([
      {
        $match: {
          clinicId,
          billId,
          status: { $in: COUNTING_STATUSES },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return out[0]?.total ?? 0;
  }

  /** For revenueSummary: sum of REFUNDED amounts in a date range. */
  async sumRefundsInRange(
    clinicId: Types.ObjectId,
    range: { start: Date; end: Date; branchId?: Types.ObjectId },
  ): Promise<{ count: number; totalRefunded: number }> {
    const match: Record<string, unknown> = {
      clinicId,
      status: CreditNoteStatus.Refunded,
      refundedAt: { $gte: range.start, $lte: range.end },
    };
    if (range.branchId) match.branchId = range.branchId;

    const out = await this.cnModel.aggregate<{
      count: number;
      totalRefunded: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalRefunded: { $sum: '$amount' },
        },
      },
    ]);
    return out[0] ?? { count: 0, totalRefunded: 0 };
  }

  /**
   * Refund cash-flow time series, bucketed by clinic-local day/week/month.
   * Used by ReportsService.revenueTimeseries to compute net revenue.
   */
  async refundTimeseries(
    clinicId: Types.ObjectId,
    range: {
      start: Date;
      end: Date;
      bucket: 'day' | 'week' | 'month';
      tz: string;
      branchId?: Types.ObjectId;
    },
  ): Promise<{ _id: Date; totalRefunded: number; count: number }[]> {
    const match: Record<string, unknown> = {
      clinicId,
      status: CreditNoteStatus.Refunded,
      refundedAt: { $gte: range.start, $lte: range.end },
    };
    if (range.branchId) match.branchId = range.branchId;

    return await this.cnModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$refundedAt',
              unit: range.bucket,
              timezone: range.tz,
              startOfWeek: 'monday',
            },
          },
          totalRefunded: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }

  // --- internals ----------------------------------------------------------

  private async loadBillForCredit(clinicId: Types.ObjectId, billId: string) {
    if (!Types.ObjectId.isValid(billId)) {
      throw new NotFoundException('Bill not found');
    }
    const bill = await this.billModel.findOne({ _id: billId, clinicId });
    if (!bill) throw new NotFoundException('Bill not found');
    if (bill.status === BillStatus.Draft) {
      throw new BadRequestException('Cannot credit a draft bill');
    }
    if (bill.status === BillStatus.Void) {
      throw new BadRequestException('Cannot credit a voided bill');
    }
    return bill;
  }
}
