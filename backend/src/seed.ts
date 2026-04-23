import * as dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import mongoose, { Types } from 'mongoose';
import { Permission } from './modules/authz/permissions';

dotenv.config();

type Clinic = {
  _id: Types.ObjectId;
  name: string;
  countryCode: string;
  timezone: string;
  currency: string;
  phoneCountryCode: string;
  settings: Record<string, unknown>;
};

type Branch = {
  _id: Types.ObjectId;
  clinicId: Types.ObjectId;
  name: string;
};

type Role = {
  _id: Types.ObjectId;
  clinicId: Types.ObjectId;
  name: string;
  permissions: Permission[];
};

type User = {
  _id: Types.ObjectId;
  clinicId: Types.ObjectId;
  branchIds: Types.ObjectId[];
  defaultBranchId?: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  status: 'ACTIVE' | 'DISABLED';
  passwordHash?: string;
  roleIds: Types.ObjectId[];
};

async function main() {
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/digirx';
  await mongoose.connect(uri);

  const clinics = mongoose.connection.collection<Clinic>('clinics');
  const branches = mongoose.connection.collection<Branch>('branches');
  const roles = mongoose.connection.collection<Role>('roles');
  const users = mongoose.connection.collection<User>('users');

  const clinicName = 'Demo Clinic';
  const clinic = await clinics.findOne({ name: clinicName });
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
    });
  }

  const branchName = 'Main Branch';
  const branch = await branches.findOne({ clinicId, name: branchName });
  const branchId = branch?._id ?? new Types.ObjectId();
  if (!branch) {
    await branches.insertOne({
      _id: branchId,
      clinicId,
      name: branchName,
    });
  }

  const adminRoleName = 'Admin';
  const adminRole = await roles.findOne({ clinicId, name: adminRoleName });
  const roleId = adminRole?._id ?? new Types.ObjectId();
  if (!adminRole) {
    await roles.insertOne({
      _id: roleId,
      clinicId,
      name: adminRoleName,
      permissions: Object.values(Permission),
    });
  }

  const adminEmail = 'admin@digirx.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123';
  const existingAdmin = await users.findOne({ clinicId, email: adminEmail });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await users.insertOne({
      _id: new Types.ObjectId(),
      clinicId,
      branchIds: [branchId],
      defaultBranchId: branchId,
      name: 'DigiRx Admin',
      email: adminEmail,
      status: 'ACTIVE',
      passwordHash,
      roleIds: [roleId],
    });
  }

  console.log('Seeded:', {
    clinicId: clinicId.toHexString(),
    branchId: branchId.toHexString(),
    adminEmail,
    adminPassword,
    headersHint: {
      'x-clinic-id': clinicId.toHexString(),
      'x-branch-id': branchId.toHexString(),
    },
    loginHint: {
      endpoint: '/auth/login',
      body: {
        clinicId: clinicId.toHexString(),
        email: adminEmail,
        password: adminPassword,
        branchId: branchId.toHexString(),
      },
    },
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
