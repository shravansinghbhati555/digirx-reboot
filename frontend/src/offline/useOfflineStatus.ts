/**
 * Everything the UI needs to explain the device's offline state — ticket E1.
 *
 * ## Why this includes diagnostics, not just a banner
 *
 * At the `fetch` layer a CORS refusal, a blocked preflight and a genuinely
 * dead network are indistinguishable: the browser deliberately hides the
 * reason from JavaScript. During development alone, three separate
 * configuration mistakes each surfaced as "you are offline". A clinic would
 * report every one of them as an outage.
 *
 * So this exposes the corroborating signals — what the browser thinks, when
 * the server was last reached, and how much work is waiting — which together
 * make a misconfiguration look different from a real one. If the browser says
 * it has a network and we have never once reached the server, that is a
 * configuration problem, not a rural connectivity problem.
 */
import { useEffect, useState } from 'react';
import { CONNECTIVITY_CHANGED_EVENT, isOnline } from './connectivity';
import { counts, type QueueCounts } from './queue';
import { REPLAY_PROGRESS_EVENT } from './replay';
import { readOfflineSession } from './session-store';
import type { OfflineSession } from './session';

export type OfflineStatus = {
  online: boolean;
  /** What the browser's own network interface reports. Differs from `online`
   *  when the interface is up but the server is unreachable — the signature
   *  of a misconfiguration rather than a lost connection. */
  browserOnline: boolean;
  session: OfflineSession;
  queue: QueueCounts;
  /** Epoch ms of the last request the server accepted, if ever. */
  lastContactAt: number | null;
  /** True when the browser has a network but we have never reached the
   *  server. Almost always a wrong API URL, a CORS allowlist gap, or a
   *  backend that is not running. */
  likelyMisconfigured: boolean;
};

const EMPTY_COUNTS: QueueCounts = { pending: 0, failed: 0, done: 0, total: 0 };

export function useOfflineStatus(clinicId?: string): OfflineStatus {
  const [queue, setQueue] = useState<QueueCounts>(EMPTY_COUNTS);
  const [session, setSession] = useState<OfflineSession>(() => readOfflineSession());
  const [online, setOnline] = useState<boolean>(() => isOnline());
  const [browserOnline, setBrowserOnline] = useState<boolean>(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  );

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      setOnline(isOnline());
      setBrowserOnline(typeof navigator === 'undefined' || navigator.onLine !== false);
      setSession(readOfflineSession());
      // The queue lives in IndexedDB, so this is async; ignore a late
      // resolution after unmount.
      void counts(clinicId)
        .then((c) => {
          if (!cancelled) setQueue(c);
        })
        .catch(() => {
          // Storage unavailable (private window). Showing zero is better than
          // breaking the banner.
        });
    };

    refresh();
    window.addEventListener(CONNECTIVITY_CHANGED_EVENT, refresh);
    window.addEventListener(REPLAY_PROGRESS_EVENT, refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    // Catches queue writes made in this tab, which emit no event of their own.
    const timer = window.setInterval(refresh, 10_000);

    return () => {
      cancelled = true;
      window.removeEventListener(CONNECTIVITY_CHANGED_EVENT, refresh);
      window.removeEventListener(REPLAY_PROGRESS_EVENT, refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      window.clearInterval(timer);
    };
  }, [clinicId]);

  return {
    online,
    browserOnline,
    session,
    queue,
    lastContactAt: session.verifiedAt,
    likelyMisconfigured: !online && browserOnline && session.verifiedAt == null,
  };
}

/** "3 minutes ago" — small enough not to justify a date library. */
export function describeAge(ms: number | null): string {
  if (ms == null) return 'never';
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
