/**
 * Working set — tickets B2 and B6.
 *
 * Defines *which* server data a device keeps locally, pulls it while online,
 * and maps an API path onto the cache so reads can fall back when offline.
 *
 * ## Why a whitelist and not "cache everything"
 *
 * A clinic's full history is far too large for a tablet, and most of it is
 * never looked at offline. The working set is deliberately the smallest thing
 * that lets a doctor finish a day: today's and tomorrow's schedule, the
 * patients attached to it, and the reference data needed to write an
 * encounter, a prescription and a bill.
 *
 * Anything not listed here simply fails offline, visibly, which is far better
 * than silently showing a stale half-answer.
 *
 * ## Read-through without touching screens
 *
 * `matchCacheable` maps a GET path to a collection. `api.ts` consults it, so
 * every screen gets local-first reads with no per-screen change — which also
 * means no fifteen-file refactor to review.
 */
import { clearCollection, getMeta, listRecords, putRecords, setMeta } from './db';
import type { DevContext } from '../app/context';

export type WorkingSetEntry = {
  collection: string;
  /** API path to pull, relative to the base URL. `{today}` / `{tomorrow}` are
   *  substituted with clinic-local dates. */
  path: string;
  /** How stale a cached copy may be before a refresh is attempted, in ms. */
  maxAgeMs: number;
  /** Where the array of documents lives in the response body. */
  itemsAt?: string;
};

const HOUR = 60 * 60 * 1000;

/**
 * The manifest. Sized for a single clinic day plus reference data.
 *
 * NOTE: this is tuned for an outage measured in hours-to-days, which is the
 * assumption open question 2 in the plan has not yet settled. If real outages
 * run a week, the appointment window and patient slice both need widening.
 */
export const WORKING_SET: WorkingSetEntry[] = [
  // The day's work. Widest window we can justify caching eagerly.
  { collection: 'appointments', path: '/appointments?date={today}', maxAgeMs: 5 * 60_000 },
  { collection: 'appointments', path: '/appointments?date={tomorrow}', maxAgeMs: HOUR },
  // Patients seen recently — the ones most likely to walk back in.
  { collection: 'patients', path: '/patients?limit=200', maxAgeMs: HOUR },
  // Reference data. Changes rarely; cheap to hold.
  { collection: 'visit-types', path: '/visit-types', maxAgeMs: 12 * HOUR },
  { collection: 'services', path: '/billing/services', maxAgeMs: 12 * HOUR },
  { collection: 'medicines', path: '/medicines', maxAgeMs: 12 * HOUR },
];

const SYNCED_AT = (collection: string, path: string) => `ws.syncedAt:${collection}:${path}`;

function todayInTz(tz: string | undefined, offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  try {
    return new Intl.DateTimeFormat('en-CA', tz ? { timeZone: tz } : undefined).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(d);
  }
}

export function resolvePath(path: string, ctx: DevContext): string {
  return path
    .replace('{today}', todayInTz(ctx.timezone))
    .replace('{tomorrow}', todayInTz(ctx.timezone, 1));
}

