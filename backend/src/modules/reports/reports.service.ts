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
import { FxService } from '../fx/fx.service';
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
    private readonly fx: FxService,
  ) { }

  /**
   * Resolve the target display currency for a clinic. Always the
   * clinic's configured currency — the dashboard always presents in
   * the active currency. Falls back to INR if unset.
   */
  private async resolveTargetCurrency(clinicId: Types.ObjectId): Promise<string> {
    const clinic = await this.clinicModel.findById(clinicId);
    return (clinic?.currency || 'INR').toUpperCase();
  }

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

    // Group by the bill's stored currency first — that's the only
    // honest way to roll up across a clinic that's had its currency
    // setting changed historically. FxService then converts each
    // per-currency bucket into the active display currency.
    const target = await this.resolveTargetCurrency(clinicId);

    const issuedBillsByCurrency = await this.billModel.aggregate<{
      _id: string;
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
          _id: '$currency',
          count: { $sum: 1 },
          totalBilled: { $sum: '$total' },
        },
      },
    ]);

    // Payments don't carry their own currency — they inherit from the
    // bill via billId. $lookup joins them so we can group correctly.
    const paymentsByCurrency = await this.paymentModel.aggregate<{
      _id: string;
      count: number;
      totalPaid: number;
    }>([
      {
        $match: {
          clinicId,
          ...(branchId ? { branchId: new Types.ObjectId(branchId) } : {}),
          paidAt: { $gte: start, $lte: end },
        },
      },
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
          currency: { $ifNull: [{ $arrayElemAt: ['$bill.currency', 0] }, target] },
        },
      },
      {
        $group: {
          _id: '$currency',
          count: { $sum: 1 },
          totalPaid: { $sum: '$amount' },
        },
      },
    ]);

    const billedConv = await this.fx.sumInto(
      issuedBillsByCurrency.map((b) => ({ currency: b._id || target, amount: b.totalBilled })),
      target,
    );
    const paidConv = await this.fx.sumInto(
      paymentsByCurrency.map((p) => ({ currency: p._id || target, amount: p.totalPaid })),
      target,
    );

    const billed = {
      count: issuedBillsByCurrency.reduce((s, b) => s + b.count, 0),
      totalBilled: billedConv.total,
    };
    const paid = {
      count: paymentsByCurrency.reduce((s, p) => s + p.count, 0),
      totalPaid: paidConv.total,
    };
    const refunds = await this.creditNotes.sumRefundsInRange(clinicId, {
      start,
      end,
      branchId: branchId ? new Types.ObjectId(branchId) : undefined,
    });
    const refundsConv = await this.fx.sumInto(refunds.perCurrency ?? [], target);

    // Net revenue = cash collected (paid) − cash returned (refunds via CN).
    // The bill totals don't change on refund; only the cash-flow does.
    const netRevenue = (paid.totalPaid ?? 0) - refundsConv.total;

    return {
      from,
      to,
      timezone: tz,
      branchId: branchId ?? null,
      branchName: await this.resolveBranchName(clinicId, branchId),
      // All monetary fields below are expressed in `currency`. When a
      // bill was issued in a different currency we converted it via
      // FxService.sumInto — see the `unconverted` arrays for any
      // currencies whose rates we couldn't resolve.
      currency: target,
      issuedBills: {
        count: billed.count,
        totalBilled: billed.totalBilled ?? 0,
        breakdown: billedConv.breakdown,
        unconverted: billedConv.unconverted,
      },
      payments: {
        count: paid.count,
        totalPaid: paid.totalPaid ?? 0,
        breakdown: paidConv.breakdown,
        unconverted: paidConv.unconverted,
      },
      refunds: {
        count: refunds.count,
        totalRefunded: refundsConv.total,
        breakdown: refundsConv.breakdown,
        unconverted: refundsConv.unconverted,
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

    // Bucket the outstanding amounts by each bill's stored currency,
    // then convert into the clinic's display currency. Rows themselves
    // keep their original currency (the BillingScreen list shows them
    // each with their own symbol).
    const target = await this.resolveTargetCurrency(clinicId);
    const perCurrency = new Map<string, number>();
    for (const r of rows) {
      const cur = String((r as { currency?: string }).currency ?? target).toUpperCase();
      const outstanding = Number((r as { outstanding?: number }).outstanding ?? 0);
      perCurrency.set(cur, (perCurrency.get(cur) ?? 0) + outstanding);
    }
    const conv = await this.fx.sumInto(
      Array.from(perCurrency.entries()).map(([currency, amount]) => ({ currency, amount })),
      target,
    );

    return {
      branchId: branchId ?? null,
      branchName: await this.resolveBranchName(clinicId, branchId),
      count: rows.length,
      rows,
      currency: target,
      totalOutstanding: conv.total,
      breakdown: conv.breakdown,
      unconverted: conv.unconverted,
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

    // Two-key group: (time bucket, currency). For each bucket we then
    // convert each per-currency sum to the clinic display currency and
    // collapse into a single per-bucket total.
    const issued = await this.billModel.aggregate<{
      _id: { bucket: Date; currency: string };
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
            bucket: {
              $dateTrunc: {
                date: '$issuedAt',
                unit: bucket,
                timezone: tz,
                startOfWeek: 'monday',
              },
            },
            currency: '$currency',
          },
          count: { $sum: 1 },
          totalBilled: { $sum: '$total' },
        },
      },
      { $sort: { '_id.bucket': 1 } },
    ]);

    const target = await this.resolveTargetCurrency(clinicId);
    const fmt = (d: Date) =>
      DateTime.fromJSDate(d, { zone: 'utc' }).setZone(tz).toISODate()!;

    // Collapse the (bucket, currency) rows into a per-bucket map, with
    // per-currency sub-totals carried alongside so the FE can show
    // breakdowns on hover.
    const byBucket = new Map<string, {
      count: number;
      perCurrency: Array<{ currency: string; amount: number }>;
    }>();
    for (const r of issued) {
      const key = fmt(r._id.bucket);
      const cur = String(r._id.currency || target).toUpperCase();
      const cell = byBucket.get(key) ?? { count: 0, perCurrency: [] };
      cell.count += r.count;
      cell.perCurrency.push({ currency: cur, amount: r.totalBilled });
      byBucket.set(key, cell);
    }

    const buckets: Array<{ bucket: string; count: number; totalBilled: number }> = [];
    for (const [key, cell] of Array.from(byBucket.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const conv = await this.fx.sumInto(cell.perCurrency, target);
      buckets.push({ bucket: key, count: cell.count, totalBilled: conv.total });
    }

    return {
      from,
      to,
      timezone: tz,
      bucket,
      branchId: branchId ?? null,
      currency: target,
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

    // Two-key group: (time bucket, bill currency). Payments inherit
    // their currency from the bill via $lookup so cross-currency
    // payments collapse correctly into per-bucket totals later.
    const paid = await this.paymentModel.aggregate<{
      _id: { bucket: Date; currency: string };
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
                date: '$paidAt',
                unit: bucket,
                timezone: tz,
                startOfWeek: 'monday',
              },
            },
            currency: '$currency',
          },
          totalPaid: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.bucket': 1 } },
    ]);

    const refunded = await this.creditNotes.refundTimeseries(clinicId, {
      start,
      end,
      bucket,
      tz,
      branchId: branchObj,
    });

    const target = await this.resolveTargetCurrency(clinicId);

    // Merge the two series by bucket key (ISO date string in clinic
    // TZ). Per-bucket payment totals are converted from each source
    // currency before being summed.
    const fmt = (d: Date) =>
      DateTime.fromJSDate(d, { zone: 'utc' }).setZone(tz).toISODate()!;

    // First collapse the (bucket, currency) payment rows by bucket so
    // we can convert each bucket's mixed-currency total in one shot.
    const paidByBucket = new Map<string, {
      perCurrency: Array<{ currency: string; amount: number }>;
      count: number;
    }>();
    for (const p of paid) {
      const key = fmt(p._id.bucket);
      const cur = String(p._id.currency || target).toUpperCase();
      const cell = paidByBucket.get(key) ?? { perCurrency: [], count: 0 };
      cell.perCurrency.push({ currency: cur, amount: p.totalPaid });
      cell.count += p.count;
      paidByBucket.set(key, cell);
    }

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
    for (const [key, cell] of paidByBucket.entries()) {
      const conv = await this.fx.sumInto(cell.perCurrency, target);
      map.set(key, {
        bucket: key,
        totalPaid: conv.total,
        paidCount: cell.count,
        totalRefunded: 0,
        refundCount: 0,
      });
    }
    // Refunds come back per (bucket, currency). Collapse per bucket so
    // we can convert each bucket's mixed-currency refund total in one
    // FX call, mirroring the payments treatment above.
    const refundsByBucket = new Map<string, {
      perCurrency: Array<{ currency: string; amount: number }>;
      count: number;
    }>();
    for (const r of refunded) {
      const key = fmt(r._id.bucket);
      const cur = String(r._id.currency || target).toUpperCase();
      const cell = refundsByBucket.get(key) ?? { perCurrency: [], count: 0 };
      cell.perCurrency.push({ currency: cur, amount: r.totalRefunded });
      cell.count += r.count;
      refundsByBucket.set(key, cell);
    }
    for (const [key, cell] of refundsByBucket.entries()) {
      const conv = await this.fx.sumInto(cell.perCurrency, target);
      const row = map.get(key) ?? {
        bucket: key,
        totalPaid: 0,
        paidCount: 0,
        totalRefunded: 0,
        refundCount: 0,
      };
      row.totalRefunded = conv.total;
      row.refundCount = cell.count;
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
      currency: target,
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
