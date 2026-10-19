import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PatientAccountDocument = HydratedDocument<PatientAccount>;

export enum PatientAccountStatus {
  Active = 'ACTIVE',
  Disabled = 'DISABLED',
}

export enum PatientAccountGender {
  Female = 'FEMALE',
  Male = 'MALE',
  Other = 'OTHER',
}

@Schema({ _id: false })
export class PortalPrivacy {
  @Prop({ type: Boolean, default: false })
  appLock!: boolean;

  @Prop({ type: Boolean, default: false })
  hidePreviews!: boolean;
}

/**
 * A person using the patient portal.
 *
 * This is the one collection that is deliberately NOT scoped by clinicId:
 * a person is global, and reaches clinic-specific `Patient` rows only
 * through explicit `PatientLink`s. Clinic records are never merged or
 * modified by creating an account or a link.
 *
 * Two kinds:
 *  - a login account, identified by a verified mobile number (`phone`);
 *  - a dependant (a minor) with no login of its own, managed by a guardian
 *    account (`managedByAccountId`).
 */
@Schema({ timestamps: true })
export class PatientAccount {
  /** Verified mobile, digits only, national format (e.g. 9845012345). */
  @Prop({ type: String, trim: true })
  phone?: string;

  /** Dial code without '+', e.g. "91". Used to build the E.164 SMS address. */
  @Prop({ type: String, trim: true, default: '91' })
  dialCode!: string;

  @Prop({ type: Types.ObjectId, index: true })
  managedByAccountId?: Types.ObjectId;

  /** Free-text relation of a dependant to its guardian, e.g. "Son". */
  @Prop({ type: String, trim: true })
  relation?: string;

  @Prop({ type: String, trim: true })
  fullName?: string;

  /** Local calendar date, YYYY-MM-DD. Stored as a string to avoid timezone drift. */
  @Prop({ type: String, trim: true })
  dob?: string;

  @Prop({ type: String, enum: PatientAccountGender })
  gender?: PatientAccountGender;

  @Prop({ type: String, trim: true, lowercase: true })
  email?: string;

  @Prop({ type: String, trim: true })
  bloodGroup?: string;

  @Prop({
    required: true,
    enum: PatientAccountStatus,
    default: PatientAccountStatus.Active,
  })
  status!: PatientAccountStatus;

  @Prop({ type: PortalPrivacy, default: () => ({}) })
  privacy!: PortalPrivacy;

  /** Notification ids the person has marked read (bounded, newest kept). */
  @Prop({ type: [String], default: [] })
  readNotificationIds!: string[];

  @Prop({ type: Date })
  notificationsReadAllAt?: Date;

  @Prop({ type: Date })
  profileCompletedAt?: Date;

  @Prop({ type: Date })
  lastLoginAt?: Date;
}

export const PatientAccountSchema =
  SchemaFactory.createForClass(PatientAccount);

// One login account per mobile number. Dependants have no phone, so the
// index only covers documents where it is set.
PatientAccountSchema.index(
  { phone: 1 },
  {
    unique: true,
    name: 'patientaccount_phone_unique',
    partialFilterExpression: { phone: { $type: 'string' } },
  },
);
