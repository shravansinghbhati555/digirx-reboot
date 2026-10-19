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

/**
 * Throw unless the app is connected to the local in-memory server. Every
 * e2e suite calls this right after app.init(), before seeding anything, so
 * a misconfigured run fails instead of writing to a real database.
 */
export function assertLocalTestDatabase(app: {
  get(token: unknown): unknown;
}): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getConnectionToken } = require('@nestjs/mongoose');
  const conn = app.get(getConnectionToken()) as {
    host?: string;
    port?: number;
    name?: string;
  };
  if (!replSet || !/^(127\.0\.0\.1|localhost)$/.test(conn.host ?? '')) {
    throw new Error(
      `Refusing to run e2e tests against ${conn.host}:${conn.port}/${conn.name} — only the in-memory test server is allowed`,
    );
  }
}
