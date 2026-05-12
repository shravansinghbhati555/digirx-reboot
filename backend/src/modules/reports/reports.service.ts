import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Appointment, AppointmentStatus, AppointmentType } from '../appointments/schemas/appointment.schema';
import { Model, QueryFilter, Types } from 'mongoose';
import { Bill, BillStatus } from '../billing/schemas/bill.schema';
import { Payment } from '../billing/schemas/payment.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { DoctorAvailabilityRule } from '../availability/schemas/doctor-availability-rule.schema';
import { CreditNotesService } from '../credit-notes/credit-notes.service';
import { computeClinicDayRange } from '../../common/clinic-time';
import { DateTime } from 'luxon';

export type Bucket = 'day' | 'week' | 'month';
const NON_BILLABLE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.Cancelled,
  AppointmentStatus.NoShow,
];

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(Bill.name) private readonly billModel: Model<Bill>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(DoctorAvailabilityRule.name)
    private readonly ruleModel: Model<DoctorAvailabilityRule>,
    private readonly creditNotes: CreditNotesService,
  ) { }

  private async resolveBranchName(clinicId: Types.ObjectId, branchId?: string): Promise<string | null> {
    if (!branchId) return null;
    try {
      const b = await this.branchModel.findOne({ _id: branchId, clinicId });
      return b?.name || null;
    } catch {
      return null;
    }
  }

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
          status: { $in: [BillStatus.Issued, BillStatus.Paid] },
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
    const refunds = await this.creditNotes.sumRefundsInRange(clinicId, {
      start,
      end,
      branchId: branchId ? new Types.ObjectId(branchId) : undefined,
    });

    // Net revenue = cash collected (paid) − cash returned (refunds via CN).
    // The bill totals don't change on refund; only the cash-flow does.
    const netRevenue = (paid.totalPaid ?? 0) - (refunds.totalRefunded ?? 0);

    return {
      from,
      to,
      timezone: tz,
      branchId: branchId ?? null,
      branchName: await this.resolveBranchName(clinicId, branchId),
      issuedBills: {
        count: billed.count,
        totalBilled: billed.totalBilled ?? 0,
      },
      payments: { count: paid.count, totalPaid: paid.totalPaid ?? 0 },
      refunds: {
        count: refunds.count,
        totalRefunded: refunds.totalRefunded,
      },
      netRevenue,
    };
  }

  async dailySchedule(
    clinicId: Types.ObjectId,
    date: string,
    branchId: string,
  ) {
    const { dayStart, dayEnd, tz } = await this.resolveDay(clinicId, date);
    const bId = new Types.ObjectId(branchId);

    const filter: QueryFilter<Appointment> = {
      clinicId,
      branchId: bId,
      $or: [
        { type: AppointmentType.Time, startAt: { $gte: dayStart, $lte: dayEnd } },
        { type: AppointmentType.Queue, queueDate: date },
      ],
    };

    const items = await this.apptModel
      .find(filter)
      .populate('patientId', 'fullName')
      .populate('doctorId', 'name')
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
      const d = String((a.doctorId as any)?._id || a.doctorId);
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
      branchName: await this.resolveBranchName(clinicId, branchId),
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
          status: { $in: [BillStatus.Issued, BillStatus.Paid] },
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
      {
        $lookup: {
          from: 'patients',
          localField: 'patientId',
          foreignField: '_id',
          as: 'patient',
        },
      },
      { $unwind: { path: '$patient', preserveNullAndEmptyArrays: true } },
    ]);

    return {
      branchId: branchId ?? null,
      branchName: await this.resolveBranchName(clinicId, branchId),
      count: rows.length,
      rows,
    };
  }

  /**
   * Daily (or weekly/monthly) count + value of issued bills, bucketed in the
   * clinic's timezone. Mirrors `revenueTimeseries` but groups by `issuedAt`
   * on the Bill collection — feeds the "Bills issued" KPI detail chart on
   * the dashboard. Status filter includes Paid because issued → paid is the
   * normal lifecycle and we want the issuance-day count, not the still-open
   * count.
   */
  async billsIssuedTimeseries(
    clinicId: Types.ObjectId,
    from?: string,
    to?: string,
    bucketRaw?: string,
    branchId?: string,
  ) {
    const bucket = normaliseBucket(bucketRaw);
    const { start, end, tz } = await this.resolveRange(clinicId, from, to);
    const branchFilter = branchId
      ? { branchId: new Types.ObjectId(branchId) }
      : {};

    const issued = await this.billModel.aggregate<{
      _id: Date;
      count: number;
      totalBilled: number;
    }>([
      {
        $match: {
          clinicId,
          ...branchFilter,
          status: { $in: [BillStatus.Issued, BillStatus.Paid] },
          issuedAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$issuedAt',
              unit: bucket,
              timezone: tz,
              startOfWeek: 'monday',
            },
          },
          count: { $sum: 1 },
          totalBilled: { $sum: '$total' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const fmt = (d: Date) =>
      DateTime.fromJSDate(d, { zone: 'utc' }).setZone(tz).toISODate()!;
    const buckets = issued.map((r) => ({
      bucket: fmt(r._id),
      count: r.count,
      totalBilled: r.totalBilled,
    }));

    return {
      from,
      to,
      timezone: tz,
      bucket,
      branchId: branchId ?? null,
      buckets,
    };
  }

  /**
   * Cash-flow time series for charts. Buckets by day, week (ISO Mon–Sun), or
   * month using Mongo's `$dateTrunc` with the clinic timezone so the bucket
   * key is the local-date the operator expects to see in the chart.
   *
   * Returns one row per bucket with payments + refunds + net.
   */
  async revenueTimeseries(
    clinicId: Types.ObjectId,
    from?: string,
    to?: string,
    bucketRaw?: string,
    branchId?: string,
  ) {
    const bucket = normaliseBucket(bucketRaw);
    const { start, end, tz } = await this.resolveRange(clinicId, from, to);
    const branchObj = branchId ? new Types.ObjectId(branchId) : undefined;
    const branchFilter = branchObj ? { branchId: branchObj } : {};

    const paid = await this.paymentModel.aggregate<{
      _id: Date;
      totalPaid: number;
      count: number;
    }>([
      {
        $match: {
          clinicId,
          ...branchFilter,
          paidAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$paidAt',
              unit: bucket,
              timezone: tz,
              startOfWeek: 'monday',
            },
          },
          totalPaid: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const refunded = await this.creditNotes.refundTimeseries(clinicId, {
      start,
      end,
      bucket,
      tz,
      branchId: branchObj,
    });

    // Merge the two series by bucket key (ISO date string in clinic TZ).
    const fmt = (d: Date) =>
      DateTime.fromJSDate(d, { zone: 'utc' }).setZone(tz).toISODate()!;
    const map = new Map<
      string,
      {
        bucket: string;
        totalPaid: number;
        paidCount: number;
        totalRefunded: number;
        refundCount: number;
      }
    >();
    for (const p of paid) {
      const key = fmt(p._id);
      map.set(key, {
        bucket: key,
        totalPaid: p.totalPaid,
        paidCount: p.count,
        totalRefunded: 0,
        refundCount: 0,
      });
    }
    for (const r of refunded) {
      const key = fmt(r._id);
      const row = map.get(key) ?? {
        bucket: key,
        totalPaid: 0,
        paidCount: 0,
        totalRefunded: 0,
        refundCount: 0,
      };
      row.totalRefunded = r.totalRefunded;
      row.refundCount = r.count;
      map.set(key, row);
    }

    const buckets = Array.from(map.values())
      .map((b) => ({
        ...b,
        netRevenue: b.totalPaid - b.totalRefunded,
      }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    return {
      from,
      to,
      timezone: tz,
      bucket,
      branchId: branchId ?? null,
      buckets,
    };
  }

  /**
   * Per-doctor utilisation across the date range. "Utilisation" is the ratio
   * of booked TIME slots to estimated capacity. Capacity is approximated
   * from the doctor's weekly availability rules (sum of window-minutes by
   * weekday / slotMinutes), spread over the range — exact day-by-day
   * resolution would require N×D Availability calls and isn't worth the
   * latency for a report that's read in aggregate.
   */
  async doctorUtilization(
    clinicId: Types.ObjectId,
    from?: string,
    to?: string,
    branchId?: string,
  ) {
    const { start, end, tz } = await this.resolveRange(clinicId, from, to);
    const branchObj = branchId ? new Types.ObjectId(branchId) : undefined;

    const apptMatch: Record<string, unknown> = {
      clinicId,
      type: AppointmentType.Time,
      status: { $nin: NON_BILLABLE_STATUSES },
      startAt: { $gte: start, $lte: end },
    };
    if (branchObj) apptMatch.branchId = branchObj;

    const booked = await this.apptModel.aggregate<{
      _id: Types.ObjectId;
      bookedSlots: number;
    }>([
      { $match: apptMatch },
      { $group: { _id: '$doctorId', bookedSlots: { $sum: 1 } } },
    ]);

    // Fetch all matching weekly rules in one pass; group by doctorUserId
    // so we can compute weekly slot capacity per doctor.
    const ruleMatch: Record<string, unknown> = { clinicId, active: true };
    if (branchObj) ruleMatch.branchId = branchObj;
    const rules = await this.ruleModel.find(ruleMatch);

    const dayCount = countDaysInRangeByWeekday(start, end, tz);

    const capacityByDoctor = new Map<string, number>();
    for (const r of rules) {
      const slotMinutes = r.slotMinutes && r.slotMinutes > 0 ? r.slotMinutes : 15;
      const winMinutes = (r.windows ?? []).reduce(
        (s, w) => s + Math.max(0, w.endMinutes - w.startMinutes),
        0,
      );
      const slotsThisWeekday = Math.floor(winMinutes / slotMinutes);
      const days = dayCount[r.weekday] ?? 0;
      const key = r.doctorUserId.toHexString();
      capacityByDoctor.set(
        key,
        (capacityByDoctor.get(key) ?? 0) + slotsThisWeekday * days,
      );
    }

    const allDoctorIds = new Set<string>([
      ...booked.map((b) => b._id.toHexString()),
      ...capacityByDoctor.keys(),
    ]);

    const doctors = Array.from(allDoctorIds).map((id) => {
      const bookedSlots = booked.find((b) => b._id.toHexString() === id)?.bookedSlots ?? 0;
      const capacity = capacityByDoctor.get(id) ?? 0;
      const utilizationPct =
        capacity > 0 ? Math.min(100, Math.round((bookedSlots / capacity) * 1000) / 10) : null;
      return { doctorId: id, bookedSlots, capacitySlots: capacity, utilizationPct };
    });

    return {
      from,
      to,
      timezone: tz,
      branchId: branchId ?? null,
      doctors: doctors.sort((a, b) => b.bookedSlots - a.bookedSlots),
    };
  }

  /**
   * Patient cohort split for the range. A patient is "new" iff their
   * first-ever appointment in this clinic falls inside the range; otherwise
   * "returning".
   */
  async newVsReturningPatients(
    clinicId: Types.ObjectId,
    from?: string,
    to?: string,
  ) {
    const { start, end, tz } = await this.resolveRange(clinicId, from, to);

    const patientsInRange = await this.apptModel.aggregate<{
      _id: Types.ObjectId;
      firstInRange: Date | null;
    }>([
      {
        $match: {
          clinicId,
          $or: [
            { startAt: { $gte: start, $lte: end } },
            // QUEUE appts: queueDate is local YYYY-MM-DD; cast to a Date
            // for sorting purposes via the row's createdAt instead.
            {
              type: AppointmentType.Queue,
              createdAt: { $gte: start, $lte: end },
            },
          ],
        },
      },
      {
        $group: {
          _id: '$patientId',
          firstInRange: {
            $min: { $ifNull: ['$startAt', '$createdAt'] },
          },
        },
      },
    ]);

    if (!patientsInRange.length) {
      return {
        from,
        to,
        timezone: tz,
        new: 0,
        returning: 0,
        total: 0,
      };
    }

    const ids = patientsInRange.map((p) => p._id);
    // Single aggregation: for each patient, find their earliest-ever appt
    // anchor and compare against `start`.
    const earliestEver = await this.apptModel.aggregate<{
      _id: Types.ObjectId;
      firstEver: Date;
    }>([
      { $match: { clinicId, patientId: { $in: ids } } },
      {
        $group: {
          _id: '$patientId',
          firstEver: {
            $min: { $ifNull: ['$startAt', '$createdAt'] },
          },
        },
      },
    ]);
    const firstEverByPatient = new Map(
      earliestEver.map((e) => [e._id.toHexString(), e.firstEver]),
    );

    let isNew = 0;
    let returning = 0;
    for (const p of patientsInRange) {
      const firstEver = firstEverByPatient.get(p._id.toHexString());
      if (firstEver && firstEver >= start) isNew += 1;
      else returning += 1;
    }

    return {
      from,
      to,
      timezone: tz,
      new: isNew,
      returning,
      total: isNew + returning,
    };
  }
}

function normaliseBucket(raw?: string): Bucket {
  const v = (raw ?? 'day').toLowerCase();
  if (v === 'week' || v === 'month' || v === 'day') return v;
  throw new BadRequestException("bucket must be 'day', 'week', or 'month'");
}

/**
 * For a UTC range, count how many local-clinic days fall on each weekday
 * (Sun=0..Sat=6). Used to multiply per-weekday capacity into a range total.
 */
function countDaysInRangeByWeekday(
  start: Date,
  end: Date,
  tz: string,
): Record<number, number> {
  const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let cursor = DateTime.fromJSDate(start, { zone: 'utc' }).setZone(tz).startOf('day');
  const last = DateTime.fromJSDate(end, { zone: 'utc' }).setZone(tz).startOf('day');
  while (cursor <= last) {
    // Luxon weekday: 1=Mon..7=Sun. Schema uses 0=Sun..6=Sat.
    const wd = cursor.weekday % 7;
    counts[wd] += 1;
    cursor = cursor.plus({ days: 1 });
  }
  return counts;
}
