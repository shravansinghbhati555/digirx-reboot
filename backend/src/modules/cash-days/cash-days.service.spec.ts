import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CashDaysService, isMismatch } from './cash-days.service';
import { CashDayStatus } from './schemas/cash-day.schema';

const clinicId = new Types.ObjectId();
const branchId = new Types.ObjectId();
const DATE = '2026-10-12';

function doc(fields: Record<string, any>) {
  const d: any = { ...fields };
  d.save = jest.fn().mockResolvedValue(d);
  d.toObject = () => ({ ...d });
  return d;
}

function makeService(opts: { existing?: any; cashIn?: number; refunded?: number } = {}) {
  const cashDayModel: any = {
    findOne: jest.fn().mockResolvedValue(opts.existing ?? null),
    create: jest.fn().mockImplementation(async (f: any) => doc({ _id: new Types.ObjectId(), ...f })),
  };
  const paymentModel: any = {
    aggregate: jest
      .fn()
      .mockResolvedValue(opts.cashIn == null ? [] : [{ total: opts.cashIn, count: 3 }]),
  };
  const creditNoteModel: any = {
    aggregate: jest.fn().mockResolvedValue(opts.refunded == null ? [] : [{ total: opts.refunded }]),
  };
  const clinicModel: any = {
    findById: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }),
  };
  const service = new CashDaysService(cashDayModel, paymentModel, creditNoteModel, clinicModel);
  return { service, cashDayModel, paymentModel, creditNoteModel };
}

describe('isMismatch', () => {
  it('compares in paise, so float noise is not a mismatch', () => {
    expect(isMismatch(0.1 + 0.2, 0.3)).toBe(false);
    expect(isMismatch(100, 100.01)).toBe(true);
  });
});

describe('CashDaysService.expected', () => {
  it('is cash in minus cash refunded', async () => {
    const { service } = makeService({ cashIn: 2500, refunded: 300 });
    const out = await service.expected(clinicId, branchId, DATE);
    expect(out).toEqual({ expectedCash: 2200, cashIn: 2500, cashRefunded: 300, paymentCount: 3 });
  });

  it('is zero on a day with no cash', async () => {
    const { service } = makeService();
    expect((await service.expected(clinicId, branchId, DATE)).expectedCash).toBe(0);
  });

  it('bounds the day in clinic-local time', async () => {
    const { service, paymentModel } = makeService({ cashIn: 0 });
    await service.expected(clinicId, branchId, DATE);
    const match = paymentModel.aggregate.mock.calls[0][0][0].$match;
    // Midnight in Asia/Kolkata is 18:30 UTC the previous day.
    expect(match.paidAt.$gte.toISOString()).toBe('2026-10-11T18:30:00.000Z');
    expect(match.paidAt.$lt.toISOString()).toBe('2026-10-12T18:30:00.000Z');
    expect(match.method).toBe('CASH');
    expect(match.clinicId).toBe(clinicId);
  });
});

describe('CashDaysService.submit', () => {
  const base = { clinicId, branchId, date: DATE, countedCash: 1500, expectedCash: 1500 };

  it('records a matching count without a note', async () => {
    const { service, cashDayModel } = makeService();
    const out = await service.submit(base);
    expect(cashDayModel.create).toHaveBeenCalled();
    expect(out.status).toBe(CashDayStatus.Submitted);
    expect(out.countedCash).toBe(1500);
  });

  it('refuses a mismatch with no note', async () => {
    const { service } = makeService();
    await expect(service.submit({ ...base, countedCash: 1480 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts a mismatch that is explained', async () => {
    const { service } = makeService();
    const out = await service.submit({ ...base, countedCash: 1480, note: 'Gave ₹20 change twice' });
    expect(out.countNote).toBe('Gave ₹20 change twice');
  });

  it('uses the client id on an offline-created count', async () => {
    const { service, cashDayModel } = makeService();
    const id = new Types.ObjectId().toHexString();
    await service.submit({ ...base, clientId: id });
    expect(cashDayModel.create.mock.calls[0][0]._id.toHexString()).toBe(id);
  });

  it('a recount replaces the previous count until approval', async () => {
    const existing = doc({ ...base, status: CashDayStatus.Submitted, countedCash: 1000, expectedAtCount: 1000 });
    const { service, cashDayModel } = makeService({ existing });
    await service.submit(base);
    expect(cashDayModel.create).not.toHaveBeenCalled();
    expect(existing.countedCash).toBe(1500);
    expect(existing.save).toHaveBeenCalled();
  });

  it('refuses to recount an approved day', async () => {
    const existing = doc({ ...base, status: CashDayStatus.Approved });
    const { service } = makeService({ existing });
    await expect(service.submit(base)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CashDaysService.approve', () => {
  function submitted(countedCash: number) {
    return doc({
      _id: new Types.ObjectId(),
      clinicId,
      branchId,
      date: DATE,
      status: CashDayStatus.Submitted,
      countedCash,
    });
  }

  it('approves against the server figure and records what was signed off', async () => {
    const day = submitted(2200);
    const { service } = makeService({ existing: day, cashIn: 2500, refunded: 300 });
    await service.approve({ clinicId, id: String(day._id) });
    expect(day.status).toBe(CashDayStatus.Approved);
    expect(day.expectedAtApproval).toBe(2200);
    expect(day.approvedAt).toBeInstanceOf(Date);
  });

  it('needs a note when post-sync expected differs from the count', async () => {
    // Another tablet's cash synced after the count: expected rose to 2500.
    const day = submitted(2200);
    const { service } = makeService({ existing: day, cashIn: 2500 });
    await expect(service.approve({ clinicId, id: String(day._id) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await service.approve({ clinicId, id: String(day._id), note: 'Front desk drawer counted separately' });
    expect(day.status).toBe(CashDayStatus.Approved);
    expect(day.approvalNote).toBe('Front desk drawer counted separately');
  });

  it('refuses to approve twice', async () => {
    const day = submitted(0);
    day.status = CashDayStatus.Approved;
    const { service } = makeService({ existing: day });
    await expect(service.approve({ clinicId, id: String(day._id) })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('scopes the lookup to the clinic', async () => {
    const { service, cashDayModel } = makeService({ existing: null });
    const id = new Types.ObjectId().toHexString();
    await expect(service.approve({ clinicId, id })).rejects.toThrow('Cash day not found');
    expect(cashDayModel.findOne.mock.calls[0][0].clinicId).toBe(clinicId);
  });
});
