import { beforeEach, describe, expect, it } from 'vitest';
import { drawNumber, isExpired, remaining, renderNumber, type StoredLease } from './leases';
import { setMeta } from './db';

/**
 * Leased sequence numbers.
 *
 * A drawn number is spent whether or not the record using it is ever saved.
 * Re-issuing one would risk two patients sharing an MRN, and a duplicate is
 * far worse than a gap — the same trade the server makes.
 */

const CLINIC = '507f1f77bcf86cd799439011';

function lease(overrides: Partial<StoredLease> = {}): StoredLease {
  return {
    id: 'lease-1',
    counter: 'MRN',
    blockStart: 101,
    blockEnd: 150,
    cursor: 101,
    numberTemplate: 'MRN-{seq:06}',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    reportedThrough: 100,
    ...overrides,
  };
}

async function store(l: StoredLease) {
  await setMeta(`lease:${CLINIC}:${l.counter}`, l);
}

beforeEach(async () => {
  // Each test installs its own lease; clear the three counters first.
  for (const c of ['MRN', 'PRESCRIPTION', 'BILL'] as const) {
    await setMeta(`lease:${CLINIC}:${c}`, undefined);
  }
});

describe('renderNumber', () => {
  it('pads to the width the server specified', () => {
    expect(renderNumber('MRN-{seq:06}', 42)).toBe('MRN-000042');
  });

  it('defaults to no padding when no width is given', () => {
    expect(renderNumber('RX-{seq}', 7)).toBe('RX-7');
  });

  it('leaves the pre-resolved parts of the template untouched', () => {
    // The server resolves branch code and fiscal year before sending, so the
    // client cannot drift from it.
    expect(renderNumber('INV-MAIN-2026-27-{seq:08}', 5)).toBe('INV-MAIN-2026-27-00000005');
  });
});

describe('drawNumber', () => {
  it('hands out the first number in the block', async () => {
    await store(lease());
    const drawn = await drawNumber(CLINIC, 'MRN');
    expect(drawn).toEqual({ ok: true, seq: 101, value: 'MRN-000101' });
  });

  it('never hands out the same number twice', async () => {
    await store(lease());
    const a = await drawNumber(CLINIC, 'MRN');
    const b = await drawNumber(CLINIC, 'MRN');
    const c = await drawNumber(CLINIC, 'MRN');

    expect([a, b, c].every((d) => d.ok)).toBe(true);
    const seqs = [a, b, c].map((d) => (d.ok ? d.seq : -1));
    expect(new Set(seqs).size).toBe(3);
    expect(seqs).toEqual([101, 102, 103]);
  });

  it('persists the cursor before returning, so a crash loses rather than reuses', async () => {
    await store(lease());
    await drawNumber(CLINIC, 'MRN');
    // A fresh read (as a reload would do) must not hand back 101 again.
    const next = await drawNumber(CLINIC, 'MRN');
    expect(next.ok && next.seq).toBe(102);
  });

  it('refuses once the block is used up', async () => {
    await store(lease({ cursor: 151 }));
    expect(await drawNumber(CLINIC, 'MRN')).toEqual({ ok: false, reason: 'exhausted' });
  });

  it('keeps drawing from an expired block — a long outage must not stop registration', async () => {
    await store(lease({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(await drawNumber(CLINIC, 'MRN')).toEqual({ ok: true, seq: 101, value: 'MRN-000101' });
  });

  it('stops at the year boundary so a printed number never disagrees with the server', async () => {
    await store(lease({ validUntil: new Date(Date.now() - 1000).toISOString() }));
    expect(await drawNumber(CLINIC, 'MRN')).toEqual({ ok: false, reason: 'stale' });
  });

  it('draws normally before the year boundary', async () => {
    await store(lease({ validUntil: new Date(Date.now() + 60_000).toISOString() }));
    const drawn = await drawNumber(CLINIC, 'MRN');
    expect(drawn.ok).toBe(true);
  });

  it('refuses when the device holds no lease at all', async () => {
    expect(await drawNumber(CLINIC, 'BILL')).toEqual({ ok: false, reason: 'none' });
  });

  it('keeps counters independent', async () => {
    await store(lease({ counter: 'MRN' }));
    await store(lease({ counter: 'PRESCRIPTION', id: 'lease-2', blockStart: 1, blockEnd: 10, cursor: 1, numberTemplate: 'RX-{seq:06}' }));

    const mrn = await drawNumber(CLINIC, 'MRN');
    const rx = await drawNumber(CLINIC, 'PRESCRIPTION');

    expect(mrn.ok && mrn.value).toBe('MRN-000101');
    expect(rx.ok && rx.value).toBe('RX-000001');
  });
});

describe('remaining', () => {
  it('counts what is left, inclusive of the cursor', () => {
    expect(remaining(lease({ cursor: 101 }))).toBe(50);
    expect(remaining(lease({ cursor: 150 }))).toBe(1);
    expect(remaining(lease({ cursor: 151 }))).toBe(0);
  });

  it('is zero without a lease', () => {
    expect(remaining(undefined)).toBe(0);
  });
});

describe('isExpired', () => {
  it('is true at and after the expiry instant', () => {
    const at = Date.now();
    const l = lease({ expiresAt: new Date(at).toISOString() });
    expect(isExpired(l, at)).toBe(true);
    expect(isExpired(l, at - 1)).toBe(false);
  });
});
