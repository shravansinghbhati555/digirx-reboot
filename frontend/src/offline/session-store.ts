/**
 * Persistence for the offline session stamps. Kept separate from
 * `session.ts` so the state machine there stays pure and testable.
 */
import { isLoggedIn, loadContext, saveContext } from '../app/context';
import { isOnline } from './connectivity';
import { evaluateOfflineSession, type OfflineSession } from './session';

/**
 * Writing to localStorage on every single request would be wasteful — a busy
 * screen fires a dozen. One stamp a minute is plenty: the grace window is
 * measured in days, so a minute of imprecision is irrelevant.
 */
const STAMP_THROTTLE_MS = 60_000;

let lastStampedAt = 0;

/**
 * Record that the server accepted an authenticated request. Called by
 * `api.ts` on every successful response — this is what keeps the grace
 * window topped up while the device is online.
 */
export function markSessionVerified(now: number = Date.now()): void {
  if (now - lastStampedAt < STAMP_THROTTLE_MS) return;
  const ctx = loadContext();
  // Nothing to vouch for if there is no session. Checked BEFORE claiming the
  // throttle slot — otherwise the login response burns it without stamping,
  // and the /me call that follows within the minute gets silently skipped.
  if (!ctx.clinicId) return;
  lastStampedAt = now;
  saveContext({ ...ctx, sessionVerifiedAt: now });
}

/**
 * Record that `/me` returned a fresh permission snapshot. Separate from
 * `markSessionVerified` because a successful request proves the session is
 * alive, while only `/me` proves the cached permissions are current.
 */
export function markPermissionsVerified(now: number = Date.now()): void {
  const ctx = loadContext();
  if (!ctx.clinicId) return;
  saveContext({ ...ctx, permissionsVerifiedAt: now, sessionVerifiedAt: now });
  lastStampedAt = now;
}

/** Current offline-session state, read from storage and live connectivity. */
export function readOfflineSession(now: number = Date.now()): OfflineSession {
  const ctx = loadContext();
  return evaluateOfflineSession({
    online: isOnline(),
    hasSession: isLoggedIn(ctx),
    verifiedAt: ctx.sessionVerifiedAt ?? null,
    permissionsAt: ctx.permissionsVerifiedAt ?? null,
    now,
  });
}

/** Reset the throttle. Used on login/logout so the next request re-stamps. */
export function resetSessionStampThrottle(): void {
  lastStampedAt = 0;
}
