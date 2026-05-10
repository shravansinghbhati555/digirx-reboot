import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import { Branch } from '../tenancy/schemas/branch.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';
import { BillCounter } from './schemas/bill-counter.schema';

export type FormatTokens = {
  seq: number;
  fiscalYear: string;
  issuedAt: Date;
  tz: string;
  branchCode: string;
  clinicId: Types.ObjectId;
};

@Injectable()
export class BillNumberingService {
  constructor(
    @InjectModel(BillCounter.name)
    private readonly counterModel: Model<BillCounter>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
  ) {}

  /**
   * Mint the next bill number for `(clinicId, branchId, fiscalYear)`.
   *
   * Atomic per (clinic, branch, FY): two concurrent calls are guaranteed
   * to see two different `lastNumber` values. Caller is responsible for
   * making sure a minted number actually ends up on a persisted bill —
   * if the surrounding transaction rolls back, the counter stays bumped
   * (auditors prefer gaps to duplicates).
   */
  async mint(
    clinicId: Types.ObjectId,
    branchId: Types.ObjectId,
    issuedAt: Date,
  ): Promise<string> {
    const [clinic, branch] = await Promise.all([
      this.clinicModel.findById(clinicId),
      this.branchModel.findOne({ _id: branchId, clinicId }),
    ]);
    if (!clinic) throw new NotFoundException('Clinic not found');
    if (!branch) throw new NotFoundException('Branch not found');

    const settings = mergeClinicSettings(clinic.settings);
    const tz = clinic.timezone || 'UTC';
    const fiscalYear = computeFiscalYear(
      issuedAt,
      tz,
      settings.billing.fiscalYearStartMonth,
    );

    const counter = await this.counterModel.findOneAndUpdate(
      { clinicId, branchId, fiscalYear },
      { $inc: { lastNumber: 1 } },
      { upsert: true, new: true },
    );

    return formatBillNo(settings.billing.billNoFormat, {
      seq: counter.lastNumber,
      fiscalYear,
      issuedAt,
      tz,
      branchCode: deriveBranchCode(branch),
      clinicId,
    });
  }
}

/**
 * Returns a fiscal-year label for the given instant in clinic-local time.
 *   - fyStartMonth = 1 → calendar year ("2026")
 *   - fyStartMonth = 4 (India) → "2026-27" for any date in Apr 2026..Mar 2027
 */
export function computeFiscalYear(
  issuedAt: Date,
  tz: string,
  fyStartMonth: number,
): string {
  const local = DateTime.fromJSDate(issuedAt, { zone: 'utc' }).setZone(tz);
  if (fyStartMonth === 1) return String(local.year);
  const startYear = local.month >= fyStartMonth ? local.year : local.year - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endShort}`;
}

export function deriveBranchCode(branch: { code?: string; name: string }): string {
  if (branch.code) return branch.code.toUpperCase();
  // Strip non-alphanumerics so "Main Branch" → "MAIN", not "MAIN " → "MAIN".
  const stripped = branch.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return stripped.slice(0, 4) || 'BR';
}

/**
 * Apply the format string to the resolved tokens. Unknown tokens are left
 * as-is so a typo is visible at the bill-number level rather than silently
 * dropped.
 */
export function formatBillNo(format: string, ctx: FormatTokens): string {
  const local = DateTime.fromJSDate(ctx.issuedAt, { zone: 'utc' }).setZone(ctx.tz);
  return format
    .replace(/\{seq(?::(\d+))?\}/g, (_m, w?: string) =>
      String(ctx.seq).padStart(w ? Number(w) : 1, '0'),
    )
    .replace(/\{fiscalYear\}/g, ctx.fiscalYear)
    .replace(/\{YYYY\}/g, String(local.year))
    .replace(/\{YY\}/g, String(local.year % 100).padStart(2, '0'))
    .replace(/\{branchCode\}/g, ctx.branchCode)
    .replace(/\{clinicCode\}/g, ctx.clinicId.toHexString().slice(0, 4).toUpperCase());
}
