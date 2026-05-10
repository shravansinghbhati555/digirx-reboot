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

export enum DocumentStatus {
  Uploading = 'UPLOADING',
  Available = 'AVAILABLE',
}

export enum DocumentCategory {
  LabReport = 'LAB_REPORT',
  Imaging = 'IMAGING',
  Prescription = 'PRESCRIPTION',
  ConsentForm = 'CONSENT_FORM',
  IdentityProof = 'IDENTITY_PROOF',
  Other = 'OTHER',
}

@Schema({ timestamps: true })
export class Document {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ required: true, enum: DocumentOwnerType, index: true })
  ownerType!: DocumentOwnerType;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  ownerId!: Types.ObjectId;

  @Prop({
    required: true,
    enum: DocumentCategory,
    default: DocumentCategory.Other,
    index: true,
  })
  category!: DocumentCategory;

  @Prop({ required: false, trim: true })
  ownerName?: string;

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

  @Prop({
    required: true,
    enum: DocumentStatus,
    default: DocumentStatus.Uploading,
  })
  status!: DocumentStatus;

  @Prop({ type: Types.ObjectId })
  createdBy?: Types.ObjectId;
}

export const DocumentSchema = SchemaFactory.createForClass(Document);

DocumentSchema.index(
  { clinicId: 1, ownerType: 1, ownerId: 1, createdAt: -1 },
  { name: 'doc_owner_idx' },
);
