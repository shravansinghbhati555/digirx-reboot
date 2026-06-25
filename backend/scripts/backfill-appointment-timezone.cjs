/* eslint-disable */
// One-time backfill: tag existing appointments that have no
// `bookingTimezone` with their clinic's CURRENT timezone.
//
// IMPORTANT: run this while each clinic is still set to the timezone its
// existing appointments were booked under. For a clinic whose appointments
// were all booked in Asia/Kolkata, set the clinic timezone back to
// Asia/Kolkata in Settings BEFORE running this, so the appointments get
// tagged "Asia/Kolkata" (then switching to another zone hides them).
//
// Usage (PowerShell):
//   $env:MONGODB_URI='<your uri>'; node scripts/backfill-appointment-timezone.cjs
//
// Idempotent: only touches appointments missing a bookingTimezone.

const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('Set MONGODB_URI'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const clinics = await db.collection('clinics')
    .find({}, { projection: { _id: 1, name: 1, timezone: 1 } })
    .toArray();

  let total = 0;
  for (const c of clinics) {
    const tz = c.timezone;
    if (!tz) { console.log(`- ${c.name}: no timezone set, skipping`); continue; }
    const res = await db.collection('appointments').updateMany(
      {
        clinicId: c._id,
        $or: [{ bookingTimezone: { $exists: false } }, { bookingTimezone: null }],
      },
      { $set: { bookingTimezone: tz } },
    );
    if (res.modifiedCount) {
      console.log(`- ${c.name}: tagged ${res.modifiedCount} appointment(s) as ${tz}`);
      total += res.modifiedCount;
    }
  }
  console.log(`\nDone. Backfilled ${total} appointment(s).`);
  await client.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
