import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CashDay, CashDaySchema } from './schemas/cash-day.schema';
import { Payment, PaymentSchema } from '../billing/schemas/payment.schema';
import { CreditNote, CreditNoteSchema } from '../credit-notes/schemas/credit-note.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { CashDaysController } from './cash-days.controller';
import { CashDaysService } from './cash-days.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CashDay.name, schema: CashDaySchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: CreditNote.name, schema: CreditNoteSchema },
      { name: Clinic.name, schema: ClinicSchema },
    ]),
  ],
  controllers: [CashDaysController],
  providers: [CashDaysService],
})
export class CashDaysModule {}
