/* eslint-disable */
// One-shot role normalisation for existing clinics. Same logic as the
// migrate-mongo migration `20260512170000-rename-and-seed-default-roles.js`
// but runnable directly via `node scripts/fix-role-names-once.cjs` —
// avoiding the broken older migration that's blocking `migrate-mongo up`.
//
// Idempotent: re-running this is a no-op once the rows match the
// target shape.

require('dotenv').config();
const { MongoClient } = require('mongodb');

const ALL_PERMISSIONS = [
  'clinic:read', 'clinic:write',
  'branch:read', 'branch:write',
  'user:read', 'user:write',
  'patient:read', 'patient:write',
  'appointment:read', 'appointment:write',
  'billing:read', 'billing:write',
  'document:read', 'document:write',
  'notification:read', 'notification:write',
  'audit:read', 'accesslog:read',
  'inventory:read', 'inventory:write',
];

const DEFAULT_ROLES = {
  'Super Admin': ALL_PERMISSIONS,
  Manager: [
    'clinic:read', 'branch:read', 'user:read',
    'patient:read', 'patient:write',
    'appointment:read', 'appointment:write',
    'billing:read', 'billing:write',
    'document:read', 'document:write',
    'notification:read', 'notification:write',
    'inventory:read', 'inventory:write',
    'audit:read', 'accesslog:read',
  ],
  'Front Desk': [
    'clinic:read', 'branch:read',
    'patient:read', 'patient:write',
    'appointment:read', 'appointment:write',
    'billing:read', 'billing:write',
    'document:read',
    'notification:read',
  ],
  Doctor: [
    'clinic:read', 'branch:read',
    'patient:read', 'patient:write',
    'appointment:read', 'appointment:write',
    'billing:read',
    'document:read', 'document:write',
    'notification:read',
  ],
  Pharmacist: [
    'clinic:read', 'branch:read',
    'patient:read',
    'billing:read', 'billing:write',
    'document:read',
    'inventory:read', 'inventory:write',
    'notification:read',
  ],
};

async function main() {
  const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/digirx';
  const client = new MongoClient(url);
  await client.connect();

  // Derive db name from URI (same as migrate-mongo-config.cjs).
  let dbName = 'digirx';
  try {
    const u = new URL(url);
    const path = (u.pathname || '/digirx').slice(1).split('?')[0];
    dbName = path || 'digirx';
  } catch {}

  const db = client.db(dbName);
  const clinics = db.collection('clinics');
  const roles = db.collection('roles');
  const now = new Date();

  let renamedAdmin = 0;
  let renamedReception = 0;
  let seeded = 0;
  let clinicCount = 0;

  const cursor = clinics.find({}, { projection: { _id: 1, name: 1 } });
  while (await cursor.hasNext()) {
    const clinic = await cursor.next();
    clinicCount++;
    const clinicId = clinic._id;

    // 1) Admin → Super Admin
    const adminRow = await roles.findOne({ clinicId, name: 'Admin' });
    const existingSuper = await roles.findOne({ clinicId, name: 'Super Admin' });
    if (adminRow && !existingSuper) {
      await roles.updateOne(
        { _id: adminRow._id },
        { $set: { name: 'Super Admin', updatedAt: now } },
      );
      renamedAdmin++;
    } else if (adminRow && existingSuper) {
      const adminPerms = (adminRow.permissions || []).length;
      const superPerms = (existingSuper.permissions || []).length;
      if (adminPerms >= superPerms) {
        await roles.deleteOne({ _id: existingSuper._id });
        await roles.updateOne(
          { _id: adminRow._id },
          { $set: { name: 'Super Admin', updatedAt: now } },
        );
      } else {
        await roles.deleteOne({ _id: adminRow._id });
      }
      renamedAdmin++;
    }

    // 2) ReceptionRole → Front Desk
    const recRow = await roles.findOne({ clinicId, name: 'ReceptionRole' });
    const existingFront = await roles.findOne({ clinicId, name: 'Front Desk' });
    if (recRow && !existingFront) {
      await roles.updateOne(
        { _id: recRow._id },
        { $set: { name: 'Front Desk', updatedAt: now } },
      );
      renamedReception++;
    } else if (recRow && existingFront) {
      const recPerms = (recRow.permissions || []).length;
      const frontPerms = (existingFront.permissions || []).length;
      if (recPerms >= frontPerms) {
        await roles.deleteOne({ _id: existingFront._id });
        await roles.updateOne(
          { _id: recRow._id },
          { $set: { name: 'Front Desk', updatedAt: now } },
        );
      } else {
        await roles.deleteOne({ _id: recRow._id });
      }
      renamedReception++;
    }

    // 3) Backfill missing defaults
    const toSeed = [];
    for (const [name, permissions] of Object.entries(DEFAULT_ROLES)) {
      const existing = await roles.findOne({ clinicId, name });
      if (existing) continue;
      if (name === 'Super Admin') {
        const anyAdmin = await roles.findOne({
          clinicId,
          name: { $in: ['Admin', 'Super Admin'] },
        });
        if (anyAdmin) continue;
      }
      toSeed.push({
        clinicId,
        name,
        permissions,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (toSeed.length) {
      await roles.insertMany(toSeed);
      seeded += toSeed.length;
    }

    console.log(
      `[${clinic.name || clinicId}] super-admin renames=${adminRow ? 1 : 0}, ` +
      `front-desk renames=${recRow ? 1 : 0}, seeded=${toSeed.length}`,
    );
  }

  console.log(
    `\nDone. ${clinicCount} clinic(s) processed. ` +
    `Total: ${renamedAdmin} Admin → Super Admin, ` +
    `${renamedReception} ReceptionRole → Front Desk, ` +
    `${seeded} role(s) seeded.`,
  );

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
