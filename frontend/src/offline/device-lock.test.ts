import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORE_QUEUE,
  STORE_RECORDS,
  getMeta,
  listRecords,
  openDb,
  putRecords,
  setMeta,
  wipeOfflineStores,
} from './db';
import { counts, enqueue, listAll, markDone } from './queue';
import { closeVault, destroyVault, isSealed, isVaultOpen } from './vault';
import {
  canResetDevice,
  recoverDevice,
  resetDevice,
  setupDevicePin,
  uploadPendingRecovery,
} from './device-lock';
import { isLocked, lock, resetLockState, verifyPin } from './pin';

/**
 * End to end over the storage layer: what actually lands in IndexedDB once a
 * PIN is set, and the setup / recovery / reset flows the lock screens call.
 */

const CLINIC = '507f1f77bcf86cd799439011';
const PIN = '482913';

async function rawRows<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return await new Promise<T[]>((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  destroyVault();
  localStorage.clear();
  resetLockState();
  await wipeOfflineStores();
});

describe('setupDevicePin', () => {
  it('encrypts records cached in plaintext before the PIN was set', async () => {
    await putRecords(CLINIC, 'patients', [{ _id: 'p1', fullName: 'Asha Verma' }]);
    const before = await rawRows<{ doc: unknown }>(STORE_RECORDS);
    expect(isSealed(before[0].doc)).toBe(false);

    await setupDevicePin(PIN);

    const after = await rawRows<{ doc: unknown }>(STORE_RECORDS);
    expect(isSealed(after[0].doc)).toBe(true);
    expect(JSON.stringify(after)).not.toContain('Asha');
    // And still readable through the normal path.
    const [rec] = await listRecords(CLINIC, 'patients');
    expect(rec.doc).toEqual({ _id: 'p1', fullName: 'Asha Verma' });
  });

  it('encrypts a queue entry written before the PIN, keeping its status readable', async () => {
    await enqueue({
      clinicId: CLINIC,
      method: 'POST',
      path: '/patients',
      body: { fullName: 'Asha Verma' },
      label: 'Patient — Asha Verma',
    });
    await setupDevicePin(PIN);

    const [row] = await rawRows<Record<string, unknown>>(STORE_QUEUE);
    expect(isSealed(row.body)).toBe(true);
    expect(isSealed(row.label)).toBe(true);
    expect(row.status).toBe('pending');
    expect(JSON.stringify(row)).not.toContain('Asha');
  });
});

describe('after setup', () => {
  beforeEach(async () => {
    await setupDevicePin(PIN);
  });

  it('seals new records, queue entries and meta at rest', async () => {
    await putRecords(CLINIC, 'patients', [{ _id: 'p2', fullName: 'Ravi Kumar' }]);
    await enqueue({ clinicId: CLINIC, method: 'POST', path: '/patients', body: { fullName: 'Ravi Kumar' }, label: 'Ravi Kumar' });
    await setMeta('resp:test', { fullName: 'Ravi Kumar' });

    const dump = JSON.stringify([
      await rawRows(STORE_RECORDS),
      await rawRows(STORE_QUEUE),
      await rawRows('meta'),
    ]);
    expect(dump).not.toContain('Ravi');
    expect(await getMeta('resp:test')).toEqual({ fullName: 'Ravi Kumar' });
    const [entry] = await listAll(CLINIC);
    expect(entry.body).toEqual({ fullName: 'Ravi Kumar' });
    expect(entry.label).toBe('Ravi Kumar');
  });

  it('counts the queue while locked, but will not read it', async () => {
    await enqueue({ clinicId: CLINIC, method: 'POST', path: '/patients', body: { a: 1 } });
    closeVault();
    expect((await counts(CLINIC)).pending).toBe(1);
    await expect(listAll(CLINIC)).rejects.toThrow(/locked/i);
  });

  it('is locked on a fresh launch until the PIN is entered', async () => {
    closeVault(); // what a page reload does
    expect(isLocked()).toBe(true);
    expect((await verifyPin('000000')).ok).toBe(false);
    expect((await verifyPin(PIN)).ok).toBe(true);
    expect(isVaultOpen()).toBe(true);
    expect(isLocked()).toBe(false);
  });

  it('an idle lock keeps the key, so background sync carries on', async () => {
    lock();
    expect(isLocked()).toBe(true);
    expect(isVaultOpen()).toBe(true);
  });

  it('backs off after repeated wrong PINs, without wiping anything', async () => {
    await enqueue({ clinicId: CLINIC, method: 'POST', path: '/patients', body: { a: 1 } });
    closeVault();
    let last;
    for (let i = 0; i < 5; i++) last = await verifyPin('000000');
    expect(last && !last.ok && last.blockedForMs).toBeGreaterThan(0);
    // Even the right PIN is refused during the backoff…
    expect((await verifyPin(PIN)).ok).toBe(false);
    // …and the queued work is untouched.
    expect((await counts(CLINIC)).pending).toBe(1);
  });
});

describe('unlock code upload', () => {
  it('sends the code once and forgets it after the server accepts', async () => {
    const code = await setupDevicePin(PIN, 'Front desk');
    const put = vi.fn().mockResolvedValue({ ok: true });

    expect(await uploadPendingRecovery(put)).toBe(true);
    expect(put).toHaveBeenCalledWith('/offline/devices/me/recovery-code', {
      recoveryCode: code,
      label: 'Front desk',
    });
    expect(await uploadPendingRecovery(put)).toBe(false);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('keeps the code queued when the upload fails', async () => {
    await setupDevicePin(PIN);
    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await uploadPendingRecovery(failing)).toBe(false);
    const ok = vi.fn().mockResolvedValue({ ok: true });
    expect(await uploadPendingRecovery(ok)).toBe(true);
  });
});

describe('recoverDevice', () => {
  it('sets a new PIN from the unlock code and queues the rotated code', async () => {
    const code = await setupDevicePin(PIN);
    await uploadPendingRecovery(vi.fn().mockResolvedValue({}));
    closeVault();

    const res = await recoverDevice(code, '777777');
    expect(res.ok).toBe(true);
    const put = vi.fn().mockResolvedValue({});
    await uploadPendingRecovery(put);
    expect(put.mock.calls[0][1].recoveryCode).toBe(res.ok && res.recoveryCode);
  });
});

describe('resetDevice', () => {
  it('refuses while work is waiting to sync', async () => {
    await setupDevicePin(PIN);
    await enqueue({ clinicId: CLINIC, method: 'POST', path: '/patients', body: { a: 1 } });
    closeVault();
    expect(await canResetDevice()).toBe(false);
    await expect(resetDevice()).rejects.toThrow(/not synced/i);
  });

  it('wipes everything once nothing is pending', async () => {
    await setupDevicePin(PIN);
    const e = await enqueue({ clinicId: CLINIC, method: 'POST', path: '/patients', body: { a: 1 } });
    await markDone(e.seq);
    closeVault();

    expect(await canResetDevice()).toBe(true);
    await resetDevice();
    expect(await rawRows(STORE_QUEUE)).toEqual([]);
    expect(isLocked()).toBe(false); // no PIN any more — setup runs next sign-in
  });
});
