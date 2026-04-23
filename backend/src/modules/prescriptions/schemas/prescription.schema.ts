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
};

@Schema({ timestamps: true })
export class Prescription {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  doctorId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  patientId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  encounterId!: Types.ObjectId;

  @Prop({ type: Array, default: [] })
  items!: PrescriptionItem[];

  @Prop({ trim: true })
  shareToken?: string;

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
