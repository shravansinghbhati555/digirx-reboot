import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BillingService } from './billing.service';
import { BillStatus } from './schemas/bill.schema';
import { PaymentMethod } from './schemas/payment.schema';

describe('BillingService.addPayment idempotency', () => {
  let billModel: any;
  let paymentModel: any;
  let serviceModel: any;
  let service: BillingService;

  function makeIssuedBill(overrides: any = {}) {
    return {
      _id: new Types.ObjectId(),
      clinicId: new Types.ObjectId(),
      branchId: new Types.ObjectId(),
      status: BillStatus.Issued,
      total: 1000,
      ...overrides,
    };
  }

  beforeEach(() => {
    billModel = {
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 0 }),
    };
    paymentModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      aggregate: jest.fn().mockResolvedValue([{ total: 0 }]),
    };
    serviceModel = {};
    service = new BillingService(billModel, paymentModel, serviceModel);
  });

  it('inserts a fresh payment when no row exists for the key', async () => {
    const bill = makeIssuedBill();
    billModel.findOne.mockResolvedValue(bill);
    const inserted = {
      _id: new Types.ObjectId(),
      billId: bill._id,
      idempotencyKey: 'k-12345678',
      amount: 100,
    };
    paymentModel.create.mockResolvedValue(inserted);

    const out = await service.addPayment(
      bill.clinicId,
      undefined,
      bill._id.toHexString(),
      {
        method: PaymentMethod.Cash,
        amount: 100,
        idempotencyKey: 'k-12345678',
      },
    );

    expect(out.payment).toBe(inserted);
    expect(out.replayed).toBe(false);
    expect(paymentModel.create).toHaveBeenCalledTimes(1);
    expect(paymentModel.findOne).not.toHaveBeenCalled();
  });

  it('returns the original payment with replayed=true on duplicate-key error', async () => {
    const bill = makeIssuedBill();
    billModel.findOne.mockResolvedValue(bill);

    const dupErr: any = new Error('E11000 duplicate key error');
    dupErr.code = 11000;
    paymentModel.create.mockRejectedValue(dupErr);

    const original = {
      _id: new Types.ObjectId(),
      billId: bill._id,
      idempotencyKey: 'k-12345678',
      amount: 100,
    };
    paymentModel.findOne.mockResolvedValue(original);

    const out = await service.addPayment(
      bill.clinicId,
      undefined,
      bill._id.toHexString(),
      {
        method: PaymentMethod.Cash,
        amount: 100,
        idempotencyKey: 'k-12345678',
      },
    );

    expect(out.payment).toBe(original);
    expect(out.replayed).toBe(true);
    expect(paymentModel.findOne).toHaveBeenCalledWith({
      clinicId: bill.clinicId,
      billId: bill._id,
      idempotencyKey: 'k-12345678',
    });
  });

  it('rethrows non-duplicate errors unchanged', async () => {
    const bill = makeIssuedBill();
    billModel.findOne.mockResolvedValue(bill);

    const otherErr: any = new Error('connection lost');
    otherErr.code = 'ECONNRESET';
    paymentModel.create.mockRejectedValue(otherErr);

    await expect(
      service.addPayment(bill.clinicId, undefined, bill._id.toHexString(), {
        method: PaymentMethod.Cash,
        amount: 100,
        idempotencyKey: 'k-12345678',
      }),
    ).rejects.toBe(otherErr);
  });

  it('rejects payments on a non-issued bill before touching paymentModel', async () => {
    const bill = makeIssuedBill({ status: BillStatus.Draft });
    billModel.findOne.mockResolvedValue(bill);

    await expect(
      service.addPayment(bill.clinicId, undefined, bill._id.toHexString(), {
        method: PaymentMethod.Cash,
        amount: 100,
        idempotencyKey: 'k-12345678',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentModel.create).not.toHaveBeenCalled();
  });

  it('rejects invalid amount before touching paymentModel', async () => {
    const bill = makeIssuedBill();
    billModel.findOne.mockResolvedValue(bill);

    await expect(
      service.addPayment(bill.clinicId, undefined, bill._id.toHexString(), {
        method: PaymentMethod.Cash,
        amount: 0,
        idempotencyKey: 'k-12345678',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentModel.create).not.toHaveBeenCalled();
  });

  it('auto-transitions Issued bill to Paid once total payments meet bill.total', async () => {
    const bill = makeIssuedBill({ total: 1000 });
    billModel.findOne.mockResolvedValue(bill);
    paymentModel.create.mockResolvedValue({
      _id: new Types.ObjectId(),
      billId: bill._id,
      amount: 500,
    });
    paymentModel.aggregate.mockResolvedValue([{ total: 1000 }]);

    await service.addPayment(
      bill.clinicId,
      undefined,
      bill._id.toHexString(),
      {
        method: PaymentMethod.Cash,
        amount: 500,
        idempotencyKey: 'k-final-pay',
      },
    );

    expect(billModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: bill._id, status: BillStatus.Issued }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: BillStatus.Paid }),
      }),
    );
  });

  describe('listBills patientId filter — the cross-patient leak fix', () => {
    it('forwards patientId into the aggregation $match (regression check)', async () => {
      // Spy on the model's aggregate so we can assert the actual pipeline
      // shape — this is the fix we shipped: without the patientId in
      // $match, /bills?patientId=… leaked every clinic-scoped bill.
      const aggregate = jest.fn().mockResolvedValue([]);
      billModel.aggregate = aggregate;

      const clinicId = new Types.ObjectId();
      const patientId = new Types.ObjectId();
      await service.listBills(clinicId, { patientId: patientId.toHexString() });

      expect(aggregate).toHaveBeenCalledTimes(1);
      const pipeline = aggregate.mock.calls[0][0] as any[];
      const matchStage = pipeline.find((s) => s.$match);
      expect(matchStage).toBeDefined();
      expect(matchStage.$match.clinicId).toEqual(clinicId);
      // The actual ObjectId comparison: the filter holds an ObjectId
      // whose hex is the same as what we passed in.
      expect((matchStage.$match.patientId as Types.ObjectId).toHexString()).toBe(
        patientId.toHexString(),
      );
    });

    it('omits patientId from the $match when not provided (back-compat)', async () => {
      const aggregate = jest.fn().mockResolvedValue([]);
      billModel.aggregate = aggregate;

      await service.listBills(new Types.ObjectId(), {});

      const pipeline = aggregate.mock.calls[0][0] as any[];
      const matchStage = pipeline.find((s) => s.$match);
      expect(matchStage.$match.patientId).toBeUndefined();
    });

    it('ignores a malformed patientId rather than throwing', async () => {
      const aggregate = jest.fn().mockResolvedValue([]);
      billModel.aggregate = aggregate;

      await service.listBills(new Types.ObjectId(), {
        patientId: 'not-a-real-objectid',
      });

      const pipeline = aggregate.mock.calls[0][0] as any[];
      const matchStage = pipeline.find((s) => s.$match);
      // No throw, no patientId in match — the bad value is dropped.
      expect(matchStage.$match.patientId).toBeUndefined();
    });
  });

  it('does not auto-Paid a bill that is not yet fully settled', async () => {
    const bill = makeIssuedBill({ total: 1000 });
    billModel.findOne.mockResolvedValue(bill);
    paymentModel.create.mockResolvedValue({
      _id: new Types.ObjectId(),
      billId: bill._id,
      amount: 400,
    });
    paymentModel.aggregate.mockResolvedValue([{ total: 400 }]);

    await service.addPayment(
      bill.clinicId,
      undefined,
      bill._id.toHexString(),
      {
        method: PaymentMethod.Cash,
        amount: 400,
        idempotencyKey: 'k-partial',
      },
    );

    expect(billModel.updateOne).not.toHaveBeenCalled();
  });
});
