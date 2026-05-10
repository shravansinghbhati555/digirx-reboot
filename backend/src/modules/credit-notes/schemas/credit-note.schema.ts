import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  BillLineItem,
} from '../../billing/schemas/bill.schema';
import { PaymentMethod } from '../../billing/schemas/payment.schema';

export type CreditNoteDocument = HydratedDocument<CreditNote>;

export enum CreditNoteStatus {
  /** CN exists, money has not yet walked. Bill outstanding stays the same. */
  Issued = 'ISSUED',
  /** Refund has been recorded. Bill's net revenue drops by `amount`. */
  Refunded = 'REFUNDED',
  /** CN was issued by mistake and explicitly invalidated. */
  Cancelled = 'CANCELLED',
}

@Schema({ timestamps: true })
export class CreditNote {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  billId!: Types.ObjectId;

  /** Minted via CreditNoteCounter, sparse-unique (clinicId, branchId, no). */
  @Prop({ trim: true })
  creditNoteNo?: string;

  /** Snapshot of credited line items. Free-form: caller can credit subset. */
  @Prop({ type: Array, default: [] })
  items!: BillLineItem[];

  @Prop({ required: true, min: 0 })
  amount!: number;

  @Prop({ required: true, trim: true })
  reason!: string;

  @Prop({
    type: String,
    required: true,
    enum: CreditNoteStatus,
    default: CreditNoteStatus.Issued,
    index: true,
  })
  status!: CreditNoteStatus;

  // --- Refund metadata (set when status → REFUNDED) ----------------------

  @Prop({ type: Date })
  refundedAt?: Date;

  @Prop({ type: String, enum: PaymentMethod })
  refundedVia?: PaymentMethod;

  @Prop({ trim: true })
  refundProviderRef?: string;

  @Prop({ type: Types.ObjectId })
  refundedBy?: Types.ObjectId;

  /** Required on refund; partial-unique on (clinicId, _id, key) → idempotency. */
  @Prop({ trim: true })
  refundIdempotencyKey?: string;

  // --- Cancellation metadata (set when status → CANCELLED) ---------------

  @Prop({ type: Date })
  cancelledAt?: Date;

  @Prop({ trim: true })
  cancellationReason?: string;

  @Prop({ type: Types.ObjectId })
  cancelledBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  pdfDocumentId?: Types.ObjectId;
}

export const CreditNoteSchema = SchemaFactory.createForClass(CreditNote);

CreditNoteSchema.index(
  { clinicId: 1, billId: 1, createdAt: -1 },
  { name: 'cn_bill_created_idx' },
);
CreditNoteSchema.index(
  { clinicId: 1, branchId: 1, creditNoteNo: 1 },
  { unique: true, sparse: true, name: 'cn_unique_no_per_branch' },
);
