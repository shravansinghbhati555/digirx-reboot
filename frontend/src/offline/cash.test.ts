import { beforeEach, describe, expect, it } from 'vitest';
import { wipeOfflineStores } from './db';
import { enqueue, markDone } from './queue';
import { destroyVault } from './vault';
import { localDate, queuedCashFor } from './cash';

const CLINIC = '507f1f77bcf86cd799439011';
const TZ = 'Asia/Kolkata';

function pay(body: Record<string, unknown>, path = '/bills/b1/payments') {
  return enqueue({ clinicId: CLINIC, method: 'POST', path, body });
}

beforeEach(async () => {
  destroyVault();
  localStorage.clear();
  await wipeOfflineStores();
});

describe('queuedCashFor', () => {
  it('sums unsynced cash for the day', async () => {
    await pay({ method: 'CASH', amount: 500, paidAt: '2026-10-12T05:00:00Z' });
    await pay({ method: 'CASH', amount: 250.5, paidAt: '2026-10-12T09:00:00Z' });
    expect(await queuedCashFor(CLINIC, '2026-10-12', TZ)).toEqual({ amount: 750.5, count: 2 });
  });

  it('ignores non-cash, other days, other endpoints and synced entries', async () => {
    await pay({ method: 'UPI', amount: 100, paidAt: '2026-10-12T05:00:00Z' });
    await pay({ method: 'CASH', amount: 100, paidAt: '2026-10-13T05:00:00Z' });
    await pay({ method: 'CASH', amount: 100 }, '/bills');
    const synced = await pay({ method: 'CASH', amount: 100, paidAt: '2026-10-12T05:00:00Z' });
    await markDone(synced.seq);
    expect(await queuedCashFor(CLINIC, '2026-10-12', TZ)).toEqual({ amount: 0, count: 0 });
  });

  it('assigns the day in clinic time, not UTC', async () => {
    // 20:00 UTC on the 11th is 01:30 on the 12th in Kolkata.
    await pay({ method: 'CASH', amount: 300, paidAt: '2026-10-11T20:00:00Z' });
    expect((await queuedCashFor(CLINIC, '2026-10-12', TZ)).amount).toBe(300);
    expect((await queuedCashFor(CLINIC, '2026-10-11', TZ)).amount).toBe(0);
  });
});

describe('localDate', () => {
  it('formats as YYYY-MM-DD in the zone', () => {
    expect(localDate('2026-10-11T20:00:00Z', TZ)).toBe('2026-10-12');
  });
});
