import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { NotificationChannel } from './notification-template.schema';

export type NotificationLogDocument = HydratedDocument<NotificationLog>;

export enum NotificationStatus {
  Queued = 'QUEUED',
  Sent = 'SENT',
  Failed = 'FAILED',
  Skipped = 'SKIPPED',
}

@Schema({ timestamps: true })
export class NotificationLog {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  branchId?: Types.ObjectId;

  // Explicit `type: String` so ts-jest with `isolatedModules: true` doesn't
  // need cross-file decorator metadata to infer the field type — without
  // this `@nestjs/mongoose` falls back to `Object` and refuses to register.
  @Prop({ type: String, required: true, enum: NotificationChannel, index: true })
  channel!: NotificationChannel;

  @Prop({ required: true, trim: true })
  to!: string; // phone / whatsapp id

  @Prop({ required: true })
  body!: string;

  @Prop({ trim: true, index: true })
  dedupeKey?: string;

  @Prop({ trim: true })
  templateKey?: string;

  @Prop({
    type: String,
    required: true,
    enum: NotificationStatus,
    default: NotificationStatus.Queued,
    index: true,
  })
  status!: NotificationStatus;

  @Prop({ default: 0 })
  attempts!: number;

  @Prop({ trim: true })
  providerMessageId?: string;

  @Prop({ type: Object })
  providerResponse?: Record<string, unknown>;

  @Prop()
  lastError?: string;
}

export const NotificationLogSchema =
  SchemaFactory.createForClass(NotificationLog);

NotificationLogSchema.index(
  { clinicId: 1, createdAt: -1 },
  { name: 'notification_log_clinic_created_idx' },
);
// Unique only when `dedupeKey` is actually a string. `sparse: true` still
// indexes missing-field rows as null for uniqueness purposes, which causes
// E11000 collisions on the second insert without a dedupeKey.
NotificationLogSchema.index(
  { clinicId: 1, dedupeKey: 1 },
  {
    unique: true,
    name: 'notification_log_dedupe_unique',
    partialFilterExpression: { dedupeKey: { $type: 'string' } },
  },
);
