import * as dotenv from 'dotenv';
import bcrypt from 'bcrypt';
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
        modules: { inventory: { enabled: false } },
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

  // 3. Seed Role
  const adminRoleName = 'Admin';
  let adminRole = await roles.findOne({ clinicId, name: adminRoleName });
  const roleId = adminRole?._id ?? new Types.ObjectId();
  if (!adminRole) {
    await roles.insertOne({
      _id: roleId,
      clinicId,
      name: adminRoleName,
      permissions: Object.values(Permission),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
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

  console.log('\nSeeding Complete!');
  console.log('Login Email:', adminEmail);
  console.log('Login Password:', adminPassword);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
