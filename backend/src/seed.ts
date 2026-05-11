import * as dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import mongoose, { Types } from 'mongoose';
import { Permission } from './modules/authz/permissions';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/digirx';
  console.log('Connecting to:', uri);
  await mongoose.connect(uri);

  const db = mongoose.connection;
  const clinics = db.collection('clinics');
  const branches = db.collection('branches');
  const roles = db.collection('roles');
  const users = db.collection('users');
  const patients = db.collection('patients');
  const appointments = db.collection('appointments');
  const bills = db.collection('bills');
  const payments = db.collection('payments');
  const encounters = db.collection('encounters');
  const prescriptions = db.collection('prescriptions');
  const prescriptionCounters = db.collection('prescriptioncounters');
  const inventoryItems = db.collection('inventoryitems');
  const inventoryBatches = db.collection('inventorybatches');

  // 1. Seed Clinic
  const clinicName = 'Demo Clinic';
  let clinic = await clinics.findOne({ name: clinicName });
  const clinicId = clinic?._id ?? new Types.ObjectId();
  if (!clinic) {
    await clinics.insertOne({
      _id: clinicId,
      name: clinicName,
      countryCode: 'IN',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      phoneCountryCode: '+91',
      settings: {
        appointments: { mode: 'BOTH', slotMinutesDefault: 15 },
        // Inventory + Pharmacy on by default. A clinic that doesn't run
        // a pharmacy counter can disable in Settings → Clinic → Modules.
        modules: { inventory: { enabled: true } },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log('Created Clinic:', clinicName);
  }

  // 2. Seed Branch
  const branchName = 'Main Branch';
  let branch = await branches.findOne({ clinicId, name: branchName });
  const branchId = branch?._id ?? new Types.ObjectId();
  if (!branch) {
    await branches.insertOne({
      _id: branchId,
      clinicId,
      name: branchName,
      address: { street: 'Hill Road', city: 'Mumbai', state: 'Maharashtra', zip: '400050' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log('Created Branch:', branchName);
  }

  // 3. Seed Role — Admin gets every permission currently declared in the
  // Permission enum. Upsert + $set on permissions so a re-run picks up
  // any newly added permissions (e.g. `inventory:read` added after the
  // role's original creation). Without this, an existing admin row would
  // miss new permissions forever and the FE would show "access required"
  // for screens whose perms landed after the seed first ran.
  const adminRoleName = 'Admin';
  const existingAdminRole = await roles.findOne({ clinicId, name: adminRoleName });
  const roleId = existingAdminRole?._id ?? new Types.ObjectId();
  await roles.updateOne(
    { clinicId, name: adminRoleName },
    {
      $set: {
        permissions: Object.values(Permission),
        updatedAt: new Date(),
      },
      $setOnInsert: {
        _id: roleId,
        clinicId,
        name: adminRoleName,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
  if (existingAdminRole) {
    console.log('Refreshed Role permissions:', adminRoleName);
  } else {
    console.log('Created Role:', adminRoleName);
  }

  // 4. Seed User (Admin/Doctor)
  const adminEmail = 'admin@digirx.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123';
  let adminUser = await users.findOne({ clinicId, email: adminEmail });
  const doctorId = adminUser?._id ?? new Types.ObjectId();
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  
  await users.updateOne(
    { clinicId, email: adminEmail },
    {
      $set: {
        name: 'Dr. Saloni Verma',
        status: 'ACTIVE',
        passwordHash,
        roleIds: [roleId],
        branchIds: [branchId],
        defaultBranchId: branchId,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        _id: doctorId,
        clinicId,
        createdAt: new Date(),
      }
    },
    { upsert: true }
  );
  console.log('Ensured Admin User exists with correct roles:', adminEmail);

  // 5. Seed Patients
  const patientData = [
    { name: 'Rajan Mehta', gender: 'MALE', phone: '9820012345', email: 'rajan@example.com', dob: '1985-05-15' },
    { name: 'Priya Sharma', gender: 'FEMALE', phone: '9820054321', email: 'priya@example.com', dob: '1992-08-22' },
    { name: 'Anil Kumar', gender: 'MALE', phone: '9820098765', email: 'anil@example.com', dob: '1978-12-10' },
    { name: 'Suman Singh', gender: 'FEMALE', phone: '9820067890', email: 'suman@example.com', dob: '2001-03-05' },
    { name: 'Rahul Jain', gender: 'MALE', phone: '9820011223', email: 'rahul@example.com', dob: '1988-11-20' },
  ];

  const seededPatients = [];
  for (const p of patientData) {
    let patient = await patients.findOne({ clinicId, fullName: p.name });
    if (!patient) {
      const pId = new Types.ObjectId();
      await patients.insertOne({
        _id: pId,
        clinicId,
        primaryBranchId: branchId,
        fullName: p.name,
        normalizedName: p.name.toLowerCase(),
        gender: p.gender,
        dob: new Date(p.dob),
        phones: [p.phone],
        normalizedPhones: [p.phone],
        emails: [p.email],
        tags: ['demo'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      patient = await patients.findOne({ _id: pId });
    }
    seededPatients.push(patient);
  }
  console.log('Seeded 5 Patients');

  // 6. Seed Appointments
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const apptTimes = [
    { hour: 9, min: 0 },
    { hour: 10, min: 30 },
    { hour: 11, min: 0 },
    { hour: 14, min: 15 },
    { hour: 16, min: 45 },
  ];

  for (let i = 0; i < seededPatients.length; i++) {
    const p = seededPatients[i];
    const time = apptTimes[i];
    const startAt = new Date(today);
    startAt.setHours(time.hour, time.min);
    
    const endAt = new Date(startAt);
    endAt.setMinutes(endAt.getMinutes() + 15);

    const apptId = new Types.ObjectId();
    await appointments.updateOne(
      { clinicId, patientId: p?._id, startAt },
      {
        $setOnInsert: {
          _id: apptId,
          clinicId,
          branchId,
          doctorId,
          patientId: p?._id,
          type: 'TIME',
          startAt,
          endAt,
          status: i === 0 ? 'DONE' : i === 1 ? 'CHECKED_IN' : 'BOOKED',
          source: 'FRONT_DESK',
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      },
      { upsert: true }
    );

    // 7. Seed Encounter for the first done appointment
    if (i === 0) {
      await encounters.updateOne(
        { clinicId, appointmentId: apptId },
        {
          $setOnInsert: {
            _id: new Types.ObjectId(),
            clinicId,
            branchId,
            doctorId,
            patientId: p?._id,
            appointmentId: apptId,
            visitedAt: startAt,
            chiefComplaint: 'Regular checkup',
            diagnosis: 'Healthy',
            status: 'SIGNED',
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        },
        { upsert: true }
      );

      // 8. Seed Bill for the first done appointment
      const billId = new Types.ObjectId();
      const amount = 500;
      await bills.updateOne(
        { clinicId, appointmentId: apptId },
        {
          $setOnInsert: {
            _id: billId,
            clinicId,
            branchId,
            patientId: p?._id,
            appointmentId: apptId,
            billNo: `BILL-${Date.now()}-${i}`,
            currency: 'INR',
            items: [{ customName: 'Consultation', quantity: 1, unitPrice: amount, amount }],
            subtotal: amount,
            total: amount,
            status: 'ISSUED',
            issuedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        },
        { upsert: true }
      );

      // 9. Seed Payment for that bill
      await payments.updateOne(
        { clinicId, billId },
        {
          $setOnInsert: {
            _id: new Types.ObjectId(),
            clinicId,
            branchId,
            billId,
            method: 'CASH',
            amount: amount,
            paidAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        },
        { upsert: true }
      );
    }
  }
  console.log('Seeded Appointments, Encounters, Bills and Payments');

  // 10. Seed a fully-formed SIGNED encounter for a new patient.
  // This exercises every field a real signed record carries — vitals,
  // structured diagnoses[], follow-up, the signed-hash audit fields —
  // plus a linked Prescription with quantity-bearing items and the
  // human-readable RX-### number that drives the pharmacy flow.
  // Idempotent on the patient name.
  const meeraName = 'Meera Iyer';
  let meera = await patients.findOne({ clinicId, fullName: meeraName });
  let meeraId: Types.ObjectId;
  if (!meera) {
    meeraId = new Types.ObjectId();
    await patients.insertOne({
      _id: meeraId,
      clinicId,
      primaryBranchId: branchId,
      fullName: meeraName,
      normalizedName: meeraName.toLowerCase(),
      gender: 'FEMALE',
      dob: new Date('1990-07-12'),
      phones: ['9820077777'],
      normalizedPhones: ['9820077777'],
      emails: ['meera@example.com'],
      tags: ['demo', 'follow-up'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log('Created Patient:', meeraName);
  } else {
    meeraId = meera._id;
  }

  // Appointment — yesterday at 10:30, status DONE so the encounter
  // linkage matches what the FE expects (encounters open from a Done
  // appointment slot).
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(10, 30, 0, 0);
  const meeraEndAt = new Date(yesterday);
  meeraEndAt.setMinutes(meeraEndAt.getMinutes() + 15);

  const meeraApptId = new Types.ObjectId();
  await appointments.updateOne(
    { clinicId, patientId: meeraId, startAt: yesterday },
    {
      $setOnInsert: {
        _id: meeraApptId,
        clinicId,
        branchId,
        doctorId,
        patientId: meeraId,
        type: 'TIME',
        startAt: yesterday,
        endAt: meeraEndAt,
        status: 'DONE',
        source: 'FRONT_DESK',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  // Resolve the appointment id we actually wrote (could be an existing
  // one from a re-run). Needed below to link the encounter.
  const meeraAppt = await appointments.findOne({
    clinicId,
    patientId: meeraId,
    startAt: yesterday,
  });
  const linkedApptId = meeraAppt?._id ?? meeraApptId;

  // Find or build the encounter. We compute the signedHash with the same
  // canonical-key set the live service uses so a tamper-detection re-run
  // would match. For a seed this is informational — no flow blocks on it.
  const existingEnc = await encounters.findOne({
    clinicId,
    appointmentId: linkedApptId,
  });

  const visitedAt = yesterday;
  const followUpAt = new Date();
  followUpAt.setDate(followUpAt.getDate() + 14); // two weeks out
  followUpAt.setHours(10, 0, 0, 0);
  const signedAt = new Date(yesterday.getTime() + 25 * 60 * 1000); // 25 min after visit
  const vitals = {
    bp: '128/84',
    pulse: '78',
    spo2: '98',
    temp: '98.6',
    weight: '62',
    height: '162',
    rr: '16',
  };
  const diagnoses = [
    { code: 'I10', description: 'Essential (primary) hypertension', primary: true },
    { code: 'E78.5', description: 'Hyperlipidemia, unspecified', primary: false },
  ];
  const chiefComplaint = 'Headache and mild dizziness for 3 days, occasional palpitations.';
  const notes =
    'Advised lifestyle modification — reduce salt, daily walk 30 min. Recheck BP after two weeks. ' +
    'Patient declined immediate lipid panel; will repeat fasting profile at follow-up.';

  // Mirror the canonical hash payload the live service uses so a future
  // verifier can re-run the same hash. Order-stable JSON via sorted keys.
  const canonical = JSON.stringify(
    {
      chiefComplaint,
      clinicId: String(clinicId),
      diagnoses: diagnoses.map((d) => ({
        code: d.code,
        description: d.description,
        primary: d.primary,
      })),
      diagnosis: null,
      doctorId: String(doctorId),
      followUpAt: followUpAt.toISOString(),
      followUpNotes: null,
      notes,
      patientId: String(meeraId),
      visitedAt: visitedAt.toISOString(),
      vitals,
    },
    Object.keys({
      chiefComplaint: 1,
      clinicId: 1,
      diagnoses: 1,
      diagnosis: 1,
      doctorId: 1,
      followUpAt: 1,
      followUpNotes: 1,
      notes: 1,
      patientId: 1,
      visitedAt: 1,
      vitals: 1,
    }).sort(),
  );
  const signedHash = createHash('sha256').update(canonical).digest('hex');

  let encounterId: Types.ObjectId;
  if (existingEnc) {
    encounterId = existingEnc._id;
    // Idempotent re-seed: bring the existing row up to the full shape
    // without changing its identity. Useful for hot-reloading after
    // schema additions like the new diagnoses[] / vitals fields.
    await encounters.updateOne(
      { _id: encounterId },
      {
        $set: {
          chiefComplaint,
          diagnoses,
          vitals,
          followUpAt,
          notes,
          status: 'SIGNED',
          signedAt,
          signedByUserId: doctorId,
          signedHash,
          updatedAt: new Date(),
        },
      },
    );
  } else {
    encounterId = new Types.ObjectId();
    await encounters.insertOne({
      _id: encounterId,
      clinicId,
      branchId,
      doctorId,
      patientId: meeraId,
      appointmentId: linkedApptId,
      visitedAt,
      chiefComplaint,
      diagnoses,
      vitals,
      followUpAt,
      notes,
      status: 'SIGNED',
      signedAt,
      signedByUserId: doctorId,
      signedHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  console.log('Seeded SIGNED encounter for', meeraName);

  // Prescription — mints a real RX-### number via the same counter
  // collection the live numbering service uses, so subsequent encounters
  // signed through the UI will continue the sequence cleanly.
  const counterDoc = await prescriptionCounters.findOneAndUpdate(
    { clinicId },
    { $inc: { lastNumber: 1 }, $setOnInsert: { createdAt: new Date() }, $set: { updatedAt: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );
  // Mongo driver returns the document under different shapes depending
  // on version — handle both.
  const lastNumber: number =
    (counterDoc as any)?.value?.lastNumber ?? (counterDoc as any)?.lastNumber ?? 1;
  const seededRxNo = `RX-${String(lastNumber).padStart(6, '0')}`;

  // Idempotent on (clinicId, encounterId) — the live upsertForEncounter
  // enforces the same 1:1 relationship.
  const existingRx = await prescriptions.findOne({ clinicId, encounterId });
  const rxItems = [
    {
      customName: 'Amlodipine 5mg',
      dosage: '1 tab',
      frequency: 'OD',
      duration: '14 days',
      instructions: 'Take in the morning with food.',
      quantity: 14,
    },
    {
      customName: 'Atorvastatin 10mg',
      dosage: '1 tab',
      frequency: 'OD',
      duration: '14 days',
      instructions: 'Take at bedtime.',
      quantity: 14,
    },
    {
      customName: 'Paracetamol 500mg',
      dosage: '1 tab',
      frequency: 'SOS',
      duration: 'as needed',
      instructions: 'For headache. Max 4 doses/day.',
      quantity: 10,
    },
  ];
  if (existingRx) {
    await prescriptions.updateOne(
      { _id: existingRx._id },
      {
        $set: {
          items: rxItems,
          updatedAt: new Date(),
        },
        // Only stamp prescriptionNo if the existing row didn't have one —
        // never re-mint, mirrors the live numbering service.
        ...(existingRx.prescriptionNo
          ? {}
          : { $setOnInsert: {} as never }),
      },
    );
    if (!existingRx.prescriptionNo) {
      await prescriptions.updateOne(
        { _id: existingRx._id },
        { $set: { prescriptionNo: seededRxNo } },
      );
    }
  } else {
    await prescriptions.insertOne({
      _id: new Types.ObjectId(),
      clinicId,
      branchId,
      doctorId,
      patientId: meeraId,
      encounterId,
      prescriptionNo: seededRxNo,
      items: rxItems,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  console.log(`Seeded Prescription ${seededRxNo} (3 items, total 38 units)`);

  // Paid service bill for the consultation, so the patient's history
  // tab shows a complete encounter+bill+payment chain end to end.
  const meeraBillId = new Types.ObjectId();
  const consultFee = 800;
  await bills.updateOne(
    { clinicId, encounterId },
    {
      $setOnInsert: {
        _id: meeraBillId,
        clinicId,
        branchId,
        patientId: meeraId,
        appointmentId: linkedApptId,
        encounterId,
        billNo: `MAIN/2026-27/${String(2000 + lastNumber).padStart(6, '0')}`,
        currency: 'INR',
        kind: 'SERVICE',
        items: [
          {
            customName: 'Cardiology Consultation',
            quantity: 1,
            unitPrice: consultFee,
            amount: consultFee,
          },
        ],
        subtotal: consultFee,
        discount: 0,
        tax: 0,
        total: consultFee,
        status: 'PAID',
        issuedAt: signedAt,
        paidAt: new Date(signedAt.getTime() + 5 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  await payments.updateOne(
    { clinicId, billId: meeraBillId },
    {
      $setOnInsert: {
        _id: new Types.ObjectId(),
        clinicId,
        branchId,
        billId: meeraBillId,
        method: 'CASH',
        amount: consultFee,
        paidAt: new Date(signedAt.getTime() + 5 * 60 * 1000),
        idempotencyKey: `seed-${meeraBillId.toHexString()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  console.log('Seeded paid consultation bill for', meeraName);

  // ─── 11. Seed ~100 inventory items + batches ──────────────────────────
  // Mixed stock states so the Inventory screen's StockPill exercises all
  // four variants: in-stock, low-stock, out-of-stock, stocked-no-threshold.
  // Idempotent: keyed on (clinicId, branchId, name). A re-run skips any
  // item that already exists rather than duplicating SKUs.
  type SeededMedicine = {
    name: string;
    unit: 'TABLET' | 'CAPSULE' | 'BOTTLE' | 'SYRUP_BOTTLE' | 'ML' | 'GRAM';
    packUnit?: 'STRIP' | 'BOX' | 'BOTTLE' | 'PACK';
    packSize?: number;
    reorderLevel: number;
  };
  // Builder: returns N items where every name is unique. Families are
  // multiplied by their dosage list so we get realistic variety without
  // a hand-typed 100-row literal.
  function buildMedicineCatalog(target: number): SeededMedicine[] {
    const families: Array<{ base: string; dosages: string[]; form: 'tab' | 'cap' | 'syrup' | 'cream' | 'drops' }> = [
      { base: 'Crocin', dosages: ['500mg', '650mg', 'Advance', 'Pain Relief'], form: 'tab' },
      { base: 'Dolo', dosages: ['650mg', '500mg', '120 Syrup'], form: 'tab' },
      { base: 'Paracetamol', dosages: ['500mg', '650mg', '125mg'], form: 'tab' },
      { base: 'Combiflam', dosages: ['Plus', 'ICY'], form: 'tab' },
      { base: 'Ibuprofen', dosages: ['200mg', '400mg', '600mg'], form: 'tab' },
      { base: 'Diclofenac', dosages: ['50mg', '100mg SR'], form: 'tab' },
      { base: 'Aspirin', dosages: ['75mg', '150mg', '325mg'], form: 'tab' },
      { base: 'Amoxicillin', dosages: ['250mg', '500mg', '750mg'], form: 'cap' },
      { base: 'Azithromycin', dosages: ['250mg', '500mg'], form: 'tab' },
      { base: 'Ciprofloxacin', dosages: ['250mg', '500mg', '750mg'], form: 'tab' },
      { base: 'Augmentin', dosages: ['375', '625 Duo', '1g'], form: 'tab' },
      { base: 'Cefixime', dosages: ['100mg', '200mg'], form: 'tab' },
      { base: 'Doxycycline', dosages: ['100mg'], form: 'cap' },
      { base: 'Pantoprazole', dosages: ['20mg', '40mg'], form: 'tab' },
      { base: 'Omeprazole', dosages: ['20mg', '40mg'], form: 'cap' },
      { base: 'Rabeprazole', dosages: ['20mg'], form: 'tab' },
      { base: 'Cetirizine', dosages: ['10mg', '5mg'], form: 'tab' },
      { base: 'Levocetirizine', dosages: ['5mg'], form: 'tab' },
      { base: 'Loratadine', dosages: ['10mg'], form: 'tab' },
      { base: 'Metformin', dosages: ['500mg', '850mg', '1000mg SR'], form: 'tab' },
      { base: 'Glimepiride', dosages: ['1mg', '2mg', '4mg'], form: 'tab' },
      { base: 'Amlodipine', dosages: ['2.5mg', '5mg', '10mg'], form: 'tab' },
      { base: 'Telmisartan', dosages: ['20mg', '40mg', '80mg'], form: 'tab' },
      { base: 'Atorvastatin', dosages: ['10mg', '20mg', '40mg'], form: 'tab' },
      { base: 'Rosuvastatin', dosages: ['5mg', '10mg', '20mg'], form: 'tab' },
      { base: 'Vitamin D3', dosages: ['60K', '1000 IU', '2000 IU'], form: 'cap' },
      { base: 'Vitamin B12', dosages: ['500mcg', '1500mcg'], form: 'tab' },
      { base: 'Calcium', dosages: ['500mg', '500+D3'], form: 'tab' },
      { base: 'Folic Acid', dosages: ['5mg'], form: 'tab' },
      { base: 'Iron + Folic Acid', dosages: ['Standard'], form: 'tab' },
      { base: 'Multivitamin', dosages: ['Daily'], form: 'cap' },
      { base: 'ORS', dosages: ['Sachet', 'Liquid 200ml'], form: 'syrup' },
      { base: 'Cofsils', dosages: ['Lozenge'], form: 'tab' },
      { base: 'Strepsils', dosages: ['Original', 'Honey-Lemon'], form: 'tab' },
      { base: 'Fluconazole', dosages: ['150mg', '200mg'], form: 'tab' },
      { base: 'Moxifloxacin Eye Drops', dosages: ['0.5%'], form: 'drops' },
      { base: 'Soframycin', dosages: ['Cream 30g'], form: 'cream' },
      { base: 'Betadine', dosages: ['Solution 100ml', 'Ointment 25g'], form: 'cream' },
      // Extra families to push the catalog past 100 unique SKUs.
      { base: 'Sinarest', dosages: ['Tablet', 'New', 'Syrup 60ml'], form: 'tab' },
      { base: 'D-Cold Total', dosages: ['Standard'], form: 'tab' },
      { base: 'Vicks Action 500', dosages: ['Standard'], form: 'tab' },
      { base: 'Norfloxacin', dosages: ['400mg', 'TZ'], form: 'tab' },
      { base: 'Septran', dosages: ['DS', 'Single'], form: 'tab' },
      { base: 'Erythromycin', dosages: ['250mg', '500mg'], form: 'tab' },
      { base: 'Clindamycin', dosages: ['300mg'], form: 'cap' },
      { base: 'Metronidazole', dosages: ['200mg', '400mg'], form: 'tab' },
      { base: 'Tinidazole', dosages: ['500mg'], form: 'tab' },
      { base: 'Losartan', dosages: ['25mg', '50mg', '100mg'], form: 'tab' },
      { base: 'Enalapril', dosages: ['5mg', '10mg'], form: 'tab' },
      { base: 'Hydrochlorothiazide', dosages: ['12.5mg', '25mg'], form: 'tab' },
    ];
    const out: SeededMedicine[] = [];
    for (const f of families) {
      for (const d of f.dosages) {
        if (out.length >= target) break;
        const name = `${f.base} ${d}`;
        // pack defaults vary by form to look realistic
        let unit: SeededMedicine['unit'] = 'TABLET';
        let packUnit: SeededMedicine['packUnit'] = 'STRIP';
        let packSize = 10;
        let reorder = 20;
        if (f.form === 'cap') { unit = 'CAPSULE'; }
        if (f.form === 'syrup') { unit = 'BOTTLE'; packUnit = 'BOX'; packSize = 1; reorder = 5; }
        if (f.form === 'cream') { unit = 'BOTTLE'; packUnit = 'BOX'; packSize = 1; reorder = 4; }
        if (f.form === 'drops') { unit = 'BOTTLE'; packUnit = 'BOX'; packSize = 1; reorder = 3; }
        out.push({ name, unit, packUnit, packSize, reorderLevel: reorder });
      }
      if (out.length >= target) break;
    }
    return out.slice(0, target);
  }

  // Target 120 so we comfortably end up with ≥100 items even if a few
  // collide on name with an earlier seed run.
  const medicineList = buildMedicineCatalog(120);

  // Stock-state plan: every 5th item out-of-stock, every 4th low-stock,
  // every 9th no-reorder-threshold-tracking; remainder healthy.
  const skuPrefix = (name: string) =>
    name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 18);

  let createdItems = 0;
  let createdBatches = 0;
  for (let i = 0; i < medicineList.length; i++) {
    const m = medicineList[i];
    const existing = await inventoryItems.findOne({ clinicId, branchId, name: m.name });
    if (existing) continue;

    // 1-in-9 items: untracked (reorderLevel = 0) — exercises the
    // "Stocked" gray pill variant.
    const tracked = i % 9 !== 0;
    const itemId = new Types.ObjectId();
    await inventoryItems.insertOne({
      _id: itemId,
      clinicId,
      branchId,
      name: m.name,
      sku: `${skuPrefix(m.name)}-${String(i + 1).padStart(3, '0')}`,
      unit: m.unit,
      packUnit: m.packUnit,
      packSize: m.packSize,
      reorderLevel: tracked ? m.reorderLevel : 0,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    createdItems++;

    // Stock state distribution:
    //   index % 5 === 0  → no batch  (Out of stock)
    //   index % 4 === 0  → tiny batch (Low stock)
    //   otherwise        → healthy batch (In stock)
    const outOfStock = i % 5 === 0;
    if (outOfStock) continue;

    const lowStock = !outOfStock && i % 4 === 0;
    const baseQty = lowStock
      ? Math.max(1, Math.floor(m.reorderLevel * 0.6))
      : m.reorderLevel * 10 + 40;

    // Two batches per healthy item, one for low-stock — varies the
    // FIFO chain and gives the "expiring soon" badge something to
    // surface for a fraction of the catalog.
    const batchCount = lowStock ? 1 : 2;
    for (let b = 0; b < batchCount; b++) {
      const expiryMonthsOut = (i + b * 3) % 24 + 2; // 2..25 months
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + expiryMonthsOut);
      const receivedAt = new Date();
      receivedAt.setDate(receivedAt.getDate() - ((i + b) % 90));
      const qty = b === 0 ? baseQty : Math.floor(baseQty * 0.7);

      await inventoryBatches.insertOne({
        _id: new Types.ObjectId(),
        clinicId,
        branchId,
        inventoryItemId: itemId,
        batchNumber: `B${String(i + 1).padStart(3, '0')}-${b + 1}`,
        expiryDate: expiry,
        quantityReceived: qty,
        quantityRemaining: qty,
        unitCost: Math.round((10 + (i % 30)) * 100) / 100,
        supplier: i % 3 === 0 ? 'MedPlus Distributors' : i % 3 === 1 ? 'Wellness Pharma' : 'Apollo Supply Chain',
        receivedAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      createdBatches++;
    }
  }
  console.log(`Seeded ${createdItems} new inventory items (+ ${createdBatches} batches; existing items skipped)`);

  console.log('\nSeeding Complete!');
  console.log('Login Email:', adminEmail);
  console.log('Login Password:', adminPassword);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
