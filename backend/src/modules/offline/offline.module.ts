import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientIdConflictFilter } from './filters/client-id-conflict.filter';
import { NumberLease, NumberLeaseSchema } from './schemas/number-lease.schema';
import { NumberLeaseController } from './number-lease.controller';
import { NumberLeaseService } from './number-lease.service';
import { MrnCounter, MrnCounterSchema } from '../patients/schemas/mrn-counter.schema';
import {
  PrescriptionCounter,
  PrescriptionCounterSchema,
} from '../prescriptions/schemas/prescription-counter.schema';
import { BillCounter, BillCounterSchema } from '../billing/schemas/bill-counter.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';

/**
 * Everything the offline-first work owns. See README.md in this folder for
 * the boundary: this module holds offline *policy*, and feature modules
 * declare participation in one line rather than implementing it themselves.
 *
 * Phase 0 tickets landing here as they are built:
 *   A1 ✓ client-minted ids — `ClientIdDto`, `clientIdFields`, the 409 filter
 *   A4 ✓ device identity (`x-device-id` → RequestContext → AuditLog)
 *   C1 ✓ number leases — schema, allocation service, endpoints
 *   C3   `issueBill` accepting a pre-minted leased number
 *   —    sync/outbox endpoints from Phase 3 onward
 *
 * The counter models are imported read-write because issuing a lease has to
 * advance the real counter atomically — that is what makes a leased block
 * safe from concurrent online minting.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NumberLease.name, schema: NumberLeaseSchema },
      { name: MrnCounter.name, schema: MrnCounterSchema },
      { name: PrescriptionCounter.name, schema: PrescriptionCounterSchema },
      { name: BillCounter.name, schema: BillCounterSchema },
      { name: Clinic.name, schema: ClinicSchema },
    ]),
  ],
  controllers: [NumberLeaseController],
  providers: [
    NumberLeaseService,
    {
      provide: APP_FILTER,
      useClass: ClientIdConflictFilter,
    },
  ],
  exports: [NumberLeaseService],
})
export class OfflineModule {}
