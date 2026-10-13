/**
 * Client lease store — ticket C2.
 *
 * Holds the blocks of sequence numbers this device has been granted, hands
 * them out one at a time while offline, and tops up before they run dry.
 *
 * ## The rule that matters
 *
 * A drawn number is spent the moment it is handed out, whether or not the
 * record using it is ever saved. Re-issuing a number after a cancelled form
 * would risk two patients sharing an MRN, and a duplicate is far worse than
 * a gap — the same trade the server makes.
 *
 * ## Rendering
 *
 * The server sends `numberTemplate` with every token except `{seq}` already
 * resolved (`INV-MAIN-2026-{seq:08}`). The client only substitutes the
 * sequence, so it cannot drift from the server on branch codes, fiscal years
 * or clinic codes.
 */
import { getMeta, setMeta } from './db';
import { isOnline } from './connectivity';
import { lacksPermission } from './working-set';
import type { DevContext } from '../app/context';

export type LeaseCounterName = 'MRN' | 'PRESCRIPTION' | 'BILL';

export type StoredLease = {
  id: string;
  counter: LeaseCounterName;
  branchId?: string;
  fiscalYear?: string;
  blockStart: number;
  blockEnd: number;
  /** Next number this device will hand out. Local and authoritative offline. */
  cursor: number;
  numberTemplate: string;
  /** ISO string — the server's expiry for this block. */
  expiresAt: string;
  /**
   * ISO string — when the template's year or fiscal year rolls over (C7).
   * Past this the block would print a number the server will not agree with,
   * so drawing stops and the record gets a pending number instead.
   */
  validUntil?: string;
  /** Highest value already reported to the server, to avoid redundant calls. */
  reportedThrough: number;
};

const KEY = (clinicId: string, counter: LeaseCounterName) => `lease:${clinicId}:${counter}`;

/** Ask for a top-up once a block is this close to empty. */
const LOW_WATER = 10;

export async function getLease(
  clinicId: string,
  counter: LeaseCounterName,
): Promise<StoredLease | undefined> {
  return await getMeta<StoredLease>(KEY(clinicId, counter));
}

async function putLease(clinicId: string, lease: StoredLease): Promise<void> {
  await setMeta(KEY(clinicId, lease.counter), lease);
}

export function remaining(lease: StoredLease | undefined): number {
  if (!lease) return 0;
  return Math.max(0, lease.blockEnd - lease.cursor + 1);
}

/**
 * True when the server's lease window has passed. Online this triggers a
 * refill; offline it does **not** stop drawing — the numbers in the block are
 * still reserved for this device (`resolveLeasedNumber` ignores expiry), and
 * an outage that outlasts the lease must not stop the clinic registering
 * patients.
 */
export function isExpired(lease: StoredLease, now: number = Date.now()): boolean {
  return new Date(lease.expiresAt).getTime() <= now;
}

/** True once the block's year or fiscal year has rolled over (C7). */
export function isStale(lease: StoredLease, now: number = Date.now()): boolean {
  return lease.validUntil != null && new Date(lease.validUntil).getTime() <= now;
}

/** Render a sequence number through the server-supplied template. */
export function renderNumber(template: string, seq: number): string {
  return template.replace(/\{seq(?::(\d+))?\}/g, (_m, width?: string) =>
    String(seq).padStart(width ? Number(width) : 1, '0'),
  );
}

export type DrawResult =
  | { ok: true; seq: number; value: string }
  | { ok: false; reason: 'none' | 'exhausted' | 'stale' };

/**
 * Take the next number. Persists the advanced cursor **before** returning, so
 * a crash between drawing and saving loses the number rather than reusing it.
 */
export async function drawNumber(
  clinicId: string,
  counter: LeaseCounterName,
): Promise<DrawResult> {
  const lease = await getLease(clinicId, counter);
  if (!lease) return { ok: false, reason: 'none' };
  if (isStale(lease)) return { ok: false, reason: 'stale' };
  if (lease.cursor > lease.blockEnd) return { ok: false, reason: 'exhausted' };

  const seq = lease.cursor;
  await putLease(clinicId, { ...lease, cursor: seq + 1 });
  return { ok: true, seq, value: renderNumber(lease.numberTemplate, seq) };
}

type LeaseApi = {
  post: <T>(path: string, body: unknown) => Promise<T>;
};

