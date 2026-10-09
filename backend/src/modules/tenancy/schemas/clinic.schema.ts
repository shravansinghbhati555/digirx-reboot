import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ClinicDocument = HydratedDocument<Clinic>;

/**
 * Where a clinic sits in the onboarding pipeline.
 *
 * Self-service signups land in PENDING and cannot log in until a platform
 * admin approves them. Clinics created before this field existed have no
 * `status` at all; the login gate treats a missing status as ACTIVE so the
 * change can never lock an existing tenant out.
 */
export enum ClinicStatus {
  Pending = 'PENDING',
  Active = 'ACTIVE',
  Rejected = 'REJECTED',
  Suspended = 'SUSPENDED',
}

@Schema({ timestamps: true })
export class Clinic {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  countryCode!: string; // e.g. IN

  @Prop({ required: true, trim: true })
  timezone!: string; // e.g. Asia/Kolkata

  @Prop({ required: true, trim: true })
  currency!: string; // e.g. INR

  @Prop({ required: true, trim: true })
  phoneCountryCode!: string; // e.g. +91

  @Prop({ type: Object, default: {} })
  settings!: Record<string, unknown>;

  // Onboarding state. Not `required` on purpose — pre-existing clinics were
  // written without it and must keep working.
  @Prop({ enum: ClinicStatus, default: ClinicStatus.Active, index: true })
  status?: ClinicStatus;

  // Marks the DigiRx team's own workspace rather than a customer tenant. It
  // lives in this collection because the platform admins need a clinic to
  // belong to, but it is not a clinic: the approval queue hides it, and its
  // status cannot be changed through the API. Without that, an operator can
  // suspend the workspace they are signed in through and lock themselves out
  // of the console they would need to undo it.
  @Prop({ type: Boolean, default: false, index: true })
  isPlatformClinic?: boolean;

  // Who signed the clinic up. Kept so the approval queue can show the
  // requesting admin without a second lookup path.
  @Prop({ type: Types.ObjectId })
  requestedByUserId?: Types.ObjectId;

  @Prop({ trim: true })
  requestedByName?: string;

  @Prop({ trim: true })
  requestedByEmail?: string;

  @Prop({ type: Date })
  statusChangedAt?: Date;

  // Platform admin who last approved / rejected / suspended the clinic.
  @Prop({ type: Types.ObjectId })
  statusChangedByUserId?: Types.ObjectId;

  // Free-text reason recorded on reject or suspend, shown back to the
  // platform team in the queue.
  @Prop({ trim: true })
  statusReason?: string;
}

export const ClinicSchema = SchemaFactory.createForClass(Clinic);

ClinicSchema.index({ name: 1 }, { name: 'clinic_name_idx' });
// Drives the approval queue: newest pending clinics first.
ClinicSchema.index({ status: 1, createdAt: -1 }, { name: 'clinic_status_created_idx' });
