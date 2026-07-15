import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CreditNotesModule } from '../credit-notes/credit-notes.module';
import { BillingController } from './billing.controller';
import { RazorpayController } from './razorpay.controller';
import { RazorpayService } from './razorpay.service';
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
import { Appointment, AppointmentSchema } from '../appointments/schemas/appointment.schema';
import { Encounter, EncounterSchema } from '../encounters/schemas/encounter.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';
// Schemas the medicine-bill-from-prescription drafter (Slice 3) needs
// read access to. Registered here so we don't pull half the prescription
// service's other deps along.
import { Prescription, PrescriptionSchema } from '../prescriptions/schemas/prescription.schema';
import { InventoryItem, InventoryItemSchema } from '../inventory/schemas/inventory-item.schema';
// Auto-deduct on medicine-bill payment (Slice 5) calls InventoryService
// to FIFO-dispense each line. Dependency is one-way (inventory doesn't
// import billing) so no forwardRef needed.
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bill.name, schema: BillSchema },
      { name: BillCounter.name, schema: BillCounterSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: ServiceCatalogItem.name, schema: ServiceCatalogItemSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Encounter.name, schema: EncounterSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: Prescription.name, schema: PrescriptionSchema },
      { name: InventoryItem.name, schema: InventoryItemSchema },
    ]),
    PdfModule,
    StorageModule,
    DocumentsModule,
    InventoryModule,
    // BillingService injects CreditNotesService for void-blocking, and
    // CreditNotesModule imports BillingModule for the Bill schema — the
    // forwardRef breaks the boot-time cycle.
    forwardRef(() => CreditNotesModule),
  ],
  controllers: [BillingController, RazorpayController],
  providers: [BillingService, BillNumberingService, RazorpayService],
  exports: [BillingService, RazorpayService],
})
export class BillingModule { }
