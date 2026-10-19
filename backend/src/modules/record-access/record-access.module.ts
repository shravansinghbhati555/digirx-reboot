import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  RecordAccessGrant,
  RecordAccessGrantSchema,
} from './schemas/record-access-grant.schema';
import { RecordAccessService } from './record-access.service';
import { RecordAccessController } from './record-access.controller';
import { PatientIdentitiesModule } from '../patient-identities/patient-identities.module';
import { PatientsModule } from '../patients/patients.module';
import { AccessLogsModule } from '../access-logs/access-logs.module';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import {
  Prescription,
  PrescriptionSchema,
} from '../prescriptions/schemas/prescription.schema';
import {
  MedicineCatalogItem,
  MedicineCatalogItemSchema,
} from '../medicines/schemas/medicine-catalog-item.schema';

/** Patient-granted, clinic-scoped access to records held at other clinics. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RecordAccessGrant.name, schema: RecordAccessGrantSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Prescription.name, schema: PrescriptionSchema },
      { name: MedicineCatalogItem.name, schema: MedicineCatalogItemSchema },
    ]),
    PatientIdentitiesModule,
    PatientsModule,
    AccessLogsModule,
  ],
  controllers: [RecordAccessController],
  providers: [RecordAccessService],
  exports: [RecordAccessService],
})
export class RecordAccessModule {}
