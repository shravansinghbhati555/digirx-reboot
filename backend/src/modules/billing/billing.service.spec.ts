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
      ...overrides,
    };
  }

  beforeEach(() => {
    billModel = {
      findOne: jest.fn(),
    };
    paymentModel = {
      create: jest.fn(),
      findOne: jest.fn(),
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
});
