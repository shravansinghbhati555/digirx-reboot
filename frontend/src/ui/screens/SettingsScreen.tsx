import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost, apiPut } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Field, Spinner, labelStyle, useToast } from '../shared/primitives';
import { Icon, type IconName } from '../shared/Icon';

type ClinicBranding = {
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
};

type ClinicSettings = {
  appointments: { mode: 'TIME' | 'QUEUE' | 'BOTH'; slotMinutesDefault: number };
  modules: { inventory: { enabled: boolean } };
  branding: ClinicBranding;
};

type ClinicSettingsResp = {
  clinic: { _id: string; name: string; timezone?: string; currency?: string };
  settings: ClinicSettings;
};

const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

type SettingsTab = 'clinic' | 'branches' | 'availability' | 'users' | 'permissions' | 'notif_cfg' | 'security' | 'context' | 'about';

const NAV: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: 'clinic',       label: 'Clinic',         icon: 'cross' },
  { id: 'branches',     label: 'Branches',       icon: 'mapPin' },
  { id: 'availability', label: 'Availability',   icon: 'clock' },
  { id: 'users',        label: 'Users',          icon: 'users' },
  { id: 'permissions',  label: 'Roles & Permissions', icon: 'shield' },
  { id: 'notif_cfg',    label: 'Notifications',  icon: 'bell' },
  { id: 'security',     label: 'Security',       icon: 'lock' },
  { id: 'context',      label: 'My context',     icon: 'user' },
  { id: 'about',        label: 'About',          icon: 'info' },
];

