import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NumberLeaseService } from './number-lease.service';
import { LeaseCounter, LeaseStatus } from './schemas/number-lease.schema';

const clinicId = new Types.ObjectId();
const branchId = new Types.ObjectId();
const DEVICE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function makeService(overrides: Record<string, any> = {}) {
  const leaseModel: any = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async (doc: any) => ({
      ...doc,
      _id: new Types.ObjectId(),
      save: jest.fn(),
    })),
  };
  const counter = (start: number) => ({
    findOneAndUpdate: jest.fn().mockResolvedValue({ lastNumber: start }),
  });
  const mrn = counter(150);
  const rx = counter(1100);
  const bill = counter(400);
  const clinicModel: any = {
    findById: jest.fn().mockResolvedValue({
      timezone: 'Asia/Kolkata',
      settings: {},
    }),
  };

  const branchModel: any = {
    findOne: jest.fn().mockResolvedValue({ code: 'MAIN', name: 'Main Branch' }),
  };

  const service = new NumberLeaseService(
    overrides.leaseModel ?? leaseModel,
    (overrides.mrn ?? mrn) as any,
    (overrides.rx ?? rx) as any,
    (overrides.bill ?? bill) as any,
    overrides.clinicModel ?? clinicModel,
    overrides.branchModel ?? branchModel,
  );
  return { service, leaseModel, mrn, rx, bill, clinicModel, branchModel };
}

