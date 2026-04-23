import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationTemplateDocument = HydratedDocument<NotificationTemplate>;

export enum NotificationChannel {
  Sms = 'SMS',
  WhatsApp = 'WHATSAPP',
}

@Schema({ timestamps: true })
export class NotificationTemplate {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ required: true, enum: NotificationChannel, index: true })
  channel!: NotificationChannel;

  @Prop({ required: true, trim: true })
  key!: string; // e.g. appointment_reminder_24h

  @Prop({ required: true })
  body!: string; // template text; interpolation later

  @Prop({ default: true })
  active!: boolean;
}

export const NotificationTemplateSchema = SchemaFactory.createForClass(NotificationTemplate);

NotificationTemplateSchema.index(
  { clinicId: 1, channel: 1, key: 1 },
  { unique: true, name: 'notification_template_unique' },
);

