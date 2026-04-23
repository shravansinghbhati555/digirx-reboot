import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export type AvailabilityWindow = { startMinutes: number; endMinutes: number };

@Schema({ timestamps: true })
export class DoctorAvailabilityRule {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  doctorUserId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0, max: 6 })
  weekday!: number; // 0=Sun..6=Sat (Luxon uses 1..7; we convert)

  @Prop({ type: Array, default: [] })
  windows!: AvailabilityWindow[];

  @Prop({ type: Number })
  slotMinutes?: number;

  @Prop({ type: Boolean, default: true })
  active!: boolean;
}

export const DoctorAvailabilityRuleSchema = SchemaFactory.createForClass(DoctorAvailabilityRule);

DoctorAvailabilityRuleSchema.index(
  { clinicId: 1, branchId: 1, doctorUserId: 1, weekday: 1 },
  { unique: true, name: 'uniq_rule_per_day' },
);

