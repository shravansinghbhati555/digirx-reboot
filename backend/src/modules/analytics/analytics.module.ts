import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';
import { Bill, BillSchema } from '../billing/schemas/bill.schema';
import { Payment, PaymentSchema } from '../billing/schemas/payment.schema';
import {
  CreditNote,
  CreditNoteSchema,
} from '../credit-notes/schemas/credit-note.schema';
import {
  Encounter,
  EncounterSchema,
} from '../encounters/schemas/encounter.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsScheduler } from './analytics.scheduler';
import { AnalyticsService } from './analytics.service';
import { DailyStats, DailyStatsSchema } from './schemas/daily-stats.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyStats.name, schema: DailyStatsSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Encounter.name, schema: EncounterSchema },
      { name: Bill.name, schema: BillSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: CreditNote.name, schema: CreditNoteSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: Branch.name, schema: BranchSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsScheduler],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