describe('NumberLeaseService.issue', () => {
  it('advances the real counter by the block size in one atomic call', async () => {
    const { service, mrn } = makeService();

    await service.issue({ clinicId, deviceId: DEVICE, counter: LeaseCounter.Mrn, size: 50 });

    // This is the load-bearing behaviour: the counter jumps the whole block,
    // so online minting can never land inside it.
    expect(mrn.findOneAndUpdate).toHaveBeenCalledWith(
      { clinicId },
      { $inc: { lastNumber: 50 } },
      { upsert: true, new: true },
    );
  });

  it('derives the block from where the counter landed', async () => {
    const { service } = makeService();

    // Counter returns 150 after a +50 bump, so the block is 101..150.
    const lease = await service.issue({
      clinicId,
      deviceId: DEVICE,
      counter: LeaseCounter.Mrn,
      size: 50,
    });

    expect(lease.blockStart).toBe(101);
    expect(lease.blockEnd).toBe(150);
    expect(lease.remaining).toBe(50);
  });

  it('uses the per-counter default size when none is given', async () => {
    const { service, rx } = makeService();
    await service.issue({ clinicId, deviceId: DEVICE, counter: LeaseCounter.Prescription });
    expect(rx.findOneAndUpdate).toHaveBeenCalledWith(
      { clinicId },
      { $inc: { lastNumber: 100 } },
      expect.anything(),
    );
  });

  it('refuses to lease without a device id', async () => {
    const { service } = makeService();
    await expect(
      service.issue({ clinicId, deviceId: '', counter: LeaseCounter.Mrn }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a BILL lease with no branch', async () => {
    const { service } = makeService();
    await expect(
      service.issue({ clinicId, deviceId: DEVICE, counter: LeaseCounter.Bill }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scopes a BILL lease by branch and fiscal year', async () => {
    const { service, bill } = makeService();
    await service.issue({
      clinicId,
      branchId,
      deviceId: DEVICE,
      counter: LeaseCounter.Bill,
      size: 20,
    });
    const [filter] = bill.findOneAndUpdate.mock.calls[0];
    expect(filter.clinicId).toBe(clinicId);
    expect(filter.branchId).toBe(branchId);
    expect(typeof filter.fiscalYear).toBe('string');
  });

  it('caps the requested block size', async () => {
    const { service } = makeService();
    await expect(
      service.issue({ clinicId, deviceId: DEVICE, counter: LeaseCounter.Mrn, size: 5000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-integer size', async () => {
    const { service } = makeService();
    await expect(
      service.issue({ clinicId, deviceId: DEVICE, counter: LeaseCounter.Mrn, size: 2.5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the existing lease instead of burning a second block', async () => {
    const existing = {
      _id: new Types.ObjectId(),
      clinicId,
      counter: LeaseCounter.Mrn,
      blockStart: 1,
      blockEnd: 50,
      usedThrough: 10,
      status: LeaseStatus.Active,
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    };
    const leaseModel: any = {
      findOne: jest.fn().mockResolvedValue(existing),
      find: jest.fn(),
      create: jest.fn(),
    };
    const { service, mrn } = makeService({ leaseModel });

    const lease = await service.issue({
      clinicId,
      deviceId: DEVICE,
      counter: LeaseCounter.Mrn,
    });

    expect(lease.blockStart).toBe(1);
    expect(mrn.findOneAndUpdate).not.toHaveBeenCalled();
    expect(leaseModel.create).not.toHaveBeenCalled();
  });

  it('allocates a fresh block when the existing lease is used up', async () => {
    const existing = {
      _id: new Types.ObjectId(),
      clinicId,
      counter: LeaseCounter.Mrn,
      blockStart: 1,
      blockEnd: 50,
      usedThrough: 50,
      status: LeaseStatus.Active,
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    };
    const leaseModel: any = {
      findOne: jest.fn().mockResolvedValue(existing),
      find: jest.fn(),
      create: jest.fn().mockImplementation(async (d: any) => ({ ...d, _id: new Types.ObjectId() })),
    };
    const { service, mrn } = makeService({ leaseModel });

    await service.issue({ clinicId, deviceId: DEVICE, counter: LeaseCounter.Mrn });

    expect(existing.status).toBe(LeaseStatus.Exhausted);
    expect(mrn.findOneAndUpdate).toHaveBeenCalled();
  });

  it('retires an expired lease rather than handing it back', async () => {
    const existing = {
      _id: new Types.ObjectId(),
      clinicId,
      counter: LeaseCounter.Mrn,
      blockStart: 1,
      blockEnd: 50,
      usedThrough: 2,
      status: LeaseStatus.Active,
      expiresAt: new Date(Date.now() - 60_000),
      save: jest.fn(),
    };
    const leaseModel: any = {
      findOne: jest.fn().mockResolvedValue(existing),
      find: jest.fn(),
      create: jest.fn().mockImplementation(async (d: any) => ({ ...d, _id: new Types.ObjectId() })),
    };
    const { service } = makeService({ leaseModel });

    await service.issue({ clinicId, deviceId: DEVICE, counter: LeaseCounter.Mrn });

    expect(existing.status).toBe(LeaseStatus.Expired);
    expect(leaseModel.create).toHaveBeenCalled();
  });
});

describe('NumberLeaseService.reportUsage', () => {
  function leaseDoc(usedThrough: number) {
    return {
      _id: new Types.ObjectId(),
      clinicId,
      counter: LeaseCounter.Mrn,
      blockStart: 1,
      blockEnd: 50,
      usedThrough,
      status: LeaseStatus.Active,
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    };
  }

  it('moves the marker forward', async () => {
    const doc = leaseDoc(10);
    const leaseModel: any = { findOne: jest.fn().mockResolvedValue(doc), find: jest.fn(), create: jest.fn() };
    const { service } = makeService({ leaseModel });

    const out = await service.reportUsage(clinicId, DEVICE, String(doc._id), 20);

    expect(out.usedThrough).toBe(20);
    expect(doc.save).toHaveBeenCalled();
  });

  it('never rewinds — a replayed report must not free used numbers', async () => {
    const doc = leaseDoc(30);
    const leaseModel: any = { findOne: jest.fn().mockResolvedValue(doc), find: jest.fn(), create: jest.fn() };
    const { service } = makeService({ leaseModel });

    const out = await service.reportUsage(clinicId, DEVICE, String(doc._id), 5);

    expect(out.usedThrough).toBe(30);
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('clamps to the end of the block and marks it exhausted', async () => {
    const doc = leaseDoc(10);
    const leaseModel: any = { findOne: jest.fn().mockResolvedValue(doc), find: jest.fn(), create: jest.fn() };
    const { service } = makeService({ leaseModel });

    const out = await service.reportUsage(clinicId, DEVICE, String(doc._id), 999);

    expect(out.usedThrough).toBe(50);
    expect(doc.status).toBe(LeaseStatus.Exhausted);
  });

  it('404s for a lease belonging to another device', async () => {
    const leaseModel: any = { findOne: jest.fn().mockResolvedValue(null), find: jest.fn(), create: jest.fn() };
    const { service } = makeService({ leaseModel });
    await expect(
      service.reportUsage(clinicId, DEVICE, String(new Types.ObjectId()), 1),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('numberTemplate', () => {
  it('resolves every token except {seq} so the client cannot drift', async () => {
    const clinicModel: any = {
      findById: jest.fn().mockResolvedValue({
        timezone: 'Asia/Kolkata',
        settings: { billing: { billNoFormat: 'INV-{branchCode}-{fiscalYear}-{seq:08}' } },
      }),
    };
    const { service } = makeService({ clinicModel });

    const lease = await service.issue({
      clinicId,
      branchId,
      deviceId: DEVICE,
      counter: LeaseCounter.Bill,
      size: 10,
    });

    expect(lease.numberTemplate).toMatch(/^INV-MAIN-[\d-]+-\{seq:08\}$/);
    // The sequence placeholder is the ONLY thing left for the client to fill.
    expect(lease.numberTemplate).toContain('{seq:08}');
    expect(lease.numberTemplate).not.toContain('{branchCode}');
    expect(lease.numberTemplate).not.toContain('{fiscalYear}');
  });
});
