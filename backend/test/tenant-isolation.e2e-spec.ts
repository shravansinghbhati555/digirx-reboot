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
import { Clinic } from '../src/modules/tenancy/schemas/clinic.schema';
import { Branch } from '../src/modules/tenancy/schemas/branch.schema';
import { Role } from '../src/modules/authz/schemas/role.schema';
import { User, UserStatus } from '../src/modules/authz/schemas/user.schema';
import {
  Patient,
  PatientGender,
} from '../src/modules/patients/schemas/patient.schema';
import {
  Appointment,
  AppointmentStatus,
  AppointmentSource,
  AppointmentType,
} from '../src/modules/appointments/schemas/appointment.schema';
import { Bill, BillStatus } from '../src/modules/billing/schemas/bill.schema';
import {
  Document,
  DocumentAccess,
  DocumentOwnerType,
} from '../src/modules/documents/schemas/document.schema';

type Tenant = {
  clinicId: Types.ObjectId;
  branchId: Types.ObjectId;
  userId: Types.ObjectId;
  patientId: Types.ObjectId;
  appointmentId: Types.ObjectId;
  billId: Types.ObjectId;
  documentId: Types.ObjectId;
};

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let tenant1: Tenant;
  let tenant2: Tenant;

  beforeAll(async () => {
    process.env.MONGODB_URI = await startMemoryMongo();
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEV_AUTH_HEADERS = 'true';
    process.env.JWT_ACCESS_SECRET = 'test_access_secret';
    process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
    process.env.NOTIFICATIONS_QUEUE_ENABLED = 'false';
    // Avoid the throttler interfering with our 8 sequential requests.
    process.env.THROTTLE_DISABLED = 'true';
    // Belt-and-braces: the queue gate already short-circuits, but blanking
    // REDIS_URL keeps any stray ioredis client (or a future change to the
    // gate) from trying to dial a Redis we don't have.
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

    tenant1 = await seedTenant(app, 'Clinic One');
    tenant2 = await seedTenant(app, 'Clinic Two');
  }, 90_000);

  afterAll(async () => {
    // Let fire-and-forget audit/access-log writes finish before closing.
    await new Promise((r) => setTimeout(r, 500));
    if (app) await app.close();
    await stopMemoryMongo();
  });

  // Sanity: each tenant CAN read its own resources. Without this, a 404 in the
  // cross-tenant test could mean "the seed never persisted" rather than "the
  // tenant filter caught it." Asserting both rules out the false positive.
  describe('Same-tenant baseline', () => {
    it('tenant 1 can read its own patient', async () => {
      const res = await get(app, tenant1, `/patients/${tenant1.patientId}`);
      expect(res.status).toBe(200);
      expect(res.body._id).toBe(tenant1.patientId.toHexString());
    });

    it('tenant 1 can read its own bill', async () => {
      const res = await get(app, tenant1, `/bills/${tenant1.billId}`);
      expect(res.status).toBe(200);
      expect(res.body._id).toBe(tenant1.billId.toHexString());
    });

    it('tenant 1 can read its own appointment', async () => {
      const res = await get(
        app,
        tenant1,
        `/appointments/${tenant1.appointmentId}`,
      );
      expect(res.status).toBe(200);
    });
  });

  describe('Cross-tenant reads return 404 (not 403, to avoid an existence oracle)', () => {
    it('GET /patients/:id of clinic 2 from clinic 1 → 404', async () => {
      const res = await get(app, tenant1, `/patients/${tenant2.patientId}`);
      expect(res.status).toBe(404);
    });

    it('GET /bills/:id of clinic 2 from clinic 1 → 404', async () => {
      const res = await get(app, tenant1, `/bills/${tenant2.billId}`);
      expect(res.status).toBe(404);
    });

    it('GET /appointments/:id of clinic 2 from clinic 1 → 404', async () => {
      const res = await get(
        app,
        tenant1,
        `/appointments/${tenant2.appointmentId}`,
      );
      expect(res.status).toBe(404);
    });

    it('GET /documents/:id/download of clinic 2 from clinic 1 → 404', async () => {
      const res = await get(
        app,
        tenant1,
        `/documents/${tenant2.documentId}/download`,
      );
      expect(res.status).toBe(404);
    });

    it('and the reverse: clinic 2 cannot reach clinic 1 either', async () => {
      const res = await get(app, tenant2, `/patients/${tenant1.patientId}`);
      expect(res.status).toBe(404);
    });
  });

  describe('Bill listings respect the tenant boundary', () => {
    it("GET /bills returns only the requesting clinic's rows", async () => {
      const res = await get(app, tenant1, `/bills?limit=100`);
      expect(res.status).toBe(200);
      const ids: string[] = res.body.rows.map((b: any) => b._id);
      expect(ids).toContain(tenant1.billId.toHexString());
      expect(ids).not.toContain(tenant2.billId.toHexString());
    });
  });
});

