import type { DevContext } from './context';
import { clearContext, saveContext } from './context';
import { isNetworkFailure, isOfflineError, markOffline, markOnline, OfflineError } from '../offline/connectivity';
import { OfflineSessionExpiredError } from '../offline/session';
import { markSessionVerified, readOfflineSession } from '../offline/session-store';
import { getDeviceId } from '../offline/device';
import { newObjectId } from '../offline/ids';
import { enqueue } from '../offline/queue';
import { cacheResponse, matchCacheable, readFromCache } from '../offline/working-set';

export const AUTH_EXPIRED_EVENT = 'digirx:auth-expired';

/**
 * Reads are local-first when the server cannot be reached (B6).
 *
 * The fallback is wired here rather than per screen: `matchCacheable` decides
 * which paths have a cached equivalent, so every screen gains offline reads
 * without a fifteen-file refactor. Uncacheable paths still fail loudly, which
 * is correct — a stale half-answer is worse than a visible error.
 */
export async function apiGet<T>(ctx: DevContext, path: string): Promise<T> {
  const match = ctx.clinicId ? matchCacheable(path) : null;
  try {
    const out = await apiFetch<T>(ctx, path, { method: 'GET' });
    if (match) void cacheResponse(ctx.clinicId, match, out);
    return out;
  } catch (err) {
    if (!match || !isOfflineError(err)) throw err;
    const cached = await readFromCache(ctx.clinicId, match);
    // Nothing cached is NOT an empty result. Returning [] here would render
    // as "this patient has no appointments" rather than "we cannot reach the
    // server", which is exactly the kind of quiet lie this phase exists to
    // avoid.
    if (cached === undefined) throw err;
    return cached as T;
  }
}