/** Pull the documents out of whatever envelope the endpoint uses. */
export function extractItems(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  if (body && typeof body === 'object') {
    for (const key of ['items', 'data', 'results', 'rows']) {
      const v = (body as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
    }
  }
  return [];
}

export type SyncReport = {
  collection: string;
  path: string;
  ok: boolean;
  count?: number;
  error?: string;
};

/**
 * Refresh the working set. Each entry is independent: one failing endpoint
 * must not stop the rest, because a device that syncs four of six collections
 * is strictly better off than one that syncs none.
 */
export async function syncWorkingSet(
  ctx: DevContext,
  fetchJson: (path: string) => Promise<unknown>,
  opts: { force?: boolean } = {},
): Promise<SyncReport[]> {
  const reports: SyncReport[] = [];
  if (!ctx.clinicId) return reports;

  for (const entry of WORKING_SET) {
    const resolved = resolvePath(entry.path, ctx);
    const key = SYNCED_AT(entry.collection, entry.path);
    try {
      if (!opts.force) {
        const last = await getMeta<number>(key);
        if (last && Date.now() - last < entry.maxAgeMs) {
          reports.push({ collection: entry.collection, path: resolved, ok: true });
          continue;
        }
      }
      const body = await fetchJson(resolved);
      const items = extractItems(body);
      const count = await putRecords(ctx.clinicId, entry.collection, items);
      await setMeta(key, Date.now());
      reports.push({ collection: entry.collection, path: resolved, ok: true, count });
    } catch (err) {
      reports.push({
        collection: entry.collection,
        path: resolved,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return reports;
}

// ------------------------------------------------------- read-through (B6)

/**
 * GET paths that may be served from cache when offline, mapped to the
 * collection holding them. Order matters: the first match wins, so more
 * specific patterns come first.
 */
const CACHEABLE: Array<{ re: RegExp; collection: string; single?: boolean }> = [
  { re: /^\/patients\/([a-f0-9]{24})(?:\?|$)/i, collection: 'patients', single: true },
  { re: /^\/patients(?:\?|$)/, collection: 'patients' },
  { re: /^\/appointments\/([a-f0-9]{24})(?:\?|$)/i, collection: 'appointments', single: true },
  { re: /^\/appointments(?:\?|$)/, collection: 'appointments' },
  { re: /^\/encounters\/([a-f0-9]{24})(?:\?|$)/i, collection: 'encounters', single: true },
  { re: /^\/encounters(?:\?|$)/, collection: 'encounters' },
  { re: /^\/prescriptions\/([a-f0-9]{24})(?:\?|$)/i, collection: 'prescriptions', single: true },
  { re: /^\/visit-types(?:\?|$)/, collection: 'visit-types' },
  { re: /^\/billing\/services(?:\?|$)/, collection: 'services' },
  { re: /^\/medicines(?:\?|$)/, collection: 'medicines' },
];

export type CacheMatch = { collection: string; id?: string };

export function matchCacheable(path: string): CacheMatch | null {
  for (const rule of CACHEABLE) {
    const m = rule.re.exec(path);
    if (m) return { collection: rule.collection, id: rule.single ? m[1] : undefined };
  }
  return null;
}

/**
 * Cache whatever a successful GET returned, so the same path works offline
 * later. Failures here are swallowed: a cache write must never break a
 * request that already succeeded.
 */
export async function cacheResponse(
  clinicId: string,
  match: CacheMatch,
  body: unknown,
): Promise<void> {
  try {
    const docs = match.id
      ? [body as Record<string, unknown>]
      : extractItems(body);
    if (docs.length) await putRecords(clinicId, match.collection, docs);
  } catch {
    // ignore
  }
}

/**
 * Serve a GET from cache. Returns `undefined` when there is nothing cached,
 * which the caller must treat as a real offline error rather than an empty
 * result — showing an empty patient list offline would look like data loss.
 */
export async function readFromCache(
  clinicId: string,
  match: CacheMatch,
): Promise<unknown | undefined> {
  try {
    if (match.id) {
      const rows = await listRecords(clinicId, match.collection);
      return rows.find((r) => r.id === match.id)?.doc;
    }
    const rows = await listRecords(clinicId, match.collection);
    if (!rows.length) return undefined;
    // Newest first, matching what list endpoints generally return.
    return rows.sort((a, b) => b.cachedAt - a.cachedAt).map((r) => r.doc);
  } catch {
    return undefined;
  }
}

/** Wipe cached documents for a collection — used when a pull replaces them. */
export async function invalidate(clinicId: string, collection: string): Promise<void> {
  await clearCollection(clinicId, collection);
}

export async function lastSyncedAt(
  collection: string,
  path: string,
): Promise<number | undefined> {
  return await getMeta<number>(SYNCED_AT(collection, path));
}
