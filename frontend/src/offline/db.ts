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
 */

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
  const db = await openDb();
  const tx = db.transaction(STORE_RECORDS, 'readwrite');
  const store = tx.objectStore(STORE_RECORDS);
  let written = 0;
  for (const doc of docs) {
    const id = String(doc?._id ?? doc?.id ?? '');
    if (!id) continue;
    const entry: CachedRecord = {
      key: recordKey(clinicId, collection, id),
      clinicId,
      collection,
      id,
      doc,
      cachedAt: now,
    };
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
  return await withStore(STORE_RECORDS, 'readonly', (s) =>
    promisify(s.get(recordKey(clinicId, collection, id))),
  );
}

export async function listRecords(
  clinicId: string,
  collection: string,
): Promise<CachedRecord[]> {
  return await withStore(STORE_RECORDS, 'readonly', (s) =>
    promisify(s.index('byCollection').getAll(IDBKeyRange.only([clinicId, collection]))),
  );
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
  return row?.value;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await withStore(STORE_META, 'readwrite', (s) => promisify(s.put({ key, value })));
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
