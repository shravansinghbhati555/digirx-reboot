import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NumberLeaseDocument = HydratedDocument<NumberLease>;

/**
 * Which counter a lease draws from. Each maps to an existing server-side
 * counter collection; a lease reserves a contiguous block out of it.
 */
export enum LeaseCounter {
  /** `MrnCounter` — per clinic. Patient-facing and permanent. */
  Mrn = 'MRN',
  /** `PrescriptionCounter` — per clinic. Printed on the slip. */
  Prescription = 'PRESCRIPTION',
  /** `BillCounter` — per clinic + branch + fiscal year. */
  Bill = 'BILL',
}

export enum LeaseStatus {
  Active = 'ACTIVE',
  /** Every number in the block has been reported used. */
  Exhausted = 'EXHAUSTED',
  /** Handed back voluntarily, or superseded. Remaining numbers become gaps. */
  Released = 'RELEASED',
  /** Past `expiresAt` without being used up. */
  Expired = 'EXPIRED',
}

/**
 * A block of sequence numbers reserved for one device to use while offline.
 *
 * ## Why blocks rather than prefixes
 *
 * The alternative is a per-device prefix (`MRN-D2-0001`). That is simpler,
 * but it changes numbers a clinic already has printed on files and cards.
 * Leasing keeps the existing format and sequence intact.
 *
 * ## Why this is safe
 *
 * Allocation increments the *real* counter by the block size in a single
 * atomic `findOneAndUpdate`, then keeps the range it just skipped past. The
 * server can never mint a number inside a leased block, because as far as the
 * counter is concerned those numbers are already spent. Two devices leasing
 * concurrently get adjacent, non-overlapping ranges.
 *
 * Unused numbers in a block become gaps in the sequence. That is the accepted
 * trade here and elsewhere in the codebase — `BillNumberingService` already
 * notes that auditors prefer gaps to duplicates.
 */
@Schema({ timestamps: true })
export class NumberLease {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  /** Only set for counters scoped per branch (BILL). */
  @Prop({ type: Types.ObjectId })
  branchId?: Types.ObjectId;

  /** The device holding this lease — `x-device-id`, minted client-side. */
  @Prop({ required: true, trim: true, index: true })
  deviceId!: string;

  @Prop({ required: true, enum: LeaseCounter })
  counter!: LeaseCounter;

  /**
   * Fiscal-year label for BILL leases, matching `BillCounter.fiscalYear`.
   *
   * A block is only valid inside the year it was drawn from: a device that
   * leases in March and stays offline into April is holding numbers for the
   * wrong year, so the client must stop issuing rather than use them.
   */
  @Prop({ trim: true })
  fiscalYear?: string;

  /** First number in the block, inclusive. */
  @Prop({ type: Number, required: true })
  blockStart!: number;

  /** Last number in the block, inclusive. */
  @Prop({ type: Number, required: true })
  blockEnd!: number;

  /**
   * Highest number the client has reported using. Advisory only — the client
   * is the authority while offline, and this catches up on sync. Used to
   * report how much of a block is left and to decide when to refill.
   */
  @Prop({ type: Number, required: true, default: 0 })
  usedThrough!: number;

  @Prop({ required: true, enum: LeaseStatus, default: LeaseStatus.Active })
  status!: LeaseStatus;

  /**
   * After this, the lease should not be drawn from. Bounds how long a block
   * can sit unused, so an abandoned device does not hold numbers forever.
   */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Types.ObjectId })
  issuedToUserId?: Types.ObjectId;
}

export const NumberLeaseSchema = SchemaFactory.createForClass(NumberLease);

/**
 * One active lease per device per counter scope. A device that needs more
 * numbers releases or exhausts its current block first, which keeps "what am
 * I drawing from?" unambiguous on the client.
 *
 * Partial so only ACTIVE rows are constrained — historical leases accumulate
 * freely for audit.
 */
NumberLeaseSchema.index(
  { clinicId: 1, deviceId: 1, counter: 1, branchId: 1, fiscalYear: 1 },
  {
    unique: true,
    name: 'lease_active_unique',
    partialFilterExpression: { status: LeaseStatus.Active },
  },
);

NumberLeaseSchema.index(
  { clinicId: 1, counter: 1, blockStart: 1 },
  { name: 'lease_block_idx' },
);
