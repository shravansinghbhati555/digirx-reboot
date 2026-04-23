import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { AvailabilityWindow } from './doctor-availability-rule.schema';

export type OverrideType = 'CLOSED' | 'CUSTOM_WINDOWS';

@Schema({ timestamps: true })
export class DoctorAvailabilityOverride {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  doctorUserId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  date!: string; // YYYY-MM-DD in clinic timezone

  @Prop({ type: String, required: true })
  type!: OverrideType;

  @Prop({ type: Array, default: [] })
  windows?: AvailabilityWindow[];

  @Prop({ type: String })
  note?: string;
}

export const DoctorAvailabilityOverrideSchema = SchemaFactory.createForClass(
  DoctorAvailabilityOverride,
);

DoctorAvailabilityOverrideSchema.index(
  { clinicId: 1, branchId: 1, doctorUserId: 1, date: 1 },
  { unique: true, name: 'uniq_override_per_date' },
);
