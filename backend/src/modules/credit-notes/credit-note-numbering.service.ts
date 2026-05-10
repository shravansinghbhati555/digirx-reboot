import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Branch } from '../tenancy/schemas/branch.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';
import {
  computeFiscalYear,
  deriveBranchCode,
  formatBillNo,
} from '../billing/bill-numbering.service';
import { CreditNoteCounter } from './schemas/credit-note-counter.schema';

@Injectable()
export class CreditNoteNumberingService {
  constructor(
    @InjectModel(CreditNoteCounter.name)
    private readonly counterModel: Model<CreditNoteCounter>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
  ) {}

  /**
   * Mint the next credit-note number for `(clinicId, branchId, fiscalYear)`.
   * Same atomic-counter contract as `BillNumberingService.mint` — the wasted
   * counter on a failed transaction is the documented trade-off (gaps over
   * duplicates).
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

    return formatBillNo(settings.billing.creditNoteNoFormat, {
      seq: counter.lastNumber,
      fiscalYear,
      issuedAt,
      tz,
      branchCode: deriveBranchCode(branch),
      clinicId,
    });
  }
}