export function SettingsScreen() {
  const [tab, setTab] = useState<SettingsTab>('clinic');

  return (
    <div style={{ display: 'flex', minHeight: '100%', alignItems: 'flex-start' }}>
      <div style={{
        position: 'sticky', top: 0, alignSelf: 'flex-start',
        width: 220, flexShrink: 0,
        maxHeight: 'calc(100vh - 56px)', overflowY: 'auto',
        borderRight: '1px solid var(--border)', padding: '16px 8px',
        display: 'flex', flexDirection: 'column', gap: 2,
        background: 'var(--surface)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 10px 8px' }}>Settings</div>
        {NAV.map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: 'none', background: tab === item.id ? 'var(--brand-50)' : 'transparent', borderRadius: 9, cursor: 'pointer', color: tab === item.id ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 13, fontWeight: tab === item.id ? 600 : 400, textAlign: 'left', borderLeft: tab === item.id ? '3px solid var(--brand-500)' : '3px solid transparent' }}>
            <Icon name={item.icon} size={15} style={{ color: tab === item.id ? 'var(--brand-500)' : 'inherit', flexShrink: 0 }} />
            {item.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: '24px 32px' }}>
        <div key={tab} style={{ animation: 'slideUp 160ms ease-out', maxWidth: 800 }}>
          <h2 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>
            {NAV.find((n) => n.id === tab)?.label}
          </h2>
          {tab === 'clinic' && <ClinicTab />}
          {tab === 'branches' && <BranchesTab />}
          {tab === 'availability' && <AvailabilityTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'permissions' && <PermissionsTab />}
          {tab === 'notif_cfg' && <NotifConfigTab />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'context' && <ContextTab />}
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

  // Profile fields
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [currency, setCurrency] = useState('');

  // Appointments
  const [apptMode, setApptMode] = useState<'TIME' | 'QUEUE' | 'BOTH'>('BOTH');
  const [slotMinutes, setSlotMinutes] = useState('15');

  // Branding
  const [displayName, setDisplayName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');

  const [saving, setSaving] = useState(false);

  function settingsPath() {
    return `/clinics/${encodeURIComponent(ctx.clinicId)}/settings`;
  }

  function hydrate(res: ClinicSettingsResp) {
    setData(res);
    setName(res.clinic.name ?? '');
    setTimezone(res.clinic.timezone ?? '');
    setCurrency(res.clinic.currency ?? '');
    setApptMode(res.settings.appointments?.mode ?? 'BOTH');
    setSlotMinutes(String(res.settings.appointments?.slotMinutesDefault ?? 15));
    setDisplayName(res.settings.branding?.displayName ?? '');
    setLogoUrl(res.settings.branding?.logoUrl ?? '');
    setPrimaryColor(res.settings.branding?.primaryColor ?? '');
  }

  async function load() {
    if (!ctx.clinicId) { setError('No clinic in context.'); return; }
    setLoading(true); setError(null);
    try {
      const res = await apiGet<ClinicSettingsResp>(ctx, settingsPath());
      hydrate(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (canRead) void load(); }, [canRead, ctx.clinicId]);

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      name.trim() !== (data.clinic.name ?? '') ||
      timezone !== (data.clinic.timezone ?? '') ||
      currency.toUpperCase() !== (data.clinic.currency ?? '') ||
      apptMode !== (data.settings.appointments?.mode ?? 'BOTH') ||
      slotMinutes !== String(data.settings.appointments?.slotMinutesDefault ?? 15) ||
      displayName.trim() !== (data.settings.branding?.displayName ?? '') ||
      logoUrl.trim() !== (data.settings.branding?.logoUrl ?? '') ||
      primaryColor.trim() !== (data.settings.branding?.primaryColor ?? '')
    );
  }, [data, name, timezone, currency, apptMode, slotMinutes, displayName, logoUrl, primaryColor]);

  async function save() {
    if (!isDirty) return;
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        appointments: { mode: apptMode, slotMinutesDefault: Number(slotMinutes) || 15 },
        branding: {
          displayName: displayName.trim() || null,
          logoUrl: logoUrl.trim() || null,
          primaryColor: primaryColor.trim() || null,
        },
      };
      if (name.trim() && name.trim() !== data?.clinic.name) body.name = name.trim();
      if (timezone.trim() && timezone.trim() !== data?.clinic.timezone) body.timezone = timezone.trim();
      if (currency.trim() && currency.trim().toUpperCase() !== data?.clinic.currency) body.currency = currency.trim().toUpperCase();

      const updated = await apiPatch<ClinicSettingsResp>(ctx, settingsPath(), body);
      hydrate(updated);
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Name" value={name} onChange={setName} placeholder="Demo Clinic" />
              <div>
                <label style={labelStyle}>Timezone (IANA)</label>
                <input
                  list="tz-options"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  disabled={!canWrite}
                  placeholder="Asia/Kolkata"
                  style={{
                    width: '100%', height: 40, padding: '0 12px',
                    background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
                    fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                    opacity: canWrite ? 1 : 0.6,
                  }}
                />
                <datalist id="tz-options">
                  {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz} />)}
                </datalist>
              </div>
              <Field label="Currency (ISO 4217)" value={currency} onChange={(v) => setCurrency(v.toUpperCase())} placeholder="INR" />
              <Row label="Clinic ID">
                <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{data.clinic._id}</code>
              </Row>
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Branding</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Display name" value={displayName} onChange={setDisplayName} placeholder="Shown on prescriptions & receipts" />
              <Field label="Logo URL" value={logoUrl} onChange={setLogoUrl} placeholder="https://…/logo.png" />
              <div>
                <label style={labelStyle}>Primary color</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={primaryColor || '#3b82f6'} onChange={(e) => setPrimaryColor(e.target.value)}
                    disabled={!canWrite}
                    style={{ width: 44, height: 40, border: '1.5px solid var(--border)', borderRadius: 10, background: 'var(--surface-muted)', cursor: canWrite ? 'pointer' : 'not-allowed', padding: 2 }} />
                  <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} disabled={!canWrite} placeholder="#3B82F6"
                    style={{ flex: 1, height: 40, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'monospace', opacity: canWrite ? 1 : 0.6 }} />
                  {primaryColor && (
                    <button onClick={() => setPrimaryColor('')} disabled={!canWrite}
                      style={{ height: 40, padding: '0 12px', background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, color: 'var(--text-subtle)', fontSize: 12, cursor: canWrite ? 'pointer' : 'not-allowed' }}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
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
          </div>

          {canWrite ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={save} disabled={saving || !isDirty}
                style={{
                  height: 40, padding: '0 28px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  cursor: (saving || !isDirty) ? (saving ? 'wait' : 'not-allowed') : 'pointer',
                  opacity: (saving || !isDirty) ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s'
                }}>
                {saving ? <Spinner /> : 'Save all changes'}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
              You don't have <code>clinic:write</code> to modify settings.
            </div>
          )}

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

// ---------- Availability tab ----------

type AvailabilityWindow = { startMinutes: number; endMinutes: number };
type WeeklyRule = {
  weekday: number;
  windows: AvailabilityWindow[];
  slotMinutes?: number;
  active: boolean;
};
type DoctorOverride = {
  _id?: string;
  date: string;
  type: 'CLOSED' | 'CUSTOM_WINDOWS';
  windows?: AvailabilityWindow[];
  note?: string;
};
type DaySlots = {
  timezone: string;
  date: string;
  slotMinutes: number;
  slots: { startAt: string; endAt: string }[];
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function fromHHMM(s: string): number {
  const [h, m] = s.split(':').map((x) => Number(x) || 0);
  return Math.max(0, Math.min(24 * 60, h * 60 + m));
}
function emptyRule(weekday: number): WeeklyRule {
  return { weekday, windows: [], slotMinutes: 15, active: false };
}

function AvailabilityTab() {
  const { ctx, permissions } = useApp();
  const toast = useToast();
  const canRead = permissions.has('clinic:read');
  const canWrite = permissions.has('clinic:write');

  const [doctorId, setDoctorId] = useState(ctx.userId);
  const [rules, setRules] = useState<WeeklyRule[]>(() => Array.from({ length: 7 }, (_, i) => emptyRule(i)));
  const [originalRules, setOriginalRules] = useState<WeeklyRule[] | null>(null);
  const [overrides, setOverrides] = useState<DoctorOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [overrideDate, setOverrideDate] = useState('');
  const [overrideType, setOverrideType] = useState<'CLOSED' | 'CUSTOM_WINDOWS'>('CLOSED');
  const [overrideWindows, setOverrideWindows] = useState<AvailabilityWindow[]>([]);
  const [overrideNote, setOverrideNote] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  const [previewDate, setPreviewDate] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<DaySlots | null>(null);

  function branchQs() {
    return ctx.branchId ? `?branchId=${encodeURIComponent(ctx.branchId)}` : '';
  }

  async function load() {
    if (!ctx.branchId) { setError('Set a branch (sign in to a branch) to manage availability.'); return; }
    if (!doctorId.trim()) { setError('Enter a doctor user ID.'); return; }
    setLoading(true); setError(null);
    try {
      const [rulesResp, overridesResp] = await Promise.all([
        apiGet<WeeklyRule[]>(ctx, `/availability/doctors/${doctorId.trim()}/rules${branchQs()}`),
        apiGet<DoctorOverride[]>(ctx, `/availability/doctors/${doctorId.trim()}/overrides${branchQs()}`),
      ]);
      // Merge into a 7-day editable grid
      const next: WeeklyRule[] = Array.from({ length: 7 }, (_, i) => emptyRule(i));
      for (const r of rulesResp) {
        if (r.weekday >= 0 && r.weekday <= 6) {
          next[r.weekday] = {
            weekday: r.weekday,
            windows: (r.windows ?? []).map((w) => ({ startMinutes: w.startMinutes, endMinutes: w.endMinutes })),
            slotMinutes: r.slotMinutes ?? 15,
            active: r.active ?? true,
          };
        }
      }
      setRules(next);
      setOriginalRules(JSON.parse(JSON.stringify(next))); // Deep copy for dirty check
      setOverrides(overridesResp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (canRead && doctorId.trim() && ctx.branchId) void load(); }, [canRead, ctx.branchId]);

  function updateRule(weekday: number, patch: Partial<WeeklyRule>) {
    setRules((rs) => rs.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));
  }

  const rulesDirty = useMemo(() => {
    if (!originalRules) return false;
    return JSON.stringify(rules) !== JSON.stringify(originalRules);
  }, [rules, originalRules]);

  async function saveRules() {
    setSaving(true); setError(null);
    try {
      // Send only active rules with at least one window — others are no-ops on the BE,
      // but we explicitly include all 7 weekdays to avoid stale rules sticking around.
      const body = {
        rules: rules.map((r) => ({
          weekday: r.weekday,
          windows: r.active ? r.windows : [],
          slotMinutes: r.slotMinutes ?? 15,
          active: r.active,
        })),
      };
      await apiPut<WeeklyRule[]>(ctx, `/availability/doctors/${doctorId.trim()}/rules${branchQs()}`, body);
      toast('Weekly rules saved', 'success');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveOverride() {
    if (!overrideDate) { setError('Pick an override date.'); return; }
    setSavingOverride(true); setError(null);
    try {
      const body: Record<string, unknown> = { type: overrideType, note: overrideNote || undefined };
      if (overrideType === 'CUSTOM_WINDOWS') body.windows = overrideWindows;
      await apiPut<DoctorOverride>(ctx, `/availability/doctors/${doctorId.trim()}/overrides/${overrideDate}${branchQs()}`, body);
      toast(`Override saved for ${overrideDate}`, 'success');
      setOverrideDate(''); setOverrideType('CLOSED'); setOverrideWindows([]); setOverrideNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingOverride(false);
    }
  }

  async function runPreview() {
    if (!previewDate) { setError('Pick a date to preview.'); return; }
    setPreviewing(true); setError(null);
    try {
      const data = await apiGet<DaySlots>(ctx, `/availability/doctors/${doctorId.trim()}/day${branchQs()}&date=${previewDate}`);
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  if (!canRead) return <PermissionGate perm="clinic:read" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Doctor + branch picker */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Doctor & branch</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'flex-end' }}>
          <Field label="Doctor user ID" value={doctorId} onChange={setDoctorId} placeholder="ObjectId" />
          <button onClick={() => void load()} disabled={loading || !doctorId.trim() || !ctx.branchId}
            style={{ height: 40, padding: '0 18px', background: 'var(--brand-50)', border: '1px solid var(--brand-100)', borderRadius: 10, color: 'var(--brand-600)', fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-subtle)' }}>
          Branch: <code style={{ fontFamily: 'monospace' }}>{ctx.branchId ?? '— none in context —'}</code>
        </div>
        {error && <div style={{ marginTop: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
      </div>

      {/* Weekly rules */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Weekly schedule</div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>Slots are generated in clinic timezone using <code>slotMinutes</code>.</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map((r) => (
            <RuleRow key={r.weekday} rule={r} disabled={!canWrite} onChange={(patch) => updateRule(r.weekday, patch)} />
          ))}
        </div>
        {canWrite && (
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={saveRules} disabled={saving || !rulesDirty || !doctorId.trim() || !ctx.branchId}
              style={{
                height: 38, padding: '0 22px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600,
                cursor: (saving || !rulesDirty) ? (saving ? 'wait' : 'not-allowed') : 'pointer',
                opacity: (saving || !rulesDirty) ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s'
              }}>
              {saving ? <Spinner /> : 'Save weekly rules'}
            </button>
          </div>
        )}
      </div>

      {/* Override editor */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Date override</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 12 }}>
          A day's override <strong>replaces</strong> that day's weekly windows. To add an extra evening slot, include the morning windows too.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Date" value={overrideDate} onChange={setOverrideDate} placeholder="YYYY-MM-DD" type="date" />
          <div>
            <label style={labelStyle}>Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['CLOSED', 'CUSTOM_WINDOWS'] as const).map((t) => (
                <button key={t} onClick={() => setOverrideType(t)} disabled={!canWrite}
                  style={{ flex: 1, height: 40, border: `1.5px solid ${overrideType === t ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 10, background: overrideType === t ? 'var(--brand-50)' : 'var(--surface-muted)', color: overrideType === t ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: canWrite ? 'pointer' : 'not-allowed' }}>
                  {t === 'CLOSED' ? 'Closed' : 'Custom windows'}
                </button>
              ))}
            </div>
          </div>
        </div>
        {overrideType === 'CUSTOM_WINDOWS' && (
          <div style={{ marginTop: 12 }}>
            <WindowsEditor value={overrideWindows} onChange={setOverrideWindows} disabled={!canWrite} />
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Field label="Note (optional)" value={overrideNote} onChange={setOverrideNote} placeholder="e.g. holiday, conference" />
        </div>
        {canWrite && (
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={saveOverride} disabled={savingOverride || !overrideDate}
              style={{
                height: 38, padding: '0 22px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600,
                cursor: (savingOverride || !overrideDate) ? (savingOverride ? 'wait' : 'not-allowed') : 'pointer',
                opacity: (savingOverride || !overrideDate) ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s'
              }}>
              {savingOverride ? <Spinner /> : 'Save override'}
            </button>
          </div>
        )}

        {overrides.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Existing overrides</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {overrides.map((o) => (
                <div key={(o._id ?? '') + o.date} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-muted)', borderRadius: 9, border: '1px solid var(--border)' }}>
                  <code style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', minWidth: 96 }}>{o.date}</code>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: o.type === 'CLOSED' ? 'var(--danger-bg)' : 'var(--info-bg)', color: o.type === 'CLOSED' ? 'var(--danger-text)' : 'var(--info-text)' }}>
                    {o.type === 'CLOSED' ? 'Closed' : `${(o.windows ?? []).length} window(s)`}
                  </span>
                  {o.note && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{o.note}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Preview */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Preview a day</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 12 }}>
          Generates the slots for any date using the saved rules + overrides. Times shown are in the clinic timezone.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'flex-end' }}>
          <Field label="Date" value={previewDate} onChange={setPreviewDate} placeholder="YYYY-MM-DD" type="date" />
          <button onClick={() => void runPreview()} disabled={previewing || !previewDate || !doctorId.trim() || !ctx.branchId}
            style={{
              height: 40, padding: '0 22px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
              cursor: (previewing || !previewDate || !doctorId.trim() || !ctx.branchId) ? (previewing ? 'wait' : 'not-allowed') : 'pointer',
              opacity: (previewing || !previewDate || !doctorId.trim() || !ctx.branchId) ? 0.6 : 1,
              transition: 'all 0.2s'
            }}>
            {previewing ? 'Loading…' : 'Show slots'}
          </button>
        </div>
        {preview && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--surface-muted)', borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 8 }}>
              {preview.date} — {preview.slots.length} slot(s) × {preview.slotMinutes} min ({preview.timezone})
            </div>
            {preview.slots.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-subtle)', fontStyle: 'italic' }}>No slots — closed or no rules.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {preview.slots.map((s) => (
                  <span key={s.startAt} style={{ fontSize: 11, fontFamily: 'monospace', padding: '4px 9px', borderRadius: 100, background: 'var(--brand-50)', border: '1px solid var(--brand-100)', color: 'var(--brand-700)' }}>
                    {formatLocalHHMM(s.startAt, preview.timezone)} → {formatLocalHHMM(s.endAt, preview.timezone)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatLocalHHMM(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  } catch {
    return iso.slice(11, 16);
  }
}

function RuleRow({ rule, disabled, onChange }: { rule: WeeklyRule; disabled: boolean; onChange: (p: Partial<WeeklyRule>) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: rule.active ? 'var(--surface-muted)' : 'transparent', border: '1px solid var(--border)', borderRadius: 10 }}>
      <button onClick={() => onChange({ active: !rule.active })} disabled={disabled}
        style={{ width: 56, padding: '6px 0', borderRadius: 8, border: `1.5px solid ${rule.active ? 'var(--brand-500)' : 'var(--border)'}`, background: rule.active ? 'var(--brand-500)' : 'var(--surface)', color: rule.active ? 'var(--brand-text)' : 'var(--text-subtle)', fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
        {WEEKDAY_LABELS[rule.weekday]}
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <WindowsEditor value={rule.windows} onChange={(ws) => onChange({ windows: ws })} disabled={disabled || !rule.active} compact />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Slot minutes</span>
          <input type="number" min={5} max={180} value={rule.slotMinutes ?? 15}
            onChange={(e) => onChange({ slotMinutes: Math.max(5, Math.min(180, Number(e.target.value) || 15)) })}
            disabled={disabled || !rule.active}
            style={{ width: 64, height: 28, padding: '0 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, color: 'var(--text)', outline: 'none' }} />
        </div>
      </div>
    </div>
  );
}

function WindowsEditor({ value, onChange, disabled, compact }: { value: AvailabilityWindow[]; onChange: (v: AvailabilityWindow[]) => void; disabled?: boolean; compact?: boolean }) {
  function update(idx: number, patch: Partial<AvailabilityWindow>) {
    onChange(value.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...value, { startMinutes: 9 * 60, endMinutes: 17 * 60 }]);
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {value.length === 0 && (
        <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic' }}>{disabled ? '— off —' : 'No windows'}</span>
      )}
      {value.map((w, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: compact ? '3px 6px' : '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <input type="time" value={toHHMM(w.startMinutes)} disabled={disabled}
            onChange={(e) => update(i, { startMinutes: fromHHMM(e.target.value) })}
            style={{ height: compact ? 24 : 30, padding: '0 4px', border: 'none', background: 'transparent', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'monospace' }} />
          <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>→</span>
          <input type="time" value={toHHMM(w.endMinutes)} disabled={disabled}
            onChange={(e) => update(i, { endMinutes: fromHHMM(e.target.value) })}
            style={{ height: compact ? 24 : 30, padding: '0 4px', border: 'none', background: 'transparent', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'monospace' }} />
          {!disabled && (
            <button onClick={() => remove(i)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 2, marginLeft: 2 }}>
              <Icon name="x" size={11} strokeWidth={2.5} />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <button onClick={add}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: compact ? '3px 8px' : '6px 12px', background: 'none', border: '1.5px dashed var(--border)', borderRadius: 8, color: 'var(--text-subtle)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
          <Icon name="plus" size={11} strokeWidth={2.5} /> Add window
        </button>
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

  const isDirty = useMemo(() => {
    return (
      api.trim() !== ctx.apiBaseUrl ||
      clinicId.trim() !== ctx.clinicId ||
      branchId.trim() !== (ctx.branchId ?? '') ||
      userId.trim() !== ctx.userId ||
      token.trim() !== (ctx.accessToken ?? '')
    );
  }, [api, clinicId, branchId, userId, token, ctx]);

  function save() {
    if (!isDirty) return;
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
          <button onClick={save} disabled={!isDirty}
            style={{
              height: 38, padding: '0 16px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600,
              cursor: !isDirty ? 'not-allowed' : 'pointer',
              opacity: !isDirty ? 0.6 : 1,
              transition: 'all 0.2s'
            }}>
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
      transition: 'background 160ms var(--ease-out), border-color 160ms var(--ease-out)',
    }}>
      {checked && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"
            strokeDasharray="24" strokeDashoffset="24"
            style={{ animation: 'pathDraw 160ms var(--ease-out) forwards', ['--draw-len' as never]: 24 }} />
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
          <Icon name="cross" size={18} style={{ color: 'var(--brand-text)' }} strokeWidth={2.5} />
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

function StubTab({ icon, title, hint }: { icon: IconName; title: string; hint: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 32, textAlign: 'center' }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--brand-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
        <Icon name={icon} size={22} style={{ color: 'var(--brand-500)' }} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: "'Manrope',sans-serif", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 460, margin: '0 auto', lineHeight: 1.5 }}>{hint}</div>
    </div>
  );
}

// ---------- Branches ----------

type BranchAdmin = {
  _id: string;
  name: string;
  addressLine?: string;
  phone?: string;
  open?: string;
  close?: string;
  slotsPerDay?: number;
  active: boolean;
  doctorCount: number;
};

function BranchesTab() {
  const { ctx, permissions } = useApp();
  const toast = useToast();
  const canRead = permissions.has('clinic:read');
  const canWrite = permissions.has('clinic:write');
  const [branches, setBranches] = useState<BranchAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<BranchAdmin | null>(null);

  function listPath() {
    return `/clinics/${encodeURIComponent(ctx.clinicId)}/branches`;
  }

  async function load() {
    if (!ctx.clinicId) { setError('No clinic in context.'); return; }
    setLoading(true); setError(null);
    try {
      const data = await apiGet<BranchAdmin[]>(ctx, listPath());
      setBranches(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (canRead) void load(); }, [canRead, ctx.clinicId]);

  async function toggleActive(b: BranchAdmin) {
    try {
      const updated = await apiPatch<BranchAdmin>(ctx, `${listPath()}/${b._id}`, { active: !b.active });
      setBranches((bs) => bs.map((x) => (x._id === b._id ? updated : x)));
      toast(updated.active ? 'Branch activated' : 'Branch deactivated', updated.active ? 'success' : 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'error');
    }
  }

  if (!canRead) return <PermissionGate perm="clinic:read" />;

  const activeCount = branches.filter((b) => b.active).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Branches</div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
            {loading ? 'Loading…' : `${branches.length} branch${branches.length === 1 ? '' : 'es'} · ${activeCount} active`}
          </div>
        </div>
        {canWrite && (
          <button onClick={() => setShowAdd(true)} className="press-scale"
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 16px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <Icon name="plus" size={14} strokeWidth={2.5} /> Add branch
          </button>
        )}
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

      {!loading && branches.length === 0 && (
        <div style={{ background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 14, padding: 32, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
          No branches yet. {canWrite ? 'Click "Add branch" to create your first one.' : ''}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {branches.map((b) => (
          <BranchCard key={b._id} branch={b}
            canWrite={canWrite}
            onEdit={() => setEditing(b)}
            onToggle={() => toggleActive(b)} />
        ))}
      </div>

      {showAdd && (
        <BranchSheet mode="create"
          onClose={() => setShowAdd(false)}
          onSaved={(b) => { setBranches((bs) => [...bs, b].sort((a, c) => a.name.localeCompare(c.name))); setShowAdd(false); toast('Branch created', 'success'); }}
        />
      )}
      {editing && (
        <BranchSheet mode="edit" initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(b) => { setBranches((bs) => bs.map((x) => (x._id === b._id ? b : x))); setEditing(null); toast('Branch updated', 'success'); }}
        />
      )}
    </div>
  );
}

function BranchCard({ branch, canWrite, onEdit, onToggle }: { branch: BranchAdmin; canWrite: boolean; onEdit: () => void; onToggle: () => void }) {
  const hours = (branch.open && branch.close) ? `${branch.open} – ${branch.close}` : '—';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand-50)', border: '1px solid var(--brand-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="mapPin" size={20} style={{ color: 'var(--brand-500)' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{branch.name}</span>
          <span style={{ padding: '1px 8px', borderRadius: 100, fontSize: 10, fontWeight: 600,
            background: branch.active ? 'var(--success-bg)' : 'var(--neutral-bg)',
            color: branch.active ? 'var(--success-text)' : 'var(--neutral-text)' }}>
            {branch.active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{branch.addressLine ?? '—'}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: 'var(--text-subtle)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="users" size={12} /> {branch.doctorCount} doctor{branch.doctorCount === 1 ? '' : 's'}
          </span>
          {branch.phone && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="phone" size={12} /> {branch.phone}
            </span>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="clock" size={12} /> {hours}
          </span>
          {branch.slotsPerDay !== undefined && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="calendar" size={12} /> {branch.slotsPerDay} slots/day
            </span>
          )}
        </div>
      </div>
      {canWrite && (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={onToggle}
            style={{
              height: 34, padding: '0 14px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'none',
              border: `1.5px solid ${branch.active ? 'var(--danger-500)' : 'var(--success-500)'}`,
              color: branch.active ? 'var(--danger-500)' : 'var(--success-500)',
            }}>
            {branch.active ? 'Deactivate' : 'Activate'}
          </button>
          <button onClick={onEdit}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 34, padding: '0 14px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <Icon name="edit" size={12} /> Edit
          </button>
        </div>
      )}
    </div>
  );
}

function BranchSheet({ mode, initial, onClose, onSaved }: {
  mode: 'create' | 'edit';
  initial?: BranchAdmin;
  onClose: () => void;
  onSaved: (b: BranchAdmin) => void;
}) {
  const { ctx } = useApp();
  const [name, setName] = useState(initial?.name ?? '');
  const [addressLine, setAddressLine] = useState(initial?.addressLine ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [open, setOpen] = useState(initial?.open ?? '09:00');
  const [close, setClose] = useState(initial?.close ?? '18:00');
  const [slotsPerDay, setSlotsPerDay] = useState(String(initial?.slotsPerDay ?? 20));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    if (mode === 'create') return true; // Always allow save for new ones
    return (
      name.trim() !== (initial?.name ?? '') ||
      addressLine.trim() !== (initial?.addressLine ?? '') ||
      phone.trim() !== (initial?.phone ?? '') ||
      open !== (initial?.open ?? '09:00') ||
      close !== (initial?.close ?? '18:00') ||
      Number(slotsPerDay) !== (initial?.slotsPerDay ?? 20)
    );
  }, [mode, initial, name, addressLine, phone, open, close, slotsPerDay]);

  async function submit() {
    if (!name.trim()) { setError('Branch name is required.'); return; }
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        addressLine: addressLine.trim() || undefined,
        phone: phone.trim() || undefined,
        open: open || undefined,
        close: close || undefined,
        slotsPerDay: slotsPerDay.trim() ? Math.max(0, Number(slotsPerDay) || 0) : undefined,
      };
      const path = `/clinics/${encodeURIComponent(ctx.clinicId)}/branches`;
      const saved = mode === 'create'
        ? await apiPost<BranchAdmin>(ctx, path, body)
        : await apiPatch<BranchAdmin>(ctx, `${path}/${initial!._id}`, body);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', borderRadius: 18, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', animation: 'slideUp 200ms ease-out' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            {mode === 'create' ? 'Add branch' : 'Edit branch'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <Field label="Branch name" value={name} onChange={setName} placeholder="e.g. Juhu" />
          <Field label="Full address" value={addressLine} onChange={setAddressLine} placeholder="Street, area, city — pincode" />
          <Field label="Phone number" value={phone} onChange={setPhone} placeholder="+91 22 XXXX XXXX" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Opens at</label>
              <input type="time" value={open} onChange={(e) => setOpen(e.target.value)}
                style={timeInputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Closes at</label>
              <input type="time" value={close} onChange={(e) => setClose(e.target.value)}
                style={timeInputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Slots / day</label>
              <input type="number" min={0} max={1000} value={slotsPerDay}
                onChange={(e) => setSlotsPerDay(e.target.value)}
                style={timeInputStyle} />
            </div>
          </div>
          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>
        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <button onClick={onClose}
            style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving || !isDirty}
            style={{
              flex: 2, height: 42, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
              cursor: (saving || !isDirty) ? (saving ? 'wait' : 'not-allowed') : 'pointer',
              opacity: (saving || !isDirty) ? 0.6 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.2s'
            }}>
            {saving ? <Spinner /> : (mode === 'create' ? 'Add branch' : 'Save changes')}
          </button>
        </div>
      </div>
    </div>
  );
}

const timeInputStyle: React.CSSProperties = {
  width: '100%', height: 40, padding: '0 12px',
  background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
  fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
};

function UsersTab() {
  return <StubTab icon="users" title="Users"
    hint="User invitations, roles, and deactivation will live here. The backend currently exposes user records via /me only; once a list endpoint exists we'll wire a table with role chips and last-login." />;
}

function NotifConfigTab() {
  return <StubTab icon="bell" title="Notification providers & quiet hours"
    hint="Provider keys (Twilio/WhatsApp Business), quiet hours, and reminder windows will live here. Templates are already editable on the Notifications page." />;
}

function SecurityTab() {
  const { ctx } = useApp();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Session</div>
        <Row label="User">{ctx.fullName ?? ctx.email ?? ctx.userId.slice(-8)}</Row>
        <Row label="Token">{ctx.accessToken ? <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{ctx.accessToken.slice(0, 18)}…</code> : 'dev headers'}</Row>
        <Row label="Refresh">httpOnly cookie <code style={{ fontFamily: 'monospace', fontSize: 11 }}>digirx_refresh</code></Row>
      </div>
      <StubTab icon="lock" title="Audit retention & 2FA"
        hint="Per-clinic 2FA enforcement, session timeouts, and audit log retention will live here. Audit writes are already happening server-side via the global AuditInterceptor." />
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
