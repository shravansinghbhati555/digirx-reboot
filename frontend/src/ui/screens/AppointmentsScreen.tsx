import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../../app/api';
import type { DevContext } from '../../app/context';
import {
  Card,
  Field,
  ListRow,
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
  SheetFrame,
  inputSurfaceClass,
  pickerListShellClass,
} from '../components/ui';

type Appointment = {
  _id: string;
  type: 'TIME' | 'QUEUE';
  status: string;
  doctorId: string;
  patientId: string;
  startAt?: string;
  endAt?: string;
  queueDate?: string;
  queueNumber?: number;
};

export function AppointmentsScreen({ ctx }: { ctx: DevContext }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState(ctx.branchId ?? '');
  const [doctorId, setDoctorId] = useState('');
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [clinicTz, setClinicTz] = useState<string | null>(null);

  const canCall = useMemo(
    () => Boolean(ctx.apiBaseUrl && ctx.clinicId && (ctx.accessToken || ctx.userId) && branchId),
    [ctx, branchId],
  );

  async function load() {
    if (!canCall) return;
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      qs.set('branchId', branchId);
      qs.set('date', date);
      if (doctorId.trim()) qs.set('doctorId', doctorId.trim());
      const data = await apiGet<Appointment[]>(ctx, `/appointments?${qs.toString()}`);
      setItems(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCall, date]);

  useEffect(() => {
    if (!canCall) return;
    apiGet<any>(ctx, '/clinic/settings')
      .then((s) => setClinicTz(typeof s?.clinic?.timezone === 'string' ? s.clinic.timezone : null))
      .catch(() => setClinicTz(null));
  }, [canCall, ctx]);

  const [showCreate, setShowCreate] = useState(false);

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <ScreenTitle title="Appointments" subtitle="Day view, filters, and booking." />
        <PrimaryButton className="w-auto shrink-0 self-start px-4 py-2.5 text-xs" onClick={() => setShowCreate(true)}>
          New
        </PrimaryButton>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date" value={date} onChange={setDate} />
          <Field label="Branch ID" value={branchId} onChange={setBranchId} />
        </div>
        <div className="mt-2">
          <Field label="Doctor ID (optional)" value={doctorId} onChange={setDoctorId} />
        </div>
        <div className="mt-2 flex justify-end">
          <SecondaryButton
            className="w-auto px-4 py-2.5 text-sm"
            onClick={() => void load()}
            disabled={!canCall || loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </SecondaryButton>
        </div>
        {!canCall ? (
          <div className="mt-2 text-xs font-medium text-amber-800/90">Set branch ID and sign in from Home.</div>
        ) : null}
        {err ? <div className="mt-2 text-xs font-medium text-rose-700">{err}</div> : null}
      </Card>

      <SlotsCard ctx={ctx} branchId={branchId} date={date} doctorId={doctorId} />

      <div className="space-y-2">
        {loading ? <div className="text-sm text-brand-inkMuted">Loading…</div> : null}
        {items.map((a) => (
          <ListRow key={a._id}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-brand-ink">{a.type}</div>
              <div className="text-xs font-medium text-brand-inkMuted">{a.status}</div>
            </div>
            <div className="mt-2 text-xs text-brand-ink">
              Doctor: <span className="font-mono text-brand-inkMuted">{a.doctorId}</span>
            </div>
            <div className="mt-1 text-xs text-brand-ink">
              Patient: <span className="font-mono text-brand-inkMuted">{a.patientId}</span>
            </div>
            {a.type === 'TIME' ? (
              <div className="mt-1 space-y-0.5">
                <div className="text-xs text-brand-ink">
                  {clinicTz && a.startAt ? formatInTimeZone(a.startAt, clinicTz) : a.startAt} →{' '}
                  {clinicTz && a.endAt ? formatInTimeZone(a.endAt, clinicTz) : a.endAt}
                </div>
                <div className="font-mono text-[11px] text-brand-inkMuted">
                  UTC: {a.startAt} → {a.endAt}
                </div>
              </div>
            ) : (
              <div className="mt-1 text-xs text-brand-ink">
                {a.queueDate} • Token #{a.queueNumber}
              </div>
            )}
            <div className="mt-2 font-mono text-[11px] text-brand-inkMuted">ID: {a._id}</div>
          </ListRow>
        ))}
        {!loading && items.length === 0 ? (
          <div className="text-sm text-brand-inkMuted">No appointments.</div>
        ) : null}
      </div>

      {showCreate ? (
        <CreateAppointmentSheet
          ctx={ctx}
          defaultBranchId={branchId}
          defaultDate={date}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      ) : null}
    </section>
  );
}

