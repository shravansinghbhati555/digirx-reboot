import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DocumentDocument = HydratedDocument<Document>;

export enum DocumentOwnerType {
  Patient = 'PATIENT',
  Appointment = 'APPOINTMENT',
  Encounter = 'ENCOUNTER',
  Bill = 'BILL',
  Prescription = 'PRESCRIPTION',
}

export enum DocumentAccess {
  InternalOnly = 'INTERNAL_ONLY',
  ShareableWithToken = 'SHAREABLE_WITH_TOKEN',
}

@Schema({ timestamps: true })
export class Document {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ required: true, enum: DocumentOwnerType, index: true })
  ownerType!: DocumentOwnerType;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  ownerId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  mimeType!: string;

  @Prop({ required: true, trim: true })
  fileName!: string;

  @Prop({ required: true })
  sizeBytes!: number;

  @Prop({ required: true, trim: true })
  storageKey!: string;

  @Prop({
    required: true,
    enum: DocumentAccess,
    default: DocumentAccess.InternalOnly,
  })
  access!: DocumentAccess;

  @Prop({ type: Types.ObjectId })
  createdBy?: Types.ObjectId;
}

export const DocumentSchema = SchemaFactory.createForClass(Document);

DocumentSchema.index(
  { clinicId: 1, ownerType: 1, ownerId: 1, createdAt: -1 },
  { name: 'doc_owner_idx' },
);
