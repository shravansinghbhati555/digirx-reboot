import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Shared in-memory MongoDB replica set across e2e suites. We keep one
 * instance per Jest worker process and refcount it so multiple suites in
 * the same worker can `startMemoryMongo` / `stopMemoryMongo` independently
 * without one suite tearing the server out from under another.
 *
 * Replica-set mode is required so the booking-overlap and bill-issue
 * transactions exercise the real (production-shaped) code path.
 */
let replSet: MongoMemoryReplSet | undefined;
let refCount = 0;

export async function startMemoryMongo(): Promise<string> {
  if (!replSet) {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
  }
  refCount += 1;
  return replSet.getUri();
}

export async function stopMemoryMongo(): Promise<void> {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && replSet) {
    const toStop = replSet;
    replSet = undefined;
    await toStop.stop();
  }
}
