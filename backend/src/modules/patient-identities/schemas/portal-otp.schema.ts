import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PortalOtpDocument = HydratedDocument<PortalOtp>;

/**
 * One-time login code. Only an HMAC of the code is stored, so a database
 * read cannot be replayed into a login.
 */
@Schema({ timestamps: true })
export class PortalOtp {
  @Prop({ type: String, required: true, trim: true })
  phone!: string;

  @Prop({ type: String, required: true, select: false })
  codeHash!: string;

  @Prop({ type: Number, default: 0 })
  attempts!: number;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date })
  consumedAt?: Date;

  /** Requesting IP, for the per-IP issue limit. */
  @Prop({ type: String, trim: true })
  ip?: string;

  createdAt?: Date;
}

export const PortalOtpSchema = SchemaFactory.createForClass(PortalOtp);

PortalOtpSchema.index(
  { phone: 1, createdAt: -1 },
  { name: 'portalotp_phone_idx' },
);
PortalOtpSchema.index({ ip: 1, createdAt: -1 }, { name: 'portalotp_ip_idx' });
// Keep rows for a day after expiry so the hourly rate limits can count them,
// then let Mongo delete them.
PortalOtpSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 24 * 60 * 60, name: 'portalotp_ttl_idx' },
);
