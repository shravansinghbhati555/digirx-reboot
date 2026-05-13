/* eslint-disable */
// One-shot: grant `dashboard:read` to every existing role row except
// those named "Doctor". The Dashboard screen is now gated on
// DashboardRead (in addition to the existing ClinicWrite); without
// this backfill, every non-Super-Admin role would suddenly lose access
// to the Dashboard tab after the rename / signup-default change.
//
// Idempotent: roles that already have dashboard:read are skipped.

require('dotenv').config();
const { MongoClient } = require('mongodb');

const DASHBOARD_READ = 'dashboard:read';

async function main() {
  const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/digirx';
  const client = new MongoClient(url);
  await client.connect();

  let dbName = 'digirx';
  try {
    const u = new URL(url);
    const path = (u.pathname || '/digirx').slice(1).split('?')[0];
    dbName = path || 'digirx';
  } catch {}

  const db = client.db(dbName);
  const roles = db.collection('roles');

  // Exclude the Doctor role by name (case-insensitive) and any role
  // that already carries dashboard:read.
  const filter = {
    name: { $not: { $regex: '^doctor$', $options: 'i' } },
    $nor: [{ permissions: DASHBOARD_READ }],
  };

  const candidates = await roles
    .find(filter, { projection: { _id: 1, name: 1, clinicId: 1 } })
    .toArray();

  if (!candidates.length) {
    console.log('No roles to update — already in sync.');
    await client.close();
    return;
  }

  console.log(`Granting dashboard:read to ${candidates.length} role row(s):`);
  for (const r of candidates) {
    console.log(`  + ${r.name} (clinic ${r.clinicId})`);
  }

  const res = await roles.updateMany(filter, {
    $addToSet: { permissions: DASHBOARD_READ },
    $set: { updatedAt: new Date() },
  });
  console.log(`\nUpdated ${res.modifiedCount} role row(s).`);

  // For clarity, also report how many Doctor rows we skipped.
  const doctorCount = await roles.countDocuments({
    name: { $regex: '^doctor$', $options: 'i' },
  });
  console.log(`Skipped ${doctorCount} Doctor role row(s) — they remain dashboard-blocked.`);

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