export async function apiPost<T>(ctx: DevContext, path: string, body: unknown): Promise<T> {
  return await apiFetch<T>(ctx, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Multipart upload. Don't set Content-Type — the browser appends the
// correct multipart boundary automatically. Used by the face-recognition
// flow (and ready for any future image / file uploads).
export async function apiPostMultipart<T>(ctx: DevContext, path: string, form: FormData): Promise<T> {
  return await apiFetch<T>(ctx, path, {
    method: 'POST',
    body: form,
  });
}

export async function apiPut<T>(ctx: DevContext, path: string, body: unknown): Promise<T> {
  return await apiFetch<T>(ctx, path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiPatch<T>(ctx: DevContext, path: string, body: unknown = {}): Promise<T> {
  return await apiFetch<T>(ctx, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiDelete<T>(ctx: DevContext, path: string): Promise<T> {
  return await apiFetch<T>(ctx, path, { method: 'DELETE' });
}

export type QueuedResult<T> = {
  data: T;
  /** True when the server was unreachable and this is waiting in the queue. */
  queued: boolean;
};

/**
 * Create something that survives being offline (B4).
 *
 * Opt-in rather than automatic: a caller has to be ready to receive a record
 * the server has never seen. Screens that have not been adapted keep using
 * `apiPost` and keep failing loudly offline, which is the safe default.
 *
 * The `_id` is minted client-side before the request (A1), so the optimistic
 * record returned here carries the same id the server will eventually assign.
 * Anything created next can reference it immediately, and a replay of a write
 * that actually landed is recognised via `CLIENT_ID_EXISTS` instead of
 * creating a duplicate.
 */
export async function apiPostQueued<T>(
  ctx: DevContext,
  path: string,
  body: Record<string, unknown>,
  opts: { label?: string } = {},
): Promise<QueuedResult<T>> {
  const withId = { ...body, _id: (body._id as string) ?? newObjectId() };
  try {
    const data = await apiPost<T>(ctx, path, withId);
    return { data, queued: false };
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    await enqueue({
      clinicId: ctx.clinicId,
      method: 'POST',
      path,
      body: withId,
      clientId: withId._id as string,
      label: opts.label,
    });
    // Make it readable immediately — a patient registered offline has to show
    // up in the list the doctor is looking at, not vanish until sync.
    const match = matchCacheable(path);
    if (match) void cacheResponse(ctx.clinicId, match, [withId]);
    return { data: withId as T, queued: true };
  }
}

/** Update something that survives being offline. */
export async function apiPatchQueued<T>(
  ctx: DevContext,
  path: string,
  body: Record<string, unknown>,
  opts: { label?: string } = {},
): Promise<QueuedResult<T>> {
  try {
    const data = await apiPatch<T>(ctx, path, body);
    return { data, queued: false };
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    await enqueue({
      clinicId: ctx.clinicId,
      method: 'PATCH',
      path,
      body,
      label: opts.label,
    });
    return { data: body as T, queued: true };
  }
}

async function apiFetch<T>(
  ctx: DevContext,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: BodyInit },
  attempt: number = 0,
): Promise<T> {
  // A locked device stops accepting new work, but must never stop *trying* to
  // reach the server — a successful response is what re-stamps the session and
  // lifts the lock. So mutations are refused up front while reads still go out.
  // Blocking everything here would deadlock: no request, no re-stamp, no
  // recovery until the browser happened to fire an `online` event.
  //
  // `/auth/*` is exempt unconditionally. Signing in is a POST, so gating it
  // behind a valid session makes signing in impossible — you would need the
  // session you are trying to create. Logging in, refreshing and logging out
  // are how a device recovers, and must always be allowed through.
  const isAuthRoute = path.startsWith('/auth/');
  if (!isAuthRoute && init.method !== 'GET' && !readOfflineSession().canWrite) {
    throw new OfflineSessionExpiredError();
  }

  let res: Response;
  try {
    res = await fetch(`${ctx.apiBaseUrl}${path}`, {
      method: init.method,
      credentials: 'include',
      headers: { ...buildHeaders(ctx), ...(init.headers ?? {}) },
      body: init.body,
    });
  } catch (err) {
    // The request never reached the server. This is NOT an auth problem —
    // leave the session completely alone. Clearing it here would log the
    // user out every time the WiFi hiccups, and take the offline write
    // queue with it.
    if (isNetworkFailure(err)) {
      markOffline();
      throw new OfflineError();
    }
    throw err;
  }

  // The server answered, whatever it said.
  markOnline();
  // A non-401 response means this session is still accepted, which is what
  // the grace window is measured from. A 401 proves the opposite, so it must
  // not count — the refresh path below decides that case.
  if (res.status !== 401) markSessionVerified();

  if (res.status === 401) {
    if (attempt === 0) {
      const next = await sharedRefresh(ctx);
      if (next.status === 'ok') {
        ctx.accessToken = next.accessToken;
        saveContext(ctx);
        return await apiFetch<T>(ctx, path, init, 1);
      }
      if (next.status === 'offline') {
        // We got a 401 from the API but could not reach /auth/refresh to
        // find out whether the session is actually dead. Assume it is not.
        // A genuinely expired session will be caught on the next attempt
        // once the connection is back; wrongly logging out here is the
        // expensive mistake.
        throw new OfflineError();
      }
    }
    // The server explicitly refused the refresh, or this was already the
    // retry. Boot the user back to the login screen for any session — JWT
    // or dev-headers — so a single source of truth handles the
    // expired/revoked case. The event listener in AppContext clears the
    // in-memory context and navigates to /login.
    if (ctx.accessToken || ctx.userId) {
      clearContext();
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
      // Friendly message — the caller's catch will see this instead
      // of "401 Unauthorized" so toasts read naturally.
      throw new Error('Your session has expired. Please log in again.');
    }
  }

  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // fall through
    }
    const detail =
      parsed && typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? Array.isArray((parsed as { message: unknown }).message)
          ? ((parsed as { message: string[] }).message.join(', '))
          : String((parsed as { message: unknown }).message)
        : (text || `HTTP ${res.status}`);
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Why this is three cases and not a nullable token: a failed refresh used to
 * be indistinguishable from an unreachable one, and both logged the user out.
 * Only `unauthorized` may end the session.
 */
type RefreshResult =
  | { status: 'ok'; accessToken: string }
  | { status: 'unauthorized' }
  | { status: 'offline' };

// Concurrent 401s should produce one refresh round-trip, not N.
// Every caller awaits the same in-flight promise; once it resolves, the
// next 401 will start a fresh refresh.
let inFlightRefresh: Promise<RefreshResult> | null = null;

function sharedRefresh(ctx: DevContext): Promise<RefreshResult> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = refreshAccessToken(ctx).finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

async function refreshAccessToken(ctx: DevContext): Promise<RefreshResult> {
  let res: Response;
  try {
    res = await fetch(`${ctx.apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...buildHeaders(ctx), 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch (err) {
    if (isNetworkFailure(err)) {
      markOffline();
      return { status: 'offline' };
    }
    throw err;
  }

  markOnline();
  if (!res.ok) return { status: 'unauthorized' };

  const data = (await res.json()) as { accessToken?: string };
  // A 200 with no token is a server contract we cannot use — treat it as a
  // dead session rather than retrying forever.
  return data.accessToken
    ? { status: 'ok', accessToken: data.accessToken }
    : { status: 'unauthorized' };
}

function buildHeaders(ctx: DevContext) {
  const headers: Record<string, string> = {};
  // Identifies the originating device so a write entered offline stays
  // attributable once it finally syncs, and so number leases can be scoped
  // per device rather than per user.
  headers['x-device-id'] = getDeviceId();
  if (ctx.accessToken) headers['Authorization'] = `Bearer ${ctx.accessToken}`;
  if (ctx.clinicId) headers['x-clinic-id'] = ctx.clinicId;
  if (ctx.branchId) headers['x-branch-id'] = ctx.branchId;
  if (!ctx.accessToken && ctx.userId) headers['x-user-id'] = ctx.userId; // dev fallback
  return headers;
}
