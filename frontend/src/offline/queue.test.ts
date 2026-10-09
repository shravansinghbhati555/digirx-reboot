import { beforeEach, describe, expect, it } from 'vitest';
import {
  counts,
  discard,
  enqueue,
  listAll,
  listFailed,
  listPending,
  markDone,
  markFailed,
  markInflight,
  markRetryable,
  pruneDone,
  recoverInflight,
  retryFailed,
} from './queue';
import { STORE_QUEUE, openDb } from './db';

/**
 * The write queue is the only copy of work done offline. These tests run
 * against a real IndexedDB implementation (fake-indexeddb), not a mock, so
 * they exercise the same transaction and cursor paths the browser does.
 */

const CLINIC = '507f1f77bcf86cd799439011';

async function wipe() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function entry(overrides: Partial<Parameters<typeof enqueue>[0]> = {}) {
  return {
    clinicId: CLINIC,
    method: 'POST' as const,
    path: '/patients',
    body: { fullName: 'Ada' },
    ...overrides,
  };
}

beforeEach(wipe);

describe('ordering', () => {
  it('assigns increasing sequence numbers', async () => {
    const a = await enqueue(entry({ path: '/patients' }));
    const b = await enqueue(entry({ path: '/encounters' }));
    const c = await enqueue(entry({ path: '/bills' }));

    expect(a.seq).toBeLessThan(b.seq);
    expect(b.seq).toBeLessThan(c.seq);
  });

  it('lists oldest first, because replay depends on it', async () => {
    // A patient must be created before the encounter that references it.
    await enqueue(entry({ path: '/patients' }));
    await enqueue(entry({ path: '/encounters' }));

    const pending = await listPending(CLINIC);
    expect(pending.map((e) => e.path)).toEqual(['/patients', '/encounters']);
  });

  it('never reuses a sequence number after a discard', async () => {
    const a = await enqueue(entry());
    await discard(a.seq);
    const b = await enqueue(entry());
    expect(b.seq).toBeGreaterThan(a.seq);
  });
});

describe('tenancy', () => {
  it('does not leak another clinic\'s queued work', async () => {
    await enqueue(entry({ clinicId: CLINIC }));
    await enqueue(entry({ clinicId: '507f1f77bcf86cd799439099' }));

    const mine = await listPending(CLINIC);
    expect(mine).toHaveLength(1);
    expect(mine[0].clinicId).toBe(CLINIC);
  });
});

describe('status transitions', () => {
  it('starts pending with no attempts', async () => {
    const e = await enqueue(entry());
    expect(e.status).toBe('pending');
    expect(e.attempts).toBe(0);
  });

  it('marks done and drops out of pending', async () => {
    const e = await enqueue(entry());
    await markDone(e.seq);
    expect(await listPending(CLINIC)).toHaveLength(0);
    expect((await counts(CLINIC)).done).toBe(1);
  });

  it('counts a retryable failure as still pending', async () => {
    // The work is not lost — it goes back in line.
    const e = await enqueue(entry());
    await markRetryable(e.seq, 'Service unavailable', 503);

    const pending = await listPending(CLINIC);
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(1);
    expect(pending[0].lastStatus).toBe(503);
  });

  it('increments attempts across repeated retries', async () => {
    const e = await enqueue(entry());
    await markRetryable(e.seq, 'boom');
    await markRetryable(e.seq, 'boom');
    await markRetryable(e.seq, 'boom');
    expect((await listPending(CLINIC))[0].attempts).toBe(3);
  });

  it('moves a permanent failure out of pending and into failed', async () => {
    const e = await enqueue(entry());
    await markFailed(e.seq, 'phones must be 6 to 15 digits', 400);

    expect(await listPending(CLINIC)).toHaveLength(0);
    const failed = await listFailed(CLINIC);
    expect(failed).toHaveLength(1);
    expect(failed[0].lastError).toMatch(/phones/);
  });

  it('puts a failed entry back in line when retried by a human', async () => {
    const e = await enqueue(entry());
    await markFailed(e.seq, 'nope', 400);
    await retryFailed(e.seq);

    expect(await listFailed(CLINIC)).toHaveLength(0);
    expect(await listPending(CLINIC)).toHaveLength(1);
  });
});

describe('crash recovery', () => {
  it('returns inflight entries to pending on restart', async () => {
    // A tab that died mid-request leaves an entry stranded. Re-sending is
    // safe because replay treats CLIENT_ID_EXISTS as success.
    const e = await enqueue(entry());
    await markInflight(e.seq);
    expect(await listPending(CLINIC)).toHaveLength(1); // inflight still counts

    const recovered = await recoverInflight();
    expect(recovered).toBe(1);
    expect((await listAll(CLINIC))[0].status).toBe('pending');
  });

  it('leaves done and failed entries alone during recovery', async () => {
    const a = await enqueue(entry());
    const b = await enqueue(entry());
    await markDone(a.seq);
    await markFailed(b.seq, 'bad', 400);

    expect(await recoverInflight()).toBe(0);
  });
});

describe('pruning', () => {
  it('only ever removes confirmed-applied entries', async () => {
    const done = await enqueue(entry());
    await enqueue(entry());
    const failed = await enqueue(entry());
    await markDone(done.seq);
    await markFailed(failed.seq, 'bad', 400);

    // Everything is recent, so nothing should go yet.
    expect(await pruneDone(60_000)).toBe(0);

    // With a zero window the done entry is old enough; pending and failed
    // must survive regardless — losing those would lose real work.
    await pruneDone(-1);
    const remaining = await listAll(CLINIC);
    expect(remaining.map((e) => e.status).sort()).toEqual(['failed', 'pending']);
  });
});

describe('counts', () => {
  it('summarises the queue for the banner', async () => {
    const a = await enqueue(entry());
    const b = await enqueue(entry());
    await enqueue(entry());
    await markDone(a.seq);
    await markFailed(b.seq, 'bad', 400);

    expect(await counts(CLINIC)).toEqual({
      pending: 1,
      failed: 1,
      done: 1,
      total: 3,
    });
  });
});
