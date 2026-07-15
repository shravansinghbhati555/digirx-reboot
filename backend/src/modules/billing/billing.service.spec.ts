import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BillingService } from './billing.service';
import { BillStatus } from './schemas/bill.schema';
import { PaymentMethod } from './schemas/payment.schema';

describe('BillingService.addPayment idempotency', () => {
  let billModel: any;
  let paymentModel: any;
  let serviceModel: any;
  let inventoryService: any;
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
      // Slice 5 — addPayment uses findOneAndUpdate for the Issued → Paid
      // flip (so it can branch on whether this caller actually won the
      // race). Returning null by default = "lost the race / not the
      // settling payment", which is fine for tests that don't fully
      // settle. Tests that DO want to assert on the dispense path
      // override this per-call.
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
    };
    paymentModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      aggregate: jest.fn().mockResolvedValue([{ total: 0 }]),
    };
    serviceModel = {};
    // Constructor signature grew when the friend wired Appointment, Encounter
    // and Clinic models alongside the bill-numbering + credit-notes deps,
    // and again in Slice 3 with Prescription + InventoryItem models for
    // the medicine-bill drafter. These tests only exercise the addPayment
    // path, so empty stubs are enough — passed through `as any` to avoid
    // spelling out Model<T>.
    const appointmentModel: any = {};
    const encounterModel: any = {};
    const clinicModel: any = {};
    const prescriptionModel: any = {};
    const inventoryItemModel: any = {};
    const numbering: any = {};
    const creditNotes: any = {};
    // Slice 5 added InventoryService for the auto-dispense path. The
    // existing addPayment tests use SERVICE bills (no kind passed →
    // defaults to SERVICE) so dispenseStock should never fire here, but
    // we provide a stub so a stray call would no-op rather than crash.
    inventoryService = { dispenseStock: jest.fn().mockResolvedValue({ dispensed: 0, movements: [] }) };
    service = new (BillingService as any)(
      billModel,
      paymentModel,
      serviceModel,
      appointmentModel,
      encounterModel,
      clinicModel,
      prescriptionModel,
      inventoryItemModel,
      inventoryService as any,
      numbering,
      creditNotes,
    );
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

    // Slice 5 swapped updateOne → findOneAndUpdate for the Issued → Paid
    // flip (so the dispense branch can react to whether *this* caller
    // won the race). The status filter remains the contract that
    // guarantees only one caller crosses the threshold.
    expect(billModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: bill._id, status: BillStatus.Issued }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: BillStatus.Paid }),
      }),
      expect.any(Object),
    );
  });

  describe('Slice 5 — auto-dispense on medicine-bill payment', () => {
    it('does NOT call dispenseStock for SERVICE bills', async () => {
      // Bills default to SERVICE when `kind` is omitted; the Issued →
      // Paid flip succeeds but the dispense branch should bail.
      const bill = makeIssuedBill({ total: 500 });
      billModel.findOne.mockResolvedValue(bill);
      billModel.findOneAndUpdate.mockResolvedValueOnce({ ...bill, status: BillStatus.Paid }); // status flip wins
      paymentModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        billId: bill._id,
        amount: 500,
      });
      paymentModel.aggregate.mockResolvedValue([{ total: 500 }]);

      await service.addPayment(bill.clinicId, undefined, bill._id.toHexString(), {
        method: PaymentMethod.Cash,
        amount: 500,
        idempotencyKey: 'k-srv',
      });

      expect(inventoryService.dispenseStock).not.toHaveBeenCalled();
    });

    it('dispenses each MEDICINE bill line FIFO when the bill becomes fully paid', async () => {
      const inventoryItemA = new Types.ObjectId();
      const inventoryItemB = new Types.ObjectId();
      const bill = makeIssuedBill({
        total: 300,
        kind: 'MEDICINE',
        items: [
          { inventoryItemId: inventoryItemA, customName: 'Crocin 500', quantity: 10, unitPrice: 10, amount: 100 },
          { inventoryItemId: inventoryItemB, customName: 'Dolo 650', quantity: 4, unitPrice: 50, amount: 200 },
          // Free-text line: must be skipped, no dispense call.
          { customName: 'Free-text item', quantity: 1, unitPrice: 0, amount: 0 },
        ],
      });
      billModel.findOne.mockResolvedValue(bill);
      // First findOneAndUpdate is the status flip (returns the freshly
      // paid bill with the medicine kind). The second is the
      // idempotency claim on inventoryDispensedAt — also wins.
      billModel.findOneAndUpdate
        .mockResolvedValueOnce({ ...bill, status: BillStatus.Paid })
        .mockResolvedValueOnce({ ...bill, inventoryDispensedAt: new Date() });

      paymentModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        billId: bill._id,
        amount: 300,
      });
      paymentModel.aggregate.mockResolvedValue([{ total: 300 }]);

      inventoryService.dispenseStock.mockResolvedValue({
        dispensed: 0,
        movements: [{ _id: new Types.ObjectId() }],
      });

      await service.addPayment(bill.clinicId, undefined, bill._id.toHexString(), {
        method: PaymentMethod.Cash,
        amount: 300,
        idempotencyKey: 'k-med-final',
      });

      // Two real items dispensed, free-text skipped.
      expect(inventoryService.dispenseStock).toHaveBeenCalledTimes(2);
      expect(inventoryService.dispenseStock).toHaveBeenCalledWith(
        bill.clinicId,
        undefined,
        inventoryItemA.toHexString(),
        expect.objectContaining({ quantity: 10, billId: bill._id.toHexString() }),
      );
      expect(inventoryService.dispenseStock).toHaveBeenCalledWith(
        bill.clinicId,
        undefined,
        inventoryItemB.toHexString(),
        expect.objectContaining({ quantity: 4 }),
      );
    });

    it('does NOT re-dispense when the idempotency claim loses (concurrent payment)', async () => {
      // Status flip wins, but the inventoryDispensedAt claim returns
      // null — meaning a sibling caller already stamped. The function
      // must exit before any dispenseStock call.
      const bill = makeIssuedBill({
        total: 100,
        kind: 'MEDICINE',
        items: [{ inventoryItemId: new Types.ObjectId(), customName: 'X', quantity: 1, unitPrice: 100, amount: 100 }],
      });
      billModel.findOne.mockResolvedValue(bill);
      billModel.findOneAndUpdate
        .mockResolvedValueOnce({ ...bill, status: BillStatus.Paid }) // status flip wins
        .mockResolvedValueOnce(null); // idempotency claim lost

      paymentModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        billId: bill._id,
        amount: 100,
      });
      paymentModel.aggregate.mockResolvedValue([{ total: 100 }]);

      await service.addPayment(bill.clinicId, undefined, bill._id.toHexString(), {
        method: PaymentMethod.Cash,
        amount: 100,
        idempotencyKey: 'k-med-replay',
      });

      expect(inventoryService.dispenseStock).not.toHaveBeenCalled();
    });

    it('continues dispensing other lines when one item is short on stock', async () => {
      const inventoryItemA = new Types.ObjectId();
      const inventoryItemB = new Types.ObjectId();
      const bill = makeIssuedBill({
        total: 200,
        kind: 'MEDICINE',
        items: [
          { inventoryItemId: inventoryItemA, customName: 'A', quantity: 5, unitPrice: 20, amount: 100 },
          { inventoryItemId: inventoryItemB, customName: 'B', quantity: 5, unitPrice: 20, amount: 100 },
        ],
      });
      billModel.findOne.mockResolvedValue(bill);
      billModel.findOneAndUpdate
        .mockResolvedValueOnce({ ...bill, status: BillStatus.Paid })
        .mockResolvedValueOnce({ ...bill, inventoryDispensedAt: new Date() });

      paymentModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        billId: bill._id,
        amount: 200,
      });
      paymentModel.aggregate.mockResolvedValue([{ total: 200 }]);

      // Item A throws insufficient stock; the loop must catch and
      // continue to item B rather than aborting the whole dispense.
      inventoryService.dispenseStock
        .mockRejectedValueOnce(new Error('Insufficient stock'))
        .mockResolvedValueOnce({ dispensed: 5, movements: [{ _id: new Types.ObjectId() }] });

      await expect(
        service.addPayment(bill.clinicId, undefined, bill._id.toHexString(), {
          method: PaymentMethod.Cash,
          amount: 200,
          idempotencyKey: 'k-med-short',
        }),
      ).resolves.toBeDefined();

      expect(inventoryService.dispenseStock).toHaveBeenCalledTimes(2);
    });
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
