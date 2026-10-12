import { beforeEach, describe, expect, it } from 'vitest';
import { putRecords, wipeOfflineStores } from './db';
import { destroyVault } from './vault';
import { applyQuery, cacheResponse, matchCacheable, readFromCache } from './working-set';
import { billSettlement } from './fees';

const CLINIC = '507f1f77bcf86cd799439011';
const TZ = 'Asia/Kolkata';
const B1 = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const DOC = 'dddddddddddddddddddddddd';

beforeEach(async () => {
  destroyVault();
  localStorage.clear();
  await wipeOfflineStores();
});

async function read(path: string) {
  const m = matchCacheable(path);
  if (!m) throw new Error(`not cacheable: ${path}`);
  return await readFromCache(CLINIC, m, TZ);
}

describe('offline list reads apply the query', () => {
  beforeEach(async () => {
    await putRecords(CLINIC, 'appointments', [
      { _id: 'a1', type: 'QUEUE', queueDate: '2026-10-12', status: 'BOOKED', branchId: B1, doctorId: DOC },
      // The appointment that leaked into "today" and failed check-in on sync.
      { _id: 'a2', type: 'QUEUE', queueDate: '2026-10-09', status: 'BOOKED', branchId: B1 },
      // 20:00 UTC on the 11th is the 12th in Kolkata.
      { _id: 'a3', type: 'TIME', startAt: '2026-10-11T20:00:00Z', status: 'CHECKED_IN', branchId: B1 },
      { _id: 'a4', type: 'QUEUE', queueDate: '2026-10-12', status: 'BOOKED', branchId: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
    ]);
  });

  it("only returns that day's appointments", async () => {
    const rows = (await read(`/appointments?branchId=${B1}&date=2026-10-12`)) as Array<{ _id: string }>;
    expect(rows.map((r) => r._id).sort()).toEqual(['a1', 'a3']);
  });

  it('filters on status, case-insensitively and comma-separated', async () => {
    const rows = (await read(`/appointments?date=2026-10-12&status=checked_in,in_progress`)) as Array<{ _id: string }>;
    expect(rows.map((r) => r._id)).toEqual(['a3']);
  });

  it('matches populated ids', async () => {
    await putRecords(CLINIC, 'appointments', [
      { _id: 'a5', queueDate: '2026-10-12', doctorId: { _id: DOC, name: 'Dr X' } },
      { _id: 'a6', queueDate: '2026-10-12', doctorId: { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', name: 'Dr Y' } },
    ]);
    const rows = (await read(`/appointments?date=2026-10-12&doctorId=${DOC}`)) as Array<{ _id: string }>;
    const ids = rows.map((r) => r._id);
    // Populated and plain ids both match; another doctor's does not. Records
    // with no doctorId at all (a3, a4) are kept rather than hidden.
    expect(ids).toEqual(expect.arrayContaining(['a1', 'a5']));
    expect(ids).not.toContain('a6');
  });

  it('a day with no appointments is empty, not "unknown"', async () => {
    expect(await read('/appointments?date=2026-10-20')).toEqual([]);
  });
});

describe('patients search offline', () => {
  it('matches name, MRN and phone digits', () => {
    const docs = [
      { _id: 'p1', fullName: 'Asha Verma', mrn: 'MRN-000101', phones: ['+91 98765 43210'] },
      { _id: 'p2', fullName: 'Ravi Kumar', mrn: 'MRN-000102', phones: ['9123456780'] },
    ];
    const q = (s: string) => applyQuery('patients', docs, new URLSearchParams(s)).map((d) => d._id);
    expect(q('query=asha')).toEqual(['p1']);
    expect(q('query=000102')).toEqual(['p2']);
    expect(q('query=98765')).toEqual(['p1']);
  });
});

describe('bills offline', () => {
  it('serves the bill list in the server envelope', async () => {
    await putRecords(CLINIC, 'bills', [
      { _id: 'b1', status: 'ISSUED', kind: 'SERVICE', createdAt: '2026-10-12T05:00:00Z', total: 500 },
      { _id: 'b2', status: 'PAID', kind: 'SERVICE', createdAt: '2026-10-12T06:00:00Z', total: 300 },
    ]);
    const out = (await read('/bills?kind=SERVICE&status=issued&date=2026-10-12')) as { rows: Array<{ _id: string }>; count: number };
    expect(out.rows.map((r) => r._id)).toEqual(['b1']);
    expect(out.count).toBe(1);
  });

  it("scopes cached payments to their bill", async () => {
    await cacheResponse(CLINIC, matchCacheable('/bills/aaaaaaaaaaaaaaaaaaaaaaa1/payments')!, [
      { _id: 'pay1', amount: 200 },
    ]);
    await cacheResponse(CLINIC, matchCacheable('/bills/aaaaaaaaaaaaaaaaaaaaaaa2/payments')!, [
      { _id: 'pay2', amount: 999 },
    ]);
    const rows = (await read('/bills/aaaaaaaaaaaaaaaaaaaaaaa1/payments')) as Array<{ _id: string }>;
    expect(rows.map((r) => r._id)).toEqual(['pay1']);
    // A bill with nothing cached has no payments as far as we know.
    expect(await read('/bills/aaaaaaaaaaaaaaaaaaaaaaa3/payments')).toEqual([]);
  });
});

describe('billSettlement', () => {
  it('is unknown when the bill is not cached', async () => {
    expect(await billSettlement(CLINIC, 'nope')).toEqual({ known: false });
  });

  it('counts cached payments, each once', async () => {
    await putRecords(CLINIC, 'bills', [{ _id: 'b1', status: 'ISSUED', total: 800, currency: 'INR' }]);
    await putRecords(CLINIC, 'payments', [
      { _id: 'local-1', billId: 'b1', amount: 500, idempotencyKey: 'k1' },
      // The same payment, as the server returned it after sync.
      { _id: 'server-1', billId: 'b1', amount: 500, idempotencyKey: 'k1' },
      { _id: 'other', billId: 'b2', amount: 800, idempotencyKey: 'k2' },
    ]);
    const s = await billSettlement(CLINIC, 'b1');
    expect(s).toEqual({ known: true, total: 800, paid: 500, outstanding: 300, currency: 'INR' });
  });

  it('a PAID bill is settled', async () => {
    await putRecords(CLINIC, 'bills', [{ _id: 'b1', status: 'PAID', total: 800 }]);
    const s = await billSettlement(CLINIC, 'b1');
    expect(s.known && s.outstanding).toBe(0);
  });
});
