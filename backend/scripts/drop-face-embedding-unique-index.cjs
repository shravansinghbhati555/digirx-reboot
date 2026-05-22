/**
 * One-shot: drop the legacy `face_embedding_unique_per_patient` index
 * left over from the single-shot enrollment design. Multi-shot
 * enrollment requires the index to be non-unique so a patient can
 * hold N rows (capped at FACE_MAX_EMBEDDINGS_PER_PATIENT, default 5).
 *
 * Mongo allows two indexes with the same key spec but different
 * options to coexist, but it doesn't allow inserting duplicate keys
 * under any unique index — so we have to drop the unique one
 * explicitly before the first second-shot enrollment.
 *
 * Run:
 *   cd backend
 *   node scripts/drop-face-embedding-unique-index.cjs
 *
 * Idempotent — safe to run multiple times. Logs what it did.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const MONGODB_URI =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/digirx';

async function main() {
  console.log(`Connecting to ${MONGODB_URI.replace(/:[^:@]+@/, ':***@')}`);
  await mongoose.connect(MONGODB_URI);
  const coll = mongoose.connection.db.collection('faceembeddings');
  const indexes = await coll.indexes();
  console.log('\nExisting indexes on faceembeddings:');
  for (const i of indexes) {
    console.log(`  ${i.name}  ${JSON.stringify(i.key)}  unique=${!!i.unique}`);
  }

  const legacy = indexes.find((i) => i.name === 'face_embedding_unique_per_patient');
  if (!legacy) {
    console.log('\nLegacy index not present — nothing to do.');
  } else {
    await coll.dropIndex('face_embedding_unique_per_patient');
    console.log('\nDropped legacy index face_embedding_unique_per_patient.');
  }

  console.log('\nDone. The new (non-unique) index will be created automatically on next BE start.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('\nFAILED:', e);
  process.exit(1);
});
