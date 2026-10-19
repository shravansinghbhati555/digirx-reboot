import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PatientLinkDocument = HydratedDocument<PatientLink>;

export enum PatientLinkStatus {
  Active = 'ACTIVE',
  Revoked = 'REVOKED',
}

export enum PatientLinkVia {
  /** Clinic record carries the mobile number that just passed OTP. */
  PhoneVerified = 'PHONE_VERIFIED',
  /** Clinic record carries the verified mobile AND the same date of birth. */
  PhoneDobConfirmed = 'PHONE_DOB_CONFIRMED',
  /** The portal created this clinic record when the person first booked there. */
  PortalSelfRegister = 'PORTAL_SELF_REGISTER',
}

/**
 * Connects a portal account to ONE clinic-specific Patient record.
 *
 * The clinic record stays exactly as it is — a link only lets that person
 * read their own data through the portal. Revoking a link hides the clinic
 * from the portal immediately; nothing is deleted.
 */
@Schema({ timestamps: true })
export class PatientLink {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  accountId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  patientId!: Types.ObjectId;

  @Prop({
    required: true,
    enum: PatientLinkStatus,
    default: PatientLinkStatus.Active,
  })
  status!: PatientLinkStatus;

  @Prop({ required: true, enum: PatientLinkVia })
  linkedVia!: PatientLinkVia;

  @Prop({ type: Date, required: true })
  verifiedAt!: Date;

  @Prop({ type: Date })
  revokedAt?: Date;
}

export const PatientLinkSchema = SchemaFactory.createForClass(PatientLink);

// A clinic record can be claimed by at most one account at a time.
PatientLinkSchema.index(
  { clinicId: 1, patientId: 1 },
  {
    unique: true,
    name: 'patientlink_active_record_unique',
    partialFilterExpression: { status: PatientLinkStatus.Active },
  },
);
PatientLinkSchema.index(
  { accountId: 1, status: 1, clinicId: 1 },
  { name: 'patientlink_account_idx' },
);
