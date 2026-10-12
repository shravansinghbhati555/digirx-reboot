/**
 * IndexedDB storage for the offline layer — ticket B1.
 *
 * Three stores, each with a distinct job:
 *
 *   `records` — cached server documents, so screens can render without a
 *               network. Disposable: everything here can be re-fetched.
 *   `queue`   — writes made offline, waiting to reach the server. **Not
 *               disposable.** This is the only copy of that work, and nothing
 *               in this codebase may clear it except a confirmed sync.
 *   `meta`    — checkpoints and sync markers.
 *
 * Written against raw IndexedDB rather than a wrapper library: the sandbox has
 * no package manager available, and the surface we need is small enough that a
 * dependency would not earn its place.
 *
 * ## Encryption (P6)
 *
 * Record bodies (`doc`) and meta values are sealed with the device data key
 * from `vault.ts`; keys and index fields stay in the clear so lookups work.
 * Crypto is async and an IndexedDB transaction auto-commits as soon as it has
 * nothing pending, so every seal/unseal happens **outside** a transaction —
 * never await crypto between opening one and finishing with it.
 */
import { seal, unseal } from './vault';

const DB_NAME = 'digirx-offline';
const DB_VERSION = 1;

export const STORE_RECORDS = 'records';
export const STORE_QUEUE = 'queue';
export const STORE_META = 'meta';

/** A cached server document. */
export type CachedRecord = {
  /** `${clinicId}:${collection}:${id}` — clinic-scoped so a device used for
   *  two clinics never bleeds one into the other. */
  key: string;
  clinicId: string;
  collection: string;
  id: string;
  /** The document as the server returned it. */
  doc: unknown;
  /** Epoch ms this copy was cached. */
  cachedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        const s = db.createObjectStore(STORE_RECORDS, { keyPath: 'key' });
        s.createIndex('byCollection', ['clinicId', 'collection'], { unique: false });
        s.createIndex('byCachedAt', 'cachedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        // `seq` autoincrements, which is what gives the queue its ordering.
        // Replay depends on it: a patient must be created before the
        // encounter that references it.
        const q = db.createObjectStore(STORE_QUEUE, { keyPath: 'seq', autoIncrement: true });
        q.createIndex('byStatus', 'status', { unique: false });
        q.createIndex('byClinic', 'clinicId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(store, mode);
  const s = tx.objectStore(store);
  const out = fn(s);
  const result = out instanceof Promise ? await out : await promisify(out);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
  return result;
}

// --------------------------------------------------------------- records

export function recordKey(clinicId: string, collection: string, id: string): string {
  return `${clinicId}:${collection}:${id}`;
}

export async function putRecords(
  clinicId: string,
  collection: string,
  docs: Array<Record<string, unknown>>,
  now: number = Date.now(),
): Promise<number> {
  if (!docs.length) return 0;
  const entries: CachedRecord[] = [];
  for (const doc of docs) {
    const id = String(doc?._id ?? doc?.id ?? '');
    if (!id) continue;
    entries.push({
      key: recordKey(clinicId, collection, id),
      clinicId,
      collection,
      id,
      doc: await seal(doc),
      cachedAt: now,
    });
  }
  if (!entries.length) return 0;
  const db = await openDb();
  const tx = db.transaction(STORE_RECORDS, 'readwrite');
  const store = tx.objectStore(STORE_RECORDS);
  let written = 0;
  for (const entry of entries) {
    store.put(entry);
    written++;
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('putRecords failed'));
  });
  return written;
}

export async function getRecord(
  clinicId: string,
  collection: string,
  id: string,
): Promise<CachedRecord | undefined> {
  const row = await withStore<CachedRecord | undefined>(STORE_RECORDS, 'readonly', (s) =>
    promisify(s.get(recordKey(clinicId, collection, id))),
  );
  return row ? { ...row, doc: await unseal(row.doc) } : undefined;
}

export async function listRecords(
  clinicId: string,
  collection: string,
): Promise<CachedRecord[]> {
  const rows = await withStore<CachedRecord[]>(STORE_RECORDS, 'readonly', (s) =>
    promisify(s.index('byCollection').getAll(IDBKeyRange.only([clinicId, collection]))),
  );
  const out: CachedRecord[] = [];
  for (const row of rows) out.push({ ...row, doc: await unseal(row.doc) });
  return out;
}

export async function clearCollection(clinicId: string, collection: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_RECORDS, 'readwrite');
  const idx = tx.objectStore(STORE_RECORDS).index('byCollection');
  const req = idx.openKeyCursor(IDBKeyRange.only([clinicId, collection]));
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    tx.objectStore(STORE_RECORDS).delete(cursor.primaryKey);
    cursor.continue();
  };
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('clearCollection failed'));
  });
}

