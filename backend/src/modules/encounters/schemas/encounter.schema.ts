import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EncounterDocument = HydratedDocument<Encounter>;

export enum EncounterStatus {
  Draft = 'DRAFT',
  Signed = 'SIGNED',
}

/**
 * Typed vitals. The DTO layer enforces numeric ranges; storing each field
 * explicitly (rather than a free-form Map) gives reports and growth charts
 * a stable shape to query.
 */
export type Vitals = {
  heightCm?: number;
  weightKg?: number;
  temperatureC?: number;
  pulseBpm?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  spo2?: number;
  respiratoryRate?: number;
};

export type DiagnosisItem = {
  /** Optional ICD-10 code, e.g. "E11.9" (Type 2 DM, no complication). */
  code?: string;
  description: string;
  /** Exactly one item should be primary; the service enforces that. */
  primary: boolean;
};

@Schema({ timestamps: true })
export class Encounter {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true, ref: 'User' })
  doctorId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true, ref: 'Patient' })
  patientId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true, ref: 'Appointment' })
  appointmentId?: Types.ObjectId;

  @Prop({ type: Date, required: true })
  visitedAt!: Date;

  @Prop()
  chiefComplaint?: string;

  @Prop()
  notes?: string;

  /**
   * Legacy single-string diagnosis. Retained so existing rows keep loading;
   * new writes should populate `diagnoses` instead. Kept in the signed-hash
   * payload so older signed encounters remain verifiable.
   */
  @Prop()
  diagnosis?: string;

  @Prop({ type: Array, default: [] })
  diagnoses!: DiagnosisItem[];

  /**
   * Stored as Mixed at the schema level so legacy free-form rows keep
   * loading; on every write the typed `VitalsDto` validates the shape.
   */
  @Prop({ type: Object })
  vitals?: Vitals;

  @Prop({ type: Date })
  followUpAt?: Date;

  @Prop({ trim: true })
  followUpNotes?: string;

  @Prop({
    required: true,
    enum: EncounterStatus,
    default: EncounterStatus.Draft,
    index: true,
  })
  status!: EncounterStatus;

  @Prop({ type: Date })
  signedAt?: Date;

  @Prop({ type: Types.ObjectId })
  signedByUserId?: Types.ObjectId;

  /**
   * SHA-256 of the canonical clinical content at sign time. Lets a verifier
   * recompute the hash from stored fields and prove the signed body has
   * not been mutated since the doctor signed off.
   */
  @Prop({ type: String })
  signedHash?: string;

  /**
   * Human-readable encounter ID (e.g. ENC-000001). Generated monotonically
   * per clinic at creation time.
   */
  @Prop({ type: String, index: true, trim: true })
  readableId?: string;
}

export const EncounterSchema = SchemaFactory.createForClass(Encounter);

EncounterSchema.index(
  { clinicId: 1, patientId: 1, visitedAt: -1 },
  { name: 'encounter_patient_history_idx' },
);
