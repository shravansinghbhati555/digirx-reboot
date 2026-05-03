import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Patient, PatientSchema } from './schemas/patient.schema';
import {
  PatientIdentifier,
  PatientIdentifierSchema,
} from './schemas/patient-identifier.schema';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { DocumentsModule } from '../documents/documents.module';
import { PatientDocumentsController } from './patientDocuments.controller';
import { StorageModule } from '../storage/storage.module';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';
import {
  Encounter,
  EncounterSchema,
} from '../encounters/schemas/encounter.schema';
import { Bill, BillSchema } from '../billing/schemas/bill.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Patient.name, schema: PatientSchema },
      { name: PatientIdentifier.name, schema: PatientIdentifierSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Encounter.name, schema: EncounterSchema },
      { name: Bill.name, schema: BillSchema },
    ]),
    DocumentsModule,
    StorageModule,
  ],
  controllers: [PatientsController, PatientDocumentsController],
  providers: [PatientsService],
})
export class PatientsModule {}
