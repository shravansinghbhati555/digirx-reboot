import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { InventoryService } from './inventory.service';
import { InventoryUnit } from './schemas/inventory-item.schema';
import { StockMovementType } from './schemas/stock-movement.schema';

describe('InventoryService', () => {
  let itemModel: any;
  let batchModel: any;
  let movementModel: any;
  let retention: any;
  let service: InventoryService;

  const clinicId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const itemId = new Types.ObjectId();

  const item = {
    _id: itemId,
    clinicId,
    branchId,
    name: 'Paracetamol 500mg',
    unit: InventoryUnit.Tablet,
    reorderLevel: 50,
    active: true,
  };

  beforeEach(() => {
    itemModel = {
      create: jest.fn(),
      findOne: jest.fn().mockResolvedValue(item),
      find: jest.fn(),
    };
    batchModel = {
      create: jest.fn(),
      find: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      aggregate: jest.fn(),
    };
    movementModel = {
      create: jest
        .fn()
        .mockImplementation(async (input: any) => ({ _id: new Types.ObjectId(), ...input })),
      find: jest.fn(),
    };
    retention = {
      expiresAt: jest
        .fn()
        .mockResolvedValue(new Date(Date.now() + 365 * 86_400_000)),
    };
    service = new InventoryService(itemModel, batchModel, movementModel, retention);
  });

  describe('dispenseStock — FIFO across batches', () => {
    it('walks batches by expiryDate ascending and decrements atomically', async () => {
      const earlyBatch = {
        _id: new Types.ObjectId(),
        quantityRemaining: 30,
        expiryDate: new Date('2026-06-01'),
      };
      const lateBatch = {
        _id: new Types.ObjectId(),
        quantityRemaining: 50,
        expiryDate: new Date('2026-12-01'),
      };
      // First scan returns both candidates in expiry order.
      batchModel.find.mockReturnValueOnce({
        sort: () => ({ limit: async () => [earlyBatch, lateBatch] }),
      });
      // CAS succeeds for both.
      batchModel.findOneAndUpdate
        .mockResolvedValueOnce({ ...earlyBatch, quantityRemaining: 0 })
        .mockResolvedValueOnce({ ...lateBatch, quantityRemaining: 30 });

      const out = await service.dispenseStock(clinicId, undefined, itemId.toHexString(), {
        quantity: 50,
      });

      expect(out.dispensed).toBe(50);
      expect(out.movements).toHaveLength(2);
      // Earlier batch is fully consumed, later batch covers the remainder.
      expect(batchModel.findOneAndUpdate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          _id: earlyBatch._id,
          quantityRemaining: { $gte: 30 },
        }),
        expect.objectContaining({ $inc: { quantityRemaining: -30 } }),
        expect.anything(),
      );
      expect(batchModel.findOneAndUpdate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          _id: lateBatch._id,
          quantityRemaining: { $gte: 20 },
        }),
        expect.objectContaining({ $inc: { quantityRemaining: -20 } }),
        expect.anything(),
      );
      // Each successful CAS produces a paired DISPENSE movement.
      expect(movementModel.create).toHaveBeenCalledTimes(2);
      expect(movementModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: StockMovementType.Dispense }),
      );
    });

    it('rolls back partial decrements and 409s when total stock is short', async () => {
      const onlyBatch = {
        _id: new Types.ObjectId(),
        quantityRemaining: 10,
        expiryDate: new Date('2026-06-01'),
      };
      // First pass: see one batch.
      batchModel.find.mockReturnValueOnce({
        sort: () => ({ limit: async () => [onlyBatch] }),
      });
      // CAS takes the 10 we have.
      batchModel.findOneAndUpdate.mockResolvedValueOnce({
        ...onlyBatch,
        quantityRemaining: 0,
      });
      // Second pass: nothing left.
      batchModel.find.mockReturnValueOnce({
        sort: () => ({ limit: async () => [] }),
      });

      await expect(
        service.dispenseStock(clinicId, undefined, itemId.toHexString(), {
          quantity: 25,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // The decrement against the only batch must be rolled back.
      expect(batchModel.updateOne).toHaveBeenCalledWith(
        { _id: onlyBatch._id },
        { $inc: { quantityRemaining: 10 } },
      );
      // No movements should be persisted on a failed dispense.
      expect(movementModel.create).not.toHaveBeenCalled();
    });

    it('skips a batch whose CAS lost a race and tries the next one', async () => {
      const racy = {
        _id: new Types.ObjectId(),
        quantityRemaining: 5,
        expiryDate: new Date('2026-06-01'),
      };
      const fallback = {
        _id: new Types.ObjectId(),
        quantityRemaining: 10,
        expiryDate: new Date('2026-12-01'),
      };
      batchModel.find.mockReturnValueOnce({
        sort: () => ({ limit: async () => [racy, fallback] }),
      });
      // CAS on `racy` finds null (someone else already drained it),
      // CAS on `fallback` succeeds.
      batchModel.findOneAndUpdate
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...fallback, quantityRemaining: 5 });

      const out = await service.dispenseStock(clinicId, undefined, itemId.toHexString(), {
        quantity: 5,
      });

      expect(out.dispensed).toBe(5);
      expect(out.movements).toHaveLength(1);
      // Only the fallback got a movement row.
      expect(movementModel.create).toHaveBeenCalledTimes(1);
      expect(movementModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ batchId: fallback._id, quantityDelta: -5 }),
      );
    });
  });

  describe('listLowStock', () => {
    it('returns items at or below reorderLevel, sorted by shortBy', async () => {
      const items = [
        { _id: new Types.ObjectId(), name: 'A', sku: 'A-1', unit: InventoryUnit.Tablet, reorderLevel: 50 },
        { _id: new Types.ObjectId(), name: 'B', sku: 'B-1', unit: InventoryUnit.Tablet, reorderLevel: 100 },
        { _id: new Types.ObjectId(), name: 'C', sku: 'C-1', unit: InventoryUnit.Tablet, reorderLevel: 30 },
      ];
      itemModel.find.mockResolvedValue(items);
      batchModel.aggregate.mockResolvedValue([
        { _id: items[0]._id, onHand: 10 },   // short by 40
        { _id: items[1]._id, onHand: 200 },  // healthy
        { _id: items[2]._id, onHand: 25 },   // short by 5
      ]);

      const rows = await service.listLowStock(clinicId, {});
      expect(rows).toHaveLength(2);
      expect(rows[0].name).toBe('A'); // worst shortfall first
      expect(rows[0].shortBy).toBe(40);
      expect(rows[1].shortBy).toBe(5);
    });

    it('skips items with reorderLevel of 0 (alerting disabled)', async () => {
      // Service filters reorderLevel: { $gt: 0 } — verify the filter is set.
      itemModel.find.mockResolvedValue([]);
      await service.listLowStock(clinicId, {});
      expect(itemModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ reorderLevel: { $gt: 0 } }),
      );
    });
  });

  describe('getItem', () => {
    it('throws 404 for an invalid ObjectId', async () => {
      await expect(
        service.getItem(clinicId, 'not-a-valid-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when the item belongs to another clinic', async () => {
      itemModel.findOne.mockResolvedValueOnce(null);
      await expect(
        service.getItem(clinicId, new Types.ObjectId().toHexString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
