import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/DigiRx';
  console.log('Connecting to', uri);
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection('bills');
    console.log('Dropping index billno_unique_per_branch...');
    await collection.dropIndex('billno_unique_per_branch');
    console.log('Index dropped successfully!');
  } catch (err) {
    console.error('Error dropping index:', err);
  } finally {
    await client.close();
  }
}

run();