type PatientRow = { _id: string; fullName: string; phones: string[] };

function SlotsCard({ ctx, branchId, doctorId, date }: { ctx: DevContext; branchId: string; doctorId: string; date: string }) {
  const [slots, setSlots] = useState<{ startAt: string; endAt: string }[] | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [slotErr, setSlotErr] = useState<string | null>(null);
  const [patientId, setPatientId] = useState('');
  const [selectedPatientLabel, setSelectedPatientLabel] = useState<string | null>(null);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientHits, setPatientHits] = useState<PatientRow[] | null>(null);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);

  const canSearchPatients = useMemo(
    () => Boolean(ctx.apiBaseUrl && ctx.clinicId && (ctx.accessToken || ctx.userId)),
    [ctx],
  );

  async function loadSlots() {
    setSlotErr(null);
    setLoading(true);
    try {
      if (!branchId.trim() || !doctorId.trim() || !date.trim()) throw new Error('Set branchId + doctorId + date');
      const qs = new URLSearchParams({ branchId: branchId.trim(), doctorId: doctorId.trim(), date: date.trim() });
      const out = await apiGet<any>(ctx, `/appointments/slots?${qs.toString()}`);
      setSlots(out.slots ?? []);
      setTimezone(typeof out.timezone === 'string' ? out.timezone : null);
    } catch (e) {
      setSlotErr(String(e));
      setSlots(null);
      setTimezone(null);
    } finally {
      setLoading(false);
    }
  }

  async function book(slot: { startAt: string; endAt: string }) {
    setSlotErr(null);
    setBooking(slot.startAt);
    try {
      await apiPost(ctx, '/appointments', {
        type: 'TIME',
        branchId: branchId.trim(),
        doctorId: doctorId.trim(),
        patientId: patientId.trim(),
        startAt: slot.startAt,
        endAt: slot.endAt,
      });
      await loadSlots();
    } catch (e) {
      setSlotErr(String(e));
    } finally {
      setBooking(null);
    }
  }

  async function searchPatients() {
    if (!canSearchPatients) return;
    setPatientSearchLoading(true);
    setSlotErr(null);
    try {
      const qs = new URLSearchParams();
      if (patientQuery.trim()) qs.set('query', patientQuery.trim());
      qs.set('limit', '15');
      const rows = await apiGet<PatientRow[]>(ctx, `/patients?${qs.toString()}`);
      setPatientHits(rows);
    } catch (e) {
      setSlotErr(String(e));
      setPatientHits(null);
    } finally {
      setPatientSearchLoading(false);
    }
  }

  function pickPatient(p: PatientRow) {
    setPatientId(p._id);
    const phone = (p.phones ?? []).find(Boolean);
    setSelectedPatientLabel(phone ? `${p.fullName} · ${phone}` : p.fullName);
    setPatientHits(null);
  }

  function clearPatient() {
    setPatientId('');
    setSelectedPatientLabel(null);
  }

  return (
    <Card title="Available slots (TIME)">
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-inkMuted/90">Patient</div>
        {selectedPatientLabel ? (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-violet-100/90 bg-violet-50/40 px-4 py-3 text-sm ring-1 ring-white/60">
            <span className="min-w-0 truncate text-brand-ink">{selectedPatientLabel}</span>
            <button
              type="button"
              onClick={clearPatient}
              className="tap-scale shrink-0 text-xs font-semibold text-fuchsia-700 hover:text-fuchsia-800"
            >
              Clear
            </button>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <input
            value={patientQuery}
            onChange={(e) => setPatientQuery(e.target.value)}
            placeholder="Search name or phone"
            className={inputSurfaceClass}
          />
          <SecondaryButton
            className="w-full shrink-0 py-2.5 sm:w-auto sm:min-w-[5.5rem]"
            type="button"
            onClick={() => void searchPatients()}
            disabled={!canSearchPatients || patientSearchLoading}
          >
            {patientSearchLoading ? '…' : 'Search'}
          </SecondaryButton>
        </div>
        {!canSearchPatients ? (
          <div className="text-[11px] font-medium text-amber-800/90">Log in (Home) to search patients.</div>
        ) : null}
        {patientHits?.length ? (
          <ul className={['max-h-40', pickerListShellClass].join(' ')}>
            {patientHits.map((p) => (
              <li key={p._id}>
                <button
                  type="button"
                  onClick={() => pickPatient(p)}
                  className="tap-scale w-full border-b border-violet-100/60 px-4 py-2.5 text-left text-sm text-brand-ink last:border-0 hover:bg-fuchsia-50/50 active:bg-violet-50/60"
                >
                  <div className="font-medium">{p.fullName}</div>
                  <div className="font-mono text-[11px] text-brand-inkMuted">{p._id}</div>
                </button>
              </li>
            ))}
          </ul>
        ) : patientHits?.length === 0 ? (
          <div className="text-xs text-brand-inkMuted">No patients match.</div>
        ) : null}
        <Field
          label="Or paste patient ObjectId"
          value={patientId}
          onChange={(v) => {
            setPatientId(v);
            setSelectedPatientLabel(null);
          }}
        />
        {timezone ? (
          <div className="text-[11px] text-brand-inkMuted">
            Displaying times in clinic timezone: <code className="text-brand-ink">{timezone}</code>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <SecondaryButton onClick={() => void loadSlots()}>{loading ? 'Loading…' : 'Load slots'}</SecondaryButton>
          <SecondaryButton disabled={!slots?.length} onClick={() => setSlots(null)}>
            Clear
          </SecondaryButton>
        </div>
        {slotErr ? <div className="text-xs font-medium text-rose-700">{slotErr}</div> : null}

        {slots ? (
          slots.length ? (
            <div className="mt-2 grid grid-cols-1 gap-2">
              {slots.slice(0, 30).map((s) => (
                <button
                  key={`${s.startAt}|${s.endAt}`}
                  type="button"
                  disabled={!patientId.trim() || booking === s.startAt}
                  onClick={() => void book(s)}
                  className="tap-scale w-full rounded-2xl border border-violet-100/85 bg-white/90 px-4 py-3 text-left text-sm font-semibold text-brand-ink shadow-sm ring-1 ring-violet-50/70 transition-shadow hover:border-fuchsia-200/80 hover:shadow-soft disabled:pointer-events-none disabled:opacity-45"
                >
                  <div className="text-xs text-brand-inkMuted">{timezone ? 'Clinic local time' : 'UTC'}</div>
                  <div className="text-sm text-brand-ink">
                    {timezone ? formatInTimeZone(s.startAt, timezone) : s.startAt} →{' '}
                    {timezone ? formatInTimeZone(s.endAt, timezone) : s.endAt}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-brand-inkMuted">
                    UTC: {s.startAt} → {s.endAt}
                  </div>
                </button>
              ))}
              {slots.length > 30 ? (
                <div className="text-xs text-brand-inkMuted">Showing first 30 slots…</div>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 text-sm text-brand-inkMuted">No slots (doctor may be closed/off).</div>
          )
        ) : (
          <div className="mt-2 text-sm text-brand-inkMuted">Load slots to book quickly.</div>
        )}
      </div>
    </Card>
  );
}

function formatInTimeZone(isoUtc: string, timeZone: string) {
  const d = new Date(isoUtc);
  if (!(d instanceof Date) || isNaN(d.getTime())) return isoUtc;
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return isoUtc;
  }
}

function CreateAppointmentSheet({
  ctx,
  defaultBranchId,
  defaultDate,
  onClose,
  onCreated,
}: {
  ctx: DevContext;
  defaultBranchId: string;
  defaultDate: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<'TIME' | 'QUEUE'>('TIME');
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [doctorId, setDoctorId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [patientLabel, setPatientLabel] = useState<string | null>(null);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientHits, setPatientHits] = useState<PatientRow[] | null>(null);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [startAt, setStartAt] = useState(`${defaultDate}T10:00:00.000Z`);
  const [endAt, setEndAt] = useState(`${defaultDate}T10:15:00.000Z`);
  const [queueDate, setQueueDate] = useState(defaultDate);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSearchPatients = useMemo(
    () => Boolean(ctx.apiBaseUrl && ctx.clinicId && (ctx.accessToken || ctx.userId)),
    [ctx],
  );

  async function searchPatientsSheet() {
    if (!canSearchPatients) return;
    setPatientSearchLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (patientQuery.trim()) qs.set('query', patientQuery.trim());
      qs.set('limit', '15');
      const rows = await apiGet<PatientRow[]>(ctx, `/patients?${qs.toString()}`);
      setPatientHits(rows);
    } catch (e) {
      setErr(String(e));
      setPatientHits(null);
    } finally {
      setPatientSearchLoading(false);
    }
  }

  function pickPatientSheet(p: PatientRow) {
    setPatientId(p._id);
    const phone = (p.phones ?? []).find(Boolean);
    setPatientLabel(phone ? `${p.fullName} · ${phone}` : p.fullName);
    setPatientHits(null);
  }

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      const body =
        type === 'TIME'
          ? { type, branchId, doctorId, patientId, startAt, endAt }
          : { type, branchId, doctorId, patientId, queueDate };
      await apiPost(ctx, '/appointments', body);
      onCreated();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetFrame title="New appointment" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <label className="block min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-inkMuted/90">Type</div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'TIME' | 'QUEUE')}
            className={['mt-1.5', inputSurfaceClass].join(' ')}
          >
            <option value="TIME">TIME</option>
            <option value="QUEUE">QUEUE</option>
          </select>
        </label>
        <Field label="Branch ID" value={branchId} onChange={setBranchId} />
      </div>

      <Field label="Doctor ID" value={doctorId} onChange={setDoctorId} />

      <div className="text-xs font-semibold uppercase tracking-wide text-brand-inkMuted/90">Patient</div>
      {patientLabel ? (
        <div className="rounded-2xl border border-violet-100/90 bg-violet-50/40 px-4 py-3 text-sm text-brand-ink ring-1 ring-white/60">
          {patientLabel}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={patientQuery}
          onChange={(e) => setPatientQuery(e.target.value)}
          placeholder="Search name or phone"
          className={inputSurfaceClass}
        />
        <SecondaryButton
          className="w-full shrink-0 py-2.5 sm:w-auto sm:min-w-[5.5rem]"
          type="button"
          onClick={() => void searchPatientsSheet()}
          disabled={!canSearchPatients || patientSearchLoading}
        >
          {patientSearchLoading ? '…' : 'Search'}
        </SecondaryButton>
      </div>
      {patientHits?.length ? (
        <ul className={['max-h-32', pickerListShellClass].join(' ')}>
          {patientHits.map((p) => (
            <li key={p._id}>
              <button
                type="button"
                onClick={() => pickPatientSheet(p)}
                className="tap-scale w-full border-b border-violet-100/60 px-4 py-2.5 text-left text-sm text-brand-ink last:border-0 hover:bg-fuchsia-50/50 active:bg-violet-50/60"
              >
                {p.fullName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Field
        label="Or patient ObjectId"
        value={patientId}
        onChange={(v) => {
          setPatientId(v);
          setPatientLabel(null);
        }}
      />

      {type === 'TIME' ? (
        <>
          <Field label="Start (ISO)" value={startAt} onChange={setStartAt} />
          <Field label="End (ISO)" value={endAt} onChange={setEndAt} />
        </>
      ) : (
        <Field label="Queue date (YYYY-MM-DD)" value={queueDate} onChange={setQueueDate} />
      )}

      {err ? <div className="text-xs font-medium text-rose-700">{err}</div> : null}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton
          onClick={() => void submit()}
          disabled={saving || !branchId.trim() || !doctorId.trim() || !patientId.trim()}
        >
          {saving ? 'Saving…' : 'Create'}
        </PrimaryButton>
      </div>
    </SheetFrame>
  );
}

