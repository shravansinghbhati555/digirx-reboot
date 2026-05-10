import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InventoryItemDocument = HydratedDocument<InventoryItem>;

export enum InventoryUnit {
  Tablet = 'TABLET',
  Capsule = 'CAPSULE',
  Bottle = 'BOTTLE',
  Vial = 'VIAL',
  Strip = 'STRIP',
  Sachet = 'SACHET',
  Ml = 'ML',
  Gram = 'GRAM',
  Unit = 'UNIT',
}

/**
 * Packaging unit a clinic may receive stock in. Independent of the
 * smallest dispensable unit (`InventoryItem.unit`). Example: an item is
 * dispensed in TABLETs but received in STRIPs of 10 tablets each — set
 * `unit=TABLET, packUnit=STRIP, packSize=10`.
 */
export enum InventoryPackUnit {
  Strip = 'STRIP',
  Box = 'BOX',
  Bottle = 'BOTTLE',
  Pack = 'PACK',
  Carton = 'CARTON',
}

/**
 * A stockable SKU at a specific branch. Different branches of the same
 * clinic can stock the same medicine independently — the booking-conflict
 * doctrine of "scope by clinic+branch" applies here too.
 *
 * Optional `medicineCatalogItemId` ties the inventory line to the
 * prescriber-facing catalog so future auto-deduct flows can resolve
 * medicine → SKU. The link is opt-in: a clinic that runs inventory
 * without a prescription catalog (or vice versa) still works.
 */
@Schema({ timestamps: true })
export class InventoryItem {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  medicineCatalogItemId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  /** Operator-defined SKU. Optional but unique per clinic+branch when set. */
  @Prop({ type: String, trim: true })
  sku?: string;

  /**
   * Smallest dispensable unit. All `quantity*` fields on InventoryBatch
   * and StockMovement are denominated in this unit.
   */
  @Prop({ type: String, required: true, enum: InventoryUnit })
  unit!: InventoryUnit;

  /**
   * Optional packaging — what stock arrives in from the supplier (e.g.
   * STRIP, BOX). When set, `packSize` is the number of `unit`s per pack
   * (e.g. 10 tablets per strip). Receive screens use this to convert a
   * supplier-format quantity ("5 strips") into the stored unit ("50
   * tablets") before persisting. Dispense always operates in `unit`.
   */
  @Prop({ type: String, enum: InventoryPackUnit })
  packUnit?: InventoryPackUnit;

  @Prop({ type: Number, min: 1 })
  packSize?: number;

  /** When sum(remainingQty across active batches) <= reorderLevel, the
   * item shows up in low-stock reports. 0 disables the alert.
   * Always denominated in `unit` (not pack). */
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  reorderLevel!: number;

  @Prop({ type: Boolean, default: true })
  active!: boolean;
}

export const InventoryItemSchema = SchemaFactory.createForClass(InventoryItem);

InventoryItemSchema.index(
  { clinicId: 1, branchId: 1, name: 1 },
  { name: 'inv_item_branch_name_idx' },
);
// SKU uniqueness is enforced only when set (sparse partial filter).
InventoryItemSchema.index(
  { clinicId: 1, branchId: 1, sku: 1 },
  {
    unique: true,
    name: 'inv_item_unique_sku',
    partialFilterExpression: { sku: { $type: 'string' } },
  },
);
// Text index for the typeahead in the dispense / receive sheets.
InventoryItemSchema.index(
  { name: 'text', sku: 'text' },
  { name: 'inv_item_text_idx', default_language: 'none' },
);
