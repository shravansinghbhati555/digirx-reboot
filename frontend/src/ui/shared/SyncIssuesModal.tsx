import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Icon } from './Icon';
import {
  discardQueued,
  listQueue,
  retryFailed,
  type QueueEntry,
} from '../../offline';
import { replayQueue } from '../../offline/replay';
import { getDeviceId } from '../../offline/device';

/**
 * Sync issues — ticket E3.
 *
 * Replay halts on a permanent failure rather than skipping it, because
 * queued writes have dependencies: an encounter references a patient created
 * three entries earlier, and carrying on past a failed create would send the
 * encounter to a server that never heard of the patient.
 *
 * That safety comes at a price — one bad entry stops the whole queue — so
 * there has to be somewhere a human can see what is stuck and decide. Before
 * this screen existed the only signal was a number in the banner.
 *
 * The three actions are deliberate:
 *  - **Retry** for transient causes the user has since fixed.
 *  - **Export** as a last resort: a JSON file they can send on when sync is
 *    genuinely broken. It is the only way work can leave a stuck device.
 *  - **Discard**, confirmed per entry, which is the only path in the app that
 *    destroys queued work.
 */
/**
 * What a queued write means, in words a doctor would use.
 *
 * `label` is set at the call site and already reads naturally ("Patient —
 * Ada Lovelace"); this is the fallback for anything that did not set one.
 * Deliberately no method or path: the clinician needs to know which piece of
 * their work is stuck, not which endpoint it maps to. That detail still goes
 * in the export, where it is for us.
 */
function describeEntry(e: QueueEntry): string {
  if (e.label) return e.label;
  const p = e.path;
  if (/^\/patients$/.test(p)) return 'New patient';
  if (/^\/patients\/[^/]+$/.test(p)) return 'Patient details';
  if (/^\/appointments$/.test(p)) return 'New appointment';
  if (/\/checkin$/.test(p)) return 'Patient check-in';
  if (/^\/encounters$/.test(p)) return 'Consultation started';
  if (/\/prescriptions$/.test(p)) return 'Prescription';
  if (/\/sign$/.test(p)) return 'Signed consultation';
  if (/^\/encounters\/[^/]+$/.test(p)) return 'Consultation notes';
  if (/\/payments$/.test(p)) return 'Payment';
  if (/\/issue$/.test(p)) return 'Issued bill';
  if (/^\/bills$/.test(p)) return 'Bill';
  return 'Saved change';
}

export function SyncIssuesModal({ onClose }: { onClose: () => void }) {
  const { ctx } = useApp();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmSeq, setConfirmSeq] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const all = await listQueue(ctx.clinicId);
    // Done entries are noise here; show what is still owed or stuck, worst
    // first so the thing blocking the queue is at the top.
    setEntries(
      all
        .filter((e) => e.status !== 'done')
        .sort((a, b) => {
          if (a.status === 'failed' && b.status !== 'failed') return -1;
          if (b.status === 'failed' && a.status !== 'failed') return 1;
          return a.seq - b.seq;
        }),
    );
  }, [ctx.clinicId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onRetry(seq: number) {
    setBusy(true);
    try {
      await retryFailed(seq);
      await replayQueue(ctx);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onRetryAll() {
    setBusy(true);
    try {
      for (const e of entries.filter((x) => x.status === 'failed')) {
        await retryFailed(e.seq);
      }
      await replayQueue(ctx);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onDiscard(seq: number) {
    setBusy(true);
    try {
      await discardQueued(seq);
      setConfirmSeq(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function onExport() {
    // This file is for *us*, not the clinic: when sync is genuinely broken
    // the doctor sends it in and we need enough to diagnose without asking
    // twenty questions. So it keeps everything the UI deliberately hides —
    // methods, paths, bodies, server errors — plus the context that explains
    // the state the device was in.
    //
    // Contains patient data by definition. The user is warned before saving.
    const report = {
      exportedAt: new Date().toISOString(),
      clinicId: ctx.clinicId,
      branchId: ctx.branchId,
      deviceId: getDeviceId(),
      apiBaseUrl: ctx.apiBaseUrl,
      userAgent: navigator.userAgent,
      counts: {
        blocked: entries.filter((x) => x.status === 'failed').length,
        waiting: entries.filter((x) => x.status !== 'failed').length,
      },
      entries,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `digirx-unsynced-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const failed = entries.filter((e) => e.status === 'failed');
  const pending = entries.filter((e) => e.status !== 'failed');

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(15,23,42,0.2)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="refresh" size={18} style={{ color: 'var(--text-muted)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Unsynced changes</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              {failed.length > 0
                ? `${failed.length} blocked · ${pending.length} waiting`
                : `${pending.length} waiting to sync`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {entries.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-subtle)', fontSize: 13 }}>
              Everything on this device has synced.
            </div>
          )}

          {failed.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--danger-text)', background: 'var(--danger-bg)', borderRadius: 8, padding: '8px 12px' }}>
              Sync is paused. Later changes wait behind the blocked one so they
              cannot be applied out of order.
            </div>
          )}

          {entries.map((e) => (
            <div
              key={e.seq}
              style={{ border: `1px solid ${e.status === 'failed' ? 'var(--danger-500)' : 'var(--border)'}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {describeEntry(e)}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-subtle)' }}>
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>

              {e.attempts > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                  Tried {e.attempts} time{e.attempts === 1 ? '' : 's'}
                </div>
              )}

              {e.status === 'failed' && e.lastError && (
                <div style={{ fontSize: 12, color: 'var(--danger-text)' }}>{e.lastError}</div>
              )}

              {e.status === 'failed' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={() => void onRetry(e.seq)} disabled={busy}
                    style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-muted)', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', color: 'var(--text)' }}>
                    Try again
                  </button>
                  {confirmSeq === e.seq ? (
                    <>
                      <button onClick={() => void onDiscard(e.seq)} disabled={busy}
                        style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: 'var(--danger-500)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
                        Delete permanently
                      </button>
                      <button onClick={() => setConfirmSeq(null)}
                        style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)' }}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmSeq(e.seq)}
                      style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', fontSize: 12, cursor: 'pointer', color: 'var(--danger-500)' }}>
                      Discard
                    </button>
                  )}
                </div>
              )}

              {confirmSeq === e.seq && (
                <div style={{ fontSize: 11, color: 'var(--danger-text)' }}>
                  This permanently deletes the change. It exists nowhere else —
                  export first if you may still need it.
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={onExport} disabled={entries.length === 0}
            style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-muted)', fontSize: 12, fontWeight: 600, cursor: entries.length ? 'pointer' : 'not-allowed', color: 'var(--text)' }}>
            Export a copy
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-subtle)', flex: 1 }}>
            Saves a file you can send to support. It contains patient
            information — keep it somewhere safe.
          </span>
          {failed.length > 0 && (
            <button onClick={() => void onRetryAll()} disabled={busy}
              style={{ padding: '7px 14px', borderRadius: 9, border: 'none', background: 'var(--brand-500)', color: 'var(--brand-text)', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
              Retry all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
