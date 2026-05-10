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

  /**
   * Short human-readable code used in generated identifiers (bill numbers,
   * credit-note numbers). Operators set this to e.g. "MUM"/"DEL". Optional;
   * the numbering service falls back to the first 4 alphanumerics of `name`.
   */
  @Prop({ type: String, trim: true, uppercase: true })
  code?: string;

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
// Branch codes must also be unique inside a clinic so two branches don't
// collide in generated bill/credit-note numbers. Sparse so legacy branches
// without a code don't all collide on `null`.
BranchSchema.index(
  { clinicId: 1, code: 1 },
  { unique: true, sparse: true, name: 'branch_unique_code_per_clinic' },
);
