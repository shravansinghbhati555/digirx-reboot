/**
 * Durable write queue — ticket B4.
 *
 * Holds mutations made while the server was unreachable, in the order they
 * were made, until replay confirms each one landed.
 *
 * **This store is the only copy of that work.** A queued encounter exists
 * nowhere else in the world. Nothing may clear an entry except a confirmed
 * sync or an explicit, user-acknowledged discard — not a logout, not a clinic
 * switch, not a failed PIN, not an expired offline session.
 *
 * Ordering is load-bearing. `seq` autoincrements, and replay walks it in
 * order, because a patient must exist before the encounter that references
 * it. A1's client-minted ids are what make that reference valid before either
 * document has reached the server.
 */
import { getDeviceId } from './device';
import { STORE_QUEUE, openDb } from './db';

export type QueueStatus =
  /** Waiting to be sent. */
  | 'pending'
  /** Handed to the replay engine. Reset to `pending` on reload — an entry
   *  stuck here means the tab died mid-flight, and the server either applied
   *  it (replay will see 409 CLIENT_ID_EXISTS) or did not. Either way,
   *  re-sending is safe. */
  | 'inflight'
  /** The server rejected it in a way retrying will not fix. Needs a human. */
  | 'failed'
  /** Confirmed applied server-side. */
  | 'done';

export type QueueEntry = {
  /** Autoincrement. The replay order, and never reused. */
  seq: number;
  clinicId: string;
  deviceId: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body: unknown;
  /** The client-minted `_id`, when this entry creates something. Lets replay
   *  recognise its own already-applied write. */
  clientId?: string;
  /** Human label for the failure surface, e.g. "Patient — Ada Lovelace". */
  label?: string;
  status: QueueStatus;
  attempts: number;
  createdAt: number;
  lastAttemptAt?: number;
  lastError?: string;
  /** HTTP status of the last attempt, when there was one. */
  lastStatus?: number;
};

export type NewQueueEntry = Omit<
  QueueEntry,
  'seq' | 'status' | 'attempts' | 'createdAt' | 'deviceId'
>;

function tx(mode: IDBTransactionMode) {
  return openDb().then((db) => db.transaction(STORE_QUEUE, mode).objectStore(STORE_QUEUE));
}

function done(store: IDBObjectStore): Promise<void> {
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () =>
      reject(store.transaction.error ?? new Error('queue transaction failed'));
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('queue request failed'));
  });
}

/** Append a mutation. Returns the stored entry, including its `seq`. */
export async function enqueue(entry: NewQueueEntry): Promise<QueueEntry> {
  const store = await tx('readwrite');
  const row = {
    ...entry,
    deviceId: getDeviceId(),
    status: 'pending' as const,
    attempts: 0,
    createdAt: Date.now(),
  };
  const seq = (await req(store.add(row as unknown as QueueEntry))) as unknown as number;
  await done(store);
  return { ...row, seq } as QueueEntry;
}

/** Every entry, oldest first. */
export async function listAll(clinicId?: string): Promise<QueueEntry[]> {
  const store = await tx('readonly');
  const all = await req<QueueEntry[]>(store.getAll());
  await done(store);
  return clinicId ? all.filter((e) => e.clinicId === clinicId) : all;
}

/** Entries still owed to the server, oldest first. */
export async function listPending(clinicId?: string): Promise<QueueEntry[]> {
  const all = await listAll(clinicId);
  return all.filter((e) => e.status === 'pending' || e.status === 'inflight');
}

export async function listFailed(clinicId?: string): Promise<QueueEntry[]> {
  const all = await listAll(clinicId);
  return all.filter((e) => e.status === 'failed');
}

export type QueueCounts = {
  pending: number;
  failed: number;
  done: number;
  total: number;
};

export async function counts(clinicId?: string): Promise<QueueCounts> {
  const all = await listAll(clinicId);
  return {
    pending: all.filter((e) => e.status === 'pending' || e.status === 'inflight').length,
    failed: all.filter((e) => e.status === 'failed').length,
    done: all.filter((e) => e.status === 'done').length,
    total: all.length,
  };
}

async function patch(seq: number, changes: Partial<QueueEntry>): Promise<void> {
  const store = await tx('readwrite');
  const existing = await req<QueueEntry | undefined>(store.get(seq));
  if (existing) store.put({ ...existing, ...changes });
  await done(store);
}

export const markInflight = (seq: number) =>
  patch(seq, { status: 'inflight', lastAttemptAt: Date.now() });

export const markDone = (seq: number) => patch(seq, { status: 'done', lastError: undefined });

export async function markFailed(
  seq: number,
  error: string,
  status?: number,
): Promise<void> {
  const store = await tx('readwrite');
  const existing = await req<QueueEntry | undefined>(store.get(seq));
  if (existing) {
    store.put({
      ...existing,
      status: 'failed',
      attempts: existing.attempts + 1,
      lastError: error,
      lastStatus: status,
      lastAttemptAt: Date.now(),
    });
  }
  await done(store);
}

export async function markRetryable(
  seq: number,
  error: string,
  status?: number,
): Promise<void> {
  const store = await tx('readwrite');
  const existing = await req<QueueEntry | undefined>(store.get(seq));
  if (existing) {
    store.put({
      ...existing,
      status: 'pending',
      attempts: existing.attempts + 1,
      lastError: error,
      lastStatus: status,
      lastAttemptAt: Date.now(),
    });
  }
  await done(store);
}

/**
 * Reset anything left `inflight` back to `pending`. Called once at startup:
 * an entry in that state means the tab closed mid-request, and we cannot know
 * whether the server applied it. Re-sending is safe because replay treats a
 * 409 `CLIENT_ID_EXISTS` as success — that is precisely why A1 exists.
 */
export async function recoverInflight(): Promise<number> {
  const store = await tx('readwrite');
  const all = await req<QueueEntry[]>(store.getAll());
  let recovered = 0;
  for (const e of all) {
    if (e.status === 'inflight') {
      store.put({ ...e, status: 'pending' });
      recovered++;
    }
  }
  await done(store);
  return recovered;
}

/**
 * Retry an entry the user parked in the failure surface.
 */
export const retryFailed = (seq: number) => patch(seq, { status: 'pending' });

/**
 * Permanently drop an entry. Only ever called from an explicit user action in
 * the failure surface (E3), after showing them exactly what is being thrown
 * away. Never call this automatically.
 */
export async function discard(seq: number): Promise<void> {
  const store = await tx('readwrite');
  store.delete(seq);
  await done(store);
}

/**
 * Remove entries already confirmed applied. Safe: `done` means the server
 * acknowledged it. Keeps a short tail so the UI can still show "12 items
 * synced" after a drain.
 */
export async function pruneDone(keepMs: number = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = Date.now() - keepMs;
  const store = await tx('readwrite');
  const all = await req<QueueEntry[]>(store.getAll());
  let pruned = 0;
  for (const e of all) {
    if (e.status === 'done' && (e.lastAttemptAt ?? e.createdAt) < cutoff) {
      store.delete(e.seq);
      pruned++;
    }
  }
  await done(store);
  return pruned;
}
