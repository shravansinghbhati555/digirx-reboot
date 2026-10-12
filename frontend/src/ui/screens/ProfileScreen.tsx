import { useEffect, useMemo, useState } from 'react';
import { apiPatch } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Avatar, Spinner, StatusPill, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';
import { DeviceSecurityCard } from '../shared/DeviceLock';

// All IANA zones when the browser supports it; otherwise a small curated set.
function allTimezones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (supported && supported.length) return supported;
  } catch { /* fall through */ }
  return [
    'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'Africa/Lagos', 'UTC',
  ];
}

function timeInZone(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
  } catch {
    return '—';
  }
}

export function ProfileScreen() {
  const { ctx, roleNames, refreshMe } = useApp();
  const toast = useToast();

  const clinicTz = ctx.clinicTimezone || ctx.timezone || 'UTC';
  // Local editable copy of the user's display-timezone preference. Empty
  // string means "use the clinic timezone".
  const [pref, setPref] = useState<string>(ctx.displayTimezone ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setPref(ctx.displayTimezone ?? ''); }, [ctx.displayTimezone]);

  const effectiveTz = pref || clinicTz;
  const zones = useMemo(() => allTimezones(), []);

  async function saveTimezone() {
    setSaving(true);
    try {
      await apiPatch(ctx, '/me/timezone', { timezone: pref || null });
      await refreshMe(); // pulls the new effective timezone into ctx
      toast(pref ? 'Display timezone updated' : 'Using clinic timezone', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update timezone', 'error');
    } finally {
      setSaving(false);
    }
  }

  const dirty = (ctx.displayTimezone ?? '') !== pref;

  return (
    <div style={{ padding: '24px 32px', height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Identity card */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, display: 'flex', alignItems: 'center', gap: 18 }}>
          {ctx.profileImageUrl ? (
            <img src={ctx.profileImageUrl} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }} />
          ) : (
            <Avatar name={ctx.fullName ?? 'User'} size={72} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{ctx.fullName ?? 'User'}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{ctx.email ?? ''}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {Array.from(roleNames).map((r) => <StatusPill key={r} status={r} small />)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clinic</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{ctx.clinicName ?? '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>{ctx.branchName ?? ''}</div>
          </div>
        </div>

        {/* Profile picture note */}
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 6, marginTop: -8 }}>
          <Icon name="info" size={13} /> Your profile photo is set by a Manager during registration or edit.
        </div>

        {/* Display timezone */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Display timezone</div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 16 }}>
            Choose how times and dates are shown to <strong>you</strong>. This only affects your view — it doesn’t change the clinic’s timezone for other staff.
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Timezone</label>
              <select value={pref} onChange={(e) => setPref(e.target.value)}
                style={{ width: '100%', height: 40, padding: '0 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-muted)', fontSize: 13, color: 'var(--text)' }}>
                <option value="">Use clinic timezone ({clinicTz})</option>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <button onClick={() => void saveTimezone()} disabled={saving || !dirty}
              style={{ height: 40, padding: '0 18px', borderRadius: 10, border: 'none', background: dirty ? 'var(--brand-500)' : 'var(--surface-muted)', color: dirty ? 'var(--brand-text)' : 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: (saving || !dirty) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {saving ? <Spinner size={14} /> : 'Save'}
            </button>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Your time</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{timeInZone(effectiveTz)} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)' }}>{effectiveTz}</span></div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clinic time</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{timeInZone(clinicTz)} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)' }}>{clinicTz}</span></div>
            </div>
          </div>
        </div>

        <DeviceSecurityCard />
      </div>
    </div>
  );
}
