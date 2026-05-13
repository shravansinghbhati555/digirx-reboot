import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AppointmentDocument = HydratedDocument<Appointment>;

export enum AppointmentType {
  Time = 'TIME',
  Queue = 'QUEUE',
}

export enum AppointmentStatus {
  Booked = 'BOOKED',
  CheckedIn = 'CHECKED_IN',
  InProgress = 'IN_PROGRESS',
  Done = 'DONE',
  Cancelled = 'CANCELLED',
  NoShow = 'NO_SHOW',
}

export enum AppointmentSource {
  FrontDesk = 'FRONT_DESK',
  PatientPortal = 'PATIENT_PORTAL',
  Internal = 'INTERNAL',
}

@Schema({ timestamps: true })
export class Appointment {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true, ref: 'User' })
  doctorId!: Types.ObjectId; // references User

  @Prop({ type: Types.ObjectId, required: true, index: true, ref: 'Patient' })
  patientId!: Types.ObjectId;

  @Prop({ required: true, enum: AppointmentType, index: true })
  type!: AppointmentType;

  // TIME appointment fields
  @Prop({ type: Date })
  startAt?: Date;

  @Prop({ type: Date })
  endAt?: Date;

  // QUEUE appointment fields
  @Prop({ type: String })
  queueDate?: string; // YYYY-MM-DD in clinic timezone

  @Prop({ type: Number })
  queueNumber?: number;

  @Prop({
    required: true,
    enum: AppointmentStatus,
    default: AppointmentStatus.Booked,
    index: true,
  })
  status!: AppointmentStatus;

  @Prop({
    required: true,
    enum: AppointmentSource,
    default: AppointmentSource.FrontDesk,
    index: true,
  })
  source!: AppointmentSource;

  @Prop()
  notes?: string;

  // Visit-type + auto-issued bill linkage. New per-doctor pricing flow
  // (the front desk picks a visit type at booking time → BE creates an
  // ISSUED bill of that price → patient must pay before check-in).
  // Both optional during transition: legacy appointments don't have
  // either field and continue to behave as they always did (bill is
  // generated post-visit if at all).
  @Prop({ type: Types.ObjectId, ref: 'VisitType' })
  visitTypeId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Bill', index: true })
  billId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  createdBy?: Types.ObjectId;

  // Cancellation audit. `cancellationReason` is required at the API layer
  // for cancel transitions but the field itself is optional on the schema
  // so legacy data migrates cleanly.
  @Prop({ trim: true })
  cancellationReason?: string;

  @Prop({ type: Date })
  cancelledAt?: Date;

  @Prop({ type: Types.ObjectId })
  cancelledBy?: Types.ObjectId;
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);

AppointmentSchema.index(
  { clinicId: 1, branchId: 1, doctorId: 1, startAt: 1 },
  { name: 'appt_time_lookup_idx' },
);
// TIME: prevent two appointments with the same exact start time on the
// same doctor + branch. This is a DB-level fence behind the application
// overlap check — anything bypassing the service (seed scripts, direct
// DB writes, a race during the non-transactional fallback path on a
// standalone Mongo) will hit this index and fail with a duplicate-key
// error instead of silently double-booking the slot.
//
// Filtered on type=TIME and only slot-holding statuses so that
// cancelling/no-showing an existing appointment frees the slot for a
// new booking at the same start time.
AppointmentSchema.index(
  { clinicId: 1, branchId: 1, doctorId: 1, type: 1, startAt: 1 },
  {
    unique: true,
    name: 'appt_time_no_dup_idx',
    partialFilterExpression: {
      type: AppointmentType.Time,
      status: {
        $in: [
          AppointmentStatus.Booked,
          AppointmentStatus.CheckedIn,
          AppointmentStatus.InProgress,
          AppointmentStatus.Done,
        ],
      },
    },
  },
);
// QUEUE: ensure unique token numbers per doctor per day (only applies to QUEUE docs).
AppointmentSchema.index(
  {
    clinicId: 1,
    branchId: 1,
    doctorId: 1,
    type: 1,
    queueDate: 1,
    queueNumber: 1,
  },
  {
    unique: true,
    sparse: true,
    name: 'appt_queue_unique_idx',
    partialFilterExpression: { type: AppointmentType.Queue },
  },
);
