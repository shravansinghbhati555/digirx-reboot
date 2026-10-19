import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Connection, Model, Types } from 'mongoose';
import { DateTime } from 'luxon';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import {
  assertLocalTestDatabase,
  startMemoryMongo,
  stopMemoryMongo,
} from './setup';
// AppModule is imported dynamically in beforeAll: importing it at the top
// evaluates MongooseModule.forRoot(process.env.MONGODB_URI) — with the URI
// ConfigModule just loaded from .env — before the in-memory URI is set.
import { Permission } from '../src/modules/authz/permissions';
import { Clinic } from '../src/modules/tenancy/schemas/clinic.schema';
import { Branch } from '../src/modules/tenancy/schemas/branch.schema';
import { mergeClinicSettings } from '../src/modules/tenancy/clinic-settings.types';
import { Role } from '../src/modules/authz/schemas/role.schema';
import { User, UserStatus } from '../src/modules/authz/schemas/user.schema';
import {
  Patient,
  PatientGender,
} from '../src/modules/patients/schemas/patient.schema';
import { DoctorAvailabilityRule } from '../src/modules/availability/schemas/doctor-availability-rule.schema';
import {
  Appointment,
  AppointmentSource,
  AppointmentStatus,
} from '../src/modules/appointments/schemas/appointment.schema';
import { AppointmentsService } from '../src/modules/appointments/appointments.service';
import {
  Encounter,
  EncounterStatus,
} from '../src/modules/encounters/schemas/encounter.schema';
import { Prescription } from '../src/modules/prescriptions/schemas/prescription.schema';
import {
  Bill,
  BillKind,
  BillStatus,
} from '../src/modules/billing/schemas/bill.schema';
import {
  Document,
  DocumentAccess,
  DocumentCategory,
  DocumentOwnerType,
  DocumentStatus,
} from '../src/modules/documents/schemas/document.schema';
import { NOTIFICATION_PROVIDER } from '../src/modules/notifications/providers/notification-provider';
import { PatientLink } from '../src/modules/patient-identities/schemas/patient-link.schema';

const TZ = 'Asia/Kolkata';
const RIYA_PHONE = '9845012345';
const VIKRAM_PHONE = '9000000001';
const SECRET_NOTE = 'SECRET CLINICIAN NOTE';

type Tenant = {
  clinicId: Types.ObjectId;
  branchId: Types.ObjectId;
  adminId: Types.ObjectId;
  doctorId: Types.ObjectId;
};

/** Captures SMS so the test can read OTP codes. */
const sent: Array<{ to: string; body: string }> = [];
const captureProvider = {
  send: async (input: { to: string; body: string }) => {
    sent.push({ to: input.to, body: input.body });
    return { providerMessageId: 'test' };
  },
};

