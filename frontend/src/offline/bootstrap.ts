/**
 * Wires the offline layer to the app lifecycle — the moving parts of B2, B3
 * and B5 that have to run somewhere.
 *
 * Three jobs:
 *   1. Register the service worker (B3).
 *   2. Refresh the working set when it is stale (B2).
 *   3. Drain the write queue whenever the connection returns (B5).
 */
import { subscribeConnectivity, isOnline } from './connectivity';
import { recoverInflight } from './queue';
import { requestPersistentStorage } from './db';
import { replayQueue } from './replay';
import { prefetchSlots, syncWorkingSet } from './working-set';
import { ensureAllLeases, reportLeaseUsage } from './leases';
import { VAULT_CHANGED_EVENT, isVaultOpen } from './vault';
import { localDate } from './cash';
import { isDeviceSetupInProgress, uploadPendingRecovery } from './device-lock';
import type { DevContext } from '../app/context';

/**
 * Registers the service worker.
 *
 * Off in dev by default: Vite serves unbundled modules there, and caching
 * them makes every subsequent edit look like it did not apply. Set
 * `VITE_ENABLE_SW=true` to force it on when you specifically want to test
 * offline reloads without doing a production build — but `pnpm build &&
 * pnpm preview` is the honest test, because that is what a clinic runs.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const forced =
    (import.meta.env as Record<string, string | undefined>).VITE_ENABLE_SW === 'true';
  if (!import.meta.env.PROD && !forced) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration costs offline shell loading, nothing else.
      // Never let it break startup.
    });
  });
}

let started = false;
let periodic: number | undefined;

/**
 * Start background sync for a signed-in context. Safe to call repeatedly;
 * later calls just update the context used for the next run.
 */
export function startOfflineSync(
  getCtx: () => DevContext,
  fetchJson: (ctx: DevContext, path: string) => Promise<unknown>,
  postJson: (ctx: DevContext, path: string, body: unknown) => Promise<unknown>,
  putJson: (ctx: DevContext, path: string, body: unknown) => Promise<unknown>,
): () => void {
  const leaseApi = {
    post: <T,>(path: string, body: unknown) =>
      postJson(getCtx(), path, body) as Promise<T>,
  };

  const run = async (opts: { force?: boolean } = {}) => {
    const ctx = getCtx();
    if (!ctx.clinicId || !isOnline()) return;
    // Everything below reads or writes the encrypted store. Before the PIN is
    // entered (or set) there is no key, so wait — the vault-changed event
    // below re-runs this the moment the device unlocks.
    if (!isVaultOpen() || isDeviceSetupInProgress()) return;
    try {
      // The admin's copy of the unlock code. First, because until it lands a
      // forgotten PIN on this device has no recovery path.
      await uploadPendingRecovery((p, body) => putJson(ctx, p, body));
      // Queue first. Getting local work to the server matters more than
      // refreshing the cache, and syncing a working set that does not yet
      // include the morning's own entries would look like they were lost.
      await replayQueue(ctx);
      // Tell the server which leased numbers we actually spent, then top the
      // blocks back up. Done after replay so a block emptied during an outage
      // is reported before we ask for its replacement.
      await reportLeaseUsage(ctx, leaseApi);
      await ensureAllLeases(ctx, leaseApi);
      await syncWorkingSet(ctx, (p) => fetchJson(ctx, p), opts);
      // Slot availability is computed, not stored, so it has to be warmed
      // per doctor per day — otherwise the booking sheet has no times.
      await prefetchSlots(ctx, (p) => fetchJson(ctx, p));
      // Today's server-side cash figure (C6), so the day-end count still has
      // a baseline if the connection drops later in the day.
      if (ctx.branchId) {
        const today = localDate(Date.now(), ctx.clinicTimezone ?? ctx.timezone);
        await fetchJson(ctx, `/cash-days?date=${today}`).catch(() => undefined);
      }
    } catch {
      // Background work never surfaces as an app error; the queue and the
      // sync markers both survive to the next attempt.
    }
  };

  if (!started) {
    started = true;
    // Ask the browser not to evict us. The queue is the only copy of work
    // done offline, so "best effort" storage is not good enough for it.
    void requestPersistentStorage();
    // An entry left `inflight` means a tab died mid-request. Re-sending is
    // safe because replay treats CLIENT_ID_EXISTS as success.
    void recoverInflight();
  }

  void run();
  const stopConnectivity = subscribeConnectivity((online) => {
    if (online) void run({ force: true });
  });
  periodic = window.setInterval(() => void run(), 5 * 60_000);
  const onVisible = () => {
    if (document.visibilityState === 'visible') void run();
  };
  document.addEventListener('visibilitychange', onVisible);
  const onVault = () => {
    if (isVaultOpen()) void run({ force: true });
  };
  window.addEventListener(VAULT_CHANGED_EVENT, onVault);

  return () => {
    stopConnectivity();
    if (periodic) window.clearInterval(periodic);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener(VAULT_CHANGED_EVENT, onVault);
  };
}
