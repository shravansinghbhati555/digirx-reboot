// Pre-flight check: is anything in the DB pointing at the _smoketest_juhu
// branch? If any collection has a row scoped to it, deletion is unsafe.
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: __dirname + '/../.env' });

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const b = await db.collection('branches').findOne({ name: '_smoketest_juhu' });
  if (!b) { console.log('Branch _smoketest_juhu not found.'); await client.close(); return; }
  console.log('Branch _smoketest_juhu _id =', b._id.toString(), 'clinicId =', b.clinicId.toString());

  const collections = await db.listCollections().toArray();
  for (const c of collections) {
    const coll = db.collection(c.name);
    // Skip the branches collection itself
    if (c.name === 'branches') continue;
    try {
      const count = await coll.countDocuments({ branchId: b._id });
      if (count > 0) console.log(`  REFERENCES in '${c.name}': ${count}`);
      // Also check users whose branchIds array contains it
      if (c.name === 'users') {
        const inArray = await coll.countDocuments({ branchIds: b._id });
        if (inArray > 0) console.log(`  users.branchIds[] containing it: ${inArray}`);
        const asDefault = await coll.countDocuments({ defaultBranchId: b._id });
        if (asDefault > 0) console.log(`  users.defaultBranchId == it: ${asDefault}`);
      }
    } catch { /* collection w/o branchId field — skip */ }
  }
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
