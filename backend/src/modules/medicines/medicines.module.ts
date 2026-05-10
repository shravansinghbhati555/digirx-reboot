import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MedicineCatalogItem,
  MedicineCatalogItemSchema,
} from './schemas/medicine-catalog-item.schema';
import { MedicinesController } from './medicines.controller';
import { MedicinesService } from './medicines.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MedicineCatalogItem.name, schema: MedicineCatalogItemSchema },
    ]),
  ],
  controllers: [MedicinesController],
  providers: [MedicinesService],
  exports: [MedicinesService],
})
export class MedicinesModule {}
