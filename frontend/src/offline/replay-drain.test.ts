import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueue, listAll, markFailed, retryFailed } from './queue';
import { STORE_QUEUE, openDb } from './db';
import { markOnline } from './connectivity';
import { replayQueue } from './replay';
import type { DevContext } from '../app/context';

/**
 * Drain ordering. A failed entry must keep blocking everything queued after
 * it until a human retries or discards it — not just for the drain that
 * failed it. Before this, the next drain skipped the failed fee payment and
 * replayed the check-in behind it, which then failed on the unpaid bill.
 */

const CLINIC = '507f1f77bcf86cd799439011';
const ctx = { clinicId: CLINIC, apiBaseUrl: 'http://api.test' } as DevContext;

async function wipe() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const sent: string[] = [];

beforeEach(async () => {
  await wipe();
  sent.length = 0;
  markOnline();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    sent.push(url.replace(ctx.apiBaseUrl, ''));
    return new Response('{}', { status: 201 });
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('drain stops behind a failed entry', () => {
  it('does not send entries queued after a failed one', async () => {
    const before = await enqueue({ clinicId: CLINIC, method: 'POST', path: '/appointments', body: {} });
    const payment = await enqueue({ clinicId: CLINIC, method: 'POST', path: '/bills/b1/payments', body: {} });
    await enqueue({ clinicId: CLINIC, method: 'POST', path: '/appointments/a1/checkin', body: {} });
    await markFailed(payment.seq, 'Your role is not allowed to do this', 403);

    const out = await replayQueue(ctx);

    expect(sent).toEqual(['/appointments']);
    expect(out.haltedAt?.seq).toBe(payment.seq);
    const statuses = Object.fromEntries((await listAll(CLINIC)).map((e) => [e.path, e.status]));
    expect(statuses['/appointments']).toBe('done');
    expect(statuses['/appointments/a1/checkin']).toBe('pending');
    expect(before.seq).toBeLessThan(payment.seq);
  });

  it('carries on once the failed entry is retried', async () => {
    const payment = await enqueue({ clinicId: CLINIC, method: 'POST', path: '/bills/b1/payments', body: {} });
    await enqueue({ clinicId: CLINIC, method: 'POST', path: '/appointments/a1/checkin', body: {} });
    await markFailed(payment.seq, 'boom', 400);
    await retryFailed(payment.seq);

    await replayQueue(ctx);

    expect(sent).toEqual(['/bills/b1/payments', '/appointments/a1/checkin']);
  });
});
