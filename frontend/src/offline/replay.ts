/**
 * Replay engine — ticket B5.
 *
 * Drains the write queue to the server, in order, exactly once each.
 *
 * ## Why it replays in strict order, and stops on a hard failure
 *
 * Queued writes have dependencies: an encounter references a patient created
 * three entries earlier. Replaying out of order, or skipping a failed entry
 * and carrying on, would send the encounter to a server that has never heard
 * of the patient — turning one bad record into a cascade of them.
 *
 * So a permanent failure **halts the drain**. The failed entry and everything
 * behind it stay queued, and the failure surface (E3) asks a human what to do.
 * That is deliberately conservative: a stalled queue is recoverable, a
 * half-applied one is not.
 *
 * ## Why re-sending is safe
 *
 * Every create carries a client-minted `_id` (A1). If a previous attempt
 * actually landed before the connection dropped, the server answers 409 with
 * `code: "CLIENT_ID_EXISTS"` — which this engine treats as success, because
 * that is exactly what it means. Payments have the same property via their
 * `idempotencyKey`, which predates this work.
 */
import { isOnline, isNetworkFailure } from './connectivity';
import { getMeta, setMeta } from './db';
import {
  listPending,
  markDone,
  markFailed,
  markInflight,
  markRetryable,
  recoverInflight,
  type QueueEntry,
} from './queue';
import type { DevContext } from '../app/context';

/** Server code meaning "this create already landed" — see A1. */
const CLIENT_ID_EXISTS = 'CLIENT_ID_EXISTS';

const CHECKPOINT_KEY = 'replay.lastAppliedSeq';
const MAX_RETRYABLE_ATTEMPTS = 5;

export const REPLAY_PROGRESS_EVENT = 'digirx:replay-progress';

export type ReplayOutcome = {
  applied: number;
  /** Already present server-side — a previous attempt had landed. */
  alreadyApplied: number;
  failed: number;
  /** True when the drain stopped early because the connection dropped. */
  interrupted: boolean;
  /** Set when a hard failure halted the drain. */
  haltedAt?: { seq: number; reason: string };
};

/**
 * What a *server response* means. Being unreachable is not in here — that is
 * decided in `send`, before there is any response to classify.
 */
type Classification =
  | { kind: 'ok' }
  | { kind: 'already-applied' }
  | { kind: 'retry'; reason: string; status?: number }
  | { kind: 'permanent'; reason: string; status?: number };

/**
 * Decide what a response means for a queued write.
 *
 * Pure and exported so the decision table can be reasoned about — and tested,
 * once this project has a frontend test runner.
 */
export function classifyResponse(status: number, body: unknown): Classification {
  if (status >= 200 && status < 300) return { kind: 'ok' };

  const parsed = body as { code?: string; message?: string } | null;

  // The write already landed. Not an error — the point of client-minted ids.
  if (status === 409 && parsed?.code === CLIENT_ID_EXISTS) {
    return { kind: 'already-applied' };
  }

  // 408/429 and 5xx are transient: the server is there but struggling.
  if (status === 408 || status === 429 || status >= 500) {
    return {
      kind: 'retry',
      reason: parsed?.message ?? `HTTP ${status}`,
      status,
    };
  }

  // 401 is its own thing: the session died while we were queued. Retrying
  // will not help until the user signs in again, but the work is not wrong —
  // so it is retryable rather than permanently failed.
  if (status === 401 || status === 403) {
    return {
      kind: 'retry',
      reason: 'Sign-in required before this can sync.',
      status,
    };
  }

  // Everything else — 400 validation, 404 missing parent, 409 for a real
  // conflict — will fail identically on every retry. A human has to look.
  return {
    kind: 'permanent',
    reason: parsed?.message ?? `HTTP ${status}`,
    status,
  };
}

function emitProgress(detail: { remaining: number; entry?: QueueEntry }): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(REPLAY_PROGRESS_EVENT, { detail }));
}

/**
 * Send one queued entry. Kept separate from `apiFetch` on purpose: replay must
 * not inherit the 401-refresh-and-retry dance, must not touch the session, and
 * must see the raw status rather than a thrown Error.
 */
async function send(
  ctx: DevContext,
  entry: QueueEntry,
): Promise<{ status: number; body: unknown } | { offline: true }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-device-id': entry.deviceId,
  };
  if (ctx.accessToken) headers['Authorization'] = `Bearer ${ctx.accessToken}`;
  if (entry.clinicId) headers['x-clinic-id'] = entry.clinicId;
  if (ctx.branchId) headers['x-branch-id'] = ctx.branchId;
  if (!ctx.accessToken && ctx.userId) headers['x-user-id'] = ctx.userId;

  let res: Response;
  try {
    res = await fetch(`${ctx.apiBaseUrl}${entry.path}`, {
      method: entry.method,
      credentials: 'include',
      headers,
      body: entry.body === undefined ? undefined : JSON.stringify(entry.body),
    });
  } catch (err) {
    if (isNetworkFailure(err)) return { offline: true };
    throw err;
  }

  let body: unknown = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body; the status alone decides.
  }
  return { status: res.status, body };
}

