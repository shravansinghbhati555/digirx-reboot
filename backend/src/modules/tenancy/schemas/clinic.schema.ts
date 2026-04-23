import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ClinicDocument = HydratedDocument<Clinic>;

@Schema({ timestamps: true })
export class Clinic {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  countryCode!: string; // e.g. IN

  @Prop({ required: true, trim: true })
  timezone!: string; // e.g. Asia/Kolkata

  @Prop({ required: true, trim: true })
  currency!: string; // e.g. INR

  @Prop({ required: true, trim: true })
  phoneCountryCode!: string; // e.g. +91

  @Prop({ type: Object, default: {} })
  settings!: Record<string, unknown>;
}

export const ClinicSchema = SchemaFactory.createForClass(Clinic);

ClinicSchema.index({ name: 1 }, { name: 'clinic_name_idx' });
