import { useEffect, useState } from 'react';
import { apiGet } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { EmptyState, Spinner, formatDateTime } from '../shared/primitives';

type OfflineDevice = {
  deviceId: string;
  label?: string;
  recoveryCode: string;
  recoveryUpdatedAt: string;
};

/**
 * Settings → Devices. Lists every tablet holding an encrypted offline store
 * with its current unlock code, so an admin can talk a doctor through a
 * forgotten PIN over the phone during an outage. Gated on `device:manage`.
 *
 * Codes are hidden until revealed one at a time: this screen is often open on
 * a reception desk, and each code opens that tablet's cached patient records.
 */
export function DevicesTab() {
  const { ctx } = useApp();
  const [devices, setDevices] = useState<OfflineDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<OfflineDevice[]>(ctx, '/offline/devices')
      .then((rows) => !cancelled && setDevices(rows))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load devices'));
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Each tablet that works offline has a PIN and an unlock code. If someone forgets the PIN,
        read them that tablet’s code — on the lock screen they tap <strong>Forgot PIN?</strong>,
        enter it and choose a new PIN. Nothing saved on the tablet is lost. The code changes after
        it is used, so this list shows the new one once the tablet is back online.
      </p>

      {error && (
        <div style={{ fontSize: 13, color: 'var(--danger-text)', background: 'var(--danger-bg)', borderRadius: 8, padding: '10px 12px' }}>
          {error}
        </div>
      )}

      {!devices && !error && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
          <Spinner size={20} />
        </div>
      )}

      {devices && devices.length === 0 && (
        <EmptyState
          icon="smartphone"
          title="No devices yet"
          hint="A tablet appears here after someone sets its PIN and it next goes online."
        />
      )}

      {devices && devices.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {devices.map((d) => {
            const shown = revealed === d.deviceId;
            return (
              <div
                key={d.deviceId}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {d.label || 'Unnamed device'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                    Code set {formatDateTime(d.recoveryUpdatedAt)} · ID …{d.deviceId.slice(-6)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 15,
                      fontWeight: 600,
                      letterSpacing: 1,
                      color: 'var(--text)',
                      userSelect: shown ? 'all' : 'none',
                    }}
                  >
                    {shown ? d.recoveryCode : '••••-••••-••••-••••'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRevealed(shown ? null : d.deviceId)}
                    style={{
                      height: 30,
                      padding: '0 12px',
                      background: 'none',
                      border: '1.5px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {shown ? 'Hide' : 'Show code'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
