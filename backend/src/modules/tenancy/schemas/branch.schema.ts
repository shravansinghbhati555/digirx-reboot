import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BranchDocument = HydratedDocument<Branch>;

@Schema({ timestamps: true })
export class Branch {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: Object, default: {} })
  address?: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  workingHours?: Record<string, unknown>;

  @Prop({ type: Types.ObjectId })
  holidayCalendarId?: Types.ObjectId;
}

export const BranchSchema = SchemaFactory.createForClass(Branch);

BranchSchema.index({ clinicId: 1, name: 1 }, { unique: true, name: 'branch_unique_name_per_clinic' });

