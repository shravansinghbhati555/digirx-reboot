import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost, apiPut } from '../../app/api';
import type { DevContext } from '../../app/context';
import { Card, Field, PrimaryButton, ScreenTitle, SecondaryButton, inputSurfaceClass } from '../components/ui';

export function MeScreen({ ctx }: { ctx: DevContext }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const permissions: string[] = useMemo(() => data?.permissions ?? [], [data]);
  const canNotifRead = permissions.includes('notification:read');
  const canNotifWrite = permissions.includes('notification:write');
  const canClinicRead = permissions.includes('clinic:read');
  const canClinicWrite = permissions.includes('clinic:write');

  useEffect(() => {
    setErr(null);
    setData(null);
    apiGet<any>(ctx, '/me')
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, [ctx]);

  const [templates, setTemplates] = useState<any[] | null>(null);
  const [logs, setLogs] = useState<any[] | null>(null);
  const [notifErr, setNotifErr] = useState<string | null>(null);

  async function loadTemplates() {
    setNotifErr(null);
    try {
      const t = await apiGet<any[]>(ctx, '/notifications/templates');
      setTemplates(t);
    } catch (e) {
      setNotifErr(String(e));
    }
  }

  async function loadLogs() {
    setNotifErr(null);
    try {
      const l = await apiGet<any[]>(ctx, '/notifications/logs?limit=50');
      setLogs(l);
    } catch (e) {
      setNotifErr(String(e));
    }
  }

  const [tplKey, setTplKey] = useState('appointment_reminder_120m');
  const [tplBody, setTplBody] = useState('Reminder: appointment at {{appointmentTime}}');

  async function upsertTemplate() {
    setNotifErr(null);
    try {
      await apiPost(ctx, '/notifications/templates', {
        channel: 'SMS',
        key: tplKey,
        body: tplBody,
        active: true,
      });
      await loadTemplates();
    } catch (e) {
      setNotifErr(String(e));
    }
  }

  const [clinicSettings, setClinicSettings] = useState<any | null>(null);
  const [clinicSettingsErr, setClinicSettingsErr] = useState<string | null>(null);
  const [apptMode, setApptMode] = useState<'TIME' | 'QUEUE' | 'BOTH'>('BOTH');
  const [slotMinutes, setSlotMinutes] = useState('15');
  const [inventoryEnabled, setInventoryEnabled] = useState(false);

  async function loadClinicSettings() {
    setClinicSettingsErr(null);
    try {
      const s = await apiGet<any>(ctx, '/clinic/settings');
      setClinicSettings(s);
      setApptMode(s?.settings?.appointments?.mode ?? 'BOTH');
      setSlotMinutes(String(s?.settings?.appointments?.slotMinutesDefault ?? 15));
      setInventoryEnabled(Boolean(s?.settings?.modules?.inventory?.enabled));
    } catch (e) {
      setClinicSettingsErr(String(e));
    }
  }

  async function saveClinicSettings() {
    setClinicSettingsErr(null);
    try {
      const s = await fetch(`${ctx.apiBaseUrl}/clinic/settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { ...(ctx.accessToken ? { Authorization: `Bearer ${ctx.accessToken}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointments: { mode: apptMode, slotMinutesDefault: Number(slotMinutes) },
          modules: { inventory: { enabled: inventoryEnabled } },
        }),
      });
      if (!s.ok) throw new Error(await s.text());
      const json = await s.json();
      setClinicSettings(json);
    } catch (e) {
      setClinicSettingsErr(String(e));
    }
  }

  // Availability (minimal admin UI)
  const [availErr, setAvailErr] = useState<string | null>(null);
  const [availDoctorId, setAvailDoctorId] = useState('');
  const [availBranchId, setAvailBranchId] = useState(ctx.branchId ?? '');
  const [availDate, setAvailDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [availSlots, setAvailSlots] = useState<any[] | null>(null);
  const [ruleWeekday, setRuleWeekday] = useState('1'); // Mon
  const [ruleStart, setRuleStart] = useState('540'); // 09:00
  const [ruleEnd, setRuleEnd] = useState('600'); // 10:00
  const [ruleSlot, setRuleSlot] = useState('15');

  const [ovStart, setOvStart] = useState('540');
  const [ovEnd, setOvEnd] = useState('720');
  const [ovNote, setOvNote] = useState('');

  async function loadSlots() {
    setAvailErr(null);
    try {
      const q = new URLSearchParams({ branchId: availBranchId, date: availDate }).toString();
      const out = await apiGet<any>(ctx, `/availability/doctors/${availDoctorId}/day?${q}`);
      setAvailSlots(out.slots ?? []);
    } catch (e) {
      setAvailErr(String(e));
    }
  }

  async function saveSimpleRule() {
    setAvailErr(null);
    try {
      const q = new URLSearchParams({ branchId: availBranchId }).toString();
      await apiPut<any>(ctx, `/availability/doctors/${availDoctorId}/rules?${q}`, {
        rules: [
          {
            weekday: Number(ruleWeekday),
            slotMinutes: Number(ruleSlot),
            active: true,
            windows: [{ startMinutes: Number(ruleStart), endMinutes: Number(ruleEnd) }],
          },
        ],
      });
      await loadSlots();
    } catch (e) {
      setAvailErr(String(e));
    }
  }

  async function closeOverrideDay() {
    setAvailErr(null);
    try {
      const q = new URLSearchParams({ branchId: availBranchId }).toString();
      await apiPatch<any>(ctx, `/availability/doctors/${availDoctorId}/overrides/${availDate}/close?${q}`, {});
      await loadSlots();
    } catch (e) {
      setAvailErr(String(e));
    }
  }

  async function saveCustomOverrideDay() {
    setAvailErr(null);
    try {
      const q = new URLSearchParams({ branchId: availBranchId }).toString();
      await apiPut<any>(ctx, `/availability/doctors/${availDoctorId}/overrides/${availDate}?${q}`, {
        type: 'CUSTOM_WINDOWS',
        windows: [{ startMinutes: Number(ovStart), endMinutes: Number(ovEnd) }],
        note: ovNote.trim() || undefined,
      });
      await loadSlots();
    } catch (e) {
      setAvailErr(String(e));
    }
  }

  return (
    <section className="space-y-4">
      <ScreenTitle title="Me" subtitle="Profile, clinic admin, notifications, availability." />
      {err ? (
        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/90 p-4 text-sm text-rose-800">{err}</div>
      ) : null}
      <Card title="/me payload">
        <pre className="max-h-64 overflow-auto text-xs text-brand-inkMuted">{JSON.stringify(data, null, 2)}</pre>
      </Card>

      <Card title="Clinic Settings (Admin)">
        {!canClinicRead ? (
          <div className="text-xs text-amber-700">
            Missing <code>clinic:read</code>.
          </div>
        ) : null}
        {clinicSettingsErr ? <div className="mt-2 text-xs font-medium text-rose-700">{clinicSettingsErr}</div> : null}

        <div className="mt-2 grid grid-cols-2 gap-2">
          <SecondaryButton onClick={() => void loadClinicSettings()}>Load settings</SecondaryButton>
          {canClinicWrite ? (
            <PrimaryButton onClick={() => void saveClinicSettings()}>Save</PrimaryButton>
          ) : (
            <SecondaryButton disabled>
              Save (no permission)
            </SecondaryButton>
          )}
        </div>

        {clinicSettings ? (
          <div className="mt-3 space-y-2 rounded-3xl border border-white/70 bg-white/70 p-4 shadow-card ring-1 ring-violet-50/80">
            <div className="text-xs font-semibold text-brand-ink">
              {clinicSettings?.clinic?.name} · {clinicSettings?.clinic?.timezone} · {clinicSettings?.clinic?.currency}
            </div>
            <label className="block">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-inkMuted/90">Appointments mode</div>
              <select
                value={apptMode}
                onChange={(e) => setApptMode(e.target.value as any)}
                className={['mt-1.5', inputSurfaceClass].join(' ')}
              >
                <option value="TIME">TIME</option>
                <option value="QUEUE">QUEUE</option>
                <option value="BOTH">BOTH</option>
              </select>
            </label>
            <Field label="Default slot minutes" value={slotMinutes} onChange={setSlotMinutes} />
            <label className="flex items-center justify-between rounded-2xl border border-violet-100/90 bg-white/90 px-4 py-3 shadow-inner">
              <div className="text-sm font-semibold text-brand-ink">Inventory module enabled</div>
              <input
                type="checkbox"
                checked={inventoryEnabled}
                onChange={(e) => setInventoryEnabled(e.target.checked)}
                className="h-4 w-4 accent-fuchsia-600"
              />
            </label>
            <div className="text-[11px] text-brand-inkMuted">
              Stored in <code>Clinic.settings</code>. Clinic profile fields (timezone/currency/phone) stay outside settings.
            </div>
          </div>
        ) : null}

        {clinicSettings ? (
          <pre className="mt-3 max-h-48 overflow-auto rounded-2xl border border-violet-100/70 bg-violet-50/40 p-3 text-[11px] text-brand-ink shadow-inner ring-1 ring-fuchsia-100/30">
            {JSON.stringify(clinicSettings, null, 2)}
          </pre>
        ) : null}
      </Card>

      <Card title="Doctor Availability (Admin)">
        {!canClinicRead ? (
          <div className="text-xs text-amber-700">
            Missing <code>clinic:read</code>.
          </div>
        ) : null}
        {availErr ? <div className="mt-2 text-xs font-medium text-rose-700">{availErr}</div> : null}

        <div className="mt-2 space-y-2">
          <Field label="Doctor userId" value={availDoctorId} onChange={setAvailDoctorId} placeholder="ObjectId" />
          <Field label="BranchId" value={availBranchId} onChange={setAvailBranchId} placeholder="ObjectId" />
          <Field label="Date (YYYY-MM-DD)" value={availDate} onChange={setAvailDate} />
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton onClick={() => void loadSlots()}>Load slots</SecondaryButton>
            {canClinicWrite ? (
              <PrimaryButton onClick={() => void saveSimpleRule()}>Save simple rule</PrimaryButton>
            ) : (
              <SecondaryButton disabled>Save (no permission)</SecondaryButton>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-2 rounded-3xl border border-white/70 bg-white/70 p-4 shadow-card ring-1 ring-violet-50/80">
          <div className="text-xs font-semibold text-brand-ink">Weekly rule (single window)</div>
          <Field label="Weekday (0=Sun..6=Sat)" value={ruleWeekday} onChange={setRuleWeekday} />
          <Field label="Start minutes (0..1440)" value={ruleStart} onChange={setRuleStart} />
          <Field label="End minutes (0..1440)" value={ruleEnd} onChange={setRuleEnd} />
          <Field label="Slot minutes" value={ruleSlot} onChange={setRuleSlot} />
          <div className="text-[11px] text-brand-inkMuted">
            Example: 540–600 = 09:00–10:00 in clinic timezone. Slots are returned in UTC ISO.
          </div>
        </div>

        <div className="mt-3 space-y-2 rounded-3xl border border-white/70 bg-white/70 p-4 shadow-card ring-1 ring-violet-50/80">
          <div className="text-xs font-semibold text-brand-ink">Day override (uses date above)</div>
          <div className="text-[11px] text-brand-inkMuted">
            Overrides replace the weekly rule for that calendar day only. Times are minutes from midnight in clinic timezone.
          </div>
          <div className="grid grid-cols-2 gap-2">
            {canClinicWrite ? (
              <PrimaryButton onClick={() => void closeOverrideDay()}>Close this day</PrimaryButton>
            ) : (
              <SecondaryButton disabled>Close (no permission)</SecondaryButton>
            )}
            {canClinicWrite ? (
              <PrimaryButton onClick={() => void saveCustomOverrideDay()}>Save custom hours</PrimaryButton>
            ) : (
              <SecondaryButton disabled>Custom (no permission)</SecondaryButton>
            )}
          </div>
          <Field label="Override start minutes" value={ovStart} onChange={setOvStart} />
          <Field label="Override end minutes" value={ovEnd} onChange={setOvEnd} />
          <Field label="Note (optional)" value={ovNote} onChange={setOvNote} />
        </div>

        {availSlots ? (
          <pre className="mt-3 max-h-48 overflow-auto rounded-2xl border border-violet-100/70 bg-violet-50/40 p-3 text-[11px] text-brand-ink shadow-inner ring-1 ring-fuchsia-100/30">
            {JSON.stringify(availSlots.slice(0, 50), null, 2)}
          </pre>
        ) : null}
      </Card>

      <Card title="Notifications (Admin)">
        {!canNotifRead ? (
          <div className="text-xs text-amber-700">
            Missing <code>notification:read</code>. Ask admin to add the permission to your role.
          </div>
        ) : null}

        {notifErr ? <div className="mt-2 text-xs font-medium text-rose-700">{notifErr}</div> : null}

        <div className="mt-2 grid grid-cols-2 gap-2">
          <SecondaryButton onClick={() => void loadTemplates()}>Load templates</SecondaryButton>
          <SecondaryButton onClick={() => void loadLogs()}>Load logs</SecondaryButton>
        </div>

        {canNotifWrite ? (
          <div className="mt-3 space-y-2 rounded-3xl border border-white/70 bg-white/70 p-4 shadow-card ring-1 ring-violet-50/80">
            <div className="text-xs font-semibold text-brand-ink">Upsert SMS template</div>
            <Field label="Key" value={tplKey} onChange={setTplKey} />
            <label className="block">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-inkMuted/90">Body</div>
              <textarea
                value={tplBody}
                onChange={(e) => setTplBody(e.target.value)}
                rows={3}
                className={['mt-1.5 min-h-[6.5rem] resize-y', inputSurfaceClass].join(' ')}
              />
              <div className="mt-1 text-[11px] text-brand-inkMuted">
                Vars: <code>{'{{appointmentTime}}'}</code>, <code>{'{{minutes}}'}</code>
              </div>
            </label>
            <PrimaryButton onClick={() => void upsertTemplate()}>Save template</PrimaryButton>
          </div>
        ) : (
          <div className="mt-3 text-xs font-medium text-amber-800/90">
            Missing <code>notification:write</code> to edit templates.
          </div>
        )}

        {templates ? (
          <div className="mt-3">
            <div className="text-xs font-semibold text-brand-ink">Templates</div>
            <pre className="mt-1 max-h-48 overflow-auto rounded-2xl border border-violet-100/70 bg-violet-50/40 p-3 text-[11px] text-brand-ink shadow-inner ring-1 ring-fuchsia-100/30">
              {JSON.stringify(templates, null, 2)}
            </pre>
          </div>
        ) : null}

        {logs ? (
          <div className="mt-3">
            <div className="text-xs font-semibold text-brand-ink">Logs (latest 50)</div>
            <pre className="mt-1 max-h-48 overflow-auto rounded-2xl border border-violet-100/70 bg-violet-50/40 p-3 text-[11px] text-brand-ink shadow-inner ring-1 ring-fuchsia-100/30">
              {JSON.stringify(logs, null, 2)}
            </pre>
          </div>
        ) : null}
      </Card>
    </section>
  );
}