/**
 * Drop every cached record. Used when the device switches clinic, so one
 * tenant's data can never be read under another's context.
 *
 * Deliberately does **not** touch the queue — that may hold unsynced work,
 * and losing it is the one failure this whole phase exists to prevent. The
 * caller is responsible for draining or explicitly discarding it first.
 */
export async function clearAllRecords(): Promise<void> {
  await withStore(STORE_RECORDS, 'readwrite', (s) => promisify(s.clear()));
}

// ------------------------------------------------------------------ meta

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await withStore<{ key: string; value: T } | undefined>(
    STORE_META,
    'readonly',
    (s) => promisify(s.get(key)),
  );
  return row ? await unseal<T>(row.value) : undefined;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  const sealed = await seal(value);
  await withStore(STORE_META, 'readwrite', (s) => promisify(s.put({ key, value: sealed })));
}

export async function deleteMeta(key: string): Promise<void> {
  await withStore(STORE_META, 'readwrite', (s) => promisify(s.delete(key)));
}

// ------------------------------------------------------------ encryption

async function readAll<T>(store: string): Promise<T[]> {
  return await withStore<T[]>(store, 'readonly', (s) => promisify(s.getAll()));
}

async function putAll(store: string, rows: unknown[]): Promise<void> {
  if (!rows.length) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const row of rows) s.put(row);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('putAll failed'));
  });
}

/**
 * Encrypt, in place, anything written in plaintext before the PIN was set —
 * the short window between signing in and setting up the device. Called once,
 * right after the vault is created. Values already sealed are left alone, so
 * re-running is harmless.
 */
export async function sealExistingRows(): Promise<void> {
  const records = await readAll<CachedRecord>(STORE_RECORDS);
  const sealedRecords: CachedRecord[] = [];
  for (const r of records) {
    sealedRecords.push({ ...r, doc: await seal(await unseal(r.doc)) });
  }
  await putAll(STORE_RECORDS, sealedRecords);

  const meta = await readAll<{ key: string; value: unknown }>(STORE_META);
  const sealedMeta: Array<{ key: string; value: unknown }> = [];
  for (const m of meta) sealedMeta.push({ key: m.key, value: await seal(await unseal(m.value)) });
  await putAll(STORE_META, sealedMeta);

  const queue = await readAll<Record<string, unknown>>(STORE_QUEUE);
  const sealedQueue: Array<Record<string, unknown>> = [];
  for (const q of queue) {
    sealedQueue.push({
      ...q,
      body: await seal(await unseal(q.body)),
      label: await seal(await unseal(q.label)),
    });
  }
  await putAll(STORE_QUEUE, sealedQueue);
}

/**
 * Wipe every offline store. Only for an explicit device reset, when the PIN
 * and unlock code are both lost and nothing is waiting to sync — the caller
 * must check that first. Without the key the encrypted rows are unreadable
 * anyway; this just stops them taking up space.
 */
export async function wipeOfflineStores(): Promise<void> {
  for (const store of [STORE_RECORDS, STORE_QUEUE, STORE_META]) {
    await withStore(store, 'readwrite', (s) => promisify(s.clear()));
  }
}

/** True when IndexedDB is usable at all — private windows can refuse it. */
export async function isStorageAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- durability

/**
 * Ask the browser to make this origin's storage persistent.
 *
 * By default IndexedDB is "best effort": under storage pressure the browser
 * may evict the whole origin without warning. That is survivable for the
 * record cache, which is re-fetchable — but the write queue is the **only**
 * copy of work done offline. Losing it loses a morning of consultations.
 *
 * Chrome grants this silently to installed PWAs and engaged sites; Firefox
 * prompts; Safari ignores it. There is no way to force it, so the answer is
 * also reported so the UI can warn when durability was refused.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export type StorageHealth = {
  /** The browser has promised not to evict this origin. */
  persistent: boolean;
  usageBytes?: number;
  quotaBytes?: number;
  /** Fraction of quota used, 0–1, when the browser reports it. */
  usedFraction?: number;
  /** Close enough to the quota that writes could start failing. */
  nearlyFull: boolean;
};

export async function storageHealth(): Promise<StorageHealth> {
  const out: StorageHealth = { persistent: false, nearlyFull: false };
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) return out;
    out.persistent = (await navigator.storage.persisted?.()) ?? false;
    const est = await navigator.storage.estimate?.();
    if (est?.usage != null && est?.quota) {
      out.usageBytes = est.usage;
      out.quotaBytes = est.quota;
      out.usedFraction = est.usage / est.quota;
      out.nearlyFull = out.usedFraction > 0.9;
    }
  } catch {
    // Reporting is best-effort; never let it break startup.
  }
  return out;
}