type ServerLease = {
  id: string;
  counter: LeaseCounterName;
  branchId?: string;
  fiscalYear?: string;
  blockStart: number;
  blockEnd: number;
  usedThrough: number;
  expiresAt: string;
  numberTemplate: string;
  validUntil?: string;
};

function adopt(server: ServerLease, previous?: StoredLease): StoredLease {
  return {
    id: server.id,
    counter: server.counter,
    branchId: server.branchId,
    fiscalYear: server.fiscalYear,
    blockStart: server.blockStart,
    blockEnd: server.blockEnd,
    // Resume where we were if the server handed back the same block; a new
    // block starts at its own beginning.
    cursor:
      previous && previous.id === server.id
        ? Math.max(previous.cursor, server.blockStart)
        : server.blockStart,
    numberTemplate: server.numberTemplate,
    expiresAt: server.expiresAt,
    validUntil: server.validUntil,
    reportedThrough: server.usedThrough,
  };
}

/**
 * Make sure a usable block is on hand. Only acts while online — the whole
 * point is to be stocked up *before* the connection goes.
 *
 * Replaces a block that is expired, empty, or nearly empty.
 */
export async function ensureLease(
  ctx: DevContext,
  counter: LeaseCounterName,
  api: LeaseApi,
): Promise<StoredLease | undefined> {
  const existing = await getLease(ctx.clinicId, counter);
  if (!isOnline()) return existing;

  const needsTopUp =
    !existing ||
    isExpired(existing) ||
    isStale(existing) ||
    remaining(existing) <= LOW_WATER;
  if (!needsTopUp) return existing;

  try {
    // Tell the server how far we got first, so it can retire a spent block
    // instead of handing the same one back.
    if (existing && existing.cursor - 1 > existing.reportedThrough) {
      await api.post(`/offline/leases/${existing.id}/usage`, {
        usedThrough: existing.cursor - 1,
      });
    }
    const server = await api.post<ServerLease>('/offline/leases', {
      counter,
      ...(counter === 'BILL' && ctx.branchId ? { branchId: ctx.branchId } : {}),
    });
    const next = adopt(server, existing);
    await putLease(ctx.clinicId, next);
    return next;
  } catch {
    // A failed top-up is not fatal: we keep whatever block we already hold,
    // and try again on the next sync. Never let this break a screen.
    return existing;
  }
}

/** Counters a device should keep stocked for offline use. */
export const OFFLINE_COUNTERS: LeaseCounterName[] = ['MRN', 'PRESCRIPTION', 'BILL'];

/** Top up everything. Called from the background sync loop. */
export async function ensureAllLeases(ctx: DevContext, api: LeaseApi): Promise<void> {
  for (const counter of OFFLINE_COUNTERS) {
    // BILL leases are per branch; without one the server would reject it.
    if (counter === 'BILL' && !ctx.branchId) continue;
    // Bill numbers need billing:write server-side; asking anyway just 403s.
    if (counter === 'BILL' && lacksPermission(ctx, 'billing:write')) continue;
    await ensureLease(ctx, counter, api);
  }
}

/** Push local cursors back to the server after reconnecting. */
export async function reportLeaseUsage(ctx: DevContext, api: LeaseApi): Promise<void> {
  for (const counter of OFFLINE_COUNTERS) {
    const lease = await getLease(ctx.clinicId, counter);
    if (!lease) continue;
    const usedThrough = lease.cursor - 1;
    if (usedThrough <= lease.reportedThrough) continue;
    try {
      await api.post(`/offline/leases/${lease.id}/usage`, { usedThrough });
      await putLease(ctx.clinicId, { ...lease, reportedThrough: usedThrough });
    } catch {
      // Advisory only — the server catches up next time.
    }
  }
}

export type LeaseHealth = {
  counter: LeaseCounterName;
  remaining: number;
  expired: boolean;
  /** Past the year/FY boundary — new records get a pending number. */
  stale: boolean;
  /** True when this counter cannot currently be used offline. */
  unavailable: boolean;
};

/** For the UI: what can this device actually do without a connection? */
export async function leaseHealth(clinicId: string): Promise<LeaseHealth[]> {
  const out: LeaseHealth[] = [];
  for (const counter of OFFLINE_COUNTERS) {
    const lease = await getLease(clinicId, counter);
    const expired = lease ? isExpired(lease) : false;
    const stale = lease ? isStale(lease) : false;
    const left = remaining(lease);
    out.push({
      counter,
      remaining: left,
      expired,
      stale,
      unavailable: !lease || stale || left === 0,
    });
  }
  return out;
}
