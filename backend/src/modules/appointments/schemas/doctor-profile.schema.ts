import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DoctorProfileDocument = HydratedDocument<DoctorProfile>;

@Schema({ timestamps: true })
export class DoctorProfile {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, unique: true, index: true })
  userId!: Types.ObjectId; // doctor user id

  @Prop({ type: [String], default: [] })
  specialties!: string[];

  @Prop({ type: Number, default: 15 })
  defaultSlotMinutes!: number;
}

export const DoctorProfileSchema = SchemaFactory.createForClass(DoctorProfile);
