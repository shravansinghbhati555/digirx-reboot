import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CashDayDocument = HydratedDocument<CashDay>;

export enum CashDayStatus {
  /** Counted, waiting for the Super Admin or Manager. */
  Submitted = 'SUBMITTED',
  /** Signed off. Frozen — a recount is refused. */
  Approved = 'APPROVED',
}

/**
 * One branch's cash drawer for one clinic-local day — ticket C6.
 *
 * One shared drawer per branch, no opening float, so expected cash is simply
 * the cash collected minus cash refunded that day. Reconciled twice:
 *
 *   - **pre-sync**, on the device, when the collector counts the drawer —
 *     `expectedAtCount` is what that device knew about at the time
 *   - **post-sync**, by the approver — the server recomputes expected from
 *     every payment that has since landed, including other tablets'
 */
@Schema({ timestamps: true })
export class CashDay {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  /** `YYYY-MM-DD` in the clinic's timezone, like `queueDate`. */
  @Prop({ required: true, trim: true })
  date!: string;

  @Prop({ required: true, enum: CashDayStatus, default: CashDayStatus.Submitted })
  status!: CashDayStatus;

  @Prop({ type: Number, required: true, min: 0 })
  countedCash!: number;

  /** The counting device's expected figure — the pre-sync reconciliation. */
  @Prop({ type: Number, required: true, min: 0 })
  expectedAtCount!: number;

  /** Required when counted ≠ expected at count. */
  @Prop({ trim: true })
  countNote?: string;

  @Prop({ type: Types.ObjectId })
  countedBy?: Types.ObjectId;

  @Prop({ type: Date, required: true })
  countedAt!: Date;

  @Prop({ trim: true })
  deviceId?: string;

  /** Server expected at the moment of approval — what was signed off. */
  @Prop({ type: Number })
  expectedAtApproval?: number;

  /** Required when counted ≠ expected at approval. */
  @Prop({ trim: true })
  approvalNote?: string;

  @Prop({ type: Types.ObjectId })
  approvedBy?: Types.ObjectId;

  @Prop({ type: Date })
  approvedAt?: Date;
}

export const CashDaySchema = SchemaFactory.createForClass(CashDay);

CashDaySchema.index(
  { clinicId: 1, branchId: 1, date: 1 },
  { unique: true, name: 'cash_day_unique_idx' },
);
