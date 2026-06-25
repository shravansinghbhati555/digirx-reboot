import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
} from '../appointments/schemas/appointment.schema';
import { Bill, BillStatus } from '../billing/schemas/bill.schema';
import { Payment } from '../billing/schemas/payment.schema';
import { CreditNote, CreditNoteStatus } from '../credit-notes/schemas/credit-note.schema';
import {
  Encounter,
  EncounterStatus,
} from '../encounters/schemas/encounter.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { computeClinicDayRange } from '../../common/clinic-time';
import { DailyStats } from './schemas/daily-stats.schema';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectModel(DailyStats.name)
    private readonly statsModel: Model<DailyStats>,
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(Encounter.name)
    private readonly encounterModel: Model<Encounter>,
    @InjectModel(Bill.name)
    private readonly billModel: Model<Bill>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<Payment>,
    @InjectModel(CreditNote.name)
    private readonly cnModel: Model<CreditNote>,
    @InjectModel(Clinic.name)
    private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name)
    private readonly branchModel: Model<Branch>,
  ) {}

  /**
   * Roll one (clinicId, branchId, date) into a DailyStats row. Idempotent —
   * an upsert means re-running for the same day refreshes the numbers
   * (important if a late refund or bill backdate changes yesterday's
   * totals after the fact).
   */
  async aggregateDay(
    clinicId: Types.ObjectId,
    branchId: Types.ObjectId,
    date: string,
  ): Promise<DailyStats> {
    const clinic = await this.clinicModel.findById(clinicId).lean();
    const tz = clinic?.timezone || 'UTC';
    const { startUtc, endUtc } = computeClinicDayRange(date, tz);

    const [appts, encounters, billsAgg, paymentsAgg, refundsAgg, newP] =
      await Promise.all([
        this.aggregateAppointments(clinicId, branchId, date, startUtc, endUtc),
        this.encounterModel.countDocuments({
          clinicId,
          branchId,
          status: EncounterStatus.Signed,
          signedAt: { $gte: startUtc, $lte: endUtc },
        }),
        this.aggregateBills(clinicId, branchId, startUtc, endUtc),
        this.aggregatePayments(clinicId, branchId, startUtc, endUtc),
        this.aggregateRefunds(clinicId, branchId, startUtc, endUtc),
        this.aggregatePatientCohort(clinicId, branchId, startUtc, endUtc),
      ]);

    const totalPaid = paymentsAgg.totalPaid;
    const totalRefunded = refundsAgg.totalRefunded;
    const netRevenue = totalPaid - totalRefunded;

    const update = {
      appointmentsBooked: appts.booked,
      appointmentsCheckedIn: appts.checkedIn,
      appointmentsDone: appts.done,
      appointmentsCancelled: appts.cancelled,
      appointmentsNoShow: appts.noShow,
      encountersSigned: encounters,
      billsIssued: billsAgg.count,
      totalBilled: billsAgg.totalBilled,
      totalPaid,
      totalRefunded,
      netRevenue,
      newPatients: newP.newPatients,
      returningPatients: newP.returningPatients,
      computedAt: new Date(),
    };

    const doc = await this.statsModel.findOneAndUpdate(
      { clinicId, branchId, date },
      { $set: update, $setOnInsert: { clinicId, branchId, date } },
      { upsert: true, new: true },
    );
    return doc!;
  }

  /**
   * Roll every clinic + branch for the given calendar date. Used by the
   * nightly cron and the admin backfill script. Failures on a single
   * branch are logged but don't stop the rest of the run — partial
   * progress beats no progress.
   */
  async aggregateForDate(date: string): Promise<{ ok: number; failed: number }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const branches = await this.branchModel.find({}, { clinicId: 1, _id: 1 });
    let ok = 0;
    let failed = 0;
    for (const b of branches) {
      try {
        await this.aggregateDay(b.clinicId, b._id, date);
        ok += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `aggregateDay failed for clinic=${b.clinicId} branch=${b._id} date=${date}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    this.logger.log(
      `aggregateForDate ${date} → ${ok} ok / ${failed} failed across ${branches.length} branches`,
    );
    return { ok, failed };
  }

  /** Read API: paginated raw rows for the FE / external BI. */
  async listDailyStats(
    clinicId: Types.ObjectId,
    opts: { from: string; to: string; branchId?: string },
  ): Promise<DailyStats[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.from) || !/^\d{4}-\d{2}-\d{2}$/.test(opts.to)) {
      throw new BadRequestException('from/to must be YYYY-MM-DD');
    }
    if (opts.from > opts.to) {
      throw new BadRequestException('to must be >= from');
    }
    const filter: Record<string, unknown> = {
      clinicId,
      date: { $gte: opts.from, $lte: opts.to },
    };
    if (opts.branchId) filter.branchId = new Types.ObjectId(opts.branchId);
    return await this.statsModel.find(filter).sort({ date: 1, branchId: 1 });
  }

  /** Range-rollup endpoint — useful for the dashboard "this month so far" tile. */
  async summarize(
    clinicId: Types.ObjectId,
    opts: { from: string; to: string; branchId?: string },
  ) {
    const rows = await this.listDailyStats(clinicId, opts);
    const acc = {
      from: opts.from,
      to: opts.to,
      branchId: opts.branchId ?? null,
      days: rows.length,
      appointmentsBooked: 0,
      appointmentsDone: 0,
      appointmentsCancelled: 0,
      encountersSigned: 0,
      billsIssued: 0,
      totalBilled: 0,
      totalPaid: 0,
      totalRefunded: 0,
      netRevenue: 0,
      newPatients: 0,
      returningPatients: 0,
    };
    for (const r of rows) {
      acc.appointmentsBooked += r.appointmentsBooked;
      acc.appointmentsDone += r.appointmentsDone;
      acc.appointmentsCancelled += r.appointmentsCancelled;
      acc.encountersSigned += r.encountersSigned;
      acc.billsIssued += r.billsIssued;
      acc.totalBilled += r.totalBilled;
      acc.totalPaid += r.totalPaid;
      acc.totalRefunded += r.totalRefunded;
      acc.netRevenue += r.netRevenue;
      acc.newPatients += r.newPatients;
      acc.returningPatients += r.returningPatients;
    }
    return acc;
  }

  // -- internals ---------------------------------------------------------

  private async aggregateAppointments(
    clinicId: Types.ObjectId,
    branchId: Types.ObjectId,
    date: string,
    startUtc: Date,
    endUtc: Date,
  ) {
    // TIME appts use startAt; QUEUE appts use queueDate (local YYYY-MM-DD).
    const filter = {
      clinicId,
      branchId,
      $or: [
        { type: AppointmentType.Time, startAt: { $gte: startUtc, $lte: endUtc } },
        { type: AppointmentType.Queue, queueDate: date },
      ],
    };
    const rows = await this.apptModel.aggregate<{
      _id: AppointmentStatus;
      count: number;
    }>([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const byStatus = new Map(rows.map((r) => [r._id, r.count]));
    return {
      booked: byStatus.get(AppointmentStatus.Booked) ?? 0,
      checkedIn: byStatus.get(AppointmentStatus.CheckedIn) ?? 0,
      done: byStatus.get(AppointmentStatus.Done) ?? 0,
      cancelled: byStatus.get(AppointmentStatus.Cancelled) ?? 0,
      noShow: byStatus.get(AppointmentStatus.NoShow) ?? 0,
    };
  }

  private async aggregateBills(
    clinicId: Types.ObjectId,
    branchId: Types.ObjectId,
    startUtc: Date,
    endUtc: Date,
  ) {
    const out = await this.billModel.aggregate<{
      count: number;
      totalBilled: number;
    }>([
      {
        $match: {
          clinicId,
          branchId,
          status: { $in: [BillStatus.Issued, BillStatus.Paid] },
          issuedAt: { $gte: startUtc, $lte: endUtc },
        },
      },
      { $group: { _id: null, count: { $sum: 1 }, totalBilled: { $sum: '$total' } } },
    ]);
    return out[0] ?? { count: 0, totalBilled: 0 };
  }

  private async aggregatePayments(
    clinicId: Types.ObjectId,
    branchId: Types.ObjectId,
    startUtc: Date,
    endUtc: Date,
  ) {
    const out = await this.paymentModel.aggregate<{ totalPaid: number }>([
      {
        $match: {
          clinicId,
          branchId,
          paidAt: { $gte: startUtc, $lte: endUtc },
        },
      },
      // Drop payments whose bill was voided — a cancelled invoice's cash
      // no longer counts toward collected revenue.
      {
        $lookup: {
          from: 'bills',
          localField: 'billId',
          foreignField: '_id',
          as: 'bill',
        },
      },
      { $match: { 'bill.0.status': { $ne: BillStatus.Void } } },
      { $group: { _id: null, totalPaid: { $sum: '$amount' } } },
    ]);
    return out[0] ?? { totalPaid: 0 };
  }

  private async aggregateRefunds(
    clinicId: Types.ObjectId,
    branchId: Types.ObjectId,
    startUtc: Date,
    endUtc: Date,
  ) {
    const out = await this.cnModel.aggregate<{ totalRefunded: number }>([
      {
        $match: {
          clinicId,
          branchId,
          status: CreditNoteStatus.Refunded,
          refundedAt: { $gte: startUtc, $lte: endUtc },
        },
      },
      { $group: { _id: null, totalRefunded: { $sum: '$amount' } } },
    ]);
    return out[0] ?? { totalRefunded: 0 };
  }

  /**
   * Cohort split for the day: a patient counts as "new" when their
   * first-ever appointment in this clinic falls inside this day.
   * Otherwise "returning". The split-per-day is more useful than the
   * range-based one in `ReportsService` because it accumulates over time
   * — yesterday's "new" stays "new" forever.
   */
  private async aggregatePatientCohort(
    clinicId: Types.ObjectId,
    branchId: Types.ObjectId,
    startUtc: Date,
    endUtc: Date,
  ) {
    const todayPatients = await this.apptModel.aggregate<{ _id: Types.ObjectId }>([
      {
        $match: {
          clinicId,
          branchId,
          $or: [
            { type: AppointmentType.Time, startAt: { $gte: startUtc, $lte: endUtc } },
            { type: AppointmentType.Queue, createdAt: { $gte: startUtc, $lte: endUtc } },
          ],
        },
      },
      { $group: { _id: '$patientId' } },
    ]);
    if (!todayPatients.length) return { newPatients: 0, returningPatients: 0 };

    const ids = todayPatients.map((p) => p._id);
    const earliest = await this.apptModel.aggregate<{ _id: Types.ObjectId; firstEver: Date }>([
      { $match: { clinicId, patientId: { $in: ids } } },
      {
        $group: {
          _id: '$patientId',
          firstEver: { $min: { $ifNull: ['$startAt', '$createdAt'] } },
        },
      },
    ]);
    const firstEver = new Map(earliest.map((e) => [e._id.toHexString(), e.firstEver]));
    let isNew = 0;
    let returning = 0;
    for (const p of todayPatients) {
      const fe = firstEver.get(p._id.toHexString());
      if (fe && fe >= startUtc) isNew += 1;
      else returning += 1;
    }
    return { newPatients: isNew, returningPatients: returning };
  }
}

/** Format a Date as YYYY-MM-DD in the given timezone. Used by callers
 * that need to derive "yesterday in clinic-local time" for the cron. */
export function clinicLocalDate(d: Date, tz: string): string {
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(tz).toISODate()!;
}
