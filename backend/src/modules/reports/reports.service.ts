import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Appointment } from '../appointments/schemas/appointment.schema';
import { Bill, BillStatus } from '../billing/schemas/bill.schema';
import { Payment } from '../billing/schemas/payment.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { computeClinicDayRange } from '../../common/clinic-time';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(Bill.name) private readonly billModel: Model<Bill>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
  ) {}

  private async resolveTimezone(clinicId: Types.ObjectId): Promise<string> {
    const clinic = await this.clinicModel.findById(clinicId);
    return clinic?.timezone || 'UTC';
  }

  private async resolveDay(
    clinicId: Types.ObjectId,
    date: string,
  ): Promise<{ dayStart: Date; dayEnd: Date; tz: string }> {
    const tz = await this.resolveTimezone(clinicId);
    try {
      const { startUtc, endUtc } = computeClinicDayRange(date, tz);
      return { dayStart: startUtc, dayEnd: endUtc, tz };
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid date',
      );
    }
  }

  private async resolveRange(
    clinicId: Types.ObjectId,
    from?: string,
    to?: string,
  ): Promise<{ start: Date; end: Date; tz: string }> {
    if (!from || !to) {
      throw new BadRequestException('from and to are required (YYYY-MM-DD)');
    }
    const tz = await this.resolveTimezone(clinicId);
    let startRange: { startUtc: Date };
    let endRange: { endUtc: Date };
    try {
      startRange = computeClinicDayRange(from, tz);
      endRange = computeClinicDayRange(to, tz);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid date range',
      );
    }
    if (endRange.endUtc < startRange.startUtc) {
      throw new BadRequestException('to must be >= from');
    }
    return { start: startRange.startUtc, end: endRange.endUtc, tz };
  }

  async revenueSummary(
    clinicId: Types.ObjectId,
    from?: string,
    to?: string,
    branchId?: string,
  ) {
    const { start, end, tz } = await this.resolveRange(clinicId, from, to);
    const branchFilter = branchId
      ? { branchId: new Types.ObjectId(branchId) }
      : {};

    const issuedBills = await this.billModel.aggregate([
      {
        $match: {
          clinicId,
          ...branchFilter,
          status: BillStatus.Issued,
          issuedAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalBilled: { $sum: '$total' },
        },
      },
    ]);

    const payments = await this.paymentModel.aggregate([
      {
        $match: {
          clinicId,
          ...(branchId ? { branchId: new Types.ObjectId(branchId) } : {}),
          paidAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalPaid: { $sum: '$amount' },
        },
      },
    ]);

    const billed = issuedBills[0] ?? { count: 0, totalBilled: 0 };
    const paid = payments[0] ?? { count: 0, totalPaid: 0 };

    return {
      from,
      to,
      timezone: tz,
      branchId: branchId ?? null,
      issuedBills: {
        count: billed.count,
        totalBilled: billed.totalBilled ?? 0,
      },
      payments: { count: paid.count, totalPaid: paid.totalPaid ?? 0 },
    };
  }

  async dailySchedule(
    clinicId: Types.ObjectId,
    date: string,
    branchId: string,
  ) {
    const { dayStart, dayEnd, tz } = await this.resolveDay(clinicId, date);
    const bId = new Types.ObjectId(branchId);

    const items = await this.apptModel
      .find({
        clinicId,
        branchId: bId,
        $or: [
          { type: 'TIME', startAt: { $gte: dayStart, $lte: dayEnd } },
          { type: 'QUEUE', queueDate: date },
        ],
      })
      .sort({ doctorId: 1, startAt: 1, queueNumber: 1 });

    const byDoctor: Record<
      string,
      {
        total: number;
        byStatus: Record<string, number>;
        byType: Record<string, number>;
      }
    > = {};

    for (const a of items) {
      const d = a.doctorId.toHexString();
      if (!byDoctor[d]) byDoctor[d] = { total: 0, byStatus: {}, byType: {} };
      byDoctor[d].total += 1;
      byDoctor[d].byStatus[a.status] =
        (byDoctor[d].byStatus[a.status] ?? 0) + 1;
      byDoctor[d].byType[a.type] = (byDoctor[d].byType[a.type] ?? 0) + 1;
    }

    return {
      date,
      timezone: tz,
      branchId,
      total: items.length,
      byDoctor,
      items,
    };
  }

  async pendingPayments(
    clinicId: Types.ObjectId,
    branchId?: string,
    limit = 50,
  ) {
    const bFilter = branchId ? { branchId: new Types.ObjectId(branchId) } : {};

    const rows = await this.billModel.aggregate([
      {
        $match: {
          clinicId,
          ...bFilter,
          status: BillStatus.Issued,
        },
      },
      {
        $lookup: {
          from: 'payments',
          localField: '_id',
          foreignField: 'billId',
          as: 'payments',
        },
      },
      {
        $addFields: {
          totalPaid: { $sum: '$payments.amount' },
        },
      },
      {
        $addFields: {
          outstanding: { $max: [0, { $subtract: ['$total', '$totalPaid'] }] },
        },
      },
      { $match: { outstanding: { $gt: 0 } } },
      { $sort: { outstanding: -1, issuedAt: -1 } },
      { $limit: Math.max(1, Math.min(200, limit)) },
      {
        $project: {
          payments: 0,
        },
      },
    ]);

    return { branchId: branchId ?? null, count: rows.length, rows };
  }
}
