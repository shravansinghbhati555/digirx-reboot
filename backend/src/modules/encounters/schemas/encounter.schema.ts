import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EncounterDocument = HydratedDocument<Encounter>;

export enum EncounterStatus {
  Draft = 'DRAFT',
  Signed = 'SIGNED',
}

@Schema({ timestamps: true })
export class Encounter {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  doctorId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  patientId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  appointmentId?: Types.ObjectId;

  @Prop({ type: Date, required: true })
  visitedAt!: Date;

  @Prop()
  chiefComplaint?: string;

  @Prop()
  notes?: string;

  @Prop()
  diagnosis?: string;

  @Prop({ type: Object })
  vitals?: Record<string, unknown>;

  @Prop({ type: Date })
  followUpAt?: Date;

  @Prop({ required: true, enum: EncounterStatus, default: EncounterStatus.Draft, index: true })
  status!: EncounterStatus;
}

export const EncounterSchema = SchemaFactory.createForClass(Encounter);

EncounterSchema.index({ clinicId: 1, patientId: 1, visitedAt: -1 }, { name: 'encounter_patient_history_idx' });

