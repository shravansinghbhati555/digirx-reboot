import { useState } from 'react';
import { SyncIssuesModal } from './SyncIssuesModal';
import { useApp } from '../../app/AppContext';
import { describeAge, useOfflineStatus } from '../../offline/useOfflineStatus';

/**
 * Offline status strip — ticket E1.
 *
 * Shows only when there is something worth saying: the server is unreachable,
 * work is waiting to sync, writes have failed, or the offline session is
 * close to expiring. Silent the rest of the time.
 *
 * It deliberately reports *why* we think we are offline rather than just
 * that we are. A CORS refusal, a blocked preflight and a dead network are
 * indistinguishable at the `fetch` layer, so without the corroborating
 * details a misconfiguration looks exactly like a rural outage — and gets
 * reported as one.
 */
export function OfflineBanner() {
  const { ctx, loggedIn } = useApp();
  const status = useOfflineStatus(ctx.clinicId);
  const [expanded, setExpanded] = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  if (!loggedIn) return null;

  const { online, browserOnline, session, queue, likelyMisconfigured, storage, durabilityAtRisk } = status;
  const expiringSoon = session.status === 'expiring' || session.status === 'expired';

  const worthShowing =
    !online || queue.pending > 0 || queue.failed > 0 || expiringSoon || durabilityAtRisk;
  if (!worthShowing) return null;

  // Most severe condition wins the colour.
  const tone: 'danger' | 'warning' | 'info' =
    queue.failed > 0 || session.status === 'expired'
      ? 'danger'
      : !online || expiringSoon
        ? 'warning'
        : 'info';

  const palette = {
    danger: { bg: 'var(--danger-bg)', text: 'var(--danger-text)', dot: 'var(--danger-500)' },
    warning: { bg: 'var(--warning-bg)', text: 'var(--warning-text)', dot: 'var(--warning-500)' },
    info: { bg: 'var(--brand-bg-soft)', text: 'var(--brand-text)', dot: 'var(--brand-500)' },
  }[tone];

  const headline = buildHeadline({ online, queue, session, likelyMisconfigured });

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: palette.bg,
        color: palette.text,
        borderBottom: '1px solid var(--border)',
        padding: '8px 16px',
        fontSize: 13,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: palette.dot,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600 }}>{headline}</span>
        {(queue.pending > 0 || queue.failed > 0) && (
          <button
            onClick={() => setShowIssues(true)}
            style={{
              background: 'none',
              border: '1px solid currentColor',
              borderRadius: 7,
              cursor: 'pointer',
              color: 'inherit',
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
            }}
          >
            {queue.failed > 0 ? 'Fix' : 'View'}
          </button>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            textDecoration: 'underline',
            fontSize: 12,
            padding: 2,
          }}
        >
          {expanded ? 'Hide details' : 'Details'}
        </button>
      </div>

      {expanded && (
        <dl
          style={{
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '2px 12px',
            fontSize: 12,
            opacity: 0.95,
          }}
        >
          <dt>Server last reached</dt>
          <dd style={{ margin: 0 }}>{describeAge(status.lastContactAt)}</dd>

          <dt>Device network</dt>
          <dd style={{ margin: 0 }}>{browserOnline ? 'connected' : 'disconnected'}</dd>

          <dt>Waiting to sync</dt>
          <dd style={{ margin: 0 }}>{queue.pending}</dd>

          <dt>Local storage</dt>
          <dd style={{ margin: 0 }}>
            {storage.persistent ? 'protected' : 'not protected'}
            {storage.usedFraction != null
              ? ` · ${Math.round(storage.usedFraction * 100)}% used`
              : ''}
          </dd>

          {queue.failed > 0 && (
            <>
              <dt>Failed</dt>
              <dd style={{ margin: 0 }}>{queue.failed}</dd>
            </>
          )}

          {session.status !== 'fresh' && session.msRemaining != null && (
            <>
              <dt>Offline access ends</dt>
              <dd style={{ margin: 0 }}>
                {session.msRemaining <= 0
                  ? 'now — reconnect to continue'
                  : `in ${Math.round(session.msRemaining / 3_600_000)}h`}
              </dd>
            </>
          )}

          {durabilityAtRisk && (
            <>
              <dt>Warning</dt>
              <dd style={{ margin: 0 }}>
                {storage.nearlyFull
                  ? 'This device is nearly out of storage. Reconnect and sync soon — new work may fail to save.'
                  : 'The browser has not guaranteed this device’s storage, so unsynced work could be cleared if space runs low. Reconnect and sync when you can.'}
              </dd>
            </>
          )}

          {likelyMisconfigured && (
            <>
              <dt>Note</dt>
              <dd style={{ margin: 0 }}>
                This device has a network but has never reached {ctx.apiBaseUrl}. That
                usually means the API address is wrong, the server is not running, or
                this origin is missing from its CORS allowlist — not that you are
                offline.
              </dd>
            </>
          )}
        </dl>
      )}
      {showIssues && <SyncIssuesModal onClose={() => setShowIssues(false)} />}
    </div>
  );
}

function buildHeadline(input: {
  online: boolean;
  queue: { pending: number; failed: number };
  session: { status: string };
  likelyMisconfigured: boolean;
}): string {
  const { online, queue, session, likelyMisconfigured } = input;

  if (queue.failed > 0) {
    return `${queue.failed} change${queue.failed === 1 ? '' : 's'} could not be saved to the server`;
  }
  if (session.status === 'expired') {
    return 'Offline for too long — reconnect to continue. Nothing has been lost.';
  }
  if (likelyMisconfigured) {
    return 'Cannot reach the server — this looks like a setup problem, not a network one';
  }
  if (!online) {
    return queue.pending > 0
      ? `Working offline — ${queue.pending} change${queue.pending === 1 ? '' : 's'} saved on this device`
      : 'Working offline — your work is saved on this device';
  }
  if (queue.pending > 0) {
    return `Syncing ${queue.pending} change${queue.pending === 1 ? '' : 's'}…`;
  }
  if (session.status === 'expiring') {
    return 'Offline access ends soon — reconnect when you can';
  }
  return 'Working offline';
}
