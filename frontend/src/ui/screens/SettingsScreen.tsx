import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Field, Spinner, labelStyle, useToast } from '../shared/primitives';
import { Icon, type IconName } from '../shared/Icon';

type ClinicSettingsResp = {
  clinic: { _id: string; name: string; timezone?: string; currency?: string };
  settings: Record<string, unknown>;
};

type SettingsTab = 'clinic' | 'context' | 'permissions' | 'about';

const NAV: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: 'clinic', label: 'Clinic', icon: 'cross' },
  { id: 'context', label: 'My context', icon: 'user' },
  { id: 'permissions', label: 'Permissions', icon: 'shield' },
  { id: 'about', label: 'About', icon: 'info' },
];

export function SettingsScreen() {
  const [tab, setTab] = useState<SettingsTab>('clinic');

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', padding: '16px 8px', display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--surface)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 10px 8px' }}>Settings</div>
        {NAV.map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: 'none', background: tab === item.id ? 'var(--brand-50)' : 'transparent', borderRadius: 9, cursor: 'pointer', color: tab === item.id ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 13, fontWeight: tab === item.id ? 600 : 400, textAlign: 'left', borderLeft: tab === item.id ? '3px solid var(--brand-500)' : '3px solid transparent' }}>
            <Icon name={item.icon} size={15} style={{ color: tab === item.id ? 'var(--brand-500)' : 'inherit', flexShrink: 0 }} />
            {item.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        <div key={tab} style={{ animation: 'slideUp 160ms ease-out', maxWidth: 800 }}>
          <h2 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>
            {NAV.find((n) => n.id === tab)?.label}
          </h2>
          {tab === 'clinic' && <ClinicTab />}
          {tab === 'context' && <ContextTab />}
          {tab === 'permissions' && <PermissionsTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}

function ClinicTab() {
  const { ctx, permissions } = useApp();
  const toast = useToast();
  const canRead = permissions.has('clinic:read');
  const canWrite = permissions.has('clinic:write');
  const [data, setData] = useState<ClinicSettingsResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [apptMode, setApptMode] = useState<'TIME' | 'QUEUE' | 'BOTH'>('BOTH');
  const [slotMinutes, setSlotMinutes] = useState('15');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await apiGet<ClinicSettingsResp>(ctx, '/clinic/settings');
      setData(res);
      const s = res.settings as { appointments?: { mode?: 'TIME' | 'QUEUE' | 'BOTH'; slotMinutesDefault?: number } } | undefined;
      setApptMode(s?.appointments?.mode ?? 'BOTH');
      setSlotMinutes(String(s?.appointments?.slotMinutesDefault ?? 15));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (canRead) void load(); }, [canRead]);

  async function save() {
    setSaving(true); setError(null);
    try {
      const updated = await apiPatch<ClinicSettingsResp>(ctx, '/clinic/settings', {
        appointments: { mode: apptMode, slotMinutesDefault: Number(slotMinutes) || 15 },
      });
      setData(updated);
      toast('Clinic settings saved', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!canRead) return <PermissionGate perm="clinic:read" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {loading && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>}
      {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

      {data && (
        <>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Clinic profile</div>
            <Row label="Name">{data.clinic.name}</Row>
            <Row label="Timezone">{data.clinic.timezone ?? '—'}</Row>
            <Row label="Currency">{data.clinic.currency ?? 'INR'}</Row>
            <Row label="Clinic ID">
              <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{data.clinic._id}</code>
            </Row>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Appointments</div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Mode</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['TIME', 'QUEUE', 'BOTH'] as const).map((m) => (
                  <button key={m} onClick={() => setApptMode(m)} disabled={!canWrite}
                    style={{ flex: 1, padding: '8px 0', border: `1.5px solid ${apptMode === m ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 10, background: apptMode === m ? 'var(--brand-50)' : 'var(--surface-muted)', color: apptMode === m ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: canWrite ? 'pointer' : 'not-allowed', opacity: canWrite ? 1 : 0.6 }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Default slot minutes" value={slotMinutes} onChange={setSlotMinutes} placeholder="15" />
            {canWrite && (
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={save} disabled={saving}
                  style={{ height: 38, padding: '0 24px', background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {saving ? <Spinner /> : 'Save changes'}
                </button>
              </div>
            )}
            {!canWrite && (
              <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-subtle)' }}>
                You don't have <code>clinic:write</code> to modify settings.
              </div>
            )}
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Raw settings</div>
            <pre style={{ background: 'var(--surface-muted)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--text-muted)', overflow: 'auto', maxHeight: 240, fontFamily: 'monospace' }}>
              {JSON.stringify(data.settings, null, 2)}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}

function ContextTab() {
  const { ctx, setCtx, refreshMe, logout } = useApp();
  const [api, setApi] = useState(ctx.apiBaseUrl);
  const [clinicId, setClinicId] = useState(ctx.clinicId);
  const [branchId, setBranchId] = useState(ctx.branchId ?? '');
  const [userId, setUserId] = useState(ctx.userId);
  const [token, setToken] = useState(ctx.accessToken ?? '');
  const toast = useToast();

  function save() {
    setCtx({
      ...ctx,
      apiBaseUrl: api.trim(),
      clinicId: clinicId.trim(),
      branchId: branchId.trim() || undefined,
      userId: userId.trim(),
      accessToken: token.trim() || undefined,
    });
    toast('Context saved', 'success');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="API base URL" value={api} onChange={setApi} />
        <Field label="Clinic ID" value={clinicId} onChange={setClinicId} />
        <Field label="Branch ID (optional)" value={branchId} onChange={setBranchId} />
        <Field label="User ID (dev fallback)" value={userId} onChange={setUserId} />
        <Field label="Access token (JWT)" value={token} onChange={setToken} />
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button onClick={save}
            style={{ height: 38, padding: '0 16px', background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Save context
          </button>
          <button onClick={() => void refreshMe()}
            style={{ height: 38, padding: '0 16px', background: 'none', border: '1.5px solid var(--border)', borderRadius: 9, color: 'var(--text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
            Refresh /me
          </button>
          <button onClick={() => void logout()}
            style={{ height: 38, padding: '0 16px', background: 'none', border: '1.5px solid var(--danger-500)', color: 'var(--danger-500)', borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: 'pointer', marginLeft: 'auto' }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

const PERMISSION_GROUPS: { group: string; items: string[] }[] = [
  { group: 'Clinic',        items: ['clinic:read', 'clinic:write'] },
  { group: 'Patients',      items: ['patient:read', 'patient:write'] },
  { group: 'Appointments',  items: ['appointment:read', 'appointment:write'] },
  { group: 'Billing',       items: ['billing:read', 'billing:write'] },
  { group: 'Documents',     items: ['document:read', 'document:write'] },
  { group: 'Notifications', items: ['notification:read', 'notification:write'] },
];

function PermissionsTab() {
  const { permissions, ctx } = useApp();
  const list = useMemo(() => Array.from(permissions).sort(), [permissions]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Your permissions</div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 12 }}>
          Loaded from <code>/me</code> for <code>{ctx.email ?? ctx.userId.slice(-8)}</code>.
        </div>
        {list.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-subtle)', padding: 16, textAlign: 'center' }}>No permissions resolved.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {list.map((p) => (
              <span key={p} style={{ padding: '4px 10px', borderRadius: 100, background: 'var(--brand-50)', color: 'var(--brand-700)', fontSize: 11, fontWeight: 600, border: '1px solid var(--brand-100)', fontFamily: 'monospace' }}>{p}</span>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 10 }}>
          Permissions matrix — your role's grants vs all known capabilities.
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--surface-muted)' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 220 }}>Permission</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--brand-600)' }}>You</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((pg) => (
                <PermissionGroupRows key={pg.group} group={pg.group} items={pg.items} permissions={permissions} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PermissionGroupRows({ group, items, permissions }: { group: string; items: string[]; permissions: Set<string> }) {
  return (
    <>
      <tr style={{ background: 'var(--surface-muted)' }}>
        <td colSpan={2} style={{ padding: '6px 16px', fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{group}</td>
      </tr>
      {items.map((p) => {
        const has = permissions.has(p);
        return (
          <tr key={p} style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text)', fontFamily: 'monospace' }}>{p}</td>
            <td style={{ padding: '10px 16px', textAlign: 'center' }}>
              <PermCheck checked={has} />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function PermCheck({ checked }: { checked: boolean }) {
  return (
    <div style={{
      width: 20, height: 20, borderRadius: 6,
      border: `1.5px solid ${checked ? 'var(--brand-500)' : 'var(--border)'}`,
      background: checked ? 'var(--brand-500)' : 'var(--surface-muted)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      margin: '0 auto',
    }}>
      {checked && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );
}

function AboutTab() {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand-500)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cross" size={18} style={{ color: '#fff' }} strokeWidth={2.5} />
        </div>
        <div>
          <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 20, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.4px' }}>
            Digi<span style={{ color: 'var(--brand-500)' }}>Rx</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Multi-tenant clinic management</div>
        </div>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li><strong style={{ color: 'var(--text)' }}>Backend:</strong> NestJS 11 · MongoDB · BullMQ · MinIO/S3</li>
        <li><strong style={{ color: 'var(--text)' }}>Frontend:</strong> React 19 · Vite 8 · TypeScript</li>
        <li><strong style={{ color: 'var(--text)' }}>Auth:</strong> JWT + refresh cookie, multi-tenant via <code>x-clinic-id</code> + <code>x-branch-id</code></li>
        <li><strong style={{ color: 'var(--text)' }}>Idempotent payments:</strong> client-generated UUIDv4 per submit</li>
      </ul>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', gap: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', flex: '0 0 200px' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)', flex: 1, textAlign: 'right' }}>{children}</div>
    </div>
  );
}

function PermissionGate({ perm }: { perm: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
      <Icon name="lock" size={28} style={{ color: 'var(--text-subtle)', margin: '0 auto 12px' }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Permission required</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>You need <code style={{ fontFamily: 'monospace' }}>{perm}</code> to view this page.</div>
    </div>
  );
}
