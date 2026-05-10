import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { InventoryController } from './inventory.controller';
import { InventoryFeatureGuard } from './inventory.guard';
import { InventoryService } from './inventory.service';
import {
  InventoryBatch,
  InventoryBatchSchema,
} from './schemas/inventory-batch.schema';
import {
  InventoryItem,
  InventoryItemSchema,
} from './schemas/inventory-item.schema';
import {
  StockMovement,
  StockMovementSchema,
} from './schemas/stock-movement.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InventoryItem.name, schema: InventoryItemSchema },
      { name: InventoryBatch.name, schema: InventoryBatchSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      // Read-only access used by the feature-flag guard.
      { name: Clinic.name, schema: ClinicSchema },
    ]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryFeatureGuard],
  exports: [InventoryService],
})
export class InventoryModule {}
