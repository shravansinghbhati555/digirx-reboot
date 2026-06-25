import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Document, DocumentSchema } from './schemas/document.schema';
import {
  DocumentShare,
  DocumentShareSchema,
} from './schemas/document-share.schema';
import {
  DocumentAccessLog,
  DocumentAccessLogSchema,
} from './schemas/document-access-log.schema';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { StorageModule } from '../storage/storage.module';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import { User, UserSchema } from '../authz/schemas/user.schema';
import { Encounter, EncounterSchema } from '../encounters/schemas/encounter.schema';
import { Prescription, PrescriptionSchema } from '../prescriptions/schemas/prescription.schema';
import { Bill, BillSchema } from '../billing/schemas/bill.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: DocumentShare.name, schema: DocumentShareSchema },
      { name: DocumentAccessLog.name, schema: DocumentAccessLogSchema },
      // Read-only here — used to resolve patient/user names for the
      // document list (owner names aren't always denormalized on the doc).
      // Encounter/Prescription let us hop owner → patient → name.
      { name: Patient.name, schema: PatientSchema },
      { name: User.name, schema: UserSchema },
      { name: Encounter.name, schema: EncounterSchema },
      { name: Prescription.name, schema: PrescriptionSchema },
      { name: Bill.name, schema: BillSchema },
    ]),
    StorageModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
