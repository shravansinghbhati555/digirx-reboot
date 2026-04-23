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

  @Prop({ type: Types.ObjectId, required: true, index: true })
  doctorId!: Types.ObjectId; // references User

  @Prop({ type: Types.ObjectId, required: true, index: true })
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

  @Prop({ type: Types.ObjectId })
  createdBy?: Types.ObjectId;
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);

AppointmentSchema.index(
  { clinicId: 1, branchId: 1, doctorId: 1, startAt: 1 },
  { name: 'appt_time_lookup_idx' },
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
