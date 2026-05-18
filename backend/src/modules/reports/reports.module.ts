import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';
import { Bill, BillSchema } from '../billing/schemas/bill.schema';
import { Payment, PaymentSchema } from '../billing/schemas/payment.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import {
  DoctorAvailabilityRule,
  DoctorAvailabilityRuleSchema,
} from '../availability/schemas/doctor-availability-rule.schema';
import { CreditNotesModule } from '../credit-notes/credit-notes.module';
import { FxModule } from '../fx/fx.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Bill.name, schema: BillSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Branch.name, schema: BranchSchema },
      // For the doctor-utilization capacity calculation in 2.1b.
      {
        name: DoctorAvailabilityRule.name,
        schema: DoctorAvailabilityRuleSchema,
      },
    ]),
    CreditNotesModule,
    FxModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
