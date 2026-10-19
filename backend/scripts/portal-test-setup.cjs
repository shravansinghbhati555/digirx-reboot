/**
 * Patient-portal manual-testing fixtures — LOCAL DATABASE ONLY.
 *
 * Creates three clinics (two on the portal, one not), doctors with weekly
 * availability and fees, and patient records shaped for each test case in
 * DigiRx-Patient/TESTING.md. Re-running removes the previous fixtures first,
 * so it doubles as a "reset".
 *
 *   cd backend
 *   node scripts/portal-test-setup.cjs           # create / reset fixtures
 *   node scripts/portal-test-setup.cjs --remove  # remove fixtures only
 *
 * Refuses to run unless MONGODB_URI points at localhost / 127.0.0.1: the
 * shared dev database must never get test data.
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const URI = process.env.MONGODB_URI || '';
const REMOVE_ONLY = process.argv.includes('--remove');
const PASSWORD = 'Test@12345';
const TZ = 'Asia/Kolkata';
const FIXTURE = 'portalTestFixture';

// Test people. Phones are national 10-digit numbers.
const PRIYA = { phone: '9000000011', dob: '1990-05-15', name: 'Priya Sharma' };
const AARAV = { phone: '9000000011', dob: '2016-03-10', name: 'Aarav Sharma' }; // Priya's son, same phone
const RAHUL = { phone: '9000000022', dob: '1985-11-02', name: 'Rahul Verma' };
const MEERA = { phone: '9000000033', dob: '1972-01-20', name: 'Meera Iyer' }; // record with a DIFFERENT DOB on file

function assertLocal(uri) {
  let host = '';
  try {
    host = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://')).hostname;
  } catch {
    /* fall through */
  }
  if (uri.startsWith('mongodb+srv://') || !['127.0.0.1', 'localhost'].includes(host)) {
    console.error(
      `\nREFUSING TO RUN: MONGODB_URI points at "${host || uri}".\n` +
        'This script only writes to a LOCAL database. See DigiRx-Patient/TESTING.md, step 2.\n',
    );
    process.exit(1);
  }
}

function allPermissions() {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src/modules/authz/permissions.ts'), 'utf8');
  return [...src.matchAll(/=\s*'([a-z:]+)'/g)].map((m) => m[1]);
}

const oid = () => new mongoose.Types.ObjectId();
const at = (d) => new Date(`${d}T00:00:00Z`);
const now = new Date();
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

async function removeFixtures(db) {
  const clinics = await db.collection('clinics').find({ [FIXTURE]: true }).project({ _id: 1 }).toArray();
  const ids = clinics.map((c) => c._id);
  if (ids.length) {
    for (const { name } of await db.listCollections().toArray()) {
      if (name === 'clinics') continue;
      await db.collection(name).deleteMany({ clinicId: { $in: ids } });
    }
    await db.collection('clinics').deleteMany({ _id: { $in: ids } });
  }
  // Portal-side data of the test people.
  const phones = [PRIYA.phone, RAHUL.phone, MEERA.phone];
  const accounts = await db.collection('patientaccounts').find({ phone: { $in: phones } }).project({ _id: 1 }).toArray();
  const accIds = accounts.map((a) => a._id);
  const deps = await db.collection('patientaccounts').find({ managedByAccountId: { $in: accIds } }).project({ _id: 1 }).toArray();
  const allAcc = [...accIds, ...deps.map((d) => d._id)];
  await db.collection('patientlinks').deleteMany({ accountId: { $in: allAcc } });
  await db.collection('portalsessions').deleteMany({ accountId: { $in: allAcc } });
  await db.collection('recordaccessgrants').deleteMany({ accountId: { $in: allAcc } });
  await db.collection('portalpaymentorders').deleteMany({ accountId: { $in: allAcc } });
  await db.collection('familygrants').deleteMany({ $or: [{ granterId: { $in: allAcc } }, { granteeId: { $in: allAcc } }] });
  await db.collection('familyconnections').deleteMany({ $or: [{ requesterId: { $in: allAcc } }, { targetPhone: { $in: phones } }] });
  await db.collection('portalotps').deleteMany({ phone: { $in: phones } });
  await db.collection('patientaccounts').deleteMany({ _id: { $in: allAcc } });
  console.log(`Removed ${ids.length} fixture clinic(s) and ${allAcc.length} portal account(s).`);
}

