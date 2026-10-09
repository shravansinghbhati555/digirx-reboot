import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  LeaseCounter,
  LeaseStatus,
  NumberLease,
} from './schemas/number-lease.schema';
import { MrnCounter } from '../patients/schemas/mrn-counter.schema';
import { PrescriptionCounter } from '../prescriptions/schemas/prescription-counter.schema';
import { BillCounter } from '../billing/schemas/bill-counter.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { computeFiscalYear, deriveBranchCode } from '../billing/bill-numbering.service';
import { Branch } from '../tenancy/schemas/branch.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';

/** Block sizes. Deliberately modest: an unused block is a permanent gap. */
const DEFAULT_BLOCK_SIZE: Record<LeaseCounter, number> = {
  [LeaseCounter.Mrn]: 50,
  [LeaseCounter.Prescription]: 100,
  [LeaseCounter.Bill]: 100,
};

const MAX_BLOCK_SIZE = 500;

/**
 * How long a block stays drawable. Long enough to cover the offline window
 * the client is configured for, short enough that an abandoned tablet stops
 * holding numbers. Kept in step with `VITE_OFFLINE_GRACE_HOURS` on the client
 * — if that grows, this should too.
 */
const LEASE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type LeaseView = {
  id: string;
  counter: LeaseCounter;
  branchId?: string;
  fiscalYear?: string;
  blockStart: number;
  blockEnd: number;
  usedThrough: number;
  remaining: number;
  expiresAt: Date;
  /** The clinic's raw format string, for display/debugging. */
  format: string;
  /**
   * The same format with **every token except `{seq}` already resolved** —
   * e.g. `INV-MAIN-2026-{seq:08}`.
   *
   * The client only has to substitute the sequence number, so it cannot drift
   * from the server on branch codes, fiscal years or clinic codes. Those are
   * derived here, once, by the same helpers the online path uses.
   */
  numberTemplate: string;
};

@Injectable()
export class NumberLeaseService {
  private readonly logger = new Logger(NumberLeaseService.name);

  constructor(
    @InjectModel(NumberLease.name)
    private readonly leaseModel: Model<NumberLease>,
    @InjectModel(MrnCounter.name)
    private readonly mrnCounterModel: Model<MrnCounter>,
    @InjectModel(PrescriptionCounter.name)
    private readonly rxCounterModel: Model<PrescriptionCounter>,
    @InjectModel(BillCounter.name)
    private readonly billCounterModel: Model<BillCounter>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
  ) {}

  /**
   * Reserve a block for a device.
   *
   * Returns the existing active lease when one is still usable, so a client
   * that asks twice does not burn two blocks. Refilling is explicit: release
   * the old lease, then ask again.
   */
  async issue(input: {
    clinicId: Types.ObjectId;
    branchId?: Types.ObjectId;
    deviceId: string;
    counter: LeaseCounter;
    size?: number;
    actorUserId?: Types.ObjectId;
  }): Promise<LeaseView> {
    const { clinicId, deviceId, counter } = input;
    if (!deviceId) {
      throw new BadRequestException(
        'A device id is required to lease numbers (send x-device-id)',
      );
    }

    const size = this.resolveSize(counter, input.size);
    const branchId = counter === LeaseCounter.Bill ? input.branchId : undefined;
    if (counter === LeaseCounter.Bill && !branchId) {
      throw new BadRequestException('branchId is required for BILL leases');
    }

    const fiscalYear =
      counter === LeaseCounter.Bill
        ? await this.currentFiscalYear(clinicId)
        : undefined;

    // Hand back a live lease rather than allocating another block.
    const existing = await this.leaseModel.findOne({
      clinicId,
      deviceId,
      counter,
      ...(branchId ? { branchId } : { branchId: { $exists: false } }),
      ...(fiscalYear ? { fiscalYear } : {}),
      status: LeaseStatus.Active,
    });
    if (existing && existing.expiresAt > new Date()) {
      if (existing.usedThrough < existing.blockEnd) {
        return await this.viewOf(existing);
      }
      // Fully used — retire it so the allocation below can proceed.
      existing.status = LeaseStatus.Exhausted;
      await existing.save();
    } else if (existing) {
      existing.status = LeaseStatus.Expired;
      await existing.save();
    }

    // The load-bearing step: advance the real counter by the block size in one
    // atomic operation, and keep the range we just jumped over. Online minting
    // can then never land inside this block, because the counter already
    // considers those numbers spent.
    const blockEnd = await this.advanceCounter(clinicId, branchId, counter, fiscalYear, size);
    const blockStart = blockEnd - size + 1;

    const lease = await this.leaseModel.create({
      clinicId,
      branchId,
      deviceId,
      counter,
      fiscalYear,
      blockStart,
      blockEnd,
      usedThrough: blockStart - 1,
      status: LeaseStatus.Active,
      expiresAt: new Date(Date.now() + LEASE_TTL_MS),
      issuedToUserId: input.actorUserId,
    });

    this.logger.log(
      `Leased ${counter} ${blockStart}-${blockEnd} to device ${deviceId} (clinic ${clinicId.toHexString()})`,
    );
    return await this.viewOf(lease);
  }

