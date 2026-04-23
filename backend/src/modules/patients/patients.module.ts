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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Patient.name, schema: PatientSchema },
      { name: PatientIdentifier.name, schema: PatientIdentifierSchema },
    ]),
    DocumentsModule,
  ],
  controllers: [PatientsController, PatientDocumentsController],
  providers: [PatientsService],
})
export class PatientsModule {}
