/* eslint-disable */
// One-shot cleanup: removes the "Zero Role Test User" seed account
// (email noroles@digirx.local) from every clinic that has one, plus
// any refresh sessions it owned. Safe to re-run — nothing happens once
// the user is gone.
//
// Run with: node scripts/delete-zero-role-test-user.cjs

require('dotenv').config();
const { MongoClient } = require('mongodb');

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
  const users = db.collection('users');
  const sessions = db.collection('sessions');

  const TARGET_EMAIL = 'noroles@digirx.local';

  // The user.schema lowercases email on write, so an equality match
  // suffices here — but use a case-insensitive regex anyway in case
  // older rows pre-date that normalization.
  const match = { email: { $regex: `^${TARGET_EMAIL}$`, $options: 'i' } };

  const found = await users.find(match).toArray();
  if (!found.length) {
    console.log('No "Zero Role Test User" rows found — nothing to do.');
    await client.close();
    return;
  }

  console.log(`Found ${found.length} matching user row(s):`);
  for (const u of found) {
    console.log(`  - _id=${u._id}  clinicId=${u.clinicId}  name=${u.name ?? '(no name)'}`);
  }

  const userIds = found.map((u) => u._id);

  // Revoke + delete refresh sessions so any active client can't keep
  // requesting fresh tokens after the user row is gone.
  const sessionRes = await sessions.deleteMany({ userId: { $in: userIds } });
  console.log(`Removed ${sessionRes.deletedCount} refresh session row(s).`);

  const userRes = await users.deleteMany({ _id: { $in: userIds } });
  console.log(`Removed ${userRes.deletedCount} user row(s).`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
