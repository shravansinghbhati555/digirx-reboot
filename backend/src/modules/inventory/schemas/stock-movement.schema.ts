import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StockMovementDocument = HydratedDocument<StockMovement>;

export enum StockMovementType {
  /** Stock arrived from a supplier — quantityDelta > 0. */
  Receive = 'RECEIVE',
  /** Stock left the shelf for a patient — quantityDelta < 0. */
  Dispense = 'DISPENSE',
  /** Manual correction (count-off after audit, breakage, theft). delta either sign. */
  Adjust = 'ADJUST',
  /** Past-expiry purge. delta < 0. */
  Expire = 'EXPIRE',
}

/**
 * Immutable per-batch movement log. Every change to
 * `InventoryBatch.quantityRemaining` is paired with a row here so we can
 * reconstruct any batch's history and answer "where did this stock go?"
 *
 * Carries TTL via RetentionService — same retention contract as audit
 * + access logs, since this is an inspection trail.
 */
@Schema({ timestamps: true })
export class StockMovement {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  inventoryItemId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  batchId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: StockMovementType, index: true })
  type!: StockMovementType;

  /**
   * Signed delta. RECEIVE > 0, DISPENSE/EXPIRE < 0, ADJUST either sign.
   * The sum of all rows for a batch equals its current quantityRemaining
   * (modulo concurrent writes); reports use that as a consistency check.
   */
  @Prop({ type: Number, required: true })
  quantityDelta!: number;

  @Prop({ type: String, trim: true })
  reason?: string;

  /** Optional outbound reference for audit traceability. */
  @Prop({ type: Types.ObjectId })
  prescriptionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  billId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  actorUserId?: Types.ObjectId;

  /** TTL anchor stamped at write — same retention contract as audit-log. */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);

StockMovementSchema.index(
  { clinicId: 1, inventoryItemId: 1, createdAt: -1 },
  { name: 'stock_mov_item_created_idx' },
);
StockMovementSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'stock_mov_ttl_idx' },
);
