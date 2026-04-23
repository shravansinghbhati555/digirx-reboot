import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PatientDocument = HydratedDocument<Patient>;

export enum PatientGender {
  Male = 'MALE',
  Female = 'FEMALE',
  Other = 'OTHER',
  Unknown = 'UNKNOWN',
}

@Schema({ timestamps: true })
export class Patient {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  primaryBranchId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  fullName!: string;

  @Prop({ required: true, trim: true, index: true })
  normalizedName!: string;

  @Prop({ enum: PatientGender, default: PatientGender.Unknown })
  gender!: PatientGender;

  @Prop()
  dob?: Date;

  @Prop({ type: [String], default: [], index: true })
  phones!: string[];

  @Prop({ type: [String], default: [], index: true })
  normalizedPhones!: string[];

  @Prop({ type: [String], default: [] })
  emails!: string[];

  @Prop({ type: Object })
  address?: Record<string, unknown>;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop()
  notes?: string;
}

export const PatientSchema = SchemaFactory.createForClass(Patient);

PatientSchema.index(
  { clinicId: 1, normalizedName: 1 },
  { name: 'patient_name_idx' },
);
PatientSchema.index({ clinicId: 1, phones: 1 }, { name: 'patient_phone_idx' });
PatientSchema.index(
  { clinicId: 1, normalizedPhones: 1 },
  { name: 'patient_normalized_phone_idx' },
);
