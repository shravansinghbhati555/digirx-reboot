import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PatientIdentifierDocument = HydratedDocument<PatientIdentifier>;

export enum PatientIdentifierType {
  MRN = 'MRN',
  ExternalId = 'EXTERNAL_ID',
}

@Schema({ timestamps: true })
export class PatientIdentifier {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  patientId!: Types.ObjectId;

  @Prop({ required: true, enum: PatientIdentifierType })
  type!: PatientIdentifierType;

  @Prop({ required: true, trim: true })
  value!: string;
}

export const PatientIdentifierSchema = SchemaFactory.createForClass(PatientIdentifier);

PatientIdentifierSchema.index(
  { clinicId: 1, type: 1, value: 1 },
  { unique: true, name: 'patient_identifier_unique_per_clinic' },
);

