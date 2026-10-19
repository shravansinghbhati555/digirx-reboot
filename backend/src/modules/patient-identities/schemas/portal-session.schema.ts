import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PortalSessionDocument = HydratedDocument<PortalSession>;

/** Refresh session for the patient portal. Separate from staff `Session`s. */
@Schema({ timestamps: true })
export class PortalSession {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  accountId!: Types.ObjectId;

  @Prop({ type: String, required: true, select: false })
  refreshTokenHash!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date })
  revokedAt?: Date;

  @Prop({ type: String, trim: true })
  userAgent?: string;

  @Prop({ type: String, trim: true })
  ip?: string;
}

export const PortalSessionSchema = SchemaFactory.createForClass(PortalSession);

PortalSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'portalsession_ttl_idx' },
);
