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
  /** API path to pull, relative to the base URL. `{today}`, `{tomorrow}` and
   *  `{today+N}` are substituted with clinic-local dates. */
  path: string;
  /** How stale a cached copy may be before a refresh is attempted, in ms. */
  maxAgeMs: number;
  /** Where the array of documents lives in the response body. */
  itemsAt?: string;
};

const HOUR = 60 * 60 * 1000;

/**
 * How many days of appointments to hold, today included. Outages typically
 * run ~2 days but can reach 5–7 (open question 2 in the plan), and a 7-day
 * outage spans eight calendar days only if it starts late — seven covers the
 * realistic worst case without pulling a month of bookings.
 */
export const APPOINTMENT_DAYS = 7;

/**
 * The manifest. Today's work, a week of upcoming bookings, and reference data.
 */
export const WORKING_SET: WorkingSetEntry[] = [
  // The day's work. Widest window we can justify caching eagerly.
  { collection: 'appointments', path: '/appointments?date={today}', maxAgeMs: 5 * 60_000 },
  { collection: 'appointments', path: '/appointments?date={tomorrow}', maxAgeMs: HOUR },
  // The rest of the week. Rarely opened, so refreshed lazily.
  ...Array.from({ length: APPOINTMENT_DAYS - 2 }, (_, i) => ({
    collection: 'appointments',
    path: `/appointments?date={today+${i + 2}}`,
    maxAgeMs: 6 * HOUR,
  })),
  // Patients seen recently — the ones most likely to walk back in.
  { collection: 'patients', path: '/patients?limit=200', maxAgeMs: HOUR },
  // Doctors. Without this the booking sheet has no names, so a booking
  // cannot even be composed offline.
  { collection: 'users', path: '/users', maxAgeMs: 6 * HOUR },
  // Reference data. Changes rarely; cheap to hold.
  { collection: 'visit-types', path: '/visit-types', maxAgeMs: 12 * HOUR },
  { collection: 'services', path: '/billing/services', maxAgeMs: 12 * HOUR },
  { collection: 'medicines', path: '/medicines', maxAgeMs: 12 * HOUR },
  // Bills. Check-in is refused until the consultation fee is paid, so offline
  // the device has to know each appointment's bill: today's, plus anything
  // still unpaid from earlier days (a patient booked last week and arriving
  // today).
  { collection: 'bills', path: '/bills?date={today}&limit=200', maxAgeMs: 5 * 60_000 },
  { collection: 'bills', path: '/bills?status=issued&limit=200', maxAgeMs: HOUR },
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
    .replace('{tomorrow}', todayInTz(ctx.timezone, 1))
    .replace(/\{today\+(\d+)\}/, (_m, n: string) => todayInTz(ctx.timezone, Number(n)));
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
const CACHEABLE: Array<{
  re: RegExp;
  collection: string;
  single?: boolean;
  /**
   * A list nested under a parent, e.g. `/bills/:id/payments`: the captured id
   * scopes the list to records whose `scopeField` equals it.
   */
  scopeField?: string;
  /** The list endpoint wraps its rows, e.g. `{ rows, count }` for `/bills`. */
  envelope?: 'rows';
  /**
   * Resolve the single document by matching a field against the captured
   * group instead of by `_id`. Needed for lookups keyed by something other
   * than the record's own id, e.g. `/encounters/by-appointment/:appointmentId`
   * — without this, triage cannot find the encounter it already created
   * offline and would create a second one.
   */
  matchField?: string;
}> = [
  {
    re: /^\/encounters\/by-appointment\/([a-f0-9]{24})(?:\?|$)/i,
    collection: 'encounters',
    single: true,
    matchField: 'appointmentId',
  },
  { re: /^\/patients\/([a-f0-9]{24})(?:\?|$)/i, collection: 'patients', single: true },
  { re: /^\/patients(?:\?|$)/, collection: 'patients' },
  { re: /^\/appointments\/([a-f0-9]{24})(?:\?|$)/i, collection: 'appointments', single: true },
  { re: /^\/appointments(?:\?|$)/, collection: 'appointments' },
  { re: /^\/encounters\/([a-f0-9]{24})(?:\?|$)/i, collection: 'encounters', single: true },
  { re: /^\/encounters(?:\?|$)/, collection: 'encounters' },
  { re: /^\/prescriptions\/([a-f0-9]{24})(?:\?|$)/i, collection: 'prescriptions', single: true },
  { re: /^\/bills\/([a-f0-9]{24})\/payments(?:\?|$)/i, collection: 'payments', scopeField: 'billId' },
  { re: /^\/bills\/([a-f0-9]{24})(?:\?|$)/i, collection: 'bills', single: true },
  { re: /^\/bills(?:\?|$)/, collection: 'bills', envelope: 'rows' },
  { re: /^\/visit-types(?:\?|$)/, collection: 'visit-types' },
  { re: /^\/billing\/services(?:\?|$)/, collection: 'services' },
  { re: /^\/medicines(?:\?|$)/, collection: 'medicines' },
];

export type CacheMatch = {
  collection: string;
  id?: string;
  /** Set when the id above names a field other than `_id` to match on. */
  matchField?: string;
  /** Nested list: only records whose `field` equals `value`. */
  scope?: { field: string; value: string };
  envelope?: 'rows';
  /** The request's query string — list reads apply it offline. */
  query?: URLSearchParams;
};

export function matchCacheable(path: string): CacheMatch | null {
  for (const rule of CACHEABLE) {
    const m = rule.re.exec(path);
    if (m) {
      const qIndex = path.indexOf('?');
      return {
        collection: rule.collection,
        id: rule.single ? m[1] : undefined,
        matchField: rule.matchField,
        scope: rule.scopeField ? { field: rule.scopeField, value: m[1] } : undefined,
        envelope: rule.envelope,
        query: qIndex >= 0 ? new URLSearchParams(path.slice(qIndex + 1)) : undefined,
      };
    }
  }
  return null;
}

/** `_id` of a field that may be a plain id or a populated document. */
function idOf(v: unknown): string {
  if (v && typeof v === 'object') return String((v as { _id?: unknown })._id ?? '');
  return v == null ? '' : String(v);
}

function dateIn(at: unknown, tz?: string): string | null {
  if (!at) return null;
  const d = new Date(at as string);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', tz ? { timeZone: tz } : undefined).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(d);
  }
}

