import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BranchDocument = HydratedDocument<Branch>;

@Schema({ _id: false })
class WorkingHours {
  @Prop({ type: String })
  open?: string; // 'HH:MM' (24h)

  @Prop({ type: String })
  close?: string; // 'HH:MM' (24h)
}

@Schema({ timestamps: true })
export class Branch {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: String, trim: true })
  addressLine?: string;

  @Prop({ type: Object, default: {} })
  address?: Record<string, unknown>; // legacy free-form (street/city/state/zip)

  @Prop({ type: String, trim: true })
  phone?: string;

  @Prop({ type: WorkingHours, default: {} })
  workingHours?: WorkingHours;

  @Prop({ type: Number })
  slotsPerDay?: number;

  @Prop({ type: Boolean, default: true })
  active!: boolean;

  @Prop({ type: Types.ObjectId })
  holidayCalendarId?: Types.ObjectId;
}

export const BranchSchema = SchemaFactory.createForClass(Branch);

BranchSchema.index(
  { clinicId: 1, name: 1 },
  { unique: true, name: 'branch_unique_name_per_clinic' },
);
