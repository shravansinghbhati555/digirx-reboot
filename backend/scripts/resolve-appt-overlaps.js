// Migration: resolve same-time TIME appointment duplicates.
//
// Strategy: for each pair of active+done TIME appointments that share
// the same (clinicId, branchId, doctorId, startAt), keep the OLDER one
// (smaller createdAt) and mark the newer one as CANCELLED with a clear
// reason. We don't delete — the historical record stays auditable.
//
// Run this BEFORE the new partial unique index is built; otherwise the
// index creation fails on the existing dupes.
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: __dirname + '/../.env' });

const BLOCKING = ['BOOKED', 'CHECKED_IN', 'IN_PROGRESS', 'DONE'];

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const appts = db.collection('appointments');

  // Find groups of >=2 TIME appointments sharing (clinic, branch, doctor, startAt)
  // and a slot-holding status.
  const groups = await appts.aggregate([
    { $match: { type: 'TIME', status: { $in: BLOCKING } } },
    {
      $group: {
        _id: { clinicId: '$clinicId', branchId: '$branchId', doctorId: '$doctorId', startAt: '$startAt' },
        ids: { $push: { id: '$_id', status: '$status', createdAt: '$createdAt', patientId: '$patientId' } },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  console.log(`Found ${groups.length} same-time conflict group(s).`);

  let cancelled = 0;
  for (const g of groups) {
    // Sort ascending by createdAt — first one stays, the rest get cancelled.
    const sorted = g.ids.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const keep = sorted[0];
    const losers = sorted.slice(1);
    console.log(`\nDoctor ${g._id.doctorId}  Slot ${g._id.startAt.toISOString()}`);
    console.log('  Keeping :', keep.id.toString(), '|', keep.status, '| patient', keep.patientId.toString(), '| created', keep.createdAt.toISOString());
    for (const l of losers) {
      console.log('  Cancel  :', l.id.toString(), '|', l.status, '| patient', l.patientId.toString(), '| created', l.createdAt.toISOString());
      await appts.updateOne(
        { _id: l.id },
        {
          $set: {
            status: 'CANCELLED',
            cancellationReason: 'Auto-resolved duplicate booking (same-time conflict cleanup)',
            cancelledAt: new Date(),
            updatedAt: new Date(),
          },
        },
      );
      cancelled++;
    }
  }

  console.log(`\nDone. Cancelled ${cancelled} duplicate appointment(s).`);
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
