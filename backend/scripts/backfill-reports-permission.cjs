/* eslint-disable */
// One-shot: add the new `reports:read` permission to every existing role
// row that already has `billing:read`. Why: today the Reports screen is
// gated to BillingRead, so anyone with BillingRead sees it. After
// introducing the dedicated ReportsRead permission, we want those roles
// to keep working without anyone having to re-toggle them in the UI.
//
// Also adds `reports:read` to any role row whose Super-Admin-like
// equivalent already has the full permission enum (defensive — Super
// Admin should have everything).
//
// Idempotent: re-running is a no-op once roles are up to date.

require('dotenv').config();
const { MongoClient } = require('mongodb');

const REPORTS_READ = 'reports:read';
const BILLING_READ = 'billing:read';

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

  // Match roles that have BillingRead but NOT yet ReportsRead.
  const filter = {
    permissions: BILLING_READ,
    $nor: [{ permissions: REPORTS_READ }],
  };

  const candidates = await roles.find(filter, { projection: { _id: 1, name: 1, clinicId: 1 } }).toArray();
  if (!candidates.length) {
    console.log('All eligible roles already carry reports:read — nothing to do.');
    await client.close();
    return;
  }

  console.log(`Found ${candidates.length} role row(s) to update:`);
  for (const r of candidates) {
    console.log(`  - ${r.name} (clinic ${r.clinicId})`);
  }

  const res = await roles.updateMany(filter, {
    $addToSet: { permissions: REPORTS_READ },
    $set: { updatedAt: new Date() },
  });
  console.log(`\nUpdated ${res.modifiedCount} role row(s).`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