describe('Patient portal (e2e)', () => {
  let app: INestApplication;
  let A: Tenant;
  let B: Tenant;
  let C: Tenant;
  const ids: Record<string, Types.ObjectId> = {};
  let riya = '';
  let vikram = '';
  let riyaApptId = '';
  let staffApptId = '';
  const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 }).toISODate()!;

  const api = () => request(app.getHttpServer());
  const asPatient = (token: string) => ({ Authorization: `Bearer ${token}` });
  const staff = (t: Tenant) => ({
    'x-clinic-id': t.clinicId.toHexString(),
    'x-branch-id': t.branchId.toHexString(),
    'x-user-id': t.adminId.toHexString(),
  });
  const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));

  async function login(phone: string) {
    const otp = await api().post('/portal/auth/request-otp').send({ phone });
    expect(otp.status).toBe(200);
    const msg = [...sent].reverse().find((m) => m.to === `+91${phone}`);
    const code = /(\d{6})/.exec(msg!.body)![1];
    const res = await api()
      .post('/portal/auth/verify-otp')
      .send({ phone, code });
    expect(res.status).toBe(200);
    return {
      token: res.body.accessToken as string,
      cookie: res.headers['set-cookie'] as unknown as string[],
    };
  }

  beforeAll(async () => {
    process.env.MONGODB_URI = await startMemoryMongo();
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEV_AUTH_HEADERS = 'true';
    process.env.JWT_ACCESS_SECRET = 'test_access_secret';
    process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
    process.env.JWT_PORTAL_SECRET = 'test_portal_secret_which_is_long_enough';
    process.env.PATIENT_PORTAL_ENABLED = 'true';
    process.env.NOTIFICATIONS_QUEUE_ENABLED = 'false';
    process.env.THROTTLE_DISABLED = 'true';
    process.env.REDIS_URL = '';
    process.env.RAZORPAY_KEY_ID = '';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NOTIFICATION_PROVIDER)
      .useValue(captureProvider)
      .compile();
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

    A = await seedClinic('Sunrise Clinic', {
      enabled: true,
      bookingEnabled: true,
      cancellationLeadTimeHours: 0,
    });
    B = await seedClinic('CarePoint Clinic', {
      enabled: true,
      bookingEnabled: true,
      cancellationLeadTimeHours: 168,
    });
    C = await seedClinic('Not On Portal Clinic', { enabled: false });

    const patients = model<Patient>(Patient.name);
    const mk = (t: Tenant, fullName: string, phone: string, dob: string) =>
      patients.create({
        clinicId: t.clinicId,
        primaryBranchId: t.branchId,
        fullName,
        normalizedName: fullName.toLowerCase(),
        gender: PatientGender.Female,
        dob: new Date(`${dob}T00:00:00Z`),
        phones: [phone],
        normalizedPhones: [phone],
      });
    ids.riyaA = (await mk(A, 'Riya Mehta', RIYA_PHONE, '1992-08-14'))._id;
    ids.childA = (await mk(A, 'Aarav Mehta', RIYA_PHONE, '2016-05-01'))._id;
    ids.riyaB = (await mk(B, 'Riya M', `91${RIYA_PHONE}`, '1992-08-14'))._id;
    ids.riyaC = (await mk(C, 'Riya Mehta', RIYA_PHONE, '1992-08-14'))._id;
    ids.vikramA = (await mk(A, 'Vikram Rao', VIKRAM_PHONE, '1990-01-01'))._id;

    // Clinic A: one signed and one draft consultation for Riya.
    const enc = model<Encounter>(Encounter.name);
    const signed = await enc.create({
      clinicId: A.clinicId,
      branchId: A.branchId,
      doctorId: A.doctorId,
      patientId: ids.riyaA,
      visitedAt: new Date(),
      chiefComplaint: 'Acid reflux',
      notes: SECRET_NOTE,
      diagnoses: [{ description: 'GERD', primary: true }],
      status: EncounterStatus.Signed,
    });
    const draft = await enc.create({
      clinicId: A.clinicId,
      branchId: A.branchId,
      doctorId: A.doctorId,
      patientId: ids.riyaA,
      visitedAt: new Date(),
      chiefComplaint: 'Draft visit',
      diagnoses: [],
      status: EncounterStatus.Draft,
    });
    const rx = model<Prescription>(Prescription.name);
    ids.rxSigned = (
      await rx.create({
        clinicId: A.clinicId,
        branchId: A.branchId,
        doctorId: A.doctorId,
        patientId: ids.riyaA,
        encounterId: signed._id,
        items: [
          {
            customName: 'Pantoprazole 40 mg',
            frequency: '1-0-0',
            duration: '14 days',
          },
        ],
      })
    )._id;
    ids.rxDraft = (
      await rx.create({
        clinicId: A.clinicId,
        branchId: A.branchId,
        doctorId: A.doctorId,
        patientId: ids.riyaA,
        encounterId: draft._id,
        items: [{ customName: 'Draft medicine' }],
      })
    )._id;

    ids.billB = (
      await model<Bill>(Bill.name).create({
        clinicId: B.clinicId,
        branchId: B.branchId,
        patientId: ids.riyaB,
        currency: 'INR',
        items: [
          { customName: 'Lab test', quantity: 1, unitPrice: 300, amount: 300 },
        ],
        subtotal: 300,
        discount: 0,
        tax: 0,
        total: 300,
        status: BillStatus.Issued,
        kind: BillKind.Service,
        issuedAt: new Date(),
      })
    )._id;

    const docs = model<Document>(Document.name);
    const doc = (patientId: Types.ObjectId, fileName: string) =>
      docs.create({
        clinicId: A.clinicId,
        ownerType: DocumentOwnerType.Patient,
        ownerId: patientId,
        category: DocumentCategory.LabReport,
        mimeType: 'application/pdf',
        fileName,
        sizeBytes: 10,
        storageKey: `clinic/x/${fileName}`,
        access: DocumentAccess.InternalOnly,
        status: DocumentStatus.Available,
      });
    ids.docRiya = (await doc(ids.riyaA, 'cbc_riya.pdf'))._id;
    ids.docChild = (await doc(ids.childA, 'cbc_child.pdf'))._id;
  }, 120_000);

  afterAll(async () => {
    // Let fire-and-forget audit/access-log writes finish before closing.
    await new Promise((r) => setTimeout(r, 500));
    if (app) await app.close();
    await stopMemoryMongo();
  });

  async function seedClinic(
    name: string,
    portal: Record<string, unknown>,
  ): Promise<Tenant> {
    const clinic = await model<Clinic>(Clinic.name).create({
      name,
      countryCode: 'IN',
      timezone: TZ,
      currency: 'INR',
      phoneCountryCode: '+91',
      settings: mergeClinicSettings({ portal }),
    });
    const branch = await model<Branch>(Branch.name).create({
      clinicId: clinic._id,
      name: 'Main',
      active: true,
    });
    const roles = model<Role>(Role.name);
    const admin = await roles.create({
      clinicId: clinic._id,
      name: 'Admin',
      permissions: Object.values(Permission),
    });
    const doctorRole = await roles.create({
      clinicId: clinic._id,
      name: 'Doctor',
      permissions: [Permission.AppointmentRead, Permission.AppointmentWrite],
    });
    const users = model<User>(User.name);
    const adminUser = await users.create({
      clinicId: clinic._id,
      branchIds: [branch._id],
      name: `${name} Admin`,
      status: UserStatus.Active,
      roleIds: [admin._id],
    });
    const doctor = await users.create({
      clinicId: clinic._id,
      branchIds: [branch._id],
      name: `Dr. ${name.split(' ')[0]}`,
      status: UserStatus.Active,
      roleIds: [doctorRole._id],
    });
    const rules = model<DoctorAvailabilityRule>(DoctorAvailabilityRule.name);
    for (let weekday = 0; weekday < 7; weekday++) {
      await rules.create({
        clinicId: clinic._id,
        branchId: branch._id,
        doctorUserId: doctor._id,
        weekday,
        windows: [{ startMinutes: 8 * 60, endMinutes: 20 * 60 }],
        slotMinutes: 30,
        active: true,
      });
    }
    return {
      clinicId: clinic._id,
      branchId: branch._id,
      adminId: adminUser._id,
      doctorId: doctor._id,
    };
  }

  const istIso = (time: string) =>
    DateTime.fromISO(`${tomorrow}T${time}`, { zone: TZ }).toUTC().toISO()!;

  // --------------------------------------------------------------------------

  describe('auth realm', () => {
    it('hides every portal route when the portal is switched off', async () => {
      process.env.PATIENT_PORTAL_ENABLED = 'false';
      const res = await api()
        .post('/portal/auth/request-otp')
        .send({ phone: RIYA_PHONE });
      expect(res.status).toBe(404);
      process.env.PATIENT_PORTAL_ENABLED = 'true';
    });

    it('logs in with OTP and shows the clinic chart for that number', async () => {
      riya = (await login(RIYA_PHONE)).token;
      const me = await api().get('/portal/me').set(asPatient(riya));
      expect(me.status).toBe(200);
      expect(me.body.name).toBe('Riya Mehta');
      expect(me.body.dobIso).toBe('1992-08-14');
      expect(me.body.gender).toBe('Female');
      expect(me.body.profileComplete).toBe(true);
      expect(me.body.dobLocked).toBe(true);
      const links = await model<PatientLink>(PatientLink.name).find({}).lean();
      expect(links.map((l) => String(l.patientId)).sort()).toEqual(
        [ids.riyaA, ids.childA, ids.riyaB, ids.riyaC].map(String).sort(),
      );
    });

    it('locks the date of birth once records are linked', async () => {
      const res = await api()
        .patch('/portal/me')
        .set(asPatient(riya))
        .send({ dob: '1990-01-01' });
      expect(res.status).toBe(400);
    });

    it('rejects a wrong code without revealing whether the number exists', async () => {
      const unknown = await api()
        .post('/portal/auth/request-otp')
        .send({ phone: '9123456789' });
      expect(unknown.status).toBe(200);
      expect(unknown.body).toEqual({ ok: true, ttlSeconds: 300 });
      const bad = await api()
        .post('/portal/auth/verify-otp')
        .send({ phone: '9123456789', code: '000000' });
      expect(bad.status).toBe(401);
    });

    it('locks a code after five wrong attempts', async () => {
      const phone = '9111111111';
      await api().post('/portal/auth/request-otp').send({ phone });
      const code = /(\d{6})/.exec(
        [...sent].reverse().find((m) => m.to === `+91${phone}`)!.body,
      )![1];
      const wrong = code === '111111' ? '222222' : '111111';
      for (let i = 0; i < 5; i++) {
        await api()
          .post('/portal/auth/verify-otp')
          .send({ phone, code: wrong });
      }
      const res = await api()
        .post('/portal/auth/verify-otp')
        .send({ phone, code });
      expect(res.status).toBe(401);
    });

    it('a portal token cannot reach staff routes', async () => {
      const res = await api().get('/patients').set(asPatient(riya));
      // Rejected by the staff tenant middleware exactly like any other
      // non-staff token (it answers 400 for signature errors today).
      const forged = await api()
        .get('/patients')
        .set({ Authorization: 'Bearer not.a.staff-token' });
      expect([400, 401]).toContain(res.status);
      expect(res.status).toBe(forged.status);
      expect(res.body.rows).toBeUndefined();
    });

    it('a staff token or staff headers cannot reach portal routes', async () => {
      const staffToken = await new JwtService({}).signAsync(
        { sub: A.adminId.toHexString(), clinicId: A.clinicId.toHexString() },
        { secret: 'test_access_secret' },
      );
      expect(
        (
          await api()
            .get('/portal/bootstrap')
            .set({ Authorization: `Bearer ${staffToken}` })
        ).status,
      ).toBe(401);
      expect((await api().get('/portal/bootstrap').set(staff(A))).status).toBe(
        401,
      );
    });

    it('rotates the refresh cookie and refuses a replay', async () => {
      const { cookie } = await login('9222222222');
      const first = await api()
        .post('/portal/auth/refresh')
        .set('Cookie', cookie);
      expect(first.status).toBe(200);
      expect(first.body.accessToken).toBeTruthy();
      const replay = await api()
        .post('/portal/auth/refresh')
        .set('Cookie', cookie);
      expect(replay.status).toBe(401);
    });
  });

  describe('unified records', () => {
    it('shows every chart registered on the signed-in number', async () => {
      const res = await api().get('/portal/bootstrap').set(asPatient(riya));
      expect(res.status).toBe(200);
      const body = res.body;
      const clinicIds = body.clinics.map((c: any) => c.id);
      expect(clinicIds).toEqual(
        expect.arrayContaining([
          String(A.branchId),
          String(B.branchId),
          String(C.branchId),
        ]),
      );

      expect(body.visits).toHaveLength(1); // signed only, not the draft
      expect(body.prescriptions.map((p: any) => p.id)).toEqual([
        String(ids.rxSigned),
      ]);
      expect(body.invoices.map((i: any) => i.id)).toEqual([String(ids.billB)]);
      expect(body.reports.map((r: any) => r.id).sort()).toEqual(
        [String(ids.docRiya), String(ids.docChild)].sort(),
      );
    });

    it('never returns staff-only fields', async () => {
      const res = await api().get('/portal/bootstrap').set(asPatient(riya));
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(SECRET_NOTE);
      expect(text).not.toContain('Draft medicine');
      expect(text).not.toContain('storageKey');
      expect(text).not.toContain('normalizedPhones');
    });

    it('logs portal reads in each clinic access log', async () => {
      const logs = await app
        .get<Model<any>>(getModelToken('AccessLog'))
        .find({ path: '/portal/bootstrap' })
        .lean();
      const clinics = new Set(logs.map((l) => String(l.clinicId)));
      expect(clinics.has(String(A.clinicId))).toBe(true);
      expect(clinics.has(String(C.clinicId))).toBe(false);
    });
  });

  describe('booking through the clinic booking engine', () => {
    it('staff booking is unchanged', async () => {
      const res = await api()
        .post('/appointments')
        .set(staff(A))
        .send({
          type: 'TIME',
          branchId: String(A.branchId),
          doctorId: String(A.doctorId),
          patientId: String(ids.vikramA),
          startAt: istIso('10:00'),
          endAt: istIso('10:30'),
        });
      expect(res.status).toBe(201);
      staffApptId = res.body._id;
    });

    it('slots show taken times without saying who took them', async () => {
      const res = await api()
        .get('/portal/slots')
        .query({
          clinicId: String(A.branchId),
          doctorId: String(A.doctorId),
          date: tomorrow,
        })
        .set(asPatient(riya));
      expect(res.status).toBe(200);
      const slots = res.body.groups.flatMap((g: any) => g.slots);
      expect(slots.find((s: any) => s.time === '10:00 AM').booked).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('Vikram');
      expect(JSON.stringify(res.body)).not.toContain(staffApptId);
    });

    it('books a free slot as a PATIENT_PORTAL appointment on the linked record', async () => {
      const res = await api()
        .post('/portal/appointments')
        .set(asPatient(riya))
        .send({
          clinicId: String(A.branchId),
          doctorId: String(A.doctorId),
          date: tomorrow,
          time: '11:00 AM',
          reason: 'Fever',
        });
      expect(res.status).toBe(201);
      riyaApptId = res.body.id;
      const appt = await model<Appointment>(Appointment.name)
        .findById(riyaApptId)
        .lean();
      expect(appt!.source).toBe(AppointmentSource.PatientPortal);
      expect(String(appt!.patientId)).toBe(String(ids.riyaA));
      expect(res.body.time).toBe('11:00 AM');
    });

    it('refuses a taken slot (409), a second visit that day (409) and an off-grid time (400)', async () => {
      const book = (time: string) =>
        api()
          .post('/portal/appointments')
          .set(asPatient(riya))
          .send({
            clinicId: String(A.branchId),
            doctorId: String(A.doctorId),
            date: tomorrow,
            time,
          });
      expect((await book('10:00 AM')).status).toBe(409);
      expect((await book('12:00 PM')).status).toBe(409);
      expect((await book('8:15 AM')).status).toBe(400);
    });

    it('does not book at a clinic that has not opted in', async () => {
      const res = await api()
        .post('/portal/appointments')
        .set(asPatient(riya))
        .send({
          clinicId: String(C.branchId),
          doctorId: String(C.doctorId),
          date: tomorrow,
          time: '11:00 AM',
        });
      expect(res.status).toBe(404);
    });

    it('reschedules only within availability', async () => {
      const ok = await api()
        .post(`/portal/appointments/${riyaApptId}/reschedule`)
        .set(asPatient(riya))
        .send({ date: tomorrow, time: '2:00 PM' });
      expect(ok.status).toBe(200);
      const appt = await model<Appointment>(Appointment.name)
        .findById(riyaApptId)
        .lean();
      expect(appt!.startAt!.toISOString()).toBe(
        istIso('14:00').replace(/\.\d{3}Z$/, '.000Z'),
      );

      const late = await api()
        .post(`/portal/appointments/${riyaApptId}/reschedule`)
        .set(asPatient(riya))
        .send({ date: tomorrow, time: '9:00 PM' });
      expect(late.status).toBe(400);
    });

    it('the portal reschedule service re-checks availability itself', async () => {
      const svc = app.get(AppointmentsService);
      await expect(
        svc.rescheduleWithinAvailability(
          A.clinicId,
          riyaApptId,
          new Date(istIso('21:00')),
          new Date(istIso('21:30')),
        ),
      ).rejects.toThrow();
    });

    it('the staff reschedule path keeps its existing flexibility', async () => {
      const res = await api()
        .patch(`/appointments/${staffApptId}`)
        .set(staff(A))
        .send({ startAt: istIso('21:00'), endAt: istIso('21:30') });
      expect(res.status).toBe(200);
    });

    it('enforces the clinic cancellation lead time', async () => {
      const booked = await api()
        .post('/portal/appointments')
        .set(asPatient(riya))
        .send({
          clinicId: String(B.branchId),
          doctorId: String(B.doctorId),
          date: tomorrow,
          time: '11:00 AM',
        });
      expect(booked.status).toBe(201);
      const res = await api()
        .post(`/portal/appointments/${booked.body.id}/cancel`)
        .set(asPatient(riya))
        .send({ reason: 'Feeling better' });
      expect(res.status).toBe(400);
    });
  });

  describe('patient authorization', () => {
    it('another patient cannot see or change these records (404)', async () => {
      vikram = (await login(VIKRAM_PHONE)).token;
      await api()
        .patch('/portal/me')
        .set(asPatient(vikram))
        .send({ fullName: 'Vikram Rao', dob: '1990-01-01' });

      expect(
        (
          await api()
            .post(`/portal/appointments/${riyaApptId}/cancel`)
            .set(asPatient(vikram))
            .send({ reason: 'x y' })
        ).status,
      ).toBe(404);
      expect(
        (
          await api()
            .get(`/portal/bills/${ids.billB}/pdf`)
            .set(asPatient(vikram))
        ).status,
      ).toBe(404);
      expect(
        (
          await api()
            .get(`/portal/reports/${ids.docRiya}/download`)
            .set(asPatient(vikram))
        ).status,
      ).toBe(404);
      expect(
        (
          await api()
            .get(`/portal/prescriptions/${ids.rxSigned}/pdf`)
            .set(asPatient(vikram))
        ).status,
      ).toBe(404);

      const boot = await api().get('/portal/bootstrap').set(asPatient(vikram));
      expect(boot.body.prescriptions).toHaveLength(0);
      expect(boot.body.invoices).toHaveLength(0);
    });

    it('cancels the patient’s own appointment through the clinic service', async () => {
      const res = await api()
        .post(`/portal/appointments/${riyaApptId}/cancel`)
        .set(asPatient(riya))
        .send({ reason: 'Feeling better' });
      expect(res.status).toBe(200);
      expect(res.body.cancelledBy).toBe('you');
      const appt = await model<Appointment>(Appointment.name)
        .findById(riyaApptId)
        .lean();
      expect(appt!.status).toBe(AppointmentStatus.Cancelled);
      expect(appt!.cancelledVia).toBe(AppointmentSource.PatientPortal);
    });
  });

  describe('family', () => {
    let connectionId = '';

    it('membership alone grants nothing', async () => {
      expect(
        (
          await api()
            .post('/portal/family/invites')
            .set(asPatient(vikram))
            .send({ phone: RIYA_PHONE, name: 'Riya', relation: 'Spouse' })
        ).status,
      ).toBe(201);
      const list = await api().get('/portal/family').set(asPatient(riya));
      const incoming = list.body.find((m: any) => m.incoming);
      expect(incoming).toBeTruthy();
      connectionId = incoming.connectionId;
      expect(
        (
          await api()
            .post(`/portal/family/invites/${connectionId}/respond`)
            .set(asPatient(riya))
            .send({ accept: true })
        ).status,
      ).toBe(200);

      const boot = await api().get('/portal/bootstrap').set(asPatient(vikram));
      expect(boot.body.prescriptions).toHaveLength(0);
      const riyaId = (await api().get('/portal/me').set(asPatient(riya))).body
        .id;
      const book = await api()
        .post('/portal/appointments')
        .set(asPatient(vikram))
        .send({
          patientId: riyaId,
          clinicId: String(A.branchId),
          doctorId: String(A.doctorId),
          date: tomorrow,
          time: '3:00 PM',
        });
      expect(book.status).toBe(404);
    });

    it('shows the inviter’s existing family on the new member’s tree', async () => {
      const dep = await api()
        .post('/portal/family/dependants')
        .set(asPatient(vikram))
        .send({ fullName: 'Aarav Rao', dob: '2016-05-01', relation: 'Son' });
      expect(dep.status).toBe(201);

      const tree = await api().get('/portal/family').set(asPatient(riya));
      expect(tree.status).toBe(200);
      expect(tree.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Vikram Rao', relation: 'Wife' }),
          expect.objectContaining({
            name: 'Aarav Rao',
            relation: 'Son',
            shared: true,
          }),
        ]),
      );
    });

    it('an explicit grant shares exactly that capability', async () => {
      const g = await api()
        .put(`/portal/family/${connectionId}/grants`)
        .set(asPatient(riya))
        .send({ rx: true });
      expect(g.status).toBe(200);
      const boot = await api().get('/portal/bootstrap').set(asPatient(vikram));
      expect(boot.body.prescriptions.map((p: any) => p.id)).toEqual([
        String(ids.rxSigned),
      ]);
      expect(boot.body.visits).toHaveLength(0); // no grant covers visits
      expect(boot.body.invoices).toHaveLength(0);
    });

    it('removing the connection revokes access at once', async () => {
      await api().delete(`/portal/family/${connectionId}`).set(asPatient(riya));
      const boot = await api().get('/portal/bootstrap').set(asPatient(vikram));
      expect(boot.body.prescriptions).toHaveLength(0);
    });

    it('a dependant links the child’s record and only under-18s qualify', async () => {
      const adult = await api()
        .post('/portal/family/dependants')
        .set(asPatient(riya))
        .send({ fullName: 'Grown Up', dob: '1990-01-01' });
      expect(adult.status).toBe(400);
      const child = await api()
        .post('/portal/family/dependants')
        .set(asPatient(riya))
        .send({ fullName: 'Aarav Mehta', dob: '2016-05-01', relation: 'Son' });
      expect(child.status).toBe(201);
      const boot = await api().get('/portal/bootstrap').set(asPatient(riya));
      expect(boot.body.reports.map((r: any) => r.id)).toEqual(
        expect.arrayContaining([String(ids.docRiya), String(ids.docChild)]),
      );
    });
  });

  describe('cross-clinic record access', () => {
    it('a clinic sees only its own records until the patient shares', async () => {
      const before = await api()
        .get(`/patients/${ids.riyaB}/shared-records`)
        .set(staff(B));
      expect(before.status).toBe(200);
      expect(before.body).toEqual({ shared: false, visits: [] });

      const share = await api()
        .put(`/portal/me/record-sharing/${B.branchId}`)
        .set(asPatient(riya))
        .send({ enabled: true });
      expect(share.status).toBe(200);

      const after = await api()
        .get(`/patients/${ids.riyaB}/shared-records`)
        .set(staff(B));
      expect(after.body.shared).toBe(true);
      expect(after.body.visits).toHaveLength(1);
      expect(after.body.visits[0].clinicName).toBe('Sunrise Clinic');
      expect(JSON.stringify(after.body)).not.toContain(SECRET_NOTE);

      // Clinic A was not granted anything.
      const other = await api()
        .get(`/patients/${ids.riyaA}/shared-records`)
        .set(staff(A));
      expect(other.body.shared).toBe(false);
    });

    it('a clinic cannot ask about another clinic’s patient', async () => {
      const res = await api()
        .get(`/patients/${ids.riyaB}/shared-records`)
        .set(staff(A));
      expect(res.status).toBe(404);
    });

    it('turning sharing off stops it', async () => {
      await api()
        .put(`/portal/me/record-sharing/${B.branchId}`)
        .set(asPatient(riya))
        .send({ enabled: false });
      const res = await api()
        .get(`/patients/${ids.riyaB}/shared-records`)
        .set(staff(B));
      expect(res.body.shared).toBe(false);
    });
  });
});
