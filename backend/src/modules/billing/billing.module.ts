import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CreditNotesModule } from '../credit-notes/credit-notes.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillNumberingService } from './bill-numbering.service';
import { Bill, BillSchema } from './schemas/bill.schema';
import {
  BillCounter,
  BillCounterSchema,
} from './schemas/bill-counter.schema';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import {
  ServiceCatalogItem,
  ServiceCatalogItemSchema,
} from './schemas/service-catalog-item.schema';
import { PdfModule } from '../pdf/pdf.module';
import { StorageModule } from '../storage/storage.module';
import { DocumentsModule } from '../documents/documents.module';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bill.name, schema: BillSchema },
      { name: BillCounter.name, schema: BillCounterSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: ServiceCatalogItem.name, schema: ServiceCatalogItemSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: Branch.name, schema: BranchSchema },
    ]),
    PdfModule,
    StorageModule,
    DocumentsModule,
    // BillingService injects CreditNotesService for void-blocking, and
    // CreditNotesModule imports BillingModule for the Bill schema — the
    // forwardRef breaks the boot-time cycle.
    forwardRef(() => CreditNotesModule),
  ],
  controllers: [BillingController],
  providers: [BillingService, BillNumberingService],
  exports: [BillingService],
})
export class BillingModule {}
