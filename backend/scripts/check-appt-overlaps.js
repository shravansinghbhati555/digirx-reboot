// Find time-based appointments that overlap each other within the same
// clinic + branch + doctor. Two appts overlap when a.startAt < b.endAt
// && a.endAt > b.startAt. We only consider ACTIVE statuses (i.e. anything
// that still consumes a slot — exclude CANCELLED/NO_SHOW).
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: __dirname + '/../.env' });

const ACTIVE = ['BOOKED', 'CHECKED_IN', 'IN_PROGRESS', 'DONE'];

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const appts = db.collection('appointments');

  // Use Demo Clinic specifically (the one the user is logged into).
  const clinic = await db.collection('clinics').findOne({ name: 'Demo Clinic' });
  if (!clinic) { console.error('Demo Clinic not found'); process.exit(1); }

  const rows = await appts.find({
    clinicId: clinic._id,
    type: 'TIME',
    status: { $in: ACTIVE },
    startAt: { $exists: true },
    endAt: { $exists: true },
  }).sort({ doctorId: 1, branchId: 1, startAt: 1 }).toArray();

  console.log(`Scanning ${rows.length} active TIME appointments in Demo Clinic…`);

  const overlaps = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (String(a.doctorId) !== String(b.doctorId)) continue;
      if (String(a.branchId) !== String(b.branchId)) continue;
      if (a.startAt < b.endAt && a.endAt > b.startAt) {
        overlaps.push([a, b]);
      } else if (b.startAt >= a.endAt) {
        // Sorted by startAt — once we pass `a.endAt` we can stop.
        break;
      }
    }
  }

  if (overlaps.length === 0) {
    console.log('No overlaps. ✓');
  } else {
    console.log(`Found ${overlaps.length} overlapping pair(s):\n`);
    for (const [a, b] of overlaps) {
      console.log('Doctor:', String(a.doctorId), 'Branch:', String(a.branchId));
      console.log('  A:', a._id.toString(), a.startAt.toISOString(), '→', a.endAt.toISOString(), '|', a.status, '| patient', String(a.patientId), '| source', a.source);
      console.log('  B:', b._id.toString(), b.startAt.toISOString(), '→', b.endAt.toISOString(), '|', b.status, '| patient', String(b.patientId), '| source', b.source);
      console.log('  createdAt A:', a.createdAt?.toISOString?.() ?? a.createdAt);
      console.log('  createdAt B:', b.createdAt?.toISOString?.() ?? b.createdAt);
      console.log('');
    }
  }
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
