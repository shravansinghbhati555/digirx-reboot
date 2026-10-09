import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPostQueued } from '../app/api';
import { listAll } from './queue';
import { STORE_QUEUE, openDb } from './db';
import type { DevContext } from '../app/context';

/**
 * What actually reaches the server on replay.
 *
 * A queued body is not sent until reconnect, so a body the server will reject
 * is invisible until the worst possible moment — and because a 4xx is a
 * *permanent* failure, it does not just lose that one write, it halts the
 * whole queue behind it.
 *
 * This bit us for real: `apiPostQueued` minted an `_id` into every POST,
 * including action endpoints like `/bills/:id/issue` and
 * `/bills/:id/payments`, whose DTOs do not declare `_id`. With
 * `forbidNonWhitelisted` that is a 400, so the first offline bill would have
 * frozen an entire day of unsynced work.
 */

const CLINIC = '507f1f77bcf86cd799439011';

const ctx = {
  apiBaseUrl: 'http://localhost:4000',
  clinicId: CLINIC,
  branchId: '507f1f77bcf86cd799439012',
  userId: '507f1f77bcf86cd799439013',
  accessToken: 'test-token',
} as DevContext;

async function wipe() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

beforeEach(async () => {
  await wipe();
  // A rejected fetch with a TypeError is exactly how the browser reports an
  // unreachable server, which is what pushes a write onto the queue.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
  // Keep the offline session inside its grace window so writes are allowed.
  localStorage.setItem(
    'digirx.devContext.v1',
    JSON.stringify({ ...ctx, sessionVerifiedAt: Date.now() }),
  );
});

describe('creates', () => {
  it('carry a client-minted _id so later writes can reference them', async () => {
    const { queued, data } = await apiPostQueued<{ _id: string }>(
      ctx,
      '/patients',
      { fullName: 'Ada Lovelace' },
    );

    expect(queued).toBe(true);
    expect(data._id).toMatch(/^[a-f0-9]{24}$/);

    const [entry] = await listAll(CLINIC);
    expect((entry.body as { _id?: string })._id).toBe(data._id);
    expect(entry.clientId).toBe(data._id);
  });

  it('keep an _id the caller already chose', async () => {
    const chosen = '507f1f77bcf86cd799439099';
    await apiPostQueued(ctx, '/patients', { _id: chosen, fullName: 'Ada' });
    const [entry] = await listAll(CLINIC);
    expect((entry.body as { _id?: string })._id).toBe(chosen);
  });
});

describe('action endpoints', () => {
  it.each([
    ['/appointments/507f1f77bcf86cd799439011/checkin'],
    ['/encounters/507f1f77bcf86cd799439011/sign'],
    ['/bills/507f1f77bcf86cd799439011/issue'],
    ['/bills/507f1f77bcf86cd799439011/payments'],
  ])('%s must not be given an _id', async (path) => {
    await apiPostQueued(ctx, path, {}, { mintId: false });

    const [entry] = await listAll(CLINIC);
    expect(entry.body).not.toHaveProperty('_id');
    expect(entry.clientId).toBeUndefined();
  });

  it('still carries the fields the endpoint does accept', async () => {
    await apiPostQueued(
      ctx,
      '/bills/507f1f77bcf86cd799439011/issue',
      {},
      { mintId: false, enrichOnQueue: async () => ({ billSeq: 42 }) },
    );

    const [entry] = await listAll(CLINIC);
    expect(entry.body).toEqual({ billSeq: 42 });
  });
});

describe('enrichOnQueue', () => {
  it('runs only when the write is actually queued', async () => {
    // A leased number is spent when drawn, so it must not be drawn for a
    // request that reached the server and had one minted for it anyway.
    const draw = vi.fn(async () => ({ mrnSeq: 101 }));

    await apiPostQueued(ctx, '/patients', { fullName: 'Ada' }, { enrichOnQueue: draw });
    expect(draw).toHaveBeenCalledTimes(1);

    // Now simulate the server being reachable.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ created: { _id: 'x' } }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    const draw2 = vi.fn(async () => ({ mrnSeq: 102 }));
    await apiPostQueued(ctx, '/patients', { fullName: 'Grace' }, { enrichOnQueue: draw2 });
    expect(draw2).not.toHaveBeenCalled();
  });
});

describe('localRecord', () => {
  it('never leaks server-side defaults into the request body', async () => {
    // `status` is stamped by the server and rejected by forbidNonWhitelisted
    // if sent, but the local copy needs it or status-gated UI disappears.
    const { data } = await apiPostQueued<{ status?: string }>(
      ctx,
      '/appointments',
      { type: 'QUEUE' },
      { localRecord: { status: 'BOOKED' } },
    );

    expect(data.status).toBe('BOOKED');
    const [entry] = await listAll(CLINIC);
    expect(entry.body).not.toHaveProperty('status');
  });
});
