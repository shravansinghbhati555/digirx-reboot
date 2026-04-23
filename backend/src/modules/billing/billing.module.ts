import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Bill, BillSchema } from './schemas/bill.schema';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { ServiceCatalogItem, ServiceCatalogItemSchema } from './schemas/service-catalog-item.schema';
import { PdfModule } from '../pdf/pdf.module';
import { StorageModule } from '../storage/storage.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bill.name, schema: BillSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: ServiceCatalogItem.name, schema: ServiceCatalogItemSchema },
    ]),
    PdfModule,
    StorageModule,
    DocumentsModule,
  ],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}

