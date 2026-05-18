/**
 * One-shot bootstrap for the face-recognition feature.
 *
 * What it does:
 *   1. Sets `settings.modules.faceRecognition.enabled = true` on every
 *      clinic that doesn't already have it set.
 *   2. Adds `face:enroll` and `face:recognize` to every role whose name
 *      contains "super admin" or "admin" (case-insensitive).
 *
 * Run:
 *   cd backend
 *   node scripts/enable-face-recognition.cjs
 *
 * Idempotent — safe to run multiple times.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const MONGODB_URI =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/digirx';

const FACE_PERMS = ['face:enroll', 'face:recognize'];

async function main() {
  console.log(`Connecting to ${MONGODB_URI.replace(/:[^:@]+@/, ':***@')}`);
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  // 1. Clinics: turn on the toggle
  const clinics = await db.collection('clinics').find({}, { projection: { _id: 1, name: 1, settings: 1 } }).toArray();
  console.log(`\nFound ${clinics.length} clinic(s)`);
  let clinicsUpdated = 0;
  for (const c of clinics) {
    const currentEnabled = c?.settings?.modules?.faceRecognition?.enabled === true;
    if (currentEnabled) {
      console.log(`  ✓ ${c.name} (${c._id}) — already enabled`);
      continue;
    }
    await db.collection('clinics').updateOne(
      { _id: c._id },
      {
        $set: {
          'settings.modules.faceRecognition.enabled': true,
        },
      },
    );
    console.log(`  → ${c.name} (${c._id}) — face recognition ENABLED`);
    clinicsUpdated++;
  }

  // 2. Roles: grant face perms to any admin-like role
  const roles = await db.collection('roles').find({}, { projection: { _id: 1, name: 1, permissions: 1, clinicId: 1 } }).toArray();
  console.log(`\nFound ${roles.length} role(s) total`);

  let rolesUpdated = 0;
  for (const r of roles) {
    const name = String(r.name ?? '').toLowerCase();
    const isAdminLike = name.includes('admin');
    if (!isAdminLike) continue;
    const current = Array.isArray(r.permissions) ? r.permissions : [];
    const missing = FACE_PERMS.filter((p) => !current.includes(p));
    if (missing.length === 0) {
      console.log(`  ✓ ${r.name} (clinic ${r.clinicId}) — already has both perms`);
      continue;
    }
    await db.collection('roles').updateOne(
      { _id: r._id },
      { $addToSet: { permissions: { $each: FACE_PERMS } } },
    );
    console.log(`  → ${r.name} (clinic ${r.clinicId}) — granted: ${missing.join(', ')}`);
    rolesUpdated++;
  }

  console.log(`\nDone. ${clinicsUpdated} clinic(s) updated, ${rolesUpdated} role(s) updated.`);
  console.log('Next: restart your backend, then hard-refresh the browser (Ctrl+Shift+R).');

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('\nFAILED:', e);
  process.exit(1);
});