let draining = false;

/** Name of the cross-tab lock. Scoped per clinic so two clinics on one
 *  machine do not block each other. */
const LOCK_NAME = (clinicId: string) => `digirx.replay.${clinicId}`;

/**
 * Run `fn` holding the cross-tab replay lock, or skip it entirely if another
 * tab already holds it.
 *
 * The in-process `draining` flag only guards *this* tab. Two open tabs each
 * had their own copy, so both drained the same queue at once: every entry
 * sent twice, with nothing but the server's idempotency to stop it becoming
 * duplicate records. That is relying on luck rather than design.
 *
 * `ifAvailable` means the second tab gives up immediately instead of queuing
 * behind the first — it has nothing useful to do, and the tab holding the
 * lock is already draining the same entries.
 *
 * Falls back to the in-process flag where Web Locks is unavailable (Safari
 * before 15.4, non-secure contexts), which is no worse than before.
 */
async function withReplayLock<T>(
  clinicId: string,
  fn: () => Promise<T>,
  skipped: T,
): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return await fn();

  let result = skipped;
  await locks.request(LOCK_NAME(clinicId), { ifAvailable: true }, async (lock) => {
    // A null lock means another tab holds it; leave the work to them.
    if (!lock) return;
    result = await fn();
  });
  return result;
}

/**
 * Drain the queue. Safe to call often — concurrent calls collapse into the
 * one already running, in this tab and across tabs, so a reconnect event and
 * a timer tick cannot double-send.
 */
export async function replayQueue(ctx: DevContext): Promise<ReplayOutcome> {
  const outcome: ReplayOutcome = {
    applied: 0,
    alreadyApplied: 0,
    failed: 0,
    interrupted: false,
  };
  if (draining) return outcome;
  if (!isOnline()) {
    outcome.interrupted = true;
    return outcome;
  }

  return await withReplayLock(
    ctx.clinicId,
    () => drain(ctx, outcome),
    outcome,
  );
}

/** The drain itself. Only ever called while holding the replay lock. */
async function drain(ctx: DevContext, outcome: ReplayOutcome): Promise<ReplayOutcome> {
  draining = true;
  try {
    await recoverInflight();
    const pending = await listPending(ctx.clinicId);

    for (const entry of pending) {
      if (!isOnline()) {
        outcome.interrupted = true;
        break;
      }

      await markInflight(entry.seq);
      const result = await send(ctx, entry);

      if ('offline' in result) {
        // Put it back and stop; nothing after this can succeed either.
        await markRetryable(entry.seq, 'Connection lost during sync');
        outcome.interrupted = true;
        break;
      }

      const verdict = classifyResponse(result.status, result.body);

      if (verdict.kind === 'ok' || verdict.kind === 'already-applied') {
        await markDone(entry.seq);
        await setMeta(CHECKPOINT_KEY, entry.seq);
        if (verdict.kind === 'ok') outcome.applied++;
        else outcome.alreadyApplied++;
        emitProgress({ remaining: pending.length - outcome.applied - outcome.alreadyApplied });
        continue;
      }

      if (verdict.kind === 'retry') {
        if (entry.attempts + 1 >= MAX_RETRYABLE_ATTEMPTS) {
          // Stop calling it transient after enough identical failures —
          // otherwise a permanently sick endpoint spins forever and the user
          // is never told.
          await markFailed(
            entry.seq,
            `${verdict.reason} (gave up after ${entry.attempts + 1} attempts)`,
            verdict.status,
          );
          outcome.failed++;
          outcome.haltedAt = { seq: entry.seq, reason: verdict.reason };
          break;
        }
        await markRetryable(entry.seq, verdict.reason, verdict.status);
        outcome.haltedAt = { seq: entry.seq, reason: verdict.reason };
        break;
      }

      // Permanent. Halt — see the header comment on ordering.
      await markFailed(entry.seq, verdict.reason, verdict.status);
      outcome.failed++;
      outcome.haltedAt = { seq: entry.seq, reason: verdict.reason };
      break;
    }
  } finally {
    draining = false;
  }

  emitProgress({ remaining: (await listPending(ctx.clinicId)).length });
  return outcome;
}

/** The highest `seq` confirmed applied, for diagnostics. */
export async function lastAppliedSeq(): Promise<number | undefined> {
  return await getMeta<number>(CHECKPOINT_KEY);
}

export function isDraining(): boolean {
  return draining;
}
