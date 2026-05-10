import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RetentionService } from '../../common/retention/retention.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { DispenseStockDto } from './dto/dispense-stock.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { InventoryBatch } from './schemas/inventory-batch.schema';
import {
  InventoryItem,
  type InventoryItemDocument,
} from './schemas/inventory-item.schema';
import {
  StockMovement,
  StockMovementType,
} from './schemas/stock-movement.schema';

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(InventoryItem.name)
    private readonly itemModel: Model<InventoryItem>,
    @InjectModel(InventoryBatch.name)
    private readonly batchModel: Model<InventoryBatch>,
    @InjectModel(StockMovement.name)
    private readonly movementModel: Model<StockMovement>,
    private readonly retention: RetentionService,
  ) {}

  // -- items ---------------------------------------------------------------

  async createItem(
    clinicId: Types.ObjectId,
    dto: CreateInventoryItemDto,
  ): Promise<InventoryItem> {
    // packUnit + packSize must come together. We don't enforce this on
    // the DTO so existing clients that omit both still pass validation;
    // catching it here gives a 400 with a clear message instead of a
    // half-written item that says "STRIP" with no size.
    if ((dto.packUnit && !dto.packSize) || (!dto.packUnit && dto.packSize)) {
      throw new BadRequestException(
        'packUnit and packSize must be set together',
      );
    }
    try {
      return await this.itemModel.create({
        clinicId,
        branchId: new Types.ObjectId(dto.branchId),
        medicineCatalogItemId: dto.medicineCatalogItemId
          ? new Types.ObjectId(dto.medicineCatalogItemId)
          : undefined,
        name: dto.name.trim(),
        sku: dto.sku?.trim().toUpperCase(),
        unit: dto.unit,
        packUnit: dto.packUnit,
        packSize: dto.packSize,
        reorderLevel: dto.reorderLevel ?? 0,
        active: dto.active ?? true,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          `An inventory item with SKU ${dto.sku} already exists in this branch`,
        );
      }
      throw err;
    }
  }

  async updateItem(
    clinicId: Types.ObjectId,
    id: string,
    dto: UpdateInventoryItemDto,
  ): Promise<InventoryItem> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Inventory item not found');
    }
    const item = await this.itemModel.findOne({ _id: id, clinicId });
    if (!item) throw new NotFoundException('Inventory item not found');

    if (dto.name !== undefined) item.name = dto.name.trim();
    if (dto.sku !== undefined) item.sku = dto.sku.trim().toUpperCase() || undefined;
    if (dto.unit !== undefined) item.unit = dto.unit;
    if (dto.reorderLevel !== undefined) item.reorderLevel = dto.reorderLevel;
    if (dto.active !== undefined) item.active = dto.active;
    // Pack fields: allow updating either both together, or clearing both
    // by passing both as undefined explicitly. Mixed states mirror the
    // create-time check above.
    if (dto.packUnit !== undefined || dto.packSize !== undefined) {
      const nextPackUnit = dto.packUnit !== undefined ? dto.packUnit : item.packUnit;
      const nextPackSize = dto.packSize !== undefined ? dto.packSize : item.packSize;
      if ((nextPackUnit && !nextPackSize) || (!nextPackUnit && nextPackSize)) {
        throw new BadRequestException(
          'packUnit and packSize must be set together',
        );
      }
      item.packUnit = nextPackUnit;
      item.packSize = nextPackSize;
    }

    try {
      await item.save();
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(`SKU already in use in this branch`);
      }
      throw err;
    }
    return item;
  }

  async getItem(clinicId: Types.ObjectId, id: string): Promise<InventoryItemDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Inventory item not found');
    }
    const item = await this.itemModel.findOne({ _id: id, clinicId });
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }

  async searchItems(
    clinicId: Types.ObjectId,
    opts: { branchId?: string; query?: string; activeOnly?: boolean; limit?: number },
  ) {
    const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
    const filter: Record<string, unknown> = { clinicId };
    if (opts.branchId) filter.branchId = new Types.ObjectId(opts.branchId);
    if (opts.activeOnly !== false) filter.active = true;

    const q = (opts.query ?? '').trim();
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = { $regex: escaped, $options: 'i' };
      // Regex over name + SKU is fast for the typical few-hundred-item
      // catalog. Switch to $text once a clinic crosses ~5k SKUs.
      filter.$or = [{ name: re }, { sku: re }];
    }

    const items = await this.itemModel.find(filter).sort({ name: 1 }).limit(limit);
    if (!items.length) return [];

    // Roll up live (non-expired, non-zero) on-hand per item so the list
    // can show stock levels and "low stock" status without N round-trips.
    // Mirrors the aggregation in listLowStock — same source of truth.
    const onHandById = await this.onHandByItemIds(
      clinicId,
      items.map((i) => i._id),
    );
    return items.map((it) => ({
      ...it.toObject(),
      onHand: onHandById.get(it._id.toHexString()) ?? 0,
    }));
  }

  /**
   * List batches for a single item, oldest-expiry first (FIFO order).
   * Used by the inventory drawer to show what stock is on hand and when
   * each lot expires.
   */
  async listBatches(clinicId: Types.ObjectId, itemId: string) {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new NotFoundException('Inventory item not found');
    }
    // Verify the item belongs to this clinic before returning batches.
    // Without this a malicious caller could enumerate batches by id.
    const item = await this.itemModel.exists({ _id: itemId, clinicId });
    if (!item) throw new NotFoundException('Inventory item not found');

    return await this.batchModel
      .find({ clinicId, inventoryItemId: new Types.ObjectId(itemId) })
      .sort({ expiryDate: 1 });
  }

  /** Aggregate live on-hand quantity per item id. Internal helper. */
  private async onHandByItemIds(
    clinicId: Types.ObjectId,
    itemIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (!itemIds.length) return new Map();
    const totals = await this.batchModel.aggregate<{
      _id: Types.ObjectId;
      onHand: number;
    }>([
      {
        $match: {
          clinicId,
          inventoryItemId: { $in: itemIds },
          quantityRemaining: { $gt: 0 },
          expiryDate: { $gt: new Date() },
        },
      },
      {
        $group: { _id: '$inventoryItemId', onHand: { $sum: '$quantityRemaining' } },
      },
    ]);
    return new Map(totals.map((t) => [t._id.toHexString(), t.onHand]));
  }

  // -- stock movement ------------------------------------------------------

  /**
   * Receive a batch of stock against an inventory item. Creates a Batch
   * row and a paired RECEIVE StockMovement.
   */
  async receiveStock(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    itemId: string,
    dto: ReceiveStockDto,
  ): Promise<{ batch: InventoryBatch; movement: StockMovement }> {
    const item = await this.getItem(clinicId, itemId);

    const expiry = new Date(dto.expiryDate);
    if (isNaN(expiry.getTime())) {
      throw new BadRequestException('Invalid expiryDate');
    }
    if (expiry.getTime() <= Date.now()) {
      throw new BadRequestException(
        'expiryDate must be in the future — receive expired stock through ADJUST instead',
      );
    }

    const now = new Date();
    const batch = await this.batchModel.create({
      clinicId,
      branchId: item.branchId,
      inventoryItemId: item._id,
      batchNumber: dto.batchNumber.trim(),
      expiryDate: expiry,
      quantityReceived: dto.quantityReceived,
      quantityRemaining: dto.quantityReceived,
      unitCost: dto.unitCost,
      supplier: dto.supplier?.trim(),
      receivedAt: now,
      receivedBy: actorUserId,
    });

    const movement = await this.writeMovement({
      clinicId,
      branchId: item.branchId,
      inventoryItemId: item._id,
      batchId: batch._id,
      type: StockMovementType.Receive,
      quantityDelta: dto.quantityReceived,
      reason: `Received from ${dto.supplier ?? 'supplier'}`,
      actorUserId,
    });

    return { batch, movement };
  }

  /**
   * Walk active batches FIFO by expiryDate ascending, atomically decrement
   * each one until `quantity` is consumed. Refuses dispense (and rolls
   * back the partially-decremented batches) if total live stock is
   * insufficient.
   *
   * The atomic decrement uses
   *   findOneAndUpdate({ _id, quantityRemaining: { $gte: take } },
   *                    { $inc: { quantityRemaining: -take } })
   * which guarantees we never drive a batch negative even under
   * concurrent dispenses.
   */
  async dispenseStock(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    itemId: string,
    dto: DispenseStockDto,
  ): Promise<{ dispensed: number; movements: StockMovement[] }> {
    const item = await this.getItem(clinicId, itemId);
    let remaining = dto.quantity;
    const taken: Array<{ batchId: Types.ObjectId; qty: number }> = [];

    // Pull active (non-zero) batches FIFO. We re-read on every loop
    // iteration so concurrent dispenses don't double-spend a batch.
    while (remaining > 0) {
      const candidates = await this.batchModel
        .find({
          clinicId,
          inventoryItemId: item._id,
          quantityRemaining: { $gt: 0 },
          expiryDate: { $gt: new Date() },
        })
        .sort({ expiryDate: 1, createdAt: 1 })
        .limit(20);

      if (!candidates.length) break;

      let consumedThisRound = 0;
      for (const candidate of candidates) {
        if (remaining === 0) break;
        const take = Math.min(remaining, candidate.quantityRemaining);
        const updated = await this.batchModel.findOneAndUpdate(
          { _id: candidate._id, quantityRemaining: { $gte: take } },
          { $inc: { quantityRemaining: -take } },
          { new: true },
        );
        if (!updated) {
          // Lost a race — another dispense ate this batch. Skip and the
          // outer while-loop re-queries.
          continue;
        }
        taken.push({ batchId: candidate._id, qty: take });
        remaining -= take;
        consumedThisRound += take;
      }

      // Defensive infinite-loop break: if a full pass through the
      // candidates couldn't take anything (every CAS lost), bail rather
      // than spinning forever.
      if (consumedThisRound === 0) break;
    }

    if (remaining > 0) {
      // Roll back any partial decrements so the dispense is all-or-nothing.
      for (const t of taken) {
        await this.batchModel.updateOne(
          { _id: t.batchId },
          { $inc: { quantityRemaining: t.qty } },
        );
      }
      throw new ConflictException(
        `Insufficient stock — short by ${remaining} of ${dto.quantity}`,
      );
    }

    const movements = await Promise.all(
      taken.map((t) =>
        this.writeMovement({
          clinicId,
          branchId: item.branchId,
          inventoryItemId: item._id,
          batchId: t.batchId,
          type: StockMovementType.Dispense,
          quantityDelta: -t.qty,
          reason: dto.reason,
          prescriptionId: dto.prescriptionId
            ? new Types.ObjectId(dto.prescriptionId)
            : undefined,
          billId: dto.billId ? new Types.ObjectId(dto.billId) : undefined,
          actorUserId,
        }),
      ),
    );

    return { dispensed: dto.quantity, movements };
  }

  // -- reports -------------------------------------------------------------

  /**
   * Items at or under their reorder threshold. Calculated as
   * sum(quantityRemaining across non-expired batches) <= reorderLevel.
   */
  async listLowStock(
    clinicId: Types.ObjectId,
    opts: { branchId?: string },
  ) {
    const branchFilter = opts.branchId
      ? { branchId: new Types.ObjectId(opts.branchId) }
      : {};
    const items = await this.itemModel.find({
      clinicId,
      ...branchFilter,
      active: true,
      // 0 means "no alerting" so skip those.
      reorderLevel: { $gt: 0 },
    });
    if (!items.length) return [];

    const itemIds = items.map((i) => i._id);
    const totals = await this.batchModel.aggregate<{
      _id: Types.ObjectId;
      onHand: number;
    }>([
      {
        $match: {
          clinicId,
          inventoryItemId: { $in: itemIds },
          quantityRemaining: { $gt: 0 },
          expiryDate: { $gt: new Date() },
        },
      },
      {
        $group: {
          _id: '$inventoryItemId',
          onHand: { $sum: '$quantityRemaining' },
        },
      },
    ]);
    const onHandById = new Map(
      totals.map((t) => [t._id.toHexString(), t.onHand]),
    );

    return items
      .map((it) => {
        const onHand = onHandById.get(it._id.toHexString()) ?? 0;
        return {
          itemId: it._id,
          name: it.name,
          sku: it.sku,
          unit: it.unit,
          reorderLevel: it.reorderLevel,
          onHand,
          shortBy: Math.max(0, it.reorderLevel - onHand),
        };
      })
      .filter((row) => row.onHand <= row.reorderLevel)
      .sort((a, b) => b.shortBy - a.shortBy);
  }

  /**
   * Batches whose `expiryDate` falls within `daysAhead` (default 30).
   * Returns enough context that the operator can decide which to
   * discount-clear before they expire and have to be written off.
   */
  async listExpiring(
    clinicId: Types.ObjectId,
    opts: { branchId?: string; daysAhead?: number },
  ) {
    const days = Math.max(1, Math.min(365, opts.daysAhead ?? 30));
    const now = new Date();
    const horizon = new Date(now.getTime() + days * 86_400_000);
    const filter: Record<string, unknown> = {
      clinicId,
      quantityRemaining: { $gt: 0 },
      expiryDate: { $gt: now, $lte: horizon },
    };
    if (opts.branchId) filter.branchId = new Types.ObjectId(opts.branchId);

    return await this.batchModel
      .find(filter)
      .sort({ expiryDate: 1 })
      .populate({ path: 'inventoryItemId', select: 'name sku unit' })
      .limit(200);
  }

  async listMovements(
    clinicId: Types.ObjectId,
    itemId: string,
    opts: { limit?: number; before?: string },
  ) {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new NotFoundException('Inventory item not found');
    }
    const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
    const filter: Record<string, unknown> = {
      clinicId,
      inventoryItemId: new Types.ObjectId(itemId),
    };
    if (opts.before) {
      const d = new Date(opts.before);
      if (!isNaN(d.getTime())) filter.createdAt = { $lt: d };
    }
    const rows = await this.movementModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);
    const last = rows.length ? rows[rows.length - 1] : undefined;
    const nextBefore =
      last && (last as any).createdAt instanceof Date
        ? ((last as any).createdAt as Date).toISOString()
        : undefined;
    return { rows, nextBefore };
  }

  // -- internal ------------------------------------------------------------

  private async writeMovement(input: {
    clinicId: Types.ObjectId;
    branchId: Types.ObjectId;
    inventoryItemId: Types.ObjectId;
    batchId: Types.ObjectId;
    type: StockMovementType;
    quantityDelta: number;
    reason?: string;
    prescriptionId?: Types.ObjectId;
    billId?: Types.ObjectId;
    actorUserId?: Types.ObjectId;
  }): Promise<StockMovement> {
    const expiresAt = await this.retention.expiresAt(input.clinicId);
    return await this.movementModel.create({ ...input, expiresAt });
  }
}
