/**
 * Offline session grace window.
 *
 * `JWT_ACCESS_TTL` expires on a wall clock, and offline there is no
 * `/auth/refresh` to call. A2 made sure an unreachable refresh no longer ends
 * the session — but "never expires while offline" is not an acceptable answer
 * either: that would let a device carrying a full patient database keep
 * working indefinitely with nobody able to revoke it.
 *
 * So an offline session is granted a bounded window, measured from the last
 * time the server actually confirmed this user. Inside the window the app
 * works from the cached permission snapshot. Outside it, the device locks.
 *
 * What locking does NOT do: clear the context, or discard queued work. A
 * locked device still holds everything it captured, and reconnecting restores
 * access to it. Destroying a morning's consultations because a token aged out
 * would be a far worse failure than refusing to start new ones.
 */

/**
 * How long a device may work offline after the last server-confirmed
 * request. Configurable because the right value depends on how long a
 * realistic outage runs — open question 2 in the implementation plan. The
 * 72-hour default is a placeholder chosen to cover a long weekend; revisit it
 * once we know the target clinics' connectivity cadence.
 */
export const OFFLINE_GRACE_MS = hoursFromEnv('VITE_OFFLINE_GRACE_HOURS', 72);

/** How long before expiry the UI should start warning. */
export const OFFLINE_WARN_MS = hoursFromEnv('VITE_OFFLINE_WARN_HOURS', 8);

function hoursFromEnv(key: string, fallbackHours: number): number {
  const raw = (import.meta.env as Record<string, string | undefined>)[key];
  const parsed = raw ? Number(raw) : NaN;
  const hours = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackHours;
  return hours * 60 * 60 * 1000;
}

export type OfflineSessionStatus =
  /** Online, or the server confirmed us just now. Business as usual. */
  | 'fresh'
  /** Offline, comfortably inside the grace window. */
  | 'grace'
  /** Offline and close to the edge — the UI should be nagging by now. */
  | 'expiring'
  /** Offline past the window. Locked until the device reconnects. */
  | 'expired';

export type OfflineSession = {
  status: OfflineSessionStatus;
  /** Epoch ms of the last server-confirmed request, if any. */
  verifiedAt: number | null;
  /** Epoch ms when the grace window closes. Null when online. */
  expiresAt: number | null;
  /** Milliseconds left in the window. Null when online. */
  msRemaining: number | null;
  /** May the app show locally cached clinical data? */
  canRead: boolean;
  /** May the app accept new work (queued or live)? */
  canWrite: boolean;
  /**
   * True when the cached permission snapshot is older than the grace window.
   * Advisory: permissions may have been changed server-side since.
   */
  permissionsStale: boolean;
};

/**
 * Pure evaluation — no storage, no clock beyond what is passed in, so the
 * whole state machine is testable without mocking anything.
 */
export function evaluateOfflineSession(input: {
  online: boolean;
  /**
   * Whether there is a session to protect at all. A logged-out device holds
   * no cached clinical data and has nothing to lock — gating it would only
   * make signing in impossible, since signing in is itself a write.
   * Defaults true so existing callers keep their meaning.
   */
  hasSession?: boolean;
  verifiedAt?: number | null;
  permissionsAt?: number | null;
  now?: number;
}): OfflineSession {
  const now = input.now ?? Date.now();
  const verifiedAt = input.verifiedAt ?? null;
  const permissionsAt = input.permissionsAt ?? null;
  const hasSession = input.hasSession ?? true;

  const permissionsStale =
    permissionsAt == null || now - permissionsAt >= OFFLINE_GRACE_MS;

  // Nothing signed in: no cached records to guard, and no session to expire.
  if (!hasSession) {
    return {
      status: 'fresh',
      verifiedAt,
      expiresAt: null,
      msRemaining: null,
      canRead: true,
      canWrite: true,
      permissionsStale,
    };
  }

  // Online means the server is answering; a real 401 would have ended the
  // session through the normal path in api.ts, so anything that reaches here
  // while online is current by definition.
  if (input.online) {
    return {
      status: 'fresh',
      verifiedAt,
      expiresAt: null,
      msRemaining: null,
      canRead: true,
      canWrite: true,
      permissionsStale,
    };
  }

  // Offline with no record of ever being confirmed. Do not extend trust we
  // never had.
  if (verifiedAt == null) {
    return {
      status: 'expired',
      verifiedAt: null,
      expiresAt: null,
      msRemaining: 0,
      canRead: false,
      canWrite: false,
      permissionsStale: true,
    };
  }

  const expiresAt = verifiedAt + OFFLINE_GRACE_MS;
  const msRemaining = Math.max(0, expiresAt - now);

  // A clock that jumped backwards (manual change, dead CMOS battery — see the
  // clock risk in the plan) would otherwise read as a huge remaining window.
  // Treat a future `verifiedAt` as "just verified" rather than trusting it.
  const drifted = verifiedAt > now;

  if (msRemaining <= 0 && !drifted) {
    return {
      status: 'expired',
      verifiedAt,
      expiresAt,
      msRemaining: 0,
      canRead: false,
      canWrite: false,
      permissionsStale,
    };
  }

  return {
    status: msRemaining <= OFFLINE_WARN_MS && !drifted ? 'expiring' : 'grace',
    verifiedAt,
    expiresAt,
    msRemaining,
    canRead: true,
    canWrite: true,
    permissionsStale,
  };
}

/**
 * Thrown when the device is locked out. Distinct from `OfflineError` (which
 * means "try again when connected") because the remedy is different: this one
 * requires reconnecting to re-verify, not just retrying.
 */
export class OfflineSessionExpiredError extends Error {
  readonly isOfflineSessionExpiredError = true;

  constructor(
    message = 'This device has been offline too long. Reconnect to continue — nothing you entered has been lost.',
  ) {
    super(message);
    this.name = 'OfflineSessionExpiredError';
    Object.setPrototypeOf(this, OfflineSessionExpiredError.prototype);
  }
}

export function isOfflineSessionExpiredError(
  err: unknown,
): err is OfflineSessionExpiredError {
  return (
    err instanceof OfflineSessionExpiredError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as OfflineSessionExpiredError).isOfflineSessionExpiredError === true)
  );
}
