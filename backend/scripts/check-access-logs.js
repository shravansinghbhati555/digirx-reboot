// Diagnostic for Dashboard "Recent activity" panel:
//  1. Does Demo Clinic's admin role include accesslog:read?
//  2. Are AccessLog rows actually being written?
//  3. Sample the most recent 5 rows to see what activityIsInteresting() would filter.
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: __dirname + '/../.env' });

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const clinic = await db.collection('clinics').findOne({ name: 'Demo Clinic' });
  if (!clinic) { console.error('Demo Clinic not found'); process.exit(1); }

  const role = await db.collection('roles').findOne({ clinicId: clinic._id, name: 'Admin' });
  console.log('Admin role exists:', !!role);
  if (role) {
    console.log('Admin role permissions (count =', role.permissions?.length ?? 0, '):');
    const hasAccessLog = (role.permissions ?? []).includes('accesslog:read');
    console.log('  Includes accesslog:read?', hasAccessLog);
    if (!hasAccessLog) console.log('  Full perm list:', role.permissions);
  }

  const total = await db.collection('accesslogs').countDocuments({ clinicId: clinic._id });
  console.log('\nTotal access-log rows for Demo Clinic:', total);

  const recent = await db.collection('accesslogs').find({ clinicId: clinic._id })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();
  console.log('\nMost recent 5 rows:');
  for (const r of recent) {
    console.log(' ', r.method, r.path, '→', r.statusCode, '|', r.createdAt?.toISOString?.() ?? r.createdAt);
  }

  // Filter preview: matches `activityIsInteresting` in DashboardScreen.tsx
  const interesting = recent.filter((r) => r.method !== 'GET' && !r.path.startsWith('/auth') && !r.path.startsWith('/me') && !r.path.startsWith('/access-logs') && r.statusCode < 400);
  console.log('\nOf those, would render in "Recent activity":', interesting.length);

  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
