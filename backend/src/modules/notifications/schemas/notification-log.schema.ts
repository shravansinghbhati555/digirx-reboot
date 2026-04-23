import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { NotificationChannel } from './notification-template.schema';

export type NotificationLogDocument = HydratedDocument<NotificationLog>;

export enum NotificationStatus {
  Queued = 'QUEUED',
  Sent = 'SENT',
  Failed = 'FAILED',
}

@Schema({ timestamps: true })
export class NotificationLog {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  branchId?: Types.ObjectId;

  @Prop({ required: true, enum: NotificationChannel, index: true })
  channel!: NotificationChannel;

  @Prop({ required: true, trim: true })
  to!: string; // phone / whatsapp id

  @Prop({ required: true })
  body!: string;

  @Prop({ trim: true, index: true })
  dedupeKey?: string;

  @Prop({
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
NotificationLogSchema.index(
  { clinicId: 1, dedupeKey: 1 },
  { unique: true, sparse: true, name: 'notification_log_dedupe_unique' },
);