  /** Active leases held by one device. */
  async listForDevice(
    clinicId: Types.ObjectId,
    deviceId: string,
  ): Promise<LeaseView[]> {
    const rows = await this.leaseModel.find({
      clinicId,
      deviceId,
      status: LeaseStatus.Active,
    });
    const out: LeaseView[] = [];
    for (const row of rows) {
      out.push(await this.viewOf(row));
    }
    return out;
  }

  /**
   * Report how far into a block the device has got. Advisory — the client is
   * the authority while offline — but it lets the UI warn before a block runs
   * dry, and shows an admin what is outstanding.
   */
  async reportUsage(
    clinicId: Types.ObjectId,
    deviceId: string,
    leaseId: string,
    usedThrough: number,
  ): Promise<LeaseView> {
    const lease = await this.leaseModel.findOne({ _id: leaseId, clinicId, deviceId });
    if (!lease) throw new NotFoundException('Lease not found');

    // Monotonic: a replayed or out-of-order report must not rewind it.
    if (usedThrough > lease.usedThrough) {
      lease.usedThrough = Math.min(usedThrough, lease.blockEnd);
      if (lease.usedThrough >= lease.blockEnd) lease.status = LeaseStatus.Exhausted;
      await lease.save();
    }
    return await this.viewOf(lease);
  }

  /**
   * Give back a block. Remaining numbers are not recycled — reusing them
   * would risk a duplicate if the device was wrong about what it had used.
   * They become gaps, which is the safe direction.
   */
  async release(
    clinicId: Types.ObjectId,
    deviceId: string,
    leaseId: string,
  ): Promise<void> {
    const lease = await this.leaseModel.findOne({ _id: leaseId, clinicId, deviceId });
    if (!lease) throw new NotFoundException('Lease not found');
    lease.status = LeaseStatus.Released;
    await lease.save();
  }

  /**
   * Confirm a sequence number was genuinely leased to this device, and return
   * the resolved template so the caller renders it exactly as the online path
   * would.
   *
   * Accepts leases in any state except never-issued: a block that is now
   * exhausted or released was still legitimately held when the offline write
   * was made, and refusing it on replay would reject work that was correct
   * when it happened. Uniqueness is still guaranteed by the allocation — no
   * other device or online mint can have been given this number.
   */
  async resolveLeasedNumber(input: {
    clinicId: Types.ObjectId;
    branchId?: Types.ObjectId;
    deviceId: string;
    counter: LeaseCounter;
    seq: number;
  }): Promise<string> {
    const { clinicId, deviceId, counter, seq } = input;
    if (!deviceId) {
      throw new BadRequestException('x-device-id is required to use a leased number');
    }
    const lease = await this.leaseModel.findOne({
      clinicId,
      deviceId,
      counter,
      blockStart: { $lte: seq },
      blockEnd: { $gte: seq },
    });
    if (!lease) {
      throw new BadRequestException(
        `Sequence ${seq} was not leased to this device for ${counter}`,
      );
    }
    const format = await this.formatFor(clinicId, counter);
    const template = await this.buildTemplate(
      clinicId,
      lease.branchId,
      counter,
      lease.fiscalYear,
      format,
    );
    return template.replace(/\{seq(?::(\d+))?\}/g, (_m, w?: string) =>
      String(seq).padStart(w ? Number(w) : 1, '0'),
    );
  }

  // ------------------------------------------------------------- internals

  private resolveSize(counter: LeaseCounter, requested?: number): number {
    const fallback = DEFAULT_BLOCK_SIZE[counter];
    if (!requested) return fallback;
    if (!Number.isInteger(requested) || requested < 1) {
      throw new BadRequestException('size must be a positive integer');
    }
    if (requested > MAX_BLOCK_SIZE) {
      throw new BadRequestException(`size must not exceed ${MAX_BLOCK_SIZE}`);
    }
    return requested;
  }