// --- helpers --------------------------------------------------------------

function get(app: INestApplication, t: Tenant, path: string): request.Test {
  return request(app.getHttpServer())
    .get(path)
    .set('x-clinic-id', t.clinicId.toHexString())
    .set('x-branch-id', t.branchId.toHexString())
    .set('x-user-id', t.userId.toHexString());
}

async function seedTenant(
  app: INestApplication,
  clinicName: string,
): Promise<Tenant> {
  const clinicModel = app.get<Model<Clinic>>(getModelToken(Clinic.name));
  const branchModel = app.get<Model<Branch>>(getModelToken(Branch.name));
  const roleModel = app.get<Model<Role>>(getModelToken(Role.name));
  const userModel = app.get<Model<User>>(getModelToken(User.name));
  const patientModel = app.get<Model<Patient>>(getModelToken(Patient.name));
  const apptModel = app.get<Model<Appointment>>(
    getModelToken(Appointment.name),
  );
  const billModel = app.get<Model<Bill>>(getModelToken(Bill.name));
  const documentModel = app.get<Model<Document>>(getModelToken(Document.name));

  const clinic = await clinicModel.create({
    name: clinicName,
    countryCode: 'IN',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    phoneCountryCode: '+91',
  });
  const branch = await branchModel.create({
    clinicId: clinic._id,
    name: `${clinicName} — Main`,
  });
  const role = await roleModel.create({
    clinicId: clinic._id,
    name: 'Admin',
    permissions: Object.values(Permission),
  });
  const user = await userModel.create({
    clinicId: clinic._id,
    branchIds: [branch._id],
    name: `${clinicName} Admin`,
    status: UserStatus.Active,
    roleIds: [role._id],
  });
  const patient = await patientModel.create({
    clinicId: clinic._id,
    primaryBranchId: branch._id,
    fullName: `${clinicName} Patient`,
    normalizedName: `${clinicName.toLowerCase()} patient`,
    gender: PatientGender.Female,
    phones: [`+91${Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000}`],
    normalizedPhones: [],
  });
  const appointment = await apptModel.create({
    clinicId: clinic._id,
    branchId: branch._id,
    doctorId: user._id,
    patientId: patient._id,
    type: AppointmentType.Queue,
    queueDate: new Date().toISOString().slice(0, 10),
    queueNumber: 1,
    status: AppointmentStatus.Booked,
    source: AppointmentSource.FrontDesk,
  });
  const bill = await billModel.create({
    clinicId: clinic._id,
    branchId: branch._id,
    patientId: patient._id,
    currency: 'INR',
    items: [
      { customName: 'Consult', quantity: 1, unitPrice: 500, amount: 500 },
    ],
    subtotal: 500,
    discount: 0,
    tax: 0,
    total: 500,
    status: BillStatus.Draft,
  });
  const document = await documentModel.create({
    clinicId: clinic._id,
    ownerType: DocumentOwnerType.Patient,
    ownerId: patient._id,
    mimeType: 'application/pdf',
    fileName: 'note.pdf',
    sizeBytes: 1024,
    storageKey: `clinic/${clinic._id.toHexString()}/patient/${patient._id.toHexString()}/note.pdf`,
    access: DocumentAccess.InternalOnly,
  });

  return {
    clinicId: clinic._id,
    branchId: branch._id,
    userId: user._id,
    patientId: patient._id,
    appointmentId: appointment._id,
    billId: bill._id,
    documentId: document._id,
  };
}
