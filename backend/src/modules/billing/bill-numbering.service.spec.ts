import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BillNumberingService,
  computeFiscalYear,
  deriveBranchCode,
  formatBillNo,
} from './bill-numbering.service';

describe('computeFiscalYear', () => {
  const TZ = 'Asia/Kolkata';

  it('returns the calendar year string when fyStartMonth = 1', () => {
    const d = new Date('2026-05-15T12:00:00Z');
    expect(computeFiscalYear(d, TZ, 1)).toBe('2026');
  });

  it('rolls into the next fiscal year on the start month boundary (India FY)', () => {
    // 2026-04-01 00:30 IST is the very start of FY 2026-27.
    const aprilFirstIst = new Date('2026-03-31T19:00:00Z');
    expect(computeFiscalYear(aprilFirstIst, TZ, 4)).toBe('2026-27');
  });

  it('still belongs to the previous FY just before the boundary', () => {
    // 2026-03-31 23:30 IST is the last instant of FY 2025-26.
    const marchLastIst = new Date('2026-03-31T17:30:00Z');
    expect(computeFiscalYear(marchLastIst, TZ, 4)).toBe('2025-26');
  });

  it('handles July-start fiscal years (e.g. AU)', () => {
    expect(computeFiscalYear(new Date('2026-07-01T03:00:00Z'), 'UTC', 7)).toBe(
      '2026-27',
    );
    expect(computeFiscalYear(new Date('2026-06-30T22:00:00Z'), 'UTC', 7)).toBe(
      '2025-26',
    );
  });
});

describe('deriveBranchCode', () => {
  it('uses the explicit code field when set', () => {
    expect(deriveBranchCode({ code: 'mum', name: 'Mumbai' })).toBe('MUM');
  });

  it('falls back to the first 4 alphanumerics of the name', () => {
    expect(deriveBranchCode({ name: 'Main Branch' })).toBe('MAIN');
    expect(deriveBranchCode({ name: 'New Delhi — North' })).toBe('NEWD');
  });

  it('returns "BR" if the name has no alphanumerics', () => {
    expect(deriveBranchCode({ name: '— ' })).toBe('BR');
  });
});

describe('formatBillNo', () => {
  const clinicId = new Types.ObjectId('a'.repeat(24));

  it('substitutes seq with width-aware padding', () => {
    expect(
      formatBillNo('{seq}', mkCtx({ seq: 7 })),
    ).toBe('7');
    expect(
      formatBillNo('{seq:4}', mkCtx({ seq: 7 })),
    ).toBe('0007');
  });

  it('renders the full default Indian template', () => {
    const out = formatBillNo('{branchCode}/{fiscalYear}/{seq:06}', mkCtx({
      seq: 42,
      branchCode: 'MUM',
      fiscalYear: '2026-27',
    }));
    expect(out).toBe('MUM/2026-27/000042');
  });

  it('expands {YYYY} and {YY} from the issuedAt instant in clinic TZ', () => {
    const issuedAt = new Date('2026-04-01T03:00:00Z'); // 08:30 IST = local year 2026
    const out = formatBillNo('{YYYY}-{YY}', mkCtx({ issuedAt, tz: 'Asia/Kolkata' }));
    expect(out).toBe('2026-26');
  });

  it('expands {clinicCode} from the first 4 hex chars of the clinicId', () => {
    expect(formatBillNo('{clinicCode}', mkCtx({}))).toBe('AAAA');
  });

  it('leaves unknown tokens unsubstituted (typos surface in the output)', () => {
    expect(formatBillNo('{branchCode}/{nope}', mkCtx({ branchCode: 'X' }))).toBe(
      'X/{nope}',
    );
  });

  function mkCtx(overrides: any = {}) {
    return {
      seq: 1,
      fiscalYear: '2026-27',
      issuedAt: new Date('2026-05-01T12:00:00Z'),
      tz: 'UTC',
      branchCode: 'BR',
      clinicId,
      ...overrides,
    };
  }
});

describe('BillNumberingService.mint', () => {
  let counterModel: any;
  let clinicModel: any;
  let branchModel: any;
  let service: BillNumberingService;

  const clinicId = new Types.ObjectId();
  const branchId = new Types.ObjectId();

  beforeEach(() => {
    counterModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ lastNumber: 1 }),
    };
    clinicModel = {
      findById: jest.fn().mockResolvedValue({
        _id: clinicId,
        timezone: 'Asia/Kolkata',
        settings: {},
      }),
    };
    branchModel = {
      findOne: jest.fn().mockResolvedValue({
        _id: branchId,
        clinicId,
        name: 'Main Branch',
        code: 'MUM',
      }),
    };
    service = new BillNumberingService(counterModel, clinicModel, branchModel);
  });

  it('atomically increments the counter scoped by (clinic, branch, FY)', async () => {
    counterModel.findOneAndUpdate.mockResolvedValue({ lastNumber: 5 });

    const issuedAt = new Date('2026-05-01T08:00:00Z');
    const out = await service.mint(clinicId, branchId, issuedAt);

    expect(counterModel.findOneAndUpdate).toHaveBeenCalledWith(
      { clinicId, branchId, fiscalYear: '2026-27' },
      { $inc: { lastNumber: 1 } },
      { upsert: true, new: true },
    );
    expect(out).toBe('MUM/2026-27/000005');
  });

  it('produces sequential numbers across simulated concurrent mints', async () => {
    let n = 0;
    counterModel.findOneAndUpdate.mockImplementation(async () => ({
      lastNumber: ++n,
    }));

    const issuedAt = new Date('2026-05-01T08:00:00Z');
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.mint(clinicId, branchId, issuedAt),
      ),
    );

    const seqs = results
      .map((s) => Number(s.split('/').pop()))
      .sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('applies the clinic-configured format', async () => {
    clinicModel.findById.mockResolvedValue({
      _id: clinicId,
      timezone: 'UTC',
      settings: {
        billing: {
          billNoFormat: 'INV-{YYYY}-{seq:08}',
          fiscalYearStartMonth: 1,
        },
      },
    });
    counterModel.findOneAndUpdate.mockResolvedValue({ lastNumber: 100 });

    const out = await service.mint(
      clinicId,
      branchId,
      new Date('2026-05-01T08:00:00Z'),
    );
    expect(out).toBe('INV-2026-00000100');
  });

  it('throws when the clinic is missing', async () => {
    clinicModel.findById.mockResolvedValue(null);
    await expect(
      service.mint(clinicId, branchId, new Date()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when the branch is missing or belongs to another clinic', async () => {
    branchModel.findOne.mockResolvedValue(null);
    await expect(
      service.mint(clinicId, branchId, new Date()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
