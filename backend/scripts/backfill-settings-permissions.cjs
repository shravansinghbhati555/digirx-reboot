/* eslint-disable */
// One-shot: grant the new `settings:*:read` permissions to existing
// role rows that currently see those tabs under the old gates. The
// mapping mirrors what the SettingsScreen NAV used to require:
//
//   old gate           -> new tab permission
//   clinic:write       -> settings:clinic:read
//   branch:read        -> settings:branches:read
//   clinic:read        -> settings:availability:read
//   notification:read  -> settings:notifications:read
//   audit:read         -> settings:audit:read
//
// Idempotent: roles already carrying a settings:* permission are
// skipped (the $addToSet does nothing).

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MAPPING = [
  { has: 'clinic:write',      grant: 'settings:clinic:read' },
  { has: 'branch:read',       grant: 'settings:branches:read' },
  { has: 'clinic:read',       grant: 'settings:availability:read' },
  { has: 'notification:read', grant: 'settings:notifications:read' },
  { has: 'audit:read',        grant: 'settings:audit:read' },
];

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

  let totalUpdated = 0;
  for (const m of MAPPING) {
    const filter = {
      permissions: m.has,
      $nor: [{ permissions: m.grant }],
    };
    const candidates = await roles.find(filter).toArray();
    if (!candidates.length) {
      console.log(`No roles need ${m.grant} (already in sync)`);
      continue;
    }
    const res = await roles.updateMany(filter, {
      $addToSet: { permissions: m.grant },
      $set: { updatedAt: new Date() },
    });
    console.log(`Granted ${m.grant} to ${res.modifiedCount} role row(s) (had ${m.has}).`);
    totalUpdated += res.modifiedCount;
  }

  console.log(`\nTotal grants: ${totalUpdated}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
