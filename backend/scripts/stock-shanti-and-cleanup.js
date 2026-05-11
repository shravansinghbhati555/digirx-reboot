// Migration:
//   1. Add ~50 inventory items + batches to the Shanti Nagar branch so
//      the "All branches" filter shows a meaningful diff vs. Main Branch.
//   2. Delete the leftover _smoketest_juhu branch (and the 2 dailystats
//      rows that reference it — they're stale analytics rollups).
//
// Idempotent: re-running won't duplicate items (matched on
// (clinicId, branchId, name)).
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config({ path: __dirname + '/../.env' });

const SHANTI_CATALOG = [
  // Antibiotics
  { name: 'Augmentin 625mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 200, exp: '2027-06-30' },
  { name: 'Azithromycin 500mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 6, reorder: 20, batchQty: 120, exp: '2027-09-15' },
  { name: 'Ciprofloxacin 500mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 150, exp: '2027-04-20' },
  { name: 'Doxycycline 100mg', unit: 'CAPSULE', packUnit: 'STRIP', packSize: 10, reorder: 25, batchQty: 100, exp: '2027-12-01' },
  { name: 'Levofloxacin 500mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 5, reorder: 15, batchQty: 80, exp: '2027-08-10' },
  { name: 'Ofloxacin 200mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 25, batchQty: 130, exp: '2027-07-25' },
  { name: 'Cefixime 200mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 160, exp: '2027-11-12' },
  { name: 'Metronidazole 400mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 15, reorder: 30, batchQty: 180, exp: '2027-05-18' },

  // Antihistamines & allergy
  { name: 'Cetirizine 10mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 40, batchQty: 220, exp: '2027-10-30' },
  { name: 'Levocetirizine 5mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 150, exp: '2027-08-22' },
  { name: 'Montelukast 10mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 20, batchQty: 100, exp: '2027-06-15' },
  { name: 'Fexofenadine 120mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 25, batchQty: 140, exp: '2027-09-08' },

  // Pain & fever
  { name: 'Aceclofenac 100mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 160, exp: '2027-07-10' },
  { name: 'Diclofenac 50mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 170, exp: '2027-05-22' },
  { name: 'Tramadol 50mg', unit: 'CAPSULE', packUnit: 'STRIP', packSize: 10, reorder: 20, batchQty: 90, exp: '2027-11-30' },
  { name: 'Naproxen 250mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 20, batchQty: 110, exp: '2027-04-14' },
  { name: 'Etoricoxib 90mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 15, batchQty: 80, exp: '2027-08-05' },

  // GI / acidity
  { name: 'Rabeprazole 20mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 160, exp: '2027-10-18' },
  { name: 'Esomeprazole 40mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 150, exp: '2027-09-25' },
  { name: 'Domperidone 10mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 25, batchQty: 140, exp: '2027-07-30' },
  { name: 'Ondansetron 4mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 20, batchQty: 100, exp: '2027-12-15' },
  { name: 'Loperamide 2mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 20, batchQty: 90, exp: '2027-06-08' },
  { name: 'Sucralfate 1g', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 15, batchQty: 70, exp: '2027-05-30' },

  // Cardio / metabolic
  { name: 'Telmisartan 40mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 150, exp: '2027-08-20' },
  { name: 'Amlodipine 5mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 160, exp: '2027-10-12' },
  { name: 'Losartan 50mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 150, exp: '2027-07-22' },
  { name: 'Atorvastatin 20mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 25, batchQty: 130, exp: '2027-11-08' },
  { name: 'Rosuvastatin 10mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 20, batchQty: 100, exp: '2027-09-18' },
  { name: 'Metformin 500mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 15, reorder: 40, batchQty: 240, exp: '2027-06-25' },
  { name: 'Glimepiride 2mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 25, batchQty: 120, exp: '2027-05-15' },
  { name: 'Sitagliptin 50mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 7, reorder: 15, batchQty: 70, exp: '2027-08-30' },

  // Respiratory
  { name: 'Salbutamol inhaler 100mcg', unit: 'UNIT', packUnit: 'BOX', packSize: 1, reorder: 10, batchQty: 30, exp: '2027-04-30' },
  { name: 'Budesonide inhaler 200mcg', unit: 'UNIT', packUnit: 'BOX', packSize: 1, reorder: 8, batchQty: 24, exp: '2027-09-12' },
  { name: 'Ambroxol 30mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 25, batchQty: 130, exp: '2027-07-04' },
  { name: 'Bromhexine syrup', unit: 'ML', packUnit: 'BOTTLE', packSize: 100, reorder: 200, batchQty: 1200, exp: '2027-03-20' },

  // Vitamins & supplements
  { name: 'Vitamin D3 60000 IU', unit: 'CAPSULE', packUnit: 'STRIP', packSize: 4, reorder: 12, batchQty: 60, exp: '2027-10-08' },
  { name: 'Vitamin B12 1500mcg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 140, exp: '2027-08-15' },
  { name: 'Folic Acid 5mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 25, batchQty: 130, exp: '2027-06-30' },
  { name: 'Iron + Folic syrup', unit: 'ML', packUnit: 'BOTTLE', packSize: 200, reorder: 400, batchQty: 2000, exp: '2027-04-12' },
  { name: 'Calcium + D3', unit: 'TABLET', packUnit: 'STRIP', packSize: 15, reorder: 30, batchQty: 180, exp: '2027-09-22' },

  // Topicals
  { name: 'Betamethasone cream 15g', unit: 'GRAM', packUnit: 'PACK', packSize: 15, reorder: 30, batchQty: 150, exp: '2027-07-18' },
  { name: 'Clotrimazole cream 20g', unit: 'GRAM', packUnit: 'PACK', packSize: 20, reorder: 40, batchQty: 200, exp: '2027-05-25' },
  { name: 'Mupirocin ointment 5g', unit: 'GRAM', packUnit: 'PACK', packSize: 5, reorder: 10, batchQty: 50, exp: '2027-08-30' },

  // Eye/ear
  { name: 'Ciprofloxacin eye drops', unit: 'ML', packUnit: 'BOTTLE', packSize: 5, reorder: 10, batchQty: 50, exp: '2027-06-12' },
  { name: 'Carboxymethylcellulose eye drops', unit: 'ML', packUnit: 'BOTTLE', packSize: 10, reorder: 20, batchQty: 100, exp: '2027-09-04' },

  // Misc commonly-Rxed
  { name: 'Pantoprazole 40mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 160, exp: '2027-07-28' },
  { name: 'Drotaverine 80mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 20, batchQty: 100, exp: '2027-10-20' },
  { name: 'Hyoscine 10mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 15, batchQty: 80, exp: '2027-05-08' },
  { name: 'Cyclobenzaprine 10mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 15, batchQty: 70, exp: '2027-08-12' },

  // Out-of-stock / low-stock examples (so the new branch shows status variety)
  { name: 'Insulin Glargine 100IU', unit: 'ML', packUnit: 'CARTON', packSize: 3, reorder: 6, batchQty: 0, exp: null },
  { name: 'Warfarin 5mg', unit: 'TABLET', packUnit: 'STRIP', packSize: 10, reorder: 30, batchQty: 8, exp: '2027-12-30' },
];

function skuFor(name, branchSuffix) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) + '-' + branchSuffix;
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const clinics = db.collection('clinics');
  const branches = db.collection('branches');
  const inventoryItems = db.collection('inventoryitems');
  const inventoryBatches = db.collection('inventorybatches');
  const dailystats = db.collection('dailystats');

  const clinic = await clinics.findOne({ name: 'Demo Clinic' });
  if (!clinic) { console.error('Demo Clinic not found'); await client.close(); process.exit(1); }
  const clinicId = clinic._id;

  // -- 1. Stock Shanti Nagar ----------------------------------------------
  const shanti = await branches.findOne({ clinicId, name: 'Shanti Nagar' });
  if (!shanti) { console.error('Shanti Nagar branch not found'); await client.close(); process.exit(1); }
  console.log('Stocking Shanti Nagar (', shanti._id.toString(), ')…');

  let created = 0, skipped = 0, batches = 0;
  for (const m of SHANTI_CATALOG) {
    const sku = skuFor(m.name, 'SN');
    const existing = await inventoryItems.findOne({ clinicId, branchId: shanti._id, name: m.name });
    let itemId;
    if (existing) { itemId = existing._id; skipped++; }
    else {
      itemId = new ObjectId();
      await inventoryItems.insertOne({
        _id: itemId,
        clinicId,
        branchId: shanti._id,
        name: m.name,
        sku,
        unit: m.unit,
        packUnit: m.packUnit,
        packSize: m.packSize,
        reorderLevel: m.reorder,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      created++;
    }

    if (m.batchQty > 0 && m.exp) {
      const batchNumber = 'SN-' + sku.slice(0, 8) + '-01';
      const have = await inventoryBatches.findOne({ inventoryItemId: itemId, batchNumber });
      if (!have) {
        await inventoryBatches.insertOne({
          clinicId,
          branchId: shanti._id,
          inventoryItemId: itemId,
          batchNumber,
          expiryDate: new Date(m.exp),
          quantityReceived: m.batchQty,
          quantityRemaining: m.batchQty,
          receivedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        batches++;
      }
    }
  }
  console.log(`  ${created} items created, ${skipped} already existed, ${batches} batches added.`);

  // -- 2. Cleanup _smoketest_juhu -----------------------------------------
  const smoke = await branches.findOne({ clinicId, name: '_smoketest_juhu' });
  if (smoke) {
    const ds = await dailystats.deleteMany({ branchId: smoke._id });
    const br = await branches.deleteOne({ _id: smoke._id });
    console.log(`  Deleted _smoketest_juhu: ${br.deletedCount} branch, ${ds.deletedCount} dailystats rows.`);
  } else {
    console.log('  _smoketest_juhu already gone.');
  }

  // -- Summary ------------------------------------------------------------
  const finalBranches = await branches.find({ clinicId }).toArray();
  console.log('\nFinal branch state for Demo Clinic:');
  for (const b of finalBranches) {
    const c = await inventoryItems.countDocuments({ clinicId, branchId: b._id });
    console.log('  -', b.name, ':', c, 'items');
  }

  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