const ID_FILTERS = ['branchId', 'doctorId', 'patientId', 'appointmentId', 'encounterId', 'billId'];

/**
 * Apply a list request's query to cached records, the way the server would.
 *
 * Without this an offline list returned **everything** cached for the
 * collection: "today's appointments" included every other cached day, so a
 * patient booked for last Thursday showed up in today's queue, was checked
 * in, and the check-in failed on sync. Only the filters the app actually
 * sends are understood; unknown parameters are ignored.
 */
export function applyQuery(
  collection: string,
  docs: Array<Record<string, unknown>>,
  query: URLSearchParams | undefined,
  tz?: string,
): Array<Record<string, unknown>> {
  if (!query) return docs;
  const zone = query.get('tz') || tz;
  let out = docs;

  for (const field of ID_FILTERS) {
    const want = query.get(field);
    if (!want) continue;
    // A record without the field is kept: an offline-created document may
    // simply not carry it, and dropping it would hide local work.
    out = out.filter((d) => d[field] === undefined || idOf(d[field]) === want);
  }

  const status = query.get('status');
  if (status) {
    const wanted = new Set(status.split(',').map((x) => x.trim().toUpperCase()));
    out = out.filter((d) => wanted.has(String(d.status ?? '').toUpperCase()));
  }

  const kind = query.get('kind');
  if (kind) out = out.filter((d) => d.kind === undefined || String(d.kind) === kind);

  const date = query.get('date');
  if (date) {
    out = out.filter((d) => {
      if (collection === 'appointments') {
        if (d.queueDate) return d.queueDate === date;
        return dateIn(d.startAt, zone) === date;
      }
      if (collection === 'bills') return dateIn(d.createdAt ?? d.issuedAt, zone) === date;
      return true;
    });
  }

  const search = (query.get('query') ?? query.get('q') ?? '').trim().toLowerCase();
  if (search && collection === 'patients') {
    const digits = search.replace(/\D/g, '');
    out = out.filter((d) => {
      if (String(d.fullName ?? '').toLowerCase().includes(search)) return true;
      if (String(d.mrn ?? '').toLowerCase().includes(search)) return true;
      if (digits.length >= 3) {
        const phones = Array.isArray(d.phones) ? d.phones : [];
        return phones.some((p) => String(p).replace(/\D/g, '').includes(digits));
      }
      return false;
    });
  }

  const limit = Number(query.get('limit'));
  if (Number.isFinite(limit) && limit > 0) out = out.slice(0, limit);
  return out;
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
    let docs = match.id
      ? [body as Record<string, unknown>]
      : extractItems(body);
    // Stamp the parent id on nested rows so the scoped read can find them.
    if (match.scope) {
      const { field, value } = match.scope;
      docs = docs.map((d) => (d[field] === undefined ? { ...d, [field]: value } : d));
    }
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
  tz?: string,
): Promise<unknown | undefined> {
  try {
    if (match.id) {
      const rows = await listRecords(clinicId, match.collection);
      if (match.matchField) {
        const field = match.matchField;
        return rows.find(
          (r) => String((r.doc as Record<string, unknown>)?.[field] ?? '') === match.id,
        )?.doc;
      }
      return rows.find((r) => r.id === match.id)?.doc;
    }
    const rows = await listRecords(clinicId, match.collection);
    // Nothing cached at all is "unknown", not "empty" — the caller reports
    // it as offline. A nested list (payments of one bill) is the exception:
    // a bill with no cached payments has, as far as this device knows, none.
    if (!rows.length && !match.scope) return undefined;
    // Newest first, matching what list endpoints generally return.
    let docs = rows
      .sort((a, b) => b.cachedAt - a.cachedAt)
      .map((r) => r.doc as Record<string, unknown>);
    if (match.scope) {
      const { field, value } = match.scope;
      docs = docs.filter((d) => idOf(d[field]) === value);
    }
    docs = applyQuery(match.collection, docs, match.query, tz);
    return match.envelope === 'rows'
      ? { rows: docs, count: docs.length, branchId: match.query?.get('branchId') ?? null }
      : docs;
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

/**
 * Merge a patch into one cached document.
 *
 * Queueing a request is not enough on its own: an action like check-in
 * changes state the *server* computes, so the cached record would still read
 * `BOOKED` and the UI would refuse to offer the next step. Offline, the
 * client has to apply the effect locally as well as queue the cause.
 *
 * Swallows failures — a cache write must never break a save that already
 * succeeded in being queued.
 */
export async function patchCachedRecord(
  clinicId: string,
  collection: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const rows = await listRecords(clinicId, collection);
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    await putRecords(clinicId, collection, [
      { ...(row.doc as Record<string, unknown>), ...patch },
    ]);
  } catch {
    // ignore
  }
}

/**
 * Next token number for a doctor's queue on a given day, derived from what
 * this device has cached (including appointments it queued earlier in the
 * same outage).
 *
 * **Relies on one writer per doctor.** Each doctor's queue is booked from one
 * device while offline (two tablets serving different doctors is fine — tokens
 * are per doctor per day), so the highest token it knows about is the highest
 * that exists. The
 * server honours the number we send (see `resolveQueueNumber`) so the token
 * on the patient's slip survives the sync, and the unique queue index is the
 * backstop if the assumption is ever violated.
 *
 * Deliberately NOT a lease: queue numbers restart daily and are read aloud in
 * the waiting room, so the gaps a leased block leaves behind would be glaring
 * — "Token 21" with three people waiting.
 */
export async function nextLocalQueueNumber(
  clinicId: string,
  doctorId: string,
  queueDate: string,
): Promise<number> {
  try {
    const rows = await listRecords(clinicId, 'appointments');
    let highest = 0;
    for (const row of rows) {
      const doc = row.doc as Record<string, unknown>;
      if (doc?.type !== 'QUEUE') continue;
      if (String(doc?.queueDate ?? '') !== queueDate) continue;
      const docDoctor = doc?.doctorId as { _id?: string } | string | undefined;
      const docDoctorId =
        typeof docDoctor === 'string' ? docDoctor : (docDoctor?._id ?? '');
      if (String(docDoctorId) !== doctorId) continue;
      const n = Number(doc?.queueNumber ?? 0);
      if (Number.isFinite(n) && n > highest) highest = n;
    }
    return highest + 1;
  } catch {
    // No cache to reason from. Returning 1 would risk colliding with a token
    // already issued today, so let the server assign instead.
    return 0;
  }
}

// ------------------------------------------------- response cache (B2/B6)

/**
 * Some GETs cannot go in the record cache because the response is not a set
 * of documents with ids — availability slots are computed per doctor per day,
 * not stored. Others are cheap lists where the exact query matters.
 *
 * These are cached verbatim, keyed by the full path, so offline they return
 * precisely what the same request returned when it last succeeded.
 */
const RESPONSE_CACHEABLE: RegExp[] = [
  // Doctor list — without it the booking sheet has no names to show.
  /^\/users(?:\?|$)/,
  // Computed availability. Query-dependent (doctor + date), so a
  // path-keyed cache is the only thing that can answer it correctly.
  /^\/appointments\/slots(?:\?|$)/,
  // Per-doctor visit types, including price — needed to book and to bill.
  /^\/visit-types(?:\?|$)/,
  // Day-end cash summary (C6): the server's expected figure as of the last
  // successful fetch, which the device adds its unsynced cash to offline.
  /^\/cash-days(?:\?|$)/,
];

export function isResponseCacheable(path: string): boolean {
  return RESPONSE_CACHEABLE.some((re) => re.test(path));
}

/**
 * Query parameter order is an accident of however the caller built the
 * string, so the raw path is a fragile cache key: `?a=1&b=2` and `?b=2&a=1`
 * are the same request but would miss each other. Sorting makes the key
 * depend on meaning rather than spelling.
 */
function normalizePath(path: string): string {
  const [base, query] = path.split('?');
  if (!query) return base;
  const params = Array.from(new URLSearchParams(query).entries()).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `${base}?${params.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

const RESP_KEY = (clinicId: string, path: string) =>
  `resp:${clinicId}:${normalizePath(path)}`;

export async function cacheResponseBody(
  clinicId: string,
  path: string,
  body: unknown,
): Promise<void> {
  try {
    await setMeta(RESP_KEY(clinicId, path), { body, cachedAt: Date.now() });
  } catch {
    // ignore
  }
}

export async function readResponseBody(
  clinicId: string,
  path: string,
): Promise<unknown | undefined> {
  try {
    const row = await getMeta<{ body: unknown; cachedAt: number }>(
      RESP_KEY(clinicId, path),
    );
    return row?.body;
  } catch {
    return undefined;
  }
}

/**
 * Warm the availability slots for each doctor, for today and tomorrow.
 *
 * Slots are computed server-side from the doctor's weekly rules and
 * overrides, so there is nothing in the record cache that can reconstruct
 * them. Prefetching the combinations the front desk is actually likely to
 * book means the slot picker still works once the connection goes.
 *
 * Bounded deliberately: doctors in the working set × 2 days. Anything wider
 * would spend a lot of requests on slots nobody opens.
 */
export async function prefetchSlots(
  ctx: DevContext,
  fetchJson: (path: string) => Promise<unknown>,
): Promise<number> {
  if (!ctx.clinicId || !ctx.branchId) return 0;
  let warmed = 0;
  try {
    const doctors = await listRecords(ctx.clinicId, 'users');
    const days = [todayInTz(ctx.timezone), todayInTz(ctx.timezone, 1)];
    for (const row of doctors) {
      const doc = row.doc as { _id?: string; roles?: Array<{ name?: string }> };
      const isDoctor = (doc.roles ?? []).some(
        (r) => (r?.name ?? '').toLowerCase() === 'doctor',
      );
      if (!isDoctor || !doc._id) continue;
      for (const date of days) {
        const path = `/appointments/slots?doctorId=${doc._id}&branchId=${ctx.branchId}&date=${date}`;
        try {
          const body = await fetchJson(path);
          await cacheResponseBody(ctx.clinicId, path, body);
          warmed++;
        } catch {
          // One doctor's slots failing must not stop the rest.
        }
      }
    }
  } catch {
    // No cached doctors yet; the next sync will try again.
  }
  return warmed;
}
