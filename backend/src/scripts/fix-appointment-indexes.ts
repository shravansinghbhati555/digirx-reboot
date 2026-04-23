import * as dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/digirx';
  await mongoose.connect(uri);

  const coll = mongoose.connection.collection('appointments');
  const indexes = await coll.indexes();

  const legacy = indexes.find((i) => i.name === 'appt_queue_unique_idx' && i.key?.queueDate === 1 && i.key?.queueNumber === 1 && i.key?.doctorId === 1 && i.unique);
  if (legacy) {
    // Drop legacy index that incorrectly applies to TIME docs (queueDate/queueNumber null).
    // New index is declared in schema with same name but partialFilterExpression.
    // eslint-disable-next-line no-console
    console.log('Dropping legacy index appt_queue_unique_idx');
    await coll.dropIndex('appt_queue_unique_idx');
  } else {
    // eslint-disable-next-line no-console
    console.log('Legacy index not found; nothing to drop');
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exitCode = 1;
});

