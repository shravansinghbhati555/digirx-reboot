import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Patient, PatientSchema } from './schemas/patient.schema';
import {
  PatientIdentifier,
  PatientIdentifierSchema,
} from './schemas/patient-identifier.schema';
import {
  MrnCounter,
  MrnCounterSchema,
} from './schemas/mrn-counter.schema';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';
import {
  Encounter,
  EncounterSchema,
} from '../encounters/schemas/encounter.schema';
import { Bill, BillSchema } from '../billing/schemas/bill.schema';
import { Payment, PaymentSchema } from '../billing/schemas/payment.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';
import { User, UserSchema } from '../authz/schemas/user.schema';
import {
  Prescription,
  PrescriptionSchema,
} from '../prescriptions/schemas/prescription.schema';
import { StorageModule } from '../storage/storage.module';
import { OfflineModule } from '../offline/offline.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Patient.name, schema: PatientSchema },
      { name: PatientIdentifier.name, schema: PatientIdentifierSchema },
      { name: MrnCounter.name, schema: MrnCounterSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Encounter.name, schema: EncounterSchema },
      { name: Bill.name, schema: BillSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Clinic.name, schema: ClinicSchema },
      // History enrichment: doctor + branch names, prescriptions per
      // encounter, payment totals per bill — looked up alongside the
      // 3-table fetch in PatientsService.getHistory.
      { name: Branch.name, schema: BranchSchema },
      { name: User.name, schema: UserSchema },
      { name: Prescription.name, schema: PrescriptionSchema },
    ]),
    // For presigning the profile-image URL on GET /patients/:id.
    StorageModule,
    // Lets an offline-registered patient keep the MRN its device already
    // drew from a lease, instead of being renumbered on replay.
    OfflineModule,
  ],
  controllers: [PatientsController],
  providers: [PatientsService],
})
export class PatientsModule {}
