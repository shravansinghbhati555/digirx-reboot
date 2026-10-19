import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RecordAccessGrantDocument = HydratedDocument<RecordAccessGrant>;

export enum RecordAccessStatus {
  Active = 'ACTIVE',
  Revoked = 'REVOKED',
}

export enum RecordAccessSource {
  /** The privacy screen's per-clinic sharing toggle. */
  PrivacySetting = 'PRIVACY_SETTING',
  /** "Share past records" switched on while booking. */
  Booking = 'BOOKING',
}

/**
 * A patient's explicit permission for one clinic to see the records they
 * hold at OTHER DigiRx clinics. Without an active, unexpired grant a clinic
 * sees only its own records — exactly as before the portal existed.
 */
@Schema({ timestamps: true })
export class RecordAccessGrant {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  accountId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  granteeClinicId!: Types.ObjectId;

  @Prop({
    required: true,
    enum: RecordAccessStatus,
    default: RecordAccessStatus.Active,
  })
  status!: RecordAccessStatus;

  @Prop({ required: true, enum: RecordAccessSource })
  source!: RecordAccessSource;

  /** Absent = until revoked. */
  @Prop({ type: Date })
  expiresAt?: Date;

  @Prop({ type: Date })
  revokedAt?: Date;
}

export const RecordAccessGrantSchema =
  SchemaFactory.createForClass(RecordAccessGrant);

RecordAccessGrantSchema.index(
  { accountId: 1, granteeClinicId: 1, status: 1 },
  { name: 'recordaccess_lookup_idx' },
);
