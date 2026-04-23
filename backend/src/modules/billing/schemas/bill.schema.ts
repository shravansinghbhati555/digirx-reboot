import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BillDocument = HydratedDocument<Bill>;

export enum BillStatus {
  Draft = 'DRAFT',
  Issued = 'ISSUED',
  Void = 'VOID',
}

export type BillLineItem = {
  serviceCatalogItemId?: Types.ObjectId;
  customName?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

@Schema({ timestamps: true })
export class Bill {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  patientId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  encounterId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  appointmentId?: Types.ObjectId;

  @Prop({ trim: true })
  billNo?: string;

  @Prop({ required: true, trim: true })
  currency!: string;

  @Prop({ type: Array, default: [] })
  items!: BillLineItem[];

  @Prop({ default: 0 })
  subtotal!: number;

  @Prop({ default: 0 })
  discount!: number;

  @Prop({ default: 0 })
  tax!: number;

  @Prop({ default: 0 })
  total!: number;

  @Prop({
    required: true,
    enum: BillStatus,
    default: BillStatus.Draft,
    index: true,
  })
  status!: BillStatus;

  @Prop({ type: Date })
  issuedAt?: Date;

  @Prop({ type: Types.ObjectId })
  pdfDocumentId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  createdBy?: Types.ObjectId;
}

export const BillSchema = SchemaFactory.createForClass(Bill);

BillSchema.index(
  { clinicId: 1, branchId: 1, createdAt: -1 },
  { name: 'bill_branch_created_idx' },
);
BillSchema.index(
  { clinicId: 1, branchId: 1, billNo: 1 },
  { unique: true, sparse: true, name: 'billno_unique_per_branch' },
);
