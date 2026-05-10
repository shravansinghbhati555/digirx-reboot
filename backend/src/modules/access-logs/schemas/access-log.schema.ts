import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AccessLogDocument = HydratedDocument<AccessLog>;

@Schema({ timestamps: true })
export class AccessLog {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  branchId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  actorUserId?: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  method!: string;

  @Prop({ required: true, trim: true, index: true })
  path!: string;

  @Prop({ required: true, index: true })
  statusCode!: number;

  @Prop({ required: true })
  durationMs!: number;

  @Prop({ trim: true, index: true })
  requestId?: string;

  @Prop({ trim: true })
  userAgent?: string;

  @Prop({ trim: true })
  ip?: string;

  /**
   * Per-row TTL anchor. Mongo's TTL monitor (~60s cadence) deletes the
   * document once `expiresAt < now`. Stamped at write time from the
   * clinic's `logs.retentionDays` setting.
   */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export const AccessLogSchema = SchemaFactory.createForClass(AccessLog);

AccessLogSchema.index(
  { clinicId: 1, createdAt: -1 },
  { name: 'accesslog_clinic_created_idx' },
);
AccessLogSchema.index(
  { clinicId: 1, path: 1, createdAt: -1 },
  { name: 'accesslog_path_created_idx' },
);
// TTL — same pattern as audit-log.schema.ts. `expireAfterSeconds: 0` means
// "the row dies exactly at the time stored in `expiresAt`".
AccessLogSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'accesslog_ttl_idx' },
);
