import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LeadDocument = HydratedDocument<Lead>;

/** Where the sales team has got to with an enquiry. */
export enum LeadStatus {
  New = 'NEW',
  Contacted = 'CONTACTED',
  Won = 'WON',
  Closed = 'CLOSED',
}

/**
 * An enquiry from the marketing site.
 *
 * Platform-level, not clinic-level: a lead arrives before any clinic exists,
 * so unlike every other collection this one carries no `clinicId`. It is read
 * only by platform admins, through the same guard as the approval queue.
 */
@Schema({ timestamps: true })
export class Lead {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  email!: string;

  @Prop({ trim: true })
  phone?: string;

  // Free-form topic from the contact form's dropdown ("demo", "sales", …).
  @Prop({ trim: true })
  reason?: string;

  @Prop({ required: true, trim: true })
  message!: string;

  // Which surface produced the lead, so a second form later is separable.
  @Prop({ trim: true, default: 'website' })
  source?: string;

  @Prop({ required: true, enum: LeadStatus, default: LeadStatus.New, index: true })
  status!: LeadStatus;

  // Internal follow-up notes, written from the admin screen.
  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Types.ObjectId })
  handledByUserId?: Types.ObjectId;

  @Prop({ type: Date })
  handledAt?: Date;

  // Whether the notification email to the sales inbox went out. Kept so a
  // misconfigured mailer is visible in the list rather than silent.
  @Prop({ type: Boolean, default: false })
  notified?: boolean;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);

// Drives the inbox: newest first, filtered by status.
LeadSchema.index({ status: 1, createdAt: -1 }, { name: 'lead_status_created_idx' });