async function putPdf(key, title) {
  if (!process.env.S3_ENDPOINT) return false;
  try {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    });
    const text = `BT /F1 18 Tf 50 750 Td (${title}) Tj ET`;
    const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${text.length}>>stream\n${text}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: Buffer.from(pdf), ContentType: 'application/pdf' }));
    return true;
  } catch (e) {
    console.warn(`  (could not upload ${key} to S3/MinIO: ${e.message})`);
    return false;
  }
}

async function makeClinic(db, spec, perms, hash) {
  const clinicId = oid();
  const branchId = oid();
  await db.collection('clinics').insertOne({
    _id: clinicId,
    [FIXTURE]: true,
    name: spec.name,
    countryCode: 'IN',
    timezone: TZ,
    currency: 'INR',
    phoneCountryCode: '+91',
    status: 'ACTIVE',
    settings: {
      portal: {
        enabled: spec.portal,
        bookingEnabled: spec.portal,
        bookableDoctorIds: [],
        maxAdvanceDays: 30,
        cancellationLeadTimeHours: spec.leadHours,
        maxActiveFutureAppointments: 3,
      },
    },
    createdAt: now,
    updatedAt: now,
  });
  await db.collection('branches').insertOne({
    _id: branchId,
    clinicId,
    name: 'Main',
    code: spec.code,
    addressLine: spec.address,
    phone: spec.phone,
    workingHours: { open: '09:00', close: '19:00' },
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  const superRole = oid();
  const doctorRole = oid();
  await db.collection('roles').insertMany([
    { _id: superRole, clinicId, name: 'Super Admin', permissions: perms, createdAt: now, updatedAt: now },
    {
      _id: doctorRole,
      clinicId,
      name: 'Doctor',
      permissions: ['appointment:read', 'appointment:write', 'patient:read', 'patient:write', 'document:read', 'document:write'],
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const adminId = oid();
  await db.collection('users').insertOne({
    _id: adminId,
    clinicId,
    branchIds: [branchId],
    defaultBranchId: branchId,
    email: spec.adminEmail,
    name: `${spec.short} Admin`,
    status: 'ACTIVE',
    passwordHash: hash,
    roleIds: [superRole],
    createdAt: now,
    updatedAt: now,
  });
  const doctors = [];
  for (const d of spec.doctors) {
    const id = oid();
    doctors.push(id);
    await db.collection('users').insertOne({
      _id: id,
      clinicId,
      branchIds: [branchId],
      defaultBranchId: branchId,
      email: d.email,
      name: d.name,
      status: 'ACTIVE',
      passwordHash: hash,
      roleIds: [doctorRole],
      qualifications: d.qual,
      registrationNumber: d.reg,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('doctorprofiles').insertOne({ _id: oid(), clinicId, userId: id, specialties: [d.speciality], defaultSlotMinutes: 15, createdAt: now, updatedAt: now });
    for (const weekday of d.days) {
      await db.collection('doctoravailabilityrules').insertOne({
        _id: oid(),
        clinicId,
        branchId,
        doctorUserId: id,
        weekday,
        windows: [
          { startMinutes: 9 * 60, endMinutes: 13 * 60 },
          { startMinutes: 16 * 60, endMinutes: 19 * 60 },
        ],
        slotMinutes: 15,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    await db.collection('visittypes').insertOne({ _id: oid(), clinicId, doctorUserId: id, name: 'Consultation', price: d.fee, currency: 'INR', active: true, createdAt: now, updatedAt: now });
  }
  return { clinicId, branchId, adminId, doctors };
}

async function makePatient(db, c, p, extra = {}) {
  const id = oid();
  await db.collection('patients').insertOne({
    _id: id,
    clinicId: c.clinicId,
    primaryBranchId: c.branchId,
    fullName: p.name,
    normalizedName: p.name.toLowerCase(),
    namePhonetic: '',
    gender: extra.gender || 'FEMALE',
    dob: at(extra.dob || p.dob),
    phones: [p.phone],
    normalizedPhones: [p.phone],
    countryCode: 'IN',
    emails: [],
    tags: [],
    faceConsent: false,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function main() {
  assertLocal(URI);
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  console.log(`Connected to local database "${db.databaseName}".`);
  await removeFixtures(db);
  if (REMOVE_ONLY) return;

  const perms = allPermissions();
  const hash = await bcrypt.hash(PASSWORD, 10);

  const sunrise = await makeClinic(db, {
    name: 'Sunrise Test Clinic', short: 'Sunrise', code: 'SUN', portal: true, leadHours: 2,
    address: '12, 100 Feet Road, Indiranagar, Bengaluru', phone: '+91 80 4123 5500',
    adminEmail: 'admin@sunrise.test',
    doctors: [
      { name: 'Dr. Kavya Rao', email: 'kavya@sunrise.test', speciality: 'General physician', qual: 'MBBS, MD', reg: 'KMC-10021', fee: 500, days: [1, 2, 3, 4, 5, 6] },
      { name: 'Dr. Sana Khan', email: 'sana@sunrise.test', speciality: 'Paediatrics', qual: 'MBBS, DCH', reg: 'KMC-20415', fee: 600, days: [1, 3, 5] },
    ],
  }, perms, hash);
  const carepoint = await makeClinic(db, {
    name: 'CarePoint Test Clinic', short: 'CarePoint', code: 'CPT', portal: true, leadHours: 24,
    address: '80 Feet Road, Koramangala, Bengaluru', phone: '+91 80 4987 1200',
    adminEmail: 'admin@carepoint.test',
    doctors: [{ name: 'Dr. Rahul Menon', email: 'menon@carepoint.test', speciality: 'Dermatology', qual: 'MBBS, MD (Derm)', reg: 'KMC-30988', fee: 800, days: [1, 2, 3, 4, 5, 6] }],
  }, perms, hash);
  const hidden = await makeClinic(db, {
    name: 'Hidden Test Clinic', short: 'Hidden', code: 'HID', portal: false, leadHours: 2,
    address: 'MG Road, Bengaluru', phone: '+91 80 4000 0000',
    adminEmail: 'admin@hidden.test',
    doctors: [{ name: 'Dr. Not Online', email: 'doc@hidden.test', speciality: 'General physician', qual: 'MBBS', reg: 'KMC-99999', fee: 300, days: [1, 2, 3, 4, 5, 6] }],
  }, perms, hash);

  // Records that should link to Priya (same phone + DOB) at all three clinics.
  const priyaSun = await makePatient(db, sunrise, PRIYA);
  const priyaCare = await makePatient(db, carepoint, PRIYA);
  await makePatient(db, hidden, PRIYA);
  // Her son: same phone, different DOB — only links when added as a dependant.
  const aaravSun = await makePatient(db, sunrise, AARAV, { gender: 'MALE' });
  // Second tester.
  await makePatient(db, sunrise, RAHUL, { gender: 'MALE' });
  // Phone matches but the DOB on file is different — must NOT link.
  await makePatient(db, sunrise, MEERA, { dob: '1972-01-21' });

  // Sunrise: one signed visit with prescription (visible), one draft (hidden).
  const signedEnc = oid();
  const draftEnc = oid();
  await db.collection('encounters').insertMany([
    {
      _id: signedEnc, clinicId: sunrise.clinicId, branchId: sunrise.branchId, doctorId: sunrise.doctors[0], patientId: priyaSun,
      visitedAt: daysAgo(10), chiefComplaint: 'Acid reflux after meals',
      notes: 'INTERNAL CLINICIAN NOTE - must never appear in the portal',
      diagnoses: [{ description: 'Gastro-oesophageal reflux (GERD)', code: 'K21.9', primary: true }],
      vitals: { bpSystolic: 118, bpDiastolic: 76, pulseBpm: 72, temperatureC: 36.8, weightKg: 58 },
      followUpAt: daysAgo(-14), followUpNotes: 'Small, frequent meals. Avoid late dinners.',
      status: 'SIGNED', signedAt: daysAgo(10), createdAt: daysAgo(10), updatedAt: daysAgo(10),
    },
    {
      _id: draftEnc, clinicId: sunrise.clinicId, branchId: sunrise.branchId, doctorId: sunrise.doctors[0], patientId: priyaSun,
      visitedAt: daysAgo(1), chiefComplaint: 'DRAFT VISIT - must not appear', diagnoses: [], status: 'DRAFT',
      createdAt: daysAgo(1), updatedAt: daysAgo(1),
    },
  ]);
  await db.collection('prescriptions').insertMany([
    {
      _id: oid(), clinicId: sunrise.clinicId, branchId: sunrise.branchId, doctorId: sunrise.doctors[0], patientId: priyaSun,
      encounterId: signedEnc, prescriptionNo: 'RX-TEST-0001',
      items: [
        { customName: 'Pantoprazole 40 mg', dosage: 'Tablet', frequency: '1-0-0', duration: '14 days', instructions: 'Before breakfast' },
        { customName: 'Antacid gel', dosage: '10 ml', frequency: 'TDS', duration: '7 days', instructions: 'After meals' },
      ],
      createdAt: daysAgo(10), updatedAt: daysAgo(10),
    },
    {
      _id: oid(), clinicId: sunrise.clinicId, branchId: sunrise.branchId, doctorId: sunrise.doctors[0], patientId: priyaSun,
      encounterId: draftEnc, items: [{ customName: 'DRAFT MEDICINE - must not appear' }],
      createdAt: daysAgo(1), updatedAt: daysAgo(1),
    },
  ]);

  // CarePoint: an unpaid bill (shows as "due").
  await db.collection('bills').insertOne({
    _id: oid(), clinicId: carepoint.clinicId, branchId: carepoint.branchId, patientId: priyaCare,
    billNo: 'CPT/TEST/000001', currency: 'INR',
    items: [{ customName: 'Skin consultation', quantity: 1, unitPrice: 800, amount: 800 }, { customName: 'Patch test', quantity: 1, unitPrice: 400, amount: 400 }],
    subtotal: 1200, discount: 0, tax: 0, total: 1200, status: 'ISSUED', kind: 'SERVICE',
    issuedAt: daysAgo(3), createdAt: daysAgo(3), updatedAt: daysAgo(3),
  });

  // Lab reports: one for Priya, one for Aarav.
  for (const [pid, title, file] of [
    [priyaSun, 'CBC report', 'CBC_report.pdf'],
    [aaravSun, 'Vaccination card', 'Vaccination_card.pdf'],
  ]) {
    const key = `clinic/${sunrise.clinicId}/patient/${pid}/${file}`;
    const uploaded = await putPdf(key, title);
    await db.collection('documents').insertOne({
      _id: oid(), clinicId: sunrise.clinicId, ownerType: 'PATIENT', ownerId: pid, category: 'LAB_REPORT',
      mimeType: 'application/pdf', fileName: file, sizeBytes: 600, storageKey: key,
      access: 'INTERNAL_ONLY', status: 'AVAILABLE', deletedAt: null, createdAt: daysAgo(2), updatedAt: daysAgo(2),
    });
    if (!uploaded) console.warn(`  ${file}: record created, but its download will fail without MinIO`);
  }

  console.log(`
Done. Test data ready.

Clinic app (http://localhost:5173) staff logins — password for all: ${PASSWORD}
  Sunrise Test Clinic    admin@sunrise.test     (doctors: kavya@sunrise.test, sana@sunrise.test)
  CarePoint Test Clinic  admin@carepoint.test   (doctor: menon@carepoint.test)
  Hidden Test Clinic     admin@hidden.test      (NOT on the portal)

Patient portal (http://localhost:5174) test people — OTP is printed in the backend console:
  Priya Sharma  ${PRIYA.phone}  DOB 15/05/1990  (records at all 3 clinics; son Aarav DOB 10/03/2016)
  Rahul Verma   ${RAHUL.phone}  DOB 02/11/1985  (record at Sunrise)
  Meera Iyer    ${MEERA.phone}  DOB 20/01/1972  (clinic has 21/01/1972 on file -> must NOT link)
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