  private async advanceCounter(
    clinicId: Types.ObjectId,
    branchId: Types.ObjectId | undefined,
    counter: LeaseCounter,
    fiscalYear: string | undefined,
    size: number,
  ): Promise<number> {
    if (counter === LeaseCounter.Mrn) {
      const row = await this.mrnCounterModel.findOneAndUpdate(
        { clinicId },
        { $inc: { lastNumber: size } },
        { upsert: true, new: true },
      );
      return row.lastNumber;
    }
    if (counter === LeaseCounter.Prescription) {
      const row = await this.rxCounterModel.findOneAndUpdate(
        { clinicId },
        { $inc: { lastNumber: size } },
        { upsert: true, new: true },
      );
      return row.lastNumber;
    }
    const row = await this.billCounterModel.findOneAndUpdate(
      { clinicId, branchId, fiscalYear },
      { $inc: { lastNumber: size } },
      { upsert: true, new: true },
    );
    return row.lastNumber;
  }

  private async currentFiscalYear(clinicId: Types.ObjectId): Promise<string> {
    const clinic = await this.clinicModel.findById(clinicId);
    if (!clinic) throw new NotFoundException('Clinic not found');
    const settings = mergeClinicSettings(clinic.settings);
    return computeFiscalYear(
      new Date(),
      clinic.timezone || 'UTC',
      settings.billing.fiscalYearStartMonth,
    );
  }

  /**
   * The format string the client renders leased numbers with, so an offline
   * device produces exactly what the server would have.
   */
  private async formatFor(
    clinicId: Types.ObjectId,
    counter: LeaseCounter,
  ): Promise<string> {
    if (counter === LeaseCounter.Prescription) return 'RX-{seq:06}';
    const clinic = await this.clinicModel.findById(clinicId);
    const settings = mergeClinicSettings(clinic?.settings);
    if (counter === LeaseCounter.Mrn) return settings.patients.mrnFormat;
    return settings.billing.billNoFormat;
  }

  /** Build the client-facing view, resolving format and template together. */
  private async viewOf(lease: NumberLease & { _id?: unknown }): Promise<LeaseView> {
    const format = await this.formatFor(lease.clinicId, lease.counter);
    const template = await this.buildTemplate(
      lease.clinicId,
      lease.branchId,
      lease.counter,
      lease.fiscalYear,
      format,
    );
    return this.toView(lease, format, template);
  }

  private toView(
    lease: NumberLease & { _id?: unknown },
    format: string,
    numberTemplate?: string,
  ): LeaseView {
    return {
      id: String((lease as { _id: unknown })._id),
      counter: lease.counter,
      branchId: lease.branchId?.toHexString(),
      fiscalYear: lease.fiscalYear,
      blockStart: lease.blockStart,
      blockEnd: lease.blockEnd,
      usedThrough: lease.usedThrough,
      remaining: Math.max(0, lease.blockEnd - lease.usedThrough),
      expiresAt: lease.expiresAt,
      format,
      numberTemplate: numberTemplate ?? format,
    };
  }

  /**
   * Resolve every token except `{seq}`, so an offline client renders exactly
   * what this server would have. Mirrors `formatMrn` / `formatBillNo` by
   * reusing their inputs rather than reimplementing them.
   */
  private async buildTemplate(
    clinicId: Types.ObjectId,
    branchId: Types.ObjectId | undefined,
    counter: LeaseCounter,
    fiscalYear: string | undefined,
    format: string,
  ): Promise<string> {
    const clinic = await this.clinicModel.findById(clinicId);
    const tz = clinic?.timezone || 'UTC';
    const local = DateTime.fromJSDate(new Date(), { zone: 'utc' }).setZone(tz);
    const clinicCode = clinicId.toHexString().slice(0, 4).toUpperCase();

    let branchCode = '';
    if (branchId) {
      const branch = await this.branchModel.findOne({ _id: branchId, clinicId });
      if (branch) branchCode = deriveBranchCode(branch);
    }

    return format
      .replace(/\{fiscalYear\}/g, fiscalYear ?? '')
      .replace(/\{YYYY\}/g, String(counter === LeaseCounter.Mrn ? new Date().getUTCFullYear() : local.year))
      .replace(
        /\{YY\}/g,
        String((counter === LeaseCounter.Mrn ? new Date().getUTCFullYear() : local.year) % 100).padStart(2, '0'),
      )
      .replace(/\{branchCode\}/g, branchCode)
      .replace(/\{clinicCode\}/g, clinicCode);
  }
}
