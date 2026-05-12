import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PrescriptionDocument = HydratedDocument<Prescription>;

export type PrescriptionItem = {
  medicineCatalogItemId?: Types.ObjectId;
  customName?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
  /**
   * Total units to dispense at the pharmacy (e.g. 10 tablets, 1 bottle).
   * Optional on the schema so legacy prescriptions (written before this
   * field landed) continue to load. The medicine-bill drafter (Slice 3)
   * defaults missing values to 1 and surfaces them for the receptionist
   * to confirm.
   */
  quantity?: number;
};

@Schema({ timestamps: true })
export class Prescription {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true, ref: 'User' })
  doctorId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true, ref: 'Patient' })
  patientId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true, ref: 'Encounter' })
  encounterId!: Types.ObjectId;

  /**
   * Human-readable prescription number printed on the slip. Format
   * `RX-{seq:06}` (e.g. `RX-000123`), minted on first save by
   * PrescriptionNumberingService. Optional on the schema so legacy
   * rows written before this field landed continue to load — they'll
   * back-fill to a number on next save.
   */
  @Prop({ type: String, trim: true })
  prescriptionNo?: string;

  @Prop({ type: Array, default: [] })
  items!: PrescriptionItem[];

  @Prop({ trim: true })
  shareToken?: string;

  @Prop()
  shareTokenExpiresAt?: Date;

  @Prop()
  shareTokenRevokedAt?: Date;

  @Prop({ type: Types.ObjectId })
  pdfDocumentId?: Types.ObjectId;
}

export const PrescriptionSchema = SchemaFactory.createForClass(Prescription);

PrescriptionSchema.index(
  { clinicId: 1, patientId: 1, createdAt: -1 },
  { name: 'rx_patient_idx' },
);
PrescriptionSchema.index(
  { shareToken: 1 },
  { sparse: true, name: 'rx_share_token_idx' },
);
// Sparse + partial: prescriptionNo is unique within a clinic when set,
// but legacy rows without it still co-exist. Using `partialFilterExpression`
// over plain `sparse` is the modern Mongo idiom and plays nicer with the
// existing `clinicId` scope.
PrescriptionSchema.index(
  { clinicId: 1, prescriptionNo: 1 },
  {
    unique: true,
    name: 'rx_clinic_no_unique',
    partialFilterExpression: { prescriptionNo: { $type: 'string' } },
  },
);
