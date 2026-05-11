const { MongoClient } = require('mongodb');
require('dotenv').config({ path: __dirname + '/../.env' });
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const clinic = await db.collection('clinics').findOne({ name: 'Demo Clinic' });
  const recent = await db.collection('accesslogs').find({
    clinicId: clinic._id,
    method: { $in: ['POST', 'PATCH', 'PUT', 'DELETE'] },
    statusCode: { $lt: 400 },
  }).sort({ createdAt: -1 }).limit(12).toArray();
  console.log(`Found ${recent.length} recent successful write events:`);
  for (const r of recent) {
    console.log(' ', r.method, r.path, '→', r.statusCode, '|', r.createdAt.toISOString());
  }
  await client.close();
})();
