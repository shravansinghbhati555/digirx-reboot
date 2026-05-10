import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InventoryBatchDocument = HydratedDocument<InventoryBatch>;

/**
 * A specific lot of stock received against an InventoryItem. Multiple
 * batches per item are normal — different expiry dates, different
 * suppliers, different unit costs. FIFO dispense walks active batches
 * by `expiryDate` ascending so older stock leaves first.
 *
 * `quantityRemaining` is decremented atomically by `findOneAndUpdate +
 * $inc + $gte` guard so a concurrent dispense can't oversell.
 */
@Schema({ timestamps: true })
export class InventoryBatch {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  inventoryItemId!: Types.ObjectId;

  /** Supplier-stamped lot number — opaque to us, useful for recalls. */
  @Prop({ type: String, required: true, trim: true })
  batchNumber!: string;

  @Prop({ type: Date, required: true })
  expiryDate!: Date;

  @Prop({ type: Number, required: true, min: 0 })
  quantityReceived!: number;

  /**
   * Decremented by dispense + adjustments. NEVER drops below zero — the
   * dispense path uses an atomic guard that fails if the row would go
   * negative.
   */
  @Prop({ type: Number, required: true, min: 0 })
  quantityRemaining!: number;

  /** Optional cost-of-goods bookkeeping. */
  @Prop({ type: Number, min: 0 })
  unitCost?: number;

  @Prop({ type: String, trim: true })
  supplier?: string;

  @Prop({ type: Date, required: true })
  receivedAt!: Date;

  @Prop({ type: Types.ObjectId })
  receivedBy?: Types.ObjectId;
}

export const InventoryBatchSchema =
  SchemaFactory.createForClass(InventoryBatch);

// Primary access pattern: dispense walks batches for an item, FIFO by
// expiry. The compound on (item, expiryDate) makes that a covered scan.
InventoryBatchSchema.index(
  { clinicId: 1, inventoryItemId: 1, expiryDate: 1 },
  { name: 'inv_batch_item_expiry_idx' },
);
// Expiring-soon report scans directly by date.
InventoryBatchSchema.index(
  { clinicId: 1, branchId: 1, expiryDate: 1 },
  { name: 'inv_batch_branch_expiry_idx' },
);
