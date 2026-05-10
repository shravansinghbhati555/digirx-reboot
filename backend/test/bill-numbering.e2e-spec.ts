import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import cookieParser from 'cookie-parser';

import { startMemoryMongo, stopMemoryMongo } from './setup';
import { AppModule } from '../src/app.module';
import { BillingService } from '../src/modules/billing/billing.service';
import { Bill, BillStatus } from '../src/modules/billing/schemas/bill.schema';
import { Clinic } from '../src/modules/tenancy/schemas/clinic.schema';
import { Branch } from '../src/modules/tenancy/schemas/branch.schema';

describe('Bill numbering (e2e)', () => {
  let app: INestApplication;
  let billing: BillingService;
  let billModel: Model<Bill>;
  let clinicId: Types.ObjectId;
  let branchId: Types.ObjectId;

  beforeAll(async () => {
    process.env.MONGODB_URI = await startMemoryMongo();
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEV_AUTH_HEADERS = 'true';
    process.env.JWT_ACCESS_SECRET = 'test_access_secret';
    process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
    process.env.NOTIFICATIONS_QUEUE_ENABLED = 'false';
    process.env.THROTTLE_DISABLED = 'true';
    delete process.env.REDIS_URL;

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

    billing = app.get(BillingService);
    billModel = app.get<Model<Bill>>(getModelToken(Bill.name));

    const clinicModel = app.get<Model<Clinic>>(getModelToken(Clinic.name));
    const branchModel = app.get<Model<Branch>>(getModelToken(Branch.name));

    const clinic = await clinicModel.create({
      name: 'Numbering Clinic',
      countryCode: 'IN',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      phoneCountryCode: '+91',
    });
    clinicId = clinic._id;

    const branch = await branchModel.create({
      clinicId,
      name: 'Mumbai Main',
      code: 'MUM',
    });
    branchId = branch._id;
  }, 90_000);

  afterAll(async () => {
    if (app) await app.close();
    await stopMemoryMongo();
  });

  it('issues 50 concurrent bills with sequential numbers, no gaps no duplicates', async () => {
    // Seed 50 DRAFT bills for the same (clinic, branch) so they all share the
    // counter.
    const drafts = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        billModel.create({
          clinicId,
          branchId,
          patientId: new Types.ObjectId(),
          currency: 'INR',
          items: [
            {
              customName: `Item ${i}`,
              quantity: 1,
              unitPrice: 100,
              amount: 100,
            },
          ],
          subtotal: 100,
          discount: 0,
          tax: 0,
          total: 100,
          status: BillStatus.Draft,
        }),
      ),
    );

    const issued = await Promise.all(
      drafts.map((d) => billing.issueBill(clinicId, String(d._id))),
    );

    const numbers = issued
      .map((b) => b.billNo!)
      .map((no) => Number(no.split('/').pop()));

    // 1..50 with no gaps and no duplicates
    const sorted = [...numbers].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(numbers).size).toBe(50);

    // Format check on a sample
    expect(issued[0].billNo).toMatch(/^MUM\/\d{4}-\d{2}\/\d{6}$/);
  }, 60_000);

  it('two concurrent issues on the same DRAFT bill yield exactly one billNo', async () => {
    const draft = await billModel.create({
      clinicId,
      branchId,
      patientId: new Types.ObjectId(),
      currency: 'INR',
      items: [{ customName: 'X', quantity: 1, unitPrice: 50, amount: 50 }],
      subtotal: 50,
      discount: 0,
      tax: 0,
      total: 50,
      status: BillStatus.Draft,
    });

    const [a, b] = await Promise.all([
      billing.issueBill(clinicId, String(draft._id)),
      billing.issueBill(clinicId, String(draft._id)),
    ]);

    // Both calls observe the same persisted bill — one wrote it, the loser
    // re-fetched. The minted-but-unused counter value on the loser is the
    // documented trade-off (gaps over duplicates).
    expect(a.billNo).toBe(b.billNo);
    expect(a.status).toBe(BillStatus.Issued);

    // Either may have raced — the persisted state is canonical.
    const persisted = await billModel.findById(draft._id);
    expect(persisted?.status).toBe(BillStatus.Issued);
    expect(persisted?.billNo).toBe(a.billNo);
  }, 30_000);
});
