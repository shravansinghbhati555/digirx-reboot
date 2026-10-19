import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import {
  assertLocalTestDatabase,
  startMemoryMongo,
  stopMemoryMongo,
} from './setup';
// AppModule is imported inside beforeAll, after MONGODB_URI points at the
// in-memory server (see test/e2e-env.ts for why).
import { Permission } from '../src/modules/authz/permissions';
import { BillingService } from '../src/modules/billing/billing.service';
import { Bill, BillStatus } from '../src/modules/billing/schemas/bill.schema';
import { Branch } from '../src/modules/tenancy/schemas/branch.schema';
import { Clinic } from '../src/modules/tenancy/schemas/clinic.schema';
import { Role } from '../src/modules/authz/schemas/role.schema';
import { User, UserStatus } from '../src/modules/authz/schemas/user.schema';

describe('Credit notes (e2e)', () => {
  let app: INestApplication;
  let billing: BillingService;
  let billModel: Model<Bill>;
  let clinicId: Types.ObjectId;
  let branchId: Types.ObjectId;
  let userId: Types.ObjectId;

  beforeAll(async () => {
    process.env.MONGODB_URI = await startMemoryMongo();
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEV_AUTH_HEADERS = 'true';
    process.env.JWT_ACCESS_SECRET = 'test_access_secret';
    process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
    process.env.NOTIFICATIONS_QUEUE_ENABLED = 'false';
    process.env.THROTTLE_DISABLED = 'true';
    process.env.REDIS_URL = '';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    assertLocalTestDatabase(app);

    billing = app.get(BillingService);
    billModel = app.get<Model<Bill>>(getModelToken(Bill.name));

    const clinicModel = app.get<Model<Clinic>>(getModelToken(Clinic.name));
    const branchModel = app.get<Model<Branch>>(getModelToken(Branch.name));
    const roleModel = app.get<Model<Role>>(getModelToken(Role.name));
    const userModel = app.get<Model<User>>(getModelToken(User.name));

    const clinic = await clinicModel.create({
      name: 'CN Clinic',
      countryCode: 'IN',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      phoneCountryCode: '+91',
    });
    clinicId = clinic._id;

    const branch = await branchModel.create({
      clinicId,
      name: 'CN Main',
      code: 'CNM',
    });
    branchId = branch._id;

    const role = await roleModel.create({
      clinicId,
      name: 'Admin',
      permissions: Object.values(Permission),
    });

    const user = await userModel.create({
      clinicId,
      branchIds: [branchId],
      name: 'CN Admin',
      status: UserStatus.Active,
      roleIds: [role._id],
    });
    userId = user._id;
  }, 90_000);

  afterAll(async () => {
    // Let fire-and-forget audit/access-log writes finish before closing.
    await new Promise((r) => setTimeout(r, 500));
    if (app) await app.close();
    await stopMemoryMongo();
  });

  // Returns the hydrated bill doc; using `any` so we can read `_id` without
  // wrestling with the Bill / BillDocument type duality.
  async function makeIssuedBill(total: number): Promise<any> {
    const draft = await billModel.create({
      clinicId,
      branchId,
      patientId: new Types.ObjectId(),
      currency: 'INR',
      items: [
        { customName: 'Visit', quantity: 1, unitPrice: total, amount: total },
      ],
      subtotal: total,
      discount: 0,
      tax: 0,
      total,
      status: BillStatus.Draft,
    });
    return await billing.issueBill(clinicId, String(draft._id));
  }

  function authedRequest() {
    return {
      post: (path: string) =>
        request(app.getHttpServer())
          .post(path)
          .set('x-clinic-id', clinicId.toHexString())
          .set('x-branch-id', branchId.toHexString())
          .set('x-user-id', userId.toHexString()),
      get: (path: string) =>
        request(app.getHttpServer())
          .get(path)
          .set('x-clinic-id', clinicId.toHexString())
          .set('x-branch-id', branchId.toHexString())
          .set('x-user-id', userId.toHexString()),
    };
  }

  it('issues a credit note and refunds it idempotently', async () => {
    const bill = await makeIssuedBill(1000);
    const http = authedRequest();

    const create = await http.post(`/bills/${bill._id}/credit-notes`).send({
      items: [{ customName: 'Visit', quantity: 1, unitPrice: 400 }],
      amount: 400,
      reason: 'Patient overcharged',
    });
    expect(create.status).toBe(201);
    expect(create.body.creditNoteNo).toMatch(/^CN\/\d{4}-\d{2}\/\d{6}$/);
    expect(create.body.status).toBe('ISSUED');

    const cnId = create.body._id;
    const key = 'idempo-key-12345';

    const refund1 = await http
      .post(`/credit-notes/${cnId}/refund`)
      .send({ method: 'CASH', idempotencyKey: key });
    expect(refund1.status).toBe(201);
    expect(refund1.body.status).toBe('REFUNDED');
    expect(refund1.body.refundedAt).toBeTruthy();

    // Replay with the same key — succeeds silently.
    const refund2 = await http
      .post(`/credit-notes/${cnId}/refund`)
      .send({ method: 'CASH', idempotencyKey: key });
    expect(refund2.status).toBe(201);
    expect(refund2.body._id).toBe(cnId);

    // Refund with a different key on a refunded CN → 409.
    const refund3 = await http
      .post(`/credit-notes/${cnId}/refund`)
      .send({ method: 'UPI', idempotencyKey: 'a-different-key-67890' });
    expect(refund3.status).toBe(409);
  }, 30_000);

  it('rejects a credit note that would exceed the bill total', async () => {
    const bill = await makeIssuedBill(500);
    const http = authedRequest();

    await http
      .post(`/bills/${bill._id}/credit-notes`)
      .send({
        items: [{ customName: 'Visit', quantity: 1, unitPrice: 300 }],
        amount: 300,
        reason: 'Partial credit',
      })
      .expect(201);

    const second = await http.post(`/bills/${bill._id}/credit-notes`).send({
      items: [{ customName: 'Visit', quantity: 1, unitPrice: 300 }],
      amount: 300,
      reason: 'Would over-credit',
    });
    expect(second.status).toBe(400);
    expect(String(second.body.message)).toMatch(/exceed bill total/i);
  }, 30_000);

  it('blocks voiding a bill while it has active credit notes', async () => {
    const bill = await makeIssuedBill(800);
    const http = authedRequest();

    const cn = await http
      .post(`/bills/${bill._id}/credit-notes`)
      .send({
        items: [{ customName: 'Visit', quantity: 1, unitPrice: 200 }],
        amount: 200,
        reason: 'Test guard',
      })
      .expect(201);

    const voidAttempt = await http
      .post(`/bills/${bill._id}/void`)
      .send({ reason: 'Operator change of mind' });
    expect(voidAttempt.status).toBe(400);
    expect(String(voidAttempt.body.message)).toMatch(/active credit notes/i);

    // Cancelling the CN frees the bill to be voided.
    await http
      .post(`/credit-notes/${cn.body._id}/cancel`)
      .send({ reason: 'Issued in error' })
      .expect(201);

    const voidOk = await http
      .post(`/bills/${bill._id}/void`)
      .send({ reason: 'Now allowed' })
      .expect(201);
    expect(voidOk.body.status).toBe('VOID');
  }, 30_000);
});
