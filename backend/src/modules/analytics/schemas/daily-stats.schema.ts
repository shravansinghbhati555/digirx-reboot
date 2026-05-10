import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DailyStatsDocument = HydratedDocument<DailyStats>;

/**
 * One pre-aggregated row per (clinic, branch, local-day). The nightly
 * `AnalyticsAggregator` cron rolls the underlying transactional
 * collections (appointments, encounters, bills, payments, credit notes)
 * into this shape so the BI dashboards / FE charts don't re-run heavy
 * aggregations per request.
 *
 * `date` is a clinic-local YYYY-MM-DD string — same convention as
 * `Appointment.queueDate`. Querying by date range stays human-readable
 * without timezone gymnastics.
 */
@Schema({ timestamps: true })
export class DailyStats {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  date!: string;

  // -- appointments ---------------------------------------------------------

  @Prop({ type: Number, default: 0 })
  appointmentsBooked!: number;
  @Prop({ type: Number, default: 0 })
  appointmentsCheckedIn!: number;
  @Prop({ type: Number, default: 0 })
  appointmentsDone!: number;
  @Prop({ type: Number, default: 0 })
  appointmentsCancelled!: number;
  @Prop({ type: Number, default: 0 })
  appointmentsNoShow!: number;

  // -- encounters -----------------------------------------------------------

  @Prop({ type: Number, default: 0 })
  encountersSigned!: number;

  // -- billing --------------------------------------------------------------

  @Prop({ type: Number, default: 0 })
  billsIssued!: number;

  @Prop({ type: Number, default: 0 })
  totalBilled!: number;

  @Prop({ type: Number, default: 0 })
  totalPaid!: number;

  @Prop({ type: Number, default: 0 })
  totalRefunded!: number;

  /** totalPaid − totalRefunded. Cached so the FE can plot net revenue
   * without re-deriving on every request. */
  @Prop({ type: Number, default: 0 })
  netRevenue!: number;

  // -- patients -------------------------------------------------------------

  /** Patients whose first-ever appointment landed on this date. */
  @Prop({ type: Number, default: 0 })
  newPatients!: number;
  /** Patients with an appointment on this date who'd seen the clinic before. */
  @Prop({ type: Number, default: 0 })
  returningPatients!: number;

  // -- bookkeeping ----------------------------------------------------------

  /** When the row was last computed — useful for surfacing staleness. */
  @Prop({ type: Date, required: true })
  computedAt!: Date;
}

export const DailyStatsSchema = SchemaFactory.createForClass(DailyStats);

DailyStatsSchema.index(
  { clinicId: 1, branchId: 1, date: 1 },
  { unique: true, name: 'daily_stats_unique_per_branch_day' },
);
DailyStatsSchema.index(
  { clinicId: 1, date: 1 },
  { name: 'daily_stats_clinic_date_idx' },
);
