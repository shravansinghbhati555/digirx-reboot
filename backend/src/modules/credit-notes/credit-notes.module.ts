import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BillingModule } from '../billing/billing.module';
import { Bill, BillSchema } from '../billing/schemas/bill.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { CreditNoteNumberingService } from './credit-note-numbering.service';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';
import {
  CreditNote,
  CreditNoteSchema,
} from './schemas/credit-note.schema';
import {
  CreditNoteCounter,
  CreditNoteCounterSchema,
} from './schemas/credit-note-counter.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CreditNote.name, schema: CreditNoteSchema },
      { name: CreditNoteCounter.name, schema: CreditNoteCounterSchema },
      { name: Bill.name, schema: BillSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: Clinic.name, schema: ClinicSchema },
    ]),
    // forwardRef so BillingService can inject CreditNotesService (for
    // void-blocking) without a circular import error at module init.
    forwardRef(() => BillingModule),
  ],
  controllers: [CreditNotesController],
  providers: [CreditNotesService, CreditNoteNumberingService],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}
