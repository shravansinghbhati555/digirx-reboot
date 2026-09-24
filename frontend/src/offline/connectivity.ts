/**
 * Connectivity classification for the offline layer.
 *
 * The single job of this file is to answer one question the rest of the app
 * kept getting wrong: **did this request fail because the session is dead, or
 * because the server was never reachable?** Those two look similar at the
 * call site and mean opposite things. An expired session should bounce the
 * user to /login. An unreachable server must not — logging out discards the
 * write queue along with the session, which on a rural connection would throw
 * away a morning's consultations.
 *
 * `api.ts` is the only writer: it reports what it observed on every request.
 * Everything else reads.
 */

export const CONNECTIVITY_CHANGED_EVENT = 'digirx:connectivity-changed';

/**
 * Thrown when a request never reached the server. Distinct from an HTTP
 * error, which means the server answered and said no.
 */
export class OfflineError extends Error {
  /** Discriminator that survives bundling and cross-realm checks. */
  readonly isOfflineError = true;

  // NOTE: once the write queue lands (B4/B5) this should become "…your work
  // is saved on this device and will sync when you reconnect". Until then it
  // must not promise persistence we do not yet provide.
  constructor(message = 'No connection to the server. Check your network and try again.') {
    super(message);
    this.name = 'OfflineError';
    // Required when targeting ES5-ish output so `instanceof` still works.
    Object.setPrototypeOf(this, OfflineError.prototype);
  }
}

export function isOfflineError(err: unknown): err is OfflineError {
  return (
    err instanceof OfflineError ||
    (typeof err === 'object' && err !== null && (err as OfflineError).isOfflineError === true)
  );
}

/**
 * True when `err` means "the request never got an answer".
 *
 * `fetch()` rejects with a `TypeError` when the request could not be made at
 * all — DNS failure, connection refused, airplane mode, WiFi dropped
 * mid-flight. An aborted request is deliberate, not a connectivity problem,
 * so it is excluded.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (isOfflineError(err)) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  return err instanceof TypeError;
}

let online: boolean =
  typeof navigator === 'undefined' ? true : navigator.onLine !== false;

export function isOnline(): boolean {
  return online;
}

/** Report that a request reached the server, whatever it answered. */
export function markOnline(): void {
  setOnline(true);
}

/** Report that a request could not reach the server. */
export function markOffline(): void {
  setOnline(false);
}

function setOnline(next: boolean): void {
  if (online === next) return;
  online = next;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(CONNECTIVITY_CHANGED_EVENT, { detail: { online: next } }),
  );
}

/**
 * Subscribe to connectivity changes. Returns an unsubscribe function.
 * The callback fires only on transitions, never on every request.
 */
export function subscribeConnectivity(cb: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    cb((e as CustomEvent<{ online: boolean }>).detail.online);
  };
  window.addEventListener(CONNECTIVITY_CHANGED_EVENT, handler);
  return () => window.removeEventListener(CONNECTIVITY_CHANGED_EVENT, handler);
}

/**
 * The browser's own signals are a useful hint but not the source of truth:
 * `navigator.onLine === true` only means a network interface exists, which on
 * a clinic LAN with no ISP is exactly the situation we support. A dropped
 * interface (`false`) is reliable, so we trust that direction and let an
 * observed successful request confirm the other.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setOnline(false));
  window.addEventListener('online', () => setOnline(true));
}
