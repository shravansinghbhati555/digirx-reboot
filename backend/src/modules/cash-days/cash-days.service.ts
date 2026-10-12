import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DateTime } from 'luxon';
import { CashDay, CashDayStatus } from './schemas/cash-day.schema';
import { Payment, PaymentMethod } from '../billing/schemas/payment.schema';
import { CreditNote, CreditNoteStatus } from '../credit-notes/schemas/credit-note.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { clientIdFields } from '../offline/client-id.util';

export type CashFigures = {
  /** Cash in minus cash refunded, from everything that has reached the server. */
  expectedCash: number;
  cashIn: number;
  cashRefunded: number;
  paymentCount: number;
};

/** Money compared in paise, so 0.1 + 0.2 never reads as a mismatch. */
function paise(n: number): number {
  return Math.round(n * 100);
}

export function isMismatch(a: number, b: number): boolean {
  return paise(a) !== paise(b);
}

/**
 * Day-end cash reconciliation — ticket C6.
 *
 * Policy (open question 3 in the offline plan): one shared drawer per
 * branch, counted once a day by whoever ran the desk, approved by the Super
 * Admin or Manager. No opening float, so expected = cash in − cash refunded.
 * A mismatch is allowed, never silent: counting it needs a note, and so does
 * approving it.
 */
@Injectable()
export class CashDaysService {
  constructor(
    @InjectModel(CashDay.name) private readonly cashDayModel: Model<CashDay>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(CreditNote.name) private readonly creditNoteModel: Model<CreditNote>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
  ) {}

  private async dayBounds(clinicId: Types.ObjectId, date: string): Promise<{ from: Date; to: Date }> {
    const clinic = await this.clinicModel.findById(clinicId);
    if (!clinic) throw new NotFoundException('Clinic not found');
    const start = DateTime.fromISO(date, { zone: clinic.timezone || 'UTC' }).startOf('day');
    if (!start.isValid) throw new BadRequestException('Invalid date');
    return { from: start.toJSDate(), to: start.plus({ days: 1 }).toJSDate() };
  }

  /** Server-side expected cash for one branch-day. */
  async expected(
    clinicId: Types.ObjectId,
    branchId: Types.ObjectId,
    date: string,
  ): Promise<CashFigures> {
    const { from, to } = await this.dayBounds(clinicId, date);

    const [paid] = await this.paymentModel.aggregate<{ total: number; count: number }>([
      {
        $match: {
          clinicId,
          branchId,
          method: PaymentMethod.Cash,
          paidAt: { $gte: from, $lt: to },
        },
      },
      // A voided bill's cash went back to the patient; it is not in the drawer.
      {
        $lookup: {
          from: 'bills',
          localField: 'billId',
          foreignField: '_id',
          as: 'bill',
          pipeline: [{ $project: { status: 1 } }],
        },
      },
      { $match: { 'bill.status': { $ne: 'VOID' } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    const [refunded] = await this.creditNoteModel.aggregate<{ total: number }>([
      {
        $match: {
          clinicId,
          branchId,
          status: CreditNoteStatus.Refunded,
          refundedVia: PaymentMethod.Cash,
          refundedAt: { $gte: from, $lt: to },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const cashIn = paid?.total ?? 0;
    const cashRefunded = refunded?.total ?? 0;
    return {
      expectedCash: Math.max(0, paise(cashIn - cashRefunded) / 100),
      cashIn,
      cashRefunded,
      paymentCount: paid?.count ?? 0,
    };
  }

  async summary(clinicId: Types.ObjectId, branchId: Types.ObjectId, date: string) {
    const figures = await this.expected(clinicId, branchId, date);
    const record = await this.cashDayModel.findOne({ clinicId, branchId, date }).lean();
    return {
      date,
      branchId: branchId.toHexString(),
      ...figures,
      record: record ?? null,
    };
  }

  /**
   * Record (or redo) the count. A recount replaces the previous one until the
   * day is approved; after that it is refused, so a signed-off day cannot be
   * quietly changed.
   */
  async submit(input: {
    clinicId: Types.ObjectId;
    branchId: Types.ObjectId;
    date: string;
    countedCash: number;
    expectedCash: number;
    note?: string;
    clientId?: string;
    actorUserId?: Types.ObjectId;
    deviceId?: string;
  }) {
    const note = input.note?.trim() || undefined;
    if (isMismatch(input.countedCash, input.expectedCash) && !note) {
      throw new BadRequestException(
        'The count does not match the expected cash — add a note explaining the difference',
      );
    }

    const fields = {
      countedCash: input.countedCash,
      expectedAtCount: input.expectedCash,
      countNote: note,
      countedBy: input.actorUserId,
      countedAt: new Date(),
      deviceId: input.deviceId,
    };
    const key = { clinicId: input.clinicId, branchId: input.branchId, date: input.date };

    const recount = async () => {
      const existing = await this.cashDayModel.findOne(key);
      if (!existing) return null;
      if (existing.status === CashDayStatus.Approved) {
        throw new ConflictException('This day has already been approved and cannot be recounted');
      }
      Object.assign(existing, fields);
      await existing.save();
      return existing.toObject();
    };

    const updated = await recount();
    if (updated) return updated;

    try {
      const created = await this.cashDayModel.create({
        ...clientIdFields(input.clientId),
        ...key,
        ...fields,
        status: CashDayStatus.Submitted,
      });
      return created.toObject();
    } catch (err) {
      // Two counts for the same day raced; the loser becomes a recount.
      if ((err as { code?: number })?.code === 11000) {
        const raced = await recount();
        if (raced) return raced;
      }
      throw err;
    }
  }

  /**
   * Sign a day off against the **server's** expected figure — by now every
   * device's cash has synced, which is the post-sync reconciliation.
   */
  async approve(input: {
    clinicId: Types.ObjectId;
    id: string;
    note?: string;
    actorUserId?: Types.ObjectId;
  }) {
    if (!Types.ObjectId.isValid(input.id)) throw new NotFoundException('Cash day not found');
    const day = await this.cashDayModel.findOne({
      _id: new Types.ObjectId(input.id),
      clinicId: input.clinicId,
    });
    if (!day) throw new NotFoundException('Cash day not found');
    if (day.status === CashDayStatus.Approved) {
      throw new ConflictException('Already approved');
    }

    const { expectedCash } = await this.expected(input.clinicId, day.branchId, day.date);
    const note = input.note?.trim() || undefined;
    if (isMismatch(day.countedCash, expectedCash) && !note) {
      throw new BadRequestException(
        `Counted cash differs from expected (${expectedCash}) — add a note to approve the difference`,
      );
    }

    day.status = CashDayStatus.Approved;
    day.expectedAtApproval = expectedCash;
    day.approvalNote = note;
    day.approvedBy = input.actorUserId;
    day.approvedAt = new Date();
    await day.save();
    return day.toObject();
  }

  /** Days counted but not yet signed off, each with the current server figure. */
  async listPending(clinicId: Types.ObjectId) {
    const days = await this.cashDayModel
      .find({ clinicId, status: CashDayStatus.Submitted })
      .sort({ date: -1 })
      .limit(60)
      .lean();
    const out: Array<(typeof days)[number] & { expectedCash: number }> = [];
    for (const d of days) {
      const { expectedCash } = await this.expected(clinicId, d.branchId, d.date);
      out.push({ ...d, expectedCash });
    }
    return out;
  }
}
