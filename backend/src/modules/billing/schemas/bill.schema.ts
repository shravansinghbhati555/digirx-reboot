import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BillDocument = HydratedDocument<Bill>;

export enum BillStatus {
  Draft = 'DRAFT',
  Issued = 'ISSUED',
  Paid = 'PAID',
  Void = 'VOID',
}

/**
 * Bill kind splits the receivables flow:
 *   - SERVICE: consultation / procedure fees, line items reference
 *     `serviceCatalogItemId` or carry a free-text `customName`.
 *   - MEDICINE: pharmacy sale, line items reference `inventoryItemId` and
 *     trigger FIFO inventory dispense on full payment (Slice 5).
 * Default is SERVICE so existing rows continue to behave exactly as before.
 */
export enum BillKind {
  Service = 'SERVICE',
  Medicine = 'MEDICINE',
}

export type BillLineItem = {
  serviceCatalogItemId?: Types.ObjectId;
  /**
   * Set on MEDICINE bills so the dispense path can resolve the stock row
   * directly without a name lookup. Optional on SERVICE bills.
   */
  inventoryItemId?: Types.ObjectId;
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

  @Prop({ type: Types.ObjectId, required: true, index: true, ref: 'Patient' })
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

  @Prop({
    required: true,
    enum: BillKind,
    default: BillKind.Service,
    index: true,
  })
  kind!: BillKind;

  // Inventory-dispense audit, set once on the payment that brings totalPaid
  // >= total for a MEDICINE bill. Presence of `inventoryDispensedAt` is the
  // idempotency guard — a refund-then-pay cycle cannot double-deduct.
  @Prop({ type: Date })
  inventoryDispensedAt?: Date;

  @Prop({ type: [Types.ObjectId], default: undefined })
  inventoryMovementIds?: Types.ObjectId[];

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Date })
  issuedAt?: Date;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ type: Types.ObjectId })
  pdfDocumentId?: Types.ObjectId;

  // One-shot guard for the auto-delivered invoice. Stamped atomically the
  // first time `sendInvoiceToPatient` actually dispatches to a patient, so
  // an invoice is sent at most once per bill regardless of how many lifecycle
  // events fire (issue, then full payment). The booking flow auto-issues the
  // bill without going through `issueBill`, so its single send happens when
  // the booking payment settles the bill (Issued -> Paid).
  @Prop({ type: Date })
  invoiceSentAt?: Date;

  @Prop({ type: Types.ObjectId })
  createdBy?: Types.ObjectId;

  // Void audit. Required at the API layer when transitioning to VOID; left
  // optional on the schema so legacy bills that never had a void path keep
  // loading.
  @Prop({ trim: true })
  voidReason?: string;

  @Prop({ type: Date })
  voidedAt?: Date;

  @Prop({ type: Types.ObjectId })
  voidedBy?: Types.ObjectId;
}

export const BillSchema = SchemaFactory.createForClass(Bill);

BillSchema.index(
  { clinicId: 1, branchId: 1, createdAt: -1 },
  { name: 'bill_branch_created_idx' },
);
BillSchema.index(
  { clinicId: 1, branchId: 1, billNo: 1 },
  {
    unique: true,
    name: 'billno_unique_per_branch',
    partialFilterExpression: { billNo: { $type: 'string' } },
  },
);

BillSchema.index(
  { appointmentId: 1 },
  {
    unique: true,
    name: 'unique_bill_per_appointment',
    partialFilterExpression: {
      appointmentId: { $exists: true },
      status: { $ne: 'VOID' },
    },
  },
);
