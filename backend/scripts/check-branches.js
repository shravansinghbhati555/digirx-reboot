// One-shot diagnostic: list branches + per-branch inventory counts.
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: __dirname + '/../.env' });

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('No MONGODB_URI'); process.exit(1); }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const clinics = await db.collection('clinics').find({}).toArray();
    for (const c of clinics) {
      console.log('\nClinic:', c.name, '_id=', c._id.toString());
      const branches = await db.collection('branches').find({ clinicId: c._id }).toArray();
      for (const b of branches) {
        const itemCount = await db.collection('inventoryitems').countDocuments({ clinicId: c._id, branchId: b._id });
        console.log('  Branch:', b.name, '_id=', b._id.toString(), '— items:', itemCount);
      }
      const totalForClinic = await db.collection('inventoryitems').countDocuments({ clinicId: c._id });
      const itemsWithoutBranch = await db.collection('inventoryitems').countDocuments({ clinicId: c._id, branchId: { $exists: false } });
      console.log('  TOTAL items for clinic:', totalForClinic, '(without branchId:', itemsWithoutBranch, ')');
    }
  } finally {
    await client.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
