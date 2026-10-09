import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EncountersModule } from '../encounters/encounters.module';
import { DocumentsModule } from '../documents/documents.module';
import { MedicinesModule } from '../medicines/medicines.module';
import { PdfModule } from '../pdf/pdf.module';
import { StorageModule } from '../storage/storage.module';
import { PrescriptionsController } from './prescriptions.controller';
import { PrescriptionsService } from './prescriptions.service';
import { PrescriptionNumberingService } from './prescription-numbering.service';
import {
  Prescription,
  PrescriptionSchema,
} from './schemas/prescription.schema';
import {
  PrescriptionCounter,
  PrescriptionCounterSchema,
} from './schemas/prescription-counter.schema';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import { User, UserSchema } from '../authz/schemas/user.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';
import { Encounter, EncounterSchema } from '../encounters/schemas/encounter.schema';
import { OfflineModule } from '../offline/offline.module';

@Module({
  imports: [
    // Lets a prescription written offline keep the number its device
    // already drew from a lease.
    OfflineModule,
    MongooseModule.forFeature([
      { name: Prescription.name, schema: PrescriptionSchema },
      { name: PrescriptionCounter.name, schema: PrescriptionCounterSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: User.name, schema: UserSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: Encounter.name, schema: EncounterSchema },
    ]),
    EncountersModule,
    PdfModule,
    StorageModule,
    DocumentsModule,
    MedicinesModule,
  ],
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService, PrescriptionNumberingService],
})
export class PrescriptionsModule {}
