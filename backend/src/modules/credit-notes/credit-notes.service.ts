import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bill, BillStatus } from '../billing/schemas/bill.schema';
import { Payment, PaymentMethod } from '../billing/schemas/payment.schema';
import { RazorpayService } from '../billing/razorpay.service';
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
  private readonly logger = new Logger(CreditNotesService.name);

  constructor(
    @InjectModel(CreditNote.name)
    private readonly cnModel: Model<CreditNote>,
    @InjectModel(Bill.name) private readonly billModel: Model<Bill>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    private readonly razorpay: RazorpayService,
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

    // Real gateway refund. When the operator refunds ONLINE (back to source)
    // and the bill was settled by a Razorpay payment, push the refund through
    // Razorpay BEFORE marking the note refunded. If the gateway call throws,
    // the exception propagates and the note stays ISSUED — we never claim the
    // money moved when it didn't. For non-Razorpay online payments (e.g. the
    // Stripe sandbox's `ch_...` ref) or other methods, we keep the operator's
    // manual reference and record-only as before.
    //
    // Concurrency: this is gateway-first, so the only window for a *double*
    // gateway refund is two requests for the SAME note both passing the
    // ISSUED check before either commits. The status CAS below guarantees at
    // most one is recorded; the FE also disables the confirm button while the
    // request is in flight. The Razorpay SDK (2.9.x) doesn't expose a
    // per-request idempotency header, so we accept this narrow window rather
    // than risk a claim-first design that could mark a note refunded when the
    // gateway call later fails.
    let providerRef = dto.providerRef?.trim() || undefined;
    if (dto.method === PaymentMethod.Online && this.razorpay.isConfigured()) {
      const rzpPaymentId = await this.findRazorpayPaymentId(clinicId, cn.billId);
      if (rzpPaymentId) {
        const refund = await this.razorpay.refundPayment(rzpPaymentId, {
          amountPaise: Math.round(cn.amount * 100),
          notes: { creditNoteId: id, idempotencyKey: dto.idempotencyKey },
        });
        providerRef = refund.id;
      } else {
        this.logger.warn(
          `[cn ${id}] ONLINE refund but no Razorpay payment found on bill ${cn.billId.toHexString()} — recording manual reference only`,
        );
      }
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
          refundProviderRef: providerRef,
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
  ): Promise<{ count: number; totalRefunded: number; perCurrency: Array<{ currency: string; amount: number }> }> {
    const match: Record<string, unknown> = {
      clinicId,
      status: CreditNoteStatus.Refunded,
      refundedAt: { $gte: range.start, $lte: range.end },
    };
    if (range.branchId) match.branchId = range.branchId;

    // Credit notes don't carry their own currency — they inherit from
    // the bill they credit. $lookup gives us the bill's currency so
    // the caller can do FX conversion before summing.
    const out = await this.cnModel.aggregate<{
      _id: string;
      count: number;
      totalRefunded: number;
    }>([
      { $match: match },
      {
        $lookup: {
          from: 'bills',
          localField: 'billId',
          foreignField: '_id',
          as: 'bill',
        },
      },
      {
        $addFields: {
          currency: { $ifNull: [{ $arrayElemAt: ['$bill.currency', 0] }, 'INR'] },
        },
      },
      {
        $group: {
          _id: '$currency',
          count: { $sum: 1 },
          totalRefunded: { $sum: '$amount' },
        },
      },
    ]);
    const perCurrency = out.map((r) => ({ currency: String(r._id || 'INR').toUpperCase(), amount: r.totalRefunded }));
    return {
      count: out.reduce((s, r) => s + r.count, 0),
      // Raw native-currency sum (callers in single-currency clinics
      // can still read this directly; for mixed-currency clinics the
      // ReportsService converts perCurrency via FxService).
      totalRefunded: out.reduce((s, r) => s + r.totalRefunded, 0),
      perCurrency,
    };
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
  ): Promise<{ _id: { bucket: Date; currency: string }; totalRefunded: number; count: number }[]> {
    const match: Record<string, unknown> = {
      clinicId,
      status: CreditNoteStatus.Refunded,
      refundedAt: { $gte: range.start, $lte: range.end },
    };
    if (range.branchId) match.branchId = range.branchId;

    // Same (bucket, currency) two-key group as the other reports —
    // ReportsService.revenueTimeseries collapses the currency dimension
    // by converting to the clinic's display currency.
    return await this.cnModel.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'bills',
          localField: 'billId',
          foreignField: '_id',
          as: 'bill',
        },
      },
      {
        $addFields: {
          currency: { $ifNull: [{ $arrayElemAt: ['$bill.currency', 0] }, 'INR'] },
        },
      },
      {
        $group: {
          _id: {
            bucket: {
              $dateTrunc: {
                date: '$refundedAt',
                unit: range.bucket,
                timezone: range.tz,
                startOfWeek: 'monday',
              },
            },
            currency: '$currency',
          },
          totalRefunded: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.bucket': 1 } },
    ]);
  }

  // --- internals ----------------------------------------------------------

  /**
   * Finds the Razorpay payment id (`pay_...`) that settled this bill so an
   * ONLINE refund can be pushed back to the original source. Picks the most
   * recent ONLINE payment whose providerRef looks like a Razorpay id. Returns
   * undefined when the bill was paid by other means (cash/UPI/card) or online
   * through a non-Razorpay / simulated gateway (e.g. the Stripe sandbox's
   * `ch_...` ref) — the caller then falls back to a record-only refund.
   */
  private async findRazorpayPaymentId(
    clinicId: Types.ObjectId,
    billId: Types.ObjectId,
  ): Promise<string | undefined> {
    const payments = await this.paymentModel
      .find({ clinicId, billId, method: PaymentMethod.Online })
      .sort({ paidAt: -1 });
    const match = payments.find((p) =>
      /^pay_/.test((p.providerRef ?? '').trim()),
    );
    return match?.providerRef?.trim() || undefined;
  }

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
