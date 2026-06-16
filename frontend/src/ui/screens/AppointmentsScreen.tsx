import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPatch, apiPost, apiPostMultipart } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { AVAILABILITY_CHANGED_EVENT } from '../../app/events';
import { Perm, usePerm } from '../../app/permissions';
import { Avatar, EmptyState, Spinner, StatusPill, labelStyle, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';
import { DatePickerChip } from '../shared/DatePickerChip';
import { ListItemSkeleton, Skeleton } from '../shared/Skeleton';
import { FaceScanModal } from '../shared/FaceScanModal';
import { DocumentsScreen } from './DocumentsScreen';

// Auto-format BP input so the operator only types digits and the "/"
// lands in the right place. Mirrors the helper of the same name in
// EncounterScreen so the triage check-in form and the doctor's
// consultation form behave identically. Heuristic on the first digit:
//   "1" or "2" → 3-digit systolic (120/80, 140/90)
//   "6"–"9"    → 2-digit systolic (90/60, 80/55)
function formatBpInput(input: string, prev: string): string {
  // See encounter screen's formatBp — same behavior, capped to a max
  // of "999/999" (3-digit systolic + slash + 3-digit diastolic).
  let cleaned = input.replace(/[^\d/]/g, '');
  if (cleaned.length < prev.length) return cleaned.slice(0, 7);
  if (cleaned.includes('/')) {
    const [sys = '', dia = ''] = cleaned.split('/');
    return `${sys.slice(0, 3)}/${dia.slice(0, 3)}`;
  }
  cleaned = cleaned.slice(0, 6);
  if (cleaned.length < 2) return cleaned;
  const first = cleaned[0];
  const systolicLen = first === '6' || first === '7' || first === '8' || first === '9' ? 2 : 3;
  if (cleaned.length <= systolicLen) return cleaned;
  return `${cleaned.slice(0, systolicLen)}/${cleaned.slice(systolicLen, systolicLen + 3)}`;
}

type AppointmentType = 'TIME' | 'QUEUE';

type Appointment = {
  _id: string;
  type: AppointmentType;
  status: string;
  doctorId: string;
  patientId: any;
  startAt?: string;
  endAt?: string;
  queueDate?: string;
  queueNumber?: number;
  notes?: string;
  visitTypeId?: string;
  billId?: string;
};

type PatientLite = {
  _id: string;
  mrn?: string;
  fullName: string;
  phones?: string[];
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | string;
  dob?: string;
  tags?: string[];
};

type UserListItem = {
  _id: string;
  name: string;
  roleIds: string[];
  branchIds: string[];
  roles: { _id: string; name: string }[];
};

// Small "pay before check-in" chip. Visible only while the appointment is
// still BOOKED *and* a bill was auto-issued at create time. Tapping it deep-
// links into BillingScreen with the bill pre-selected so the front desk can
// collect payment in one hop. Once the patient is CHECKED_IN (BE gate
// verifies the bill is fully paid) the chip disappears.
function PaymentChip({
  appt, onOpen,
}: { appt: Appointment; onOpen: (billId: string) => void }) {
  if (!appt.billId) return null;
  if (statusKey(appt.status) !== 'BOOKED') return null;
  return (
    <button type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(appt.billId!); }}
      title="Collect consultation fee before check-in"
      style={{
        height: 22, padding: '0 8px',
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)',
        color: '#b45309', borderRadius: 999,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.02em',
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      <Icon name="receipt" size={10} /> Unpaid
    </button>
  );
}

function formatDrName(name: string | undefined): string {
  if (!name) return 'Doctor';
  const trimmed = name.trim();
  if (/^dr\.?\s/i.test(trimmed)) return trimmed;
  return `Dr. ${trimmed}`;
}

// MRN is the human-readable identifier; fall back to a `_id` tail only when
// no MRN was minted (legacy data) or when the patient lookup hasn't resolved.
function patientRefLabel(
  p: { mrn?: string; _id: string } | undefined,
  id?: any,
): string {
  if (p?.mrn) return p.mrn;
  const rawId = typeof id === 'object' ? id?._id : id;
  const fallback = (p?._id ?? rawId ?? '').toString().slice(-6);
  return fallback ? `#${fallback}` : '—';
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);
const EXPANDED_H = 300;
// Collapsed hours are thin strips; only the selected hour (the current
// one by default) expands to the full EXPANDED_H so the doctor sees it
// without scrolling.
const COLLAPSED_H = 48;

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  DONE: { bg: 'var(--success-bg)', border: 'var(--success-500)', text: 'var(--success-text)' },
  CHECKED_IN: { bg: 'var(--teal-bg)', border: 'var(--accent-500)', text: 'var(--teal-text)' },
  IN_PROGRESS: { bg: 'var(--info-bg)', border: 'var(--info-500)', text: 'var(--info-text)' },
  BOOKED: { bg: 'var(--brand-bg-soft)', border: 'var(--brand-500)', text: 'var(--brand-text-strong)' },
  CANCELLED: { bg: 'var(--danger-bg)', border: 'var(--danger-500)', text: 'var(--danger-text)' },
  NO_SHOW: { bg: 'var(--warning-bg)', border: 'var(--warning-500)', text: 'var(--warning-text)' },
};

function statusKey(s: string): string {
  return (s || '').toUpperCase().replace(/-/g, '_');
}

function statusToken(s: string): string {
  return (s || '').toLowerCase().replace(/_/g, '-');
}

function isoToTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}



function isoToMin(iso: string | undefined): number {
  if (!iso) return 0;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  return d.getHours() * 60 + d.getMinutes();
}

// Local YYYY-MM-DD (matches how the grid reads `getHours()` in local
// time, so "is the picked date today?" lines up with the clock).
function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type ApptLayout = { left: string; width: string; zIndex: number; opacity: number };

function isOverlapping(a: Appointment, b: Appointment) {
  const aStart = isoToMin(a.startAt);
  const aEnd = isoToMin(a.endAt) || (aStart + 30);
  const bStart = isoToMin(b.startAt);
  const bEnd = isoToMin(b.endAt) || (bStart + 30);
  return aStart < bEnd && bStart < aEnd;
}

function computeDayLayout(appts: Appointment[]) {
  const active = appts.filter((a) => statusKey(a.status) !== 'CANCELLED');
  const cancelled = appts.filter((a) => statusKey(a.status) === 'CANCELLED');

  const layout = new Map<string, ApptLayout>();

  // 1. Layout active appointments using a multi-column algorithm
  const activeCols: Appointment[][] = [];
  [...active].sort((a, b) => isoToMin(a.startAt) - isoToMin(b.startAt)).forEach((a) => {
    let placed = false;
    for (const col of activeCols) {
      if (isoToMin(a.startAt) >= (isoToMin(col[col.length - 1].endAt) || isoToMin(col[col.length - 1].startAt) + 30)) {
        col.push(a);
        placed = true;
        break;
      }
    }
    if (!placed) activeCols.push([a]);
  });

  activeCols.forEach((col, colIdx) => {
    col.forEach((a) => {
      layout.set(a._id, {
        left: `calc(${(colIdx / activeCols.length) * 100}% + 4px)`,
        width: `calc(${(1 / activeCols.length) * 100}% - 8px)`,
        zIndex: 2,
        opacity: 1,
      });
    });
  });

  // 2. Layout cancelled appointments
  cancelled.forEach((a) => {
    const overlapsWithActive = active.some((other) => isOverlapping(a, other));
    if (overlapsWithActive) {
      // Small ghosted slice on the right
      layout.set(a._id, {
        left: '70%',
        width: 'calc(30% - 8px)',
        zIndex: 1,
        opacity: 0.4,
      });
    } else {
      layout.set(a._id, {
        left: '4px',
        width: 'calc(100% - 8px)',
        zIndex: 1,
        opacity: 0.4,
      });
    }
  });

  return layout;
}


export function AppointmentsScreen() {
  const { ctx, selectedPatientId, setSelectedPatientId, setScreen, setSelectedBillId, selectedDate, setSelectedDate } = useApp();
  const { has } = usePerm();
  const canBook = has(Perm.AppointmentWrite);
  const toast = useToast();
  const date = selectedDate;
  const setDate = setSelectedDate;
  const [showCancelled, setShowCancelled] = useState(false);
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [showBook, setShowBook] = useState(false);
  const [patients, setPatients] = useState<Map<string, PatientLite>>(new Map());
  const [doctors, setDoctors] = useState<Map<string, string>>(new Map());

  // Scroll container for the time-based day grid + a once-a-minute clock
  // tick so the "now" marker tracks the current time and the grid lands
  // on the current hour for the doctor without manual scrolling.
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const isToday = date === localYmd(nowTick);
  const nowMin = nowTick.getHours() * 60 + nowTick.getMinutes();

  // Accordion: exactly one hour is expanded at a time. Default = current
  // hour on today's view; the doctor can tap any hour strip to expand it.
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  const getHourH = (h: number) => (h === selectedHour ? EXPANDED_H : COLLAPSED_H);

  // Cumulative top offsets — heights vary, so we accumulate instead of a
  // flat (h-8)*H. Recomputed whenever the expanded hour changes.
  const hourGeom = useMemo(() => {
    const tops: Record<number, number> = {};
    let acc = 0;
    for (const h of HOURS) {
      tops[h] = acc;
      acc += h === selectedHour ? EXPANDED_H : COLLAPSED_H;
    }
    return { tops, total: acc };
  }, [selectedHour]);

  const getHourTop = (h: number) => hourGeom.tops[h] ?? 0;

  const getTimeTop = (iso: string | undefined) => {
    if (!iso) return 0;
    const min = isoToMin(iso);
    const h = Math.floor(min / 60);
    const m = min % 60;
    return getHourTop(h) + (m / 60) * getHourH(h);
  };

  // Auto-select the current hour when opening today's schedule. For other
  // dates, expand the earliest hour that actually has an appointment so
  // the doctor still lands on something useful. Keyed on date/loading
  // (not nowTick) so it doesn't re-collapse the doctor's manual choice
  // every minute.
  useEffect(() => {
    if (loading) return;
    if (isToday && nowMin >= 8 * 60 && nowMin < 20 * 60) {
      setSelectedHour(Math.floor(nowMin / 60));
    } else {
      const firstApptHour = dayAppts
        .map((a) => Math.floor(isoToMin(a.startAt) / 60))
        .filter((h) => h >= 8 && h <= 19)
        .sort((a, b) => a - b)[0];
      setSelectedHour(firstApptHour ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, loading]);

  // Scroll the expanded hour into view whenever the selection changes
  // (auto on open, or after a tap). A small margin keeps the hour above
  // it partly visible for context.
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el || loading) return;
    if (selectedHour != null) {
      el.scrollTo({ top: Math.max(0, getHourTop(selectedHour) - 56), behavior: 'smooth' });
    } else {
      el.scrollTo({ top: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHour, loading]);

  async function load() {
    if (!ctx.branchId) {
      setError('Set a branch ID (sign in to a branch) to list appointments.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ branchId: ctx.branchId, date });
      const data = await apiGet<Appointment[]>(ctx, `/appointments?${qs.toString()}`);
      setItems(data);
      // Populate the patients map from the already-populated data if available,
      // otherwise lazy-load the rest.
      const next = new Map(patients);
      const missingIds: string[] = [];

      for (const a of data) {
        if (!a.patientId) continue;
        if (typeof a.patientId === 'object' && a.patientId._id) {
          next.set(a.patientId._id, a.patientId);
        } else if (typeof a.patientId === 'string' && !next.has(a.patientId)) {
          missingIds.push(a.patientId);
        }
      }

      if (missingIds.length > 0) {
        await Promise.all(
          Array.from(new Set(missingIds)).map(async (id) => {
            try {
              const p = await apiGet<PatientLite>(ctx, `/patients/${id}`);
              next.set(id, p);
            } catch {
              next.set(id, { _id: id, fullName: id.slice(-6) });
            }
          })
        );
      }
      setPatients(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, ctx.branchId, ctx.clinicId]);

  // Two refresh sources beyond the date/branch deps above:
  //   1) availability-changed events — admin saved/removed an override
  //      on another tab, the cascade likely moved this day's bookings.
  //   2) visibilitychange — the tab was backgrounded; on return the
  //      data might be stale (e.g. someone else booked or rescheduled).
  useEffect(() => {
    function onChange() { void load(); }
    function onVis() { if (document.visibilityState === 'visible') void load(); }
    window.addEventListener(AVAILABILITY_CHANGED_EVENT, onChange);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener(AVAILABILITY_CHANGED_EVENT, onChange);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, ctx.branchId, ctx.clinicId]);

  useEffect(() => {
    apiGet<Array<{ _id: string; name: string }>>(ctx, '/users')
      .then((list) => {
        const next = new Map<string, string>();
        for (const u of list) next.set(u._id, u.name);
        setDoctors(next);
      })
      .catch(() => undefined);
  }, [ctx.clinicId, ctx.accessToken]);

  // Auto-open booking sheet when patient is referred from another screen
  useEffect(() => {
    if (selectedPatientId) setShowBook(true);
  }, [selectedPatientId]);

  const dayAppts = useMemo(() => {
    let filtered = items.filter((a) => a.type === 'TIME');
    if (showCancelled) {
      filtered = filtered.filter(a => statusKey(a.status) === 'CANCELLED');
    } else {
      filtered = filtered.filter(a => statusKey(a.status) !== 'CANCELLED');
    }
    return filtered;
  }, [items, showCancelled]);
  const queueAppts = useMemo(() => {
    let filtered = items.filter((a) => a.type === 'QUEUE');
    if (showCancelled) {
      filtered = filtered.filter(a => statusKey(a.status) === 'CANCELLED');
    } else {
      filtered = filtered.filter(a => statusKey(a.status) !== 'CANCELLED');
    }
    return filtered.sort((a, b) => (a.queueNumber ?? 0) - (b.queueNumber ?? 0));
  }, [items, showCancelled]);

  function shiftDate(deltaDays: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + deltaDays);
    setDate(d.toISOString().slice(0, 10));
  }

  function getName(id: any): string {
    const stringId = typeof id === 'object' ? id?._id : id;
    if (!stringId) return '—';
    return patients.get(stringId)?.fullName ?? (typeof stringId === 'string' ? stringId.slice(-6) : '—');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => shiftDate(-1)}
          aria-label="Previous day"
          style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)' }}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <DatePickerChip value={date} onChange={setDate} size="sm" />
        <button onClick={() => shiftDate(1)}
          aria-label="Next day"
          style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)' }}>
          <Icon name="chevronRight" size={16} />
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setShowCancelled(!showCancelled)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
              background: showCancelled ? 'var(--danger-bg)' : 'var(--surface-muted)',
              border: `1px solid ${showCancelled ? 'var(--danger-500)' : 'var(--border)'}`,
              borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              color: showCancelled ? 'var(--danger-text)' : 'var(--text-subtle)',
              transition: 'all 0.2s'
            }}>
            <Icon name={showCancelled ? 'eye' : 'eyeOff'} size={14} />
            {showCancelled ? 'Showing Cancelled' : 'Show Cancelled'}
          </button>

          <button onClick={() => void load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh appointments"
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: loading ? 'wait' : 'pointer', color: 'var(--text-muted)' }}>
            <Icon name="refresh" size={14} style={{ animation: loading ? 'spin 800ms linear infinite' : undefined }} />
          </button>
        </div>

        <button onClick={() => canBook && setShowBook(true)}
          disabled={!canBook}
          title={canBook ? undefined : 'You do not have permission to book appointments'}
          style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: canBook ? 'pointer' : 'not-allowed', opacity: canBook ? 1 : 0.5 }}>
          <Icon name="plus" size={14} strokeWidth={2.5} /> Book
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 24px', background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid var(--border)', color: 'var(--danger-500)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg)', display: 'flex', flexDirection: 'row' }}>
        {/* Left Column: Walk-in Queue */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Walk-in queue</h2>
                <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{loading ? '—' : queueAppts.filter((a) => statusKey(a.status) === 'BOOKED').length} waiting</p>
              </div>
            </div>
            {loading ? (
              <div style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                {Array.from({ length: 5 }).map((_, i) => <ListItemSkeleton key={i} />)}
              </div>
            ) : queueAppts.length === 0 ? <EmptyState icon="users" title="No queue tokens for this date" /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {queueAppts.map((a) => (
                  // Open the appointment detail panel (ApptSheet) — it
                  // has the role-appropriate action: front desk sees
                  // "Check in patient", the doctor sees "Start
                  // encounter". Jumping straight to /encounters here
                  // broke front-desk check-in (they lack encounter
                  // access, so the shell bounced them to dashboard).
                  <div key={a._id} onClick={() => setSelected(a)}
                    style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 14, cursor: 'pointer' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-muted)', border: '1.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Manrope',sans-serif", fontSize: 18, fontWeight: 800, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {a.queueNumber ?? '—'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{getName(a.patientId)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>
                        {doctors.get(a.doctorId) ? formatDrName(doctors.get(a.doctorId)) : `Doctor #${a.doctorId.slice(-8).toUpperCase()}`}
                      </div>
                    </div>
                    <PaymentChip appt={a} onOpen={(billId) => { setSelectedBillId(billId); setScreen('billing'); }} />
                    <StatusPill status={statusToken(a.status)} small />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Day Grid (Time-based appointments) */}
        <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '24px 24px 0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div>
              <h2 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Time-based appointments</h2>
              <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{loading ? '—' : dayAppts.filter((a) => statusKey(a.status) === 'BOOKED').length} scheduled</p>
            </div>
          </div>
          <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, marginTop: 16, borderTop: '1px solid var(--border)' }}>
            <div ref={gridScrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', background: 'var(--bg)', position: 'relative' }}>
              {/* Labels column */}
              <div style={{ width: 64, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', position: 'relative', minHeight: hourGeom.total }}>
                {HOURS.map((h) => {
                  const expanded = h === selectedHour;
                  return (
                    <div key={h} onClick={() => setSelectedHour(h)}
                      title={expanded ? undefined : `Show ${String(h).padStart(2, '0')}:00`}
                      style={{ position: 'absolute', top: getHourTop(h), left: 0, right: 0, height: getHourH(h), borderBottom: '1px solid var(--border)', boxSizing: 'border-box', cursor: 'pointer', background: expanded ? 'var(--brand-bg-soft)' : 'transparent', display: 'flex', flexDirection: 'column', justifyContent: expanded ? 'flex-start' : 'center' }}>
                      <div style={{ height: expanded ? EXPANDED_H / 4 : 'auto', display: 'flex', alignItems: expanded ? 'flex-start' : 'center', justifyContent: 'flex-end', paddingRight: 8, paddingTop: expanded ? 6 : 0, fontSize: 11, fontWeight: 700, color: expanded ? 'var(--brand-text-strong)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                        {String(h).padStart(2, '0')}:00
                      </div>
                      {expanded && (['15', '30', '45'] as const).map((m) => (
                        <div key={m} style={{ height: EXPANDED_H / 4, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 8, paddingTop: 6, fontSize: 10, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                          {String(h).padStart(2, '0')}:{m}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* Grid and Appointments */}
              <div style={{ flex: 1, position: 'relative', minHeight: hourGeom.total }}>
                {HOURS.map((h) => {
                  const expanded = h === selectedHour;
                  return (
                    <div key={h} onClick={() => setSelectedHour(h)}
                      style={{
                        position: 'absolute', left: 0, right: 0, top: getHourTop(h), height: getHourH(h),
                        borderBottom: '1px solid var(--border)', boxSizing: 'border-box', cursor: 'pointer',
                        background: expanded ? 'var(--surface-muted)' : 'transparent',
                      }}>
                      {expanded && (['15', '30', '45'] as const).map((m) => (
                        <div key={m} style={{ position: 'absolute', left: 0, right: 0, top: (parseInt(m) / 60) * EXPANDED_H, height: 1, borderTop: '1px dashed var(--border)' }} />
                      ))}
                    </div>
                  );
                })}

                {loading && (
                  <div style={{ padding: 20 }}>
                    <Spinner />
                  </div>
                )}

                {(() => {
                  const dayLayout = computeDayLayout(dayAppts);
                  return dayAppts.map((a) => {
                    const top = getTimeTop(a.startAt);
                    const bottom = getTimeTop(a.endAt);
                    // In a collapsed hour the block is a thin bar (just the
                    // name); in the expanded hour it gets the full block.
                    const inExpanded = Math.floor(isoToMin(a.startAt) / 60) === selectedHour;
                    const height = Math.max(bottom - top, inExpanded ? 32 : 16);

                    if (top < 0) return null;

                    const col = STATUS_COLORS[statusKey(a.status)] ?? STATUS_COLORS.BOOKED;
                    const layout = dayLayout.get(a._id) ?? { left: '8px', width: 'calc(100% - 16px)' };

                    // Tiny dot in the corner whenever the appointment has an
                    // unpaid auto-issued bill — keeps the calendar block compact
                    // but still flags "needs payment before check-in" at a glance.
                    const unpaid = !!a.billId && statusKey(a.status) === 'BOOKED';
                    return (
                      <div key={a._id} onClick={(e) => { e.stopPropagation(); setSelected(a); }}
                        title={inExpanded ? undefined : `${getName(a.patientId)} · ${isoToTime(a.startAt)}`}
                        style={{
                          position: 'absolute', left: layout.left, width: layout.width,
                          top: top + 2, height: height - 4,
                          background: col.bg, border: `1.5px solid ${col.border}`,
                          borderRadius: inExpanded ? 10 : 6, padding: inExpanded ? '6px 10px' : '1px 8px', cursor: 'pointer', overflow: 'hidden', zIndex: 2,
                          boxShadow: 'var(--e1)', display: 'flex', flexDirection: 'column', gap: 2,
                          justifyContent: 'center',
                        }}>
                        {unpaid && (
                          <span title="Unpaid · pay before check-in"
                            style={{
                              position: 'absolute', top: 6, right: 8,
                              width: 8, height: 8, borderRadius: 999,
                              background: '#f59e0b', boxShadow: '0 0 0 2px var(--surface)',
                            }} />
                        )}
                        <div style={{ fontSize: inExpanded ? 12 : 10, fontWeight: 700, color: col.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {getName(a.patientId)}
                        </div>
                        {inExpanded && (
                          <div style={{ fontSize: 10, color: col.text, opacity: 0.8 }}>
                            {isoToTime(a.startAt)} → {isoToTime(a.endAt)}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Empty state — pinned to the center of the visible grid area
              (outside the scroll container) so it stays centered instead
              of sitting at the top of the tall, scrollable timeline. */}
            {!loading && dayAppts.length === 0 && !error && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', padding: 24, textAlign: 'center', color: 'var(--text-subtle)' }}>
                <EmptyState icon="calendar" title="No time-based appointments" hint="Use the Book button to create one." />
              </div>
            )}
          </div>
        </div>
      </div>

      {selected && (
        <ApptSheet
          appt={selected}
          patientName={getName(selected.patientId)}
          doctorName={doctors.get(selected.doctorId)}
          patientRef={patientRefLabel(patients.get(selected.patientId), selected.patientId)}
          onClose={() => setSelected(null)}
          onChanged={() => { setSelected(null); void load(); }} />
      )}

      {showBook && (
        <BookSheet
          defaultDate={date}
          defaultPatientId={selectedPatientId}
          onClose={() => { setShowBook(false); setSelectedPatientId(undefined); }}
          onCreated={() => { setShowBook(false); setSelectedPatientId(undefined); toast('Appointment booked', 'success'); void load(); }}
        />
      )}
    </div>
  );
}

function ApptSheet({
  appt, patientName, doctorName, patientRef, onClose, onChanged,
}: {
  appt: Appointment;
  patientName: string;
  doctorName?: string;
  patientRef?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { ctx, setScreen, setSelectedAppointmentId, setSelectedBillId } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [bill, setBill] = useState<any>(null);
  const [billLoading, setBillLoading] = useState(true);
  const [showTriage, setShowTriage] = useState(false);

  useEffect(() => {
    setBillLoading(true);
    apiGet<any>(ctx, `/bills/context/find?appointmentId=${appt._id}`)
      .then(setBill)
      .catch(() => setBill(null))
      .finally(() => setBillLoading(false));
  }, [appt._id, ctx]);

  async function checkIn() {
    setShowTriage(true);
  }

  function startEncounter() {
    setSelectedAppointmentId(appt._id);
    setScreen('encounters');
    onClose();
  }

  function goToBilling() {
    if (bill && bill._id) {
      setSelectedBillId(bill._id);
    } else {
      setSelectedAppointmentId(appt._id);
    }
    setScreen('billing');
    onClose();
  }

  async function cancel() {
    setBusy(true);
    try {
      await apiPatch(ctx, `/appointments/${appt._id}`, { status: 'CANCELLED' });
      toast('Appointment cancelled', 'error');
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Cancel failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  const status = statusKey(appt.status);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', background: 'rgba(15,23,42,0.3)', backdropFilter: 'blur(2px)', animation: 'fadeIn 180ms ease-out' }} onClick={onClose}>
      <div style={{ width: 380, height: '100%', background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: '-8px 0 32px rgba(15,23,42,0.1)', display: 'flex', flexDirection: 'column', animation: 'slideInRight 240ms ease-out' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{appt.type === 'TIME' ? 'Time appointment' : 'Queue token'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>
              {appt.type === 'TIME' ? `${isoToTime(appt.startAt)} → ${isoToTime(appt.endAt)}` : `Token #${appt.queueNumber ?? '—'} · ${appt.queueDate ?? ''}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ flex: 1, padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={patientName} size={44} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>{patientName}</div>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontFamily: 'monospace' }}>{patientRef ?? `#${appt.patientId.slice(-6)}`}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Cell label="Doctor" value={doctorName ? formatDrName(doctorName) : appt.doctorId.slice(-8)} />
            <Cell label="Status" value={statusToken(appt.status)} />
            <Cell label="Type" value={appt.type} />
            <Cell label="ID" value={`#${appt._id.slice(-8).toUpperCase()}`} />
          </div>
          <div><StatusPill status={statusToken(appt.status)} /></div>
          {appt.notes && <div style={{ fontSize: 13, color: 'var(--text-muted)', background: 'var(--surface-muted)', padding: 12, borderRadius: 10 }}>{appt.notes}</div>}

          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Billing</div>
            {billLoading ? (
              <Skeleton height={42} width="100%" radius={12} />
            ) : bill ? (
              <div onClick={goToBilling} style={{ cursor: 'pointer', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{bill.billNo || 'Draft Bill'}</div>
                  <div style={{ marginTop: 2, display: 'flex', gap: 6 }}><StatusPill status={bill.status.toLowerCase()} small /></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-subtle)', fontSize: 12 }}>
                  View <Icon name="chevronRight" size={14} />
                </div>
              </div>
            ) : appt.status === 'DONE' ? (
              <button onClick={goToBilling} style={{ width: '100%', height: 40, background: 'none', border: '1.5px dashed var(--border)', borderRadius: 12, color: 'var(--text-subtle)', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Icon name="receipt" size={14} /> Create Bill
              </button>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '0 4px' }}>Complete the appointment to create a bill.</div>
            )}
          </div>
        </div>
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {status === 'BOOKED' && (
            <button onClick={checkIn} disabled={busy} className="press-scale"
              style={{ height: 42, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="checkCircle" size={14} strokeWidth={2.5} />
              {busy ? 'Checking in…' : 'Check in patient'}
            </button>
          )}
          {status === 'CHECKED_IN' && (
            <button onClick={startEncounter} className="press-scale"
              style={{ height: 42, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="stethoscope" size={14} />
              Start encounter
            </button>
          )}
          {status === 'IN_PROGRESS' && (
            <button onClick={startEncounter} className="press-scale"
              style={{ height: 42, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="clipboard" size={14} />
              Start Consultation
            </button>
          )}
          {/* DONE = the consultation was completed (and likely signed).
                Let the doctor reopen it to view / edit the prescription
                or re-print / re-share any time. The encounter screen
                opens a signed consultation in preview with an Edit
                action. */}
          {status === 'DONE' && (
            <button onClick={startEncounter} className="press-scale"
              style={{ height: 42, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="fileText" size={14} />
              View / Edit prescription
            </button>
          )}
          {(status === 'BOOKED' || status === 'CHECKED_IN') && (
            <button onClick={cancel} disabled={busy} className="press-scale"
              style={{ height: 40, background: 'none', border: '1.5px solid var(--danger-500)', color: 'var(--danger-500)', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
              Cancel appointment
            </button>
          )}
        </div>

        {showTriage && (
          <TriageModal
            appt={appt}
            patientName={patientName}
            onClose={() => setShowTriage(false)}
            onSaved={() => {
              setShowTriage(false);
              onChanged();
            }}
          />
        )}
      </div>
    </div>
  );
}

function TriageModal({
  appt, patientName, onClose, onSaved,
}: {
  appt: Appointment; patientName: string; onClose: () => void; onSaved: () => void;
}) {
  const { ctx } = useApp();
  const { has } = usePerm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState('');
  const [vitals, setVitals] = useState<Record<string, string>>({
    bp: '', spo2: '', temp: '', pulse: '', rr: '', weight: '', height: ''
  });
  // Documents moved here from patient registration: most patients
  // bring paperwork (lab reports, ID, referrals) on the visit day,
  // not when their chart is first created. Scoped to the patient so
  // the doctor sees them on every future visit too.
  const patientIdForDocs: string | null =
    typeof appt.patientId === 'string'
      ? appt.patientId
      : appt.patientId?._id ?? null;
  const canUploadDocs = has(Perm.DocumentWrite);

  async function save() {
    setBusy(true);
    try {
      // 1. Check in if still BOOKED
      if (appt.status === 'BOOKED') {
        await apiPost(ctx, `/appointments/${appt._id}/checkin`, {});
      }

      // 2. Create/Get Encounter Draft
      let encId: string;
      try {
        const existing = await apiGet<any>(ctx, `/encounters/by-appointment/${appt._id}`);
        encId = existing._id;
      } catch {
        const newEnc = await apiPost<any>(ctx, '/encounters', {
          appointmentId: appt._id,
          patientId: appt.patientId?._id || appt.patientId,
          doctorId: appt.doctorId,
          branchId: ctx.branchId,
          chiefComplaint: complaint,
        });
        encId = newEnc._id;
      }

      // 3. Save Vitals (using same mapping as EncounterScreen)
      const out: Record<string, any> = {};
      if (vitals.bp) {
        const parts = vitals.bp.split('/');
        const sys = parseInt(parts[0]?.trim());
        const dia = parseInt(parts[1]?.trim());
        if (!isNaN(sys)) out.bpSystolic = sys;
        if (!isNaN(dia)) out.bpDiastolic = dia;
      }
      if (vitals.spo2) {
        const val = parseInt(vitals.spo2);
        if (!isNaN(val)) out.spo2 = val;
      }
      if (vitals.temp) {
        const val = parseFloat(vitals.temp);
        if (!isNaN(val)) out.temperatureC = parseFloat(((val - 32) * 5 / 9).toFixed(1));
      }
      if (vitals.pulse) {
        const val = parseInt(vitals.pulse);
        if (!isNaN(val)) out.pulseBpm = val;
      }
      if (vitals.rr) {
        const val = parseInt(vitals.rr);
        if (!isNaN(val)) out.respiratoryRate = val;
      }
      if (vitals.weight) {
        const val = parseFloat(vitals.weight);
        if (!isNaN(val)) out.weightKg = val;
      }
      if (vitals.height) {
        const val = parseFloat(vitals.height);
        if (!isNaN(val)) out.heightCm = val;
      }

      await apiPatch(ctx, `/encounters/${encId}`, {
        vitals: out,
        chiefComplaint: complaint || undefined
      });

      // 4. Status is already CHECKED_IN from step 1
      toast('Triage completed & Patient checked in', 'success');
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to save triage', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Two-column body when documents are shown so the modal stays
  // within viewport height. `auto-fit / minmax(320px, 1fr)`
  // collapses the columns into a single stack on narrow viewports
  // (≤~700px wide) so the layout is still usable on a phone.
  const showDocsColumn = canUploadDocs && !!patientIdForDocs;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div
        className="modal-content"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          width: '100%',
          maxWidth: showDocsColumn ? 860 : 440,
          maxHeight: 'calc(100vh - 32px)',
          padding: 24,
          boxShadow: 'var(--e4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Patient Vitals</h3>
            <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{patientName}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer' }}><Icon name="x" size={20} /></button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: showDocsColumn
              ? 'repeat(auto-fit, minmax(320px, 1fr))'
              : '1fr',
            gap: 20,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            paddingRight: 4,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <ModalInput label="Weight (kg)" value={vitals.weight} onChange={v => setVitals({ ...vitals, weight: v })} type="number" />
              <ModalInput label="Height (cm)" value={vitals.height} onChange={v => setVitals({ ...vitals, height: v })} type="number" />
              <ModalInput label="Temp (°F)" value={vitals.temp} onChange={v => setVitals({ ...vitals, temp: v })} type="number" />
              <ModalInput label="Pulse (bpm)" value={vitals.pulse} onChange={v => setVitals({ ...vitals, pulse: v })} type="number" />
              <ModalInput label="SpO2 (%)" value={vitals.spo2} onChange={v => setVitals({ ...vitals, spo2: v })} type="number" />
              <ModalInput label="RR (/min)" value={vitals.rr} onChange={v => setVitals({ ...vitals, rr: v })} type="number" />
              <ModalInput label="BP (mmHg)" value={vitals.bp} onChange={v => setVitals({ ...vitals, bp: formatBpInput(v, vitals.bp) })} placeholder="120/80" />
            </div>
            <div>
              <label style={labelStyle}>Chief Complaint</label>
              <textarea
                value={complaint} onChange={e => setComplaint(e.target.value)}
                placeholder="Optional notes..."
                style={{ width: '100%', height: 80, padding: 10, borderRadius: 10, background: 'var(--surface-muted)', border: '1.5px solid var(--border)', fontSize: 13, outline: 'none', resize: 'none' }}
              />
            </div>
          </div>

          {showDocsColumn && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="folder" size={14} style={{ color: 'var(--brand-500)' }} />
                <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                  Documents (optional)
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                Upload lab reports, ID proofs, referrals — anything the doctor should see this visit.
              </div>
              <div style={{ marginTop: 4, flex: 1, minHeight: 200, maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
                <DocumentsScreen fixedOwnerType="PATIENT" fixedOwnerId={patientIdForDocs} hideAccessLevel />
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={save} disabled={busy} style={{ flex: 1, height: 44, background: 'var(--brand-500)', color: 'white', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {busy ? <Spinner size={16} /> : <><Icon name="check" size={16} /> Check In & Save</>}
          </button>
          <button onClick={onClose} style={{ flex: 1, height: 44, background: 'none', border: '1px solid var(--border)', borderRadius: 10, fontWeight: 600, cursor: 'pointer', color: 'var(--text)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalInput({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', height: 38, padding: '0 10px', borderRadius: 8, background: 'var(--surface-muted)', border: '1.5px solid var(--border)', fontSize: 13, color: 'var(--text)', outline: 'none' }}
      />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--surface-muted)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, marginTop: 3, fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}

// ---------- Book appointment (3-step wizard) ----------

const APPT_TYPES = ['Consultation', 'Follow-up', 'Procedure', 'Telemedicine'] as const;
const ROOMS = ['Room 1', 'Room 2', 'Room 3'] as const;
const DURATIONS = [15, 20, 30, 45, 60] as const;
// Payment methods mirror the set used by the Billing screen's PaymentSheet
// so the front desk sees the same chips/labels in both places.
const PAYMENT_METHODS: { id: string; label: string; icon: 'banknote' | 'smartphone' | 'creditCard' | 'send' | 'arrowUp' }[] = [
  { id: 'CASH', label: 'Cash', icon: 'banknote' },
  { id: 'UPI', label: 'UPI', icon: 'smartphone' },
  { id: 'CARD', label: 'Card', icon: 'creditCard' },
  { id: 'ONLINE', label: 'Online', icon: 'send' },
  { id: 'BANK_TRANSFER', label: 'Bank', icon: 'arrowUp' },
];

type SlotStatus = 'available' | 'booked' | 'past' | 'too-short';

type SlotChoice = {
  startAt: string;
  endAt: string;
  label: string;
  status: SlotStatus;
  bookedBy?: { apptId: string; patientName: string | null; status: string } | null;
};

function getAge(dob?: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const md = now.getMonth() - d.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function genderInitial(g?: string): string {
  const u = (g ?? '').toUpperCase();
  if (u === 'MALE') return 'M';
  if (u === 'FEMALE') return 'F';
  if (u === 'OTHER') return 'O';
  return u.slice(0, 1);
}

function combineToIso(d: string, hm: string): Date {
  const [h, m] = hm.split(':').map(Number);
  const dt = new Date(`${d}T00:00:00`);
  dt.setHours(h, m, 0, 0);
  return dt;
}

function fmtSlotLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function BookSheet({
  defaultDate, defaultPatientId, onClose, onCreated,
}: {
  defaultDate: string;
  defaultPatientId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { ctx, features } = useApp();
  const { has } = usePerm();
  const toast = useToast();
  // 4-step wizard: 1 Patient → 2 Details → 3 Payment → 4 Confirm.
  // Step 3 collects payment info; the appointment + bill + payment are all
  // submitted together at step 4 so an abandoned wizard never leaves a
  // half-created appointment in the DB. Step 3 is skipped when the doctor
  // has no visit-type catalog (no bill would be issued anyway).
  const [step, setStep] = useState<1 | 2 | 3 | 4>(defaultPatientId ? 2 : 1);
  // Payment fields — mirror the PaymentSheet inside BillingScreen so the
  // front desk recognizes the layout. Idempotency key is generated once
  // per wizard so a retry doesn't double-record the payment.
  const [payMethod, setPayMethod] = useState('UPI');
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [payIdempKey] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`));
  // Face-recognition state for step 1. Open the scanner modal, take a
  // shot, POST /face/recognize, then either auto-pick (high
  // confidence) or surface candidates so the front desk can confirm.
  const [showFaceScanner, setShowFaceScanner] = useState(false);
  const [faceMatches, setFaceMatches] = useState<Array<{ patientId: string; fullName: string; mrn?: string; score: number; confidence: 'high' | 'low' | 'none' }>>([]);
  const [faceScanInfo, setFaceScanInfo] = useState<string | null>(null);

  // Step 1
  const [patientQuery, setPatientQuery] = useState('');
  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientLite | null>(null);

  // Step 2
  // When the clinic locks itself to one mode, default the wizard to
  // that mode. 'BOTH' keeps the legacy default of TIME.
  const apptModeSetting = useMemo(() => features.appointmentMode, [features.appointmentMode]);
  const [apptKind, setApptKind] = useState<AppointmentType>(
    apptModeSetting === 'QUEUE' ? 'QUEUE' : 'TIME',
  );
  // If the clinic admin changes the mode while the wizard is open,
  // force the local pick to stay valid.
  useEffect(() => {
    if (apptModeSetting === 'TIME' && apptKind !== 'TIME') setApptKind('TIME');
    else if (apptModeSetting === 'QUEUE' && apptKind !== 'QUEUE') setApptKind('QUEUE');
  }, [apptModeSetting, apptKind]);
  const [date, setDate] = useState(defaultDate);
  const [slotStart, setSlotStart] = useState(''); // 'HH:MM' local
  const [slots, setSlots] = useState<SlotChoice[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotMinutes, setSlotMinutes] = useState<number>(15);
  const [apptType, setApptType] = useState<typeof APPT_TYPES[number]>('Consultation');
  // Per-doctor visit-type catalog. When the picked doctor has any active
  // visit types, the front desk must pick one — that drives the auto-issued
  // bill the patient pays before check-in. Doctors with an empty catalog
  // fall back to the legacy free-text APPT_TYPES dropdown (no bill).
  const [visitTypes, setVisitTypes] = useState<Array<{ _id: string; name: string; price: number; currency: string }>>([]);
  const [visitTypeId, setVisitTypeId] = useState<string>('');
  const [duration, setDuration] = useState<number>(30);
  // Bumped by the manual refresh button AND by the availability-changed
  // event so the slot useEffect re-runs and pulls a fresh view. Without
  // this, an admin updating doctor rules / overrides while the sheet is
  // open leaves the picker showing stale availability.
  const [slotsRefreshKey, setSlotsRefreshKey] = useState(0);
  // Doctor identity is what the slot endpoint queries availability for.
  // It defaults to the signed-in user (the common single-doctor case) but
  // is editable so a receptionist booking on someone else's behalf doesn't
  // silently query the wrong doctor's hours — the bug we shipped this for.
  const [doctorId, setDoctorId] = useState('');
  const [doctors, setDoctors] = useState<UserListItem[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [room, setRoom] = useState<typeof ROOMS[number]>('Room 1');
  const [notes, setNotes] = useState('');

  // Submit
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isIndiaRegion = useMemo(() => {
    if (ctx.currency) {
      return ctx.currency === 'INR';
    }
    if (ctx.timezone) {
      return ctx.timezone === 'Asia/Kolkata';
    }
    const cachedCountry = ctx.userId ? localStorage.getItem(`digirx.detected_country_${ctx.userId}`) : null;
    return cachedCountry === 'IN';
  }, [ctx.currency, ctx.timezone, ctx.userId]);

  useEffect(() => {
    if (isIndiaRegion) {
      setPayMethod('UPI');
    } else {
      setPayMethod('CASH');
    }
  }, [isIndiaRegion]);

  // Load patient list (step 1) — refetch on query change. `cancelled`
  // guards against an older query's response overwriting a newer one's
  // when the user keeps typing while a request is in flight.
  useEffect(() => {
    if (step !== 1) return;
    const q = patientQuery.trim();
    if (q.length < 3) {
      setPatients([]);
      setPatientsLoading(false);
      return;
    }
    setPatientsLoading(true);
    let cancelled = false;
    const qs = new URLSearchParams();
    qs.set('query', q);
    qs.set('limit', '50');
    const t = setTimeout(() => {
      apiGet<PatientLite[]>(ctx, `/patients?${qs.toString()}`)
        .then((r) => { if (!cancelled) setPatients(r); })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!cancelled) setPatientsLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [step, patientQuery, ctx]);

  // Pre-load patient when referred from another screen
  useEffect(() => {
    if (!defaultPatientId) return;
    apiGet<PatientLite>(ctx, `/patients/${defaultPatientId}`)
      .then((p) => setSelectedPatient(p))
      .catch(() => undefined);
  }, [defaultPatientId, ctx]);

  // Pull the clinic's user list so the doctor picker has names instead of
  // raw ObjectIds. Falls back gracefully if the caller lacks user:read —
  // in that case the picker degrades to a one-option list (the signed-in
  // user), which preserves the previous behavior.
  useEffect(() => {
    setDoctorsLoading(true);
    apiGet<UserListItem[]>(ctx, '/users')
      .then((list) => {
        // Only show users who have the exact 'Doctor' role.
        const branchDoctors = list.filter((u) => {
          const hasBranch = !ctx.branchId || (u.branchIds && u.branchIds.includes(ctx.branchId));
          const isDoctor = u.roles.some((r) => r.name.toLowerCase() === 'doctor');
          return hasBranch && isDoctor;
        });
        setDoctors(branchDoctors);

        // Pick a default doctor: either the first one in the list, 
        // or the current user if they happen to be a doctor in this branch.
        const meAsDoctor = branchDoctors.find(d => d._id === ctx.userId);
        if (meAsDoctor) {
          setDoctorId(meAsDoctor._id);
        } else if (branchDoctors.length > 0) {
          setDoctorId(branchDoctors[0]._id);
        }
      })
      .catch(() => setDoctors([]))
      .finally(() => setDoctorsLoading(false));
  }, [ctx.clinicId, ctx.accessToken, ctx.branchId, ctx.userId]);

  // Pull the picked doctor's visit-type catalog. We only ask for active
  // rows because the picker is a *choose-to-bill* surface — deactivated
  // entries stay invisible until the admin reactivates them in Settings.
  useEffect(() => {
    if (!doctorId) { setVisitTypes([]); setVisitTypeId(''); return; }
    let cancelled = false;
    const qs = new URLSearchParams({ doctorId });
    apiGet<Array<{ _id: string; name: string; price: number; currency: string }>>(ctx, `/visit-types?${qs.toString()}`)
      .then((rows) => {
        if (cancelled) return;
        setVisitTypes(rows);
        // Auto-select the first row so the front desk never lands on a
        // doctor with options but an empty picker.
        setVisitTypeId((prev) => (prev && rows.some((r) => r._id === prev) ? prev : (rows[0]?._id ?? '')));
      })
      .catch(() => { if (!cancelled) { setVisitTypes([]); setVisitTypeId(''); } });
    return () => { cancelled = true; };
  }, [doctorId, ctx]);

  // Whenever the picked visit type changes, prefill the payment amount
  // with its price so the front desk doesn't have to retype. They can
  // still edit it (partial / advance / split payment scenarios).
  useEffect(() => {
    const vt = visitTypes.find((v) => v._id === visitTypeId);
    if (vt) setPayAmount(String(vt.price));
    else setPayAmount('');
  }, [visitTypeId, visitTypes]);

  // Resolve the picked doctor's display label. Prefer the users list (so
  // switching the picker updates the label), then fall back to ctx.fullName
  // when the picked doctor is the signed-in user, then to a generic label.
  const doctorName = useMemo(() => {
    const match = doctors.find((d) => d._id === doctorId);
    if (match) return formatDrName(match.name);
    if (doctorId === ctx.userId && ctx.fullName) return formatDrName(ctx.fullName);
    return 'Doctor';
  }, [doctorId, doctors, ctx.userId, ctx.fullName]);

  // Load slots (step 2) when doctor / date / duration changes (TIME only).
  // The duration is sent to the backend so each slot's status reflects
  // whether the chosen length actually fits before the next conflict /
  // window-end. Without this the picker would show "available" for slots
  // that would 409 on submit because the duration spills past a booking.
  useEffect(() => {
    if (step !== 2 || apptKind !== 'TIME' || !doctorId.trim() || !date || !ctx.branchId) {
      setSlots([]);
      return;
    }
    setSlotsLoading(true);
    const qs = new URLSearchParams({
      branchId: ctx.branchId,
      date,
      doctorId: doctorId.trim(),
      duration: String(duration),
    });
    apiGet<{
      slotMinutes?: number;
      durationMinutes?: number;
      slots: Array<{
        startAt: string;
        endAt: string;
        status?: SlotStatus;
        bookedBy?: { apptId: string; patientName: string | null; status: string };
      }>;
    }>(ctx, `/appointments/slots?${qs.toString()}`)
      .then((r) => {
        const labeled: SlotChoice[] = (r.slots ?? []).map((s) => ({
          startAt: s.startAt,
          endAt: s.endAt,
          label: fmtSlotLabel(s.startAt),
          status: (s.status ?? 'available') as SlotStatus,
          bookedBy: s.bookedBy ?? null,
        }));

        // Filter out past slots from the primary 'slots' state so that the 
        // total count and grid stay in sync with the user's view.
        const futureSlots = labeled.filter(s => s.status !== 'past');
        setSlots(futureSlots);

        if (typeof r.slotMinutes === 'number' && r.slotMinutes > 0) setSlotMinutes(r.slotMinutes);

        // Auto-pick the first AVAILABLE slot
        const firstAvail = futureSlots.find((s) => s.status === 'available');
        const stillValid = futureSlots.find(
          (s) => s.label === slotStart && s.status === 'available',
        );
        if (firstAvail && !stillValid) {
          setSlotStart(firstAvail.label);
        } else if (!firstAvail) {
          setSlotStart('');
        }
      })
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, apptKind, doctorId, date, ctx.branchId, duration, slotsRefreshKey]);

  // Listen for cross-screen availability changes (override saved /
  // removed in Settings) and bump the refresh key so the slot picker
  // pulls fresh data without the receptionist having to close the sheet.
  useEffect(() => {
    function onChange() { setSlotsRefreshKey((k) => k + 1); }
    window.addEventListener(AVAILABILITY_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(AVAILABILITY_CHANGED_EVENT, onChange);
  }, []);

  // Payment step always shows. When the doctor has a visit-type catalog
  // the BE will auto-issue the bill using the picked row's price; when
  // there's no catalog the front desk types the amount in manually and
  // we send it to the BE as a manual bill (same auto-issue path, just
  // with a typed-in label + amount). Either way the check-in gate
  // applies because the appointment ends up with `billId` set.
  const pickedVisitType = visitTypes.find((v) => v._id === visitTypeId) ?? null;

  function continueFromStep1() {
    if (!selectedPatient) return;
    setStep(2);
  }

  // Called by FaceScanModal after the user captures a frame. POSTs
  // to /face/recognize and either auto-picks the patient (high
  // confidence) or surfaces the candidate list inline so the front
  // desk can confirm before locking in the wrong chart.
  async function handleFaceScan(blob: Blob, opts?: { preDetected?: boolean }) {
    const form = new FormData();
    form.append('image', blob, 'scan.jpg');
    if (opts?.preDetected) form.append('pre_detected', 'true');
    const res = await apiPostMultipart<{
      matches: Array<{ patientId: string; fullName: string; mrn?: string; score: number; confidence: 'high' | 'low' | 'none' }>;
      autoMatch: { patientId: string; fullName: string; mrn?: string; score: number; confidence: 'high' | 'low' | 'none' } | null;
      facesDetected: number;
    }>(ctx, '/face/recognize', form);

    // Pick the top match ONLY when the BE flagged it as `high`
    // confidence. Below that band the cosine score is in the "could
    // be anyone" zone (0.40–HIGH_THRESHOLD on the BE) — auto-picking
    // those produces false positives on non-face inputs and on
    // lookalikes. We'd rather make the operator type than load the
    // wrong patient chart.
    const top = res.matches[0];
    if (top && top.confidence === 'high') {
      try {
        const full = await apiGet<PatientLite>(ctx, `/patients/${top.patientId}`);
        setSelectedPatient(full);
        setFaceMatches([]);
        setFaceScanInfo(null);
        setShowFaceScanner(false);
        setStep(2);
        return;
      } catch (e) {
        setShowFaceScanner(false);
        setFaceMatches([]);
        setFaceScanInfo(`Matched ${top.fullName} but couldn't load the patient — try searching by name. (${e instanceof Error ? e.message : String(e)})`);
        return;
      }
    }

    // No face / no confident match — same message either way so the
    // operator doesn't get confused by a "low confidence" mid-state.
    setFaceMatches([]);
    setShowFaceScanner(false);
    setFaceScanInfo('Face not recognized. Try a different angle, better lighting, or search by name.');
  }

  async function handlePhoneVerify(phone: string) {
    const matches = await apiGet<PatientLite[]>(ctx, `/patients?query=${encodeURIComponent(phone)}`);
    if (!matches || matches.length === 0) {
      throw new Error('No patient found with this mobile number.');
    }
    const exactMatch = matches.find((p) => p.phones?.includes(phone)) ?? matches[0];
    setSelectedPatient(exactMatch);
    setFaceMatches([]);
    setFaceScanInfo(null);
    setShowFaceScanner(false);
    setStep(2);
    toast('Patient verified by phone ✓', 'success');
  }

  async function pickFaceCandidate(patientId: string) {
    try {
      const full = await apiGet<PatientLite>(ctx, `/patients/${patientId}`);
      setSelectedPatient(full);
      setFaceMatches([]);
      setFaceScanInfo(null);
      // Confirming a low-confidence candidate is the same intent as
      // the auto-match path — the operator has now committed to a
      // patient, so push them straight to step 2.
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function continueFromStep2() {
    if (!doctorId.trim()) { setError('Doctor is required.'); return; }
    if (apptKind === 'TIME' && !slotStart) { setError('Pick a time slot.'); return; }
    if (visitTypes.length > 0 && !visitTypeId) {
      setError('Pick a visit type so a bill can be issued.');
      return;
    }
    // Auto-fill the payment amount with the visit type's catalog
    // price so the operator's default action collects the full fee.
    // Without this, the amount field starts empty and an operator can
    // forget to type — the appointment gets booked but the bill stays
    // unpaid, blocking check-in later. The operator can still adjust
    // the value before clicking through to step 4 (over-pay / etc).
    const vt = visitTypes.find((v) => v._id === visitTypeId);
    if (vt) setPayAmount(String(vt.price));
    setError(null);
    setStep(3);
  }

  function continueFromStep3() {
    const amountNum = Number(payAmount);
    if (!payAmount || !Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Enter a valid payment amount.');
      return;
    }
    // When a visit-type is picked the BE pegs the bill at its catalog
    // price — refuse to advance if the front desk typed a smaller amount,
    // otherwise the patient walks in underpaid.
    if (pickedVisitType && amountNum < pickedVisitType.price) {
      setError(`Amount is less than the consultation fee (${pickedVisitType.currency} ${pickedVisitType.price.toLocaleString('en-IN')}). Collect the full amount before continuing.`);
      return;
    }
    setError(null);
    setStep(4);
  }

  async function submit() {
    if (!ctx.branchId) { setError('Branch ID is required (sign in to a branch).'); return; }
    if (!selectedPatient) { setError('Patient is required.'); return; }
    if (!doctorId.trim()) { setError('Doctor is required.'); return; }
    if (visitTypes.length > 0 && !visitTypeId) { setError('Pick a visit type so a bill can be issued.'); return; }
    const amountNum = Number(payAmount);
    if (!payAmount || !Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Payment amount is required.');
      return;
    }
    setSaving(true); setError(null);
    try {
      // 1) Create the appointment. The BE auto-issues a SERVICE bill when
      //    `visitTypeId` OR `manualBillAmount + manualBillLabel` are set,
      //    and returns the appointment row with `billId` populated.
      const billLabel = pickedVisitType?.name ?? apptType;
      let body: Record<string, unknown>;
      if (apptKind === 'QUEUE') {
        body = {
          type: 'QUEUE',
          branchId: ctx.branchId,
          doctorId: doctorId.trim(),
          patientId: selectedPatient._id,
          queueDate: date,
          notes: notes.trim() || undefined,
          visitTypeId: visitTypeId || undefined,
          // Only send manual bill fields when there's no visit type;
          // visit-type wins on the BE.
          manualBillAmount: visitTypeId ? undefined : amountNum,
          manualBillLabel: visitTypeId ? undefined : billLabel,
        };
      } else {
        if (!slotStart) { setError('Time slot is required.'); setSaving(false); return; }
        const start = combineToIso(date, slotStart);
        const end = new Date(start.getTime() + duration * 60_000);
        if (start.getTime() < Date.now()) {
          setError('That time slot is in the past — pick a future slot.');
          setSaving(false);
          return;
        }
        const composedNotes = [billLabel, room, notes.trim()].filter(Boolean).join(' · ');
        body = {
          type: 'TIME',
          branchId: ctx.branchId,
          doctorId: doctorId.trim(),
          patientId: selectedPatient._id,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          notes: composedNotes,
          visitTypeId: visitTypeId || undefined,
          manualBillAmount: visitTypeId ? undefined : amountNum,
          manualBillLabel: visitTypeId ? undefined : billLabel,
        };
      }
      const created = await apiPost<{ _id: string; billId?: string }>(ctx, '/appointments', body);

      // 2) Record the payment against the auto-issued bill. Idempotency
      //    key was generated when the wizard mounted, so a retry on a
      //    transient failure won't double-charge. A payment failure does
      //    NOT roll back the appointment — surface the error and let the
      //    front desk settle from BillingScreen.
      if (created.billId) {
        try {
          await apiPost(ctx, `/bills/${created.billId}/payments`, {
            method: payMethod,
            amount: amountNum,
            providerRef: payRef.trim() || undefined,
            idempotencyKey: payIdempKey,
          });
        } catch (payErr) {
          setError(
            `Appointment booked, but payment recording failed: ${payErr instanceof Error ? payErr.message : String(payErr)}. Settle the bill from Billing → Pending.`,
          );
          setSaving(false);
          onCreated();
          return;
        }
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const totalSteps = 4;
  const stepLabel = step === 1 ? 'Patient' : step === 2 ? 'Details' : step === 3 ? 'Payment' : 'Confirm';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }}>
      {/* Backdrop has no onClick — booking is a multi-step wizard
            with patient + payment data the operator can easily lose to
            a stray click. Closing requires the explicit X button. */}
      <div style={{ background: 'var(--surface)', borderRadius: 18, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 540, animation: 'slideUp 200ms ease-out', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Book appointment</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>Step {step} of {totalSteps} — {stepLabel}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Step indicator — always 4 segments now (Patient/Details/Payment/Confirm). */}
        <div style={{ padding: '12px 24px 0', display: 'flex', gap: 6 }}>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: n <= step ? 'var(--brand-500)' : 'var(--border)',
              transition: 'background 200ms ease-out',
            }} />
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
          {step === 1 && (
            <PatientStep
              query={patientQuery} onQuery={setPatientQuery}
              patients={patients} loading={patientsLoading}
              selected={selectedPatient} onPick={setSelectedPatient}
              canScanFace={features.faceRecognition && has(Perm.FaceRecognize)}
              onScanClick={() => { setFaceScanInfo(null); setShowFaceScanner(true); }}
              faceMatches={faceMatches}
              faceInfo={faceScanInfo}
              onPickFaceMatch={pickFaceCandidate}
              onClearFace={() => { setFaceMatches([]); setFaceScanInfo(null); }}
            />
          )}

          {step === 2 && (
            <DetailsStep
              patient={selectedPatient}
              onChangePatient={() => setStep(1)}
              apptKind={apptKind} setApptKind={setApptKind}
              apptModeSetting={apptModeSetting}
              date={date} setDate={setDate}
              slotStart={slotStart} setSlotStart={setSlotStart}
              slots={slots} slotsLoading={slotsLoading} slotMinutes={slotMinutes}
              doctorId={doctorId} setDoctorId={setDoctorId}
              doctors={doctors} doctorName={doctorName}
              doctorsLoading={doctorsLoading}
              apptType={apptType} setApptType={setApptType}
              visitTypes={visitTypes} visitTypeId={visitTypeId} setVisitTypeId={setVisitTypeId}
              duration={duration} setDuration={setDuration}
              room={room} setRoom={setRoom}
              notes={notes} setNotes={setNotes}
              onRefreshSlots={() => setSlotsRefreshKey((k) => k + 1)}
            />
          )}

          {step === 3 && (
            <PaymentStep
              visitType={pickedVisitType}
              fallbackLabel={apptType}
              currency={pickedVisitType?.currency ?? 'INR'}
              payMethod={payMethod} setPayMethod={setPayMethod}
              payAmount={payAmount} setPayAmount={setPayAmount}
              payRef={payRef} setPayRef={setPayRef}
              idempotencyKey={payIdempKey}
              isIndiaRegion={isIndiaRegion}
            />
          )}

          {step === 4 && (
            <ConfirmStep
              patient={selectedPatient}
              apptKind={apptKind}
              date={date} time={slotStart} duration={duration}
              apptType={apptType} doctorName={doctorName} room={room}
              visitType={pickedVisitType}
              paid={Number(payAmount) > 0 ? { method: payMethod, amount: Number(payAmount), reference: payRef.trim() || undefined, currency: pickedVisitType?.currency ?? 'INR' } : null}
            />
          )}

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px 20px', display: 'flex', gap: 10, borderTop: '1px solid var(--border)' }}>
          {step === 1 ? (
            <button onClick={continueFromStep1} disabled={!selectedPatient}
              style={{
                flex: 1, height: 44, border: 'none', borderRadius: 10,
                background: selectedPatient ? 'var(--brand-500)' : 'rgba(99,102,241,0.4)',
                color: 'var(--brand-text)', fontSize: 14, fontWeight: 600,
                cursor: selectedPatient ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              Continue <Icon name="chevronRight" size={14} strokeWidth={2.5} />
            </button>
          ) : (
            <>
              <button onClick={() => {
                if (step === 4) setStep(3);
                else if (step === 3) setStep(2);
                else setStep(1);
                setError(null);
              }}
                style={{ flex: 1, height: 44, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
                Back
              </button>
              {step === 2 && (
                <button onClick={continueFromStep2}
                  disabled={!doctorId.trim() || (apptKind === 'TIME' && !slotStart)}
                  style={{
                    flex: 2, height: 44, border: 'none', borderRadius: 10,
                    background: (doctorId.trim() && (apptKind === 'QUEUE' || slotStart)) ? 'var(--brand-500)' : 'rgba(99,102,241,0.4)',
                    color: 'var(--brand-text)', fontSize: 14, fontWeight: 600,
                    cursor: (doctorId.trim() && (apptKind === 'QUEUE' || slotStart)) ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                  Continue <Icon name="chevronRight" size={14} strokeWidth={2.5} />
                </button>
              )}
              {step === 3 && (
                <button onClick={continueFromStep3}
                  disabled={!payAmount || Number(payAmount) <= 0}
                  style={{
                    flex: 2, height: 44, border: 'none', borderRadius: 10,
                    background: payAmount && Number(payAmount) > 0 ? 'var(--brand-500)' : 'rgba(99,102,241,0.4)',
                    color: 'var(--brand-text)', fontSize: 14, fontWeight: 600,
                    cursor: payAmount && Number(payAmount) > 0 ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                  Confirm payment <Icon name="chevronRight" size={14} strokeWidth={2.5} />
                </button>
              )}
              {step === 4 && (
                <button onClick={submit} disabled={saving}
                  style={{ flex: 2, height: 44, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {saving ? <Spinner /> : <><Icon name="check" size={14} strokeWidth={2.5} /> Confirm booking</>}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {showFaceScanner && (
        <FaceScanModal
          title="Identify patient by face"
          hint="Position the patient's face in the frame and capture."
          captureLabel="Capture & match"
          onCancel={() => setShowFaceScanner(false)}
          onCapture={handleFaceScan}
          onPhoneVerify={handlePhoneVerify}
        />
      )}
    </div>
  );
}

function PatientStep({
  query, onQuery, patients, loading, selected, onPick,
  canScanFace, onScanClick,
  faceMatches, faceInfo, onPickFaceMatch, onClearFace,
}: {
  query: string; onQuery: (v: string) => void;
  patients: PatientLite[]; loading: boolean;
  selected: PatientLite | null; onPick: (p: PatientLite) => void;
  canScanFace: boolean;
  onScanClick: () => void;
  faceMatches: Array<{ patientId: string; fullName: string; mrn?: string; score: number; confidence: 'high' | 'low' | 'none' }>;
  faceInfo: string | null;
  onPickFaceMatch: (patientId: string) => void;
  onClearFace: () => void;
}) {
  return (
    <>
      {/* Face-recognition row. Sits above the typed search so the
            quick path is visible first. The scan button is gated on
            face:recognize permission. */}
      {(faceMatches.length > 0 || faceInfo) && (
        <div style={{ background: 'var(--brand-50)', border: '1px solid var(--brand-100)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="camera" size={14} style={{ color: 'var(--brand-600)' }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-700)', flex: 1 }}>
              {faceMatches.length > 0 ? 'Possible matches — confirm one' : 'Face scan'}
            </div>
            <button type="button" onClick={onClearFace}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 2 }}>
              <Icon name="x" size={14} />
            </button>
          </div>
          {faceInfo && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{faceInfo}</div>}
          {faceMatches.map((m) => (
            <button key={m.patientId} type="button" onClick={() => onPickFaceMatch(m.patientId)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                padding: '10px 12px', textAlign: 'left',
                background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 10,
                cursor: 'pointer',
              }}>
              <Avatar name={m.fullName} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.fullName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {[m.mrn ? `#${m.mrn}` : null, `match ${Math.round(m.score * 100)}%`].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span style={{
                padding: '2px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700,
                background: m.confidence === 'high' ? 'var(--success-bg)' : 'var(--warning-bg)',
                color: m.confidence === 'high' ? 'var(--success-text)' : 'var(--warning-text)',
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>
                {m.confidence}
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search by name or phone…"
            style={{
              width: '100%', height: 44, padding: '0 14px 0 40px',
              background: 'var(--surface-muted)', border: '1.5px solid var(--brand-500)', borderRadius: 10,
              fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
            }} />
        </div>
        {canScanFace && (
          <button type="button" onClick={onScanClick}
            title="Identify by face"
            style={{
              height: 44, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--brand-500)', color: 'var(--brand-text)',
              border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}>
            <Icon name="camera" size={14} strokeWidth={2.5} /> Scan face
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
        {query.trim().length < 3 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <Icon name="search" size={32} style={{ color: 'var(--text-subtle)', opacity: 0.2, marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>Search Patients</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>Enter at least 3 characters to search...</div>
          </div>
        ) : loading && patients.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-subtle)' }}>Searching…</div>
        ) : !loading && patients.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-subtle)' }}>No patients match "{query}".</div>
        ) : null}
        {patients.map((p) => {
          const age = getAge(p.dob);
          const phone = p.phones?.[0] ?? '';
          const isSel = selected?._id === p._id;
          return (
            <button key={p._id} onClick={() => onPick(p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                padding: '12px 14px', textAlign: 'left',
                background: isSel ? 'var(--brand-50)' : 'var(--surface-muted)',
                border: `1.5px solid ${isSel ? 'var(--brand-500)' : 'var(--border)'}`,
                borderRadius: 12, cursor: 'pointer', transition: 'all 120ms',
              }}>
              <Avatar name={p.fullName} size={40} imageUrl={(p as { profileImageUrl?: string }).profileImageUrl} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.fullName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
                  {[genderInitial(p.gender), age != null ? `${age}y` : null, phone].filter(Boolean).join(' · ')}
                </div>
              </div>
              <Icon name="chevronRight" size={16} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
    </>
  );
}

function DetailsStep({
  patient, onChangePatient,
  apptKind, setApptKind, apptModeSetting,
  date, setDate, slotStart, setSlotStart, slots, slotsLoading, slotMinutes,
  doctorId, setDoctorId, doctors, doctorName, doctorsLoading,
  apptType, setApptType,
  visitTypes, visitTypeId, setVisitTypeId,
  duration, setDuration,
  room, setRoom, notes, setNotes,
  onRefreshSlots,
}: {
  patient: PatientLite | null;
  onChangePatient: () => void;
  apptKind: AppointmentType; setApptKind: (v: AppointmentType) => void;
  apptModeSetting: 'TIME' | 'QUEUE' | 'BOTH';
  date: string; setDate: (v: string) => void;
  slotStart: string; setSlotStart: (v: string) => void;
  slots: SlotChoice[]; slotsLoading: boolean; slotMinutes: number;
  doctorId: string; setDoctorId: (v: string) => void;
  doctors: Array<{ _id: string; name: string }>;
  doctorName: string;
  doctorsLoading: boolean;
  apptType: typeof APPT_TYPES[number]; setApptType: (v: typeof APPT_TYPES[number]) => void;
  visitTypes: Array<{ _id: string; name: string; price: number; currency: string }>;
  visitTypeId: string; setVisitTypeId: (v: string) => void;
  duration: number; setDuration: (v: number) => void;
  room: typeof ROOMS[number]; setRoom: (v: typeof ROOMS[number]) => void;
  notes: string; setNotes: (v: string) => void;
  onRefreshSlots: () => void;
}) {
  const meta = patient ? [genderInitial(patient.gender) === 'M' ? 'Male' : genderInitial(patient.gender) === 'F' ? 'Female' : 'Other', getAge(patient.dob) != null ? `${getAge(patient.dob)}y` : null].filter(Boolean).join(' · ') : '';

  return (
    <>
      {/* Selected patient pill */}
      {patient && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--brand-50)', border: '1px solid var(--brand-100)', borderRadius: 10 }}>
          <Avatar name={patient.fullName} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand-700)' }}>{patient.fullName}</div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{meta}</div>
          </div>
          <button onClick={onChangePatient} style={{ background: 'none', border: 'none', color: 'var(--brand-600)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Change
          </button>
        </div>
      )}

      {/* Doctor picker — sits at the top of step 2 because slot availability
          and the visit-type catalog both key off the picked doctor. */}
      <div>
        <label style={labelStyle}>Doctor</label>
        <DoctorPicker
          doctorId={doctorId}
          setDoctorId={setDoctorId}
          doctors={doctors}
          fallbackLabel={doctorName}
          loading={doctorsLoading}
        />
      </div>

      {/* Appointment kind toggle — only rendered when the clinic
            allows BOTH. When the admin has locked the clinic to one
            mode, the toggle is pointless; we just render a read-only
            label so the operator still sees which mode they're in. */}
      {apptModeSetting === 'BOTH' ? (
        <div>
          <label style={labelStyle}>Appointment type</label>
          <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10 }}>
            {(['TIME', 'QUEUE'] as const).map((k) => {
              const active = apptKind === k;
              return (
                <button key={k} type="button" onClick={() => setApptKind(k)}
                  style={{
                    flex: 1, height: 36, border: 'none', borderRadius: 8,
                    background: active ? 'var(--surface)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-muted)',
                    fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer',
                    boxShadow: active ? '0 1px 2px rgba(15,23,42,0.06)' : 'none',
                  }}>
                  {k === 'TIME' ? 'Time slot' : 'Walk-in queue'}
                </button>
              );
            })}
          </div>
          {apptKind === 'QUEUE' && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-subtle)' }}>
              A token number will be assigned automatically.
            </div>
          )}
        </div>
      ) : (
        // Mode is locked by the clinic admin — show a read-only
        // indicator so the operator knows which mode is active.
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <Icon name={apptModeSetting === 'QUEUE' ? 'users' : 'clock'} size={14} style={{ color: 'var(--text-muted)' }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            {apptModeSetting === 'QUEUE' ? 'Walk-in queue' : 'Time slot'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginLeft: 4 }}>
            (clinic mode)
          </div>
        </div>
      )}

      <div>
        <label style={labelStyle}>Date</label>
        <DatePickerChip value={date} onChange={setDate} size="sm" fullWidth />
      </div>

      {apptKind === 'TIME' && (
        <>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Time slot</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                  {(slotsLoading || doctorsLoading) ? 'Loading…' : `${slots.length} available`}
                </span>
                <button type="button" onClick={onRefreshSlots} disabled={slotsLoading || doctorsLoading}
                  title="Refresh slots"
                  aria-label="Refresh slots"
                  style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: (slotsLoading || doctorsLoading) ? 'wait' : 'pointer', color: 'var(--text-muted)' }}>
                  <Icon name="refresh" size={11} style={{ animation: (slotsLoading || doctorsLoading) ? 'spin 800ms linear infinite' : undefined }} />
                </button>
              </div>
            </div >
            <TimeSlotGrid
              slotMinutes={slotMinutes}
              available={slots}
              value={slotStart}
              onChange={setSlotStart}
              date={date}
            />
          </div >

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'flex-start' }}>
            <div>
              <label style={labelStyle}>Visit type</label>
              {visitTypes.length > 0 ? (
                <select value={visitTypeId} onChange={(e) => setVisitTypeId(e.target.value)} style={selectStyle}>
                  {visitTypes.map((vt) => (
                    <option key={vt._id} value={vt._id}>
                      {vt.name} — {vt.currency} {vt.price.toLocaleString('en-IN')}
                    </option>
                  ))}
                </select>
              ) : (
                <select value={apptType} onChange={(e) => setApptType(e.target.value as typeof APPT_TYPES[number])} style={selectStyle}>
                  {APPT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              {visitTypes.length === 0 && (
                <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-subtle)' }}>
                  No catalog set — enter the fee manually on the next step.
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Duration</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {DURATIONS.map((d) => (
                  <button key={d} onClick={() => setDuration(d)}
                    style={{
                      padding: '6px 14px', minWidth: 56,
                      border: `1.5px solid ${duration === d ? 'var(--brand-500)' : 'var(--border)'}`,
                      borderRadius: 8, background: duration === d ? 'var(--brand-50)' : 'var(--surface)',
                      color: duration === d ? 'var(--brand-600)' : 'var(--text-muted)',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                    {d}m
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )
      }

      <div>
        <label style={labelStyle}>Room</label>
        <select value={room} onChange={(e) => setRoom(e.target.value as typeof ROOMS[number])} style={selectStyle}>
          {ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div>
        <label style={labelStyle}>
          Notes <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>(optional)</span>
        </label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason for visit, special instructions…"
          style={{
            width: '100%', minHeight: 72, padding: '10px 12px',
            background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
            fontSize: 13, color: 'var(--text)', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
            fontFamily: 'inherit',
          }} />
      </div>

    </>
  );
}

function TimeSlotGrid({
  slotMinutes, available, value, onChange, date,
}: {
  slotMinutes: number;
  available: SlotChoice[];
  value: string;
  onChange: (v: string) => void;
  // YYYY-MM-DD of the currently picked booking date. Drives the
  // "hide past slots" cutoff: when date === today we skip every
  // label before the current minute; future dates show the full
  // grid; past dates show nothing.
  date: string;
}) {
  // Day window: 08:00–20:00 in `slotMinutes` increments. Wide enough for
  // typical clinic hours; slots the doctor's rules don't cover render as
  // dim "off-hours" cells. Backend-returned slots that fall outside this
  // window get added so we never silently hide the doctor's actual hours.
  // O(1) lookup from grid label → slot status / metadata.
  const slotByLabel = new Map(available.map((s) => [s.label, s]));

  // Single per-slot rule: a label is hidden when (picked-date + time)
  // is earlier than the current moment. No day-level branching —
  // future dates show everything, today shows from-now-onward, past
  // dates naturally render nothing because all their slots are
  // earlier than now.
  const nowMs = Date.now();
  function labelIsPast(hhmm: string): boolean {
    const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
    const dt = new Date(`${date}T00:00:00`);
    dt.setHours(h, m, 0, 0);
    return dt.getTime() < nowMs;
  }

  const startMin = 8 * 60;
  const endMin = 20 * 60;
  const step = Math.max(5, Math.min(180, slotMinutes || 15));
  const grid: string[] = [];
  for (let m = startMin; m + step <= endMin; m += step) {
    const label = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (labelIsPast(label)) continue;
    grid.push(label);
  }
  // Add any backend-returned slots that fall outside our 08:00–20:00
  // window — still subject to the past-time cutoff.
  for (const s of available) {
    if (grid.includes(s.label)) continue;
    if (labelIsPast(s.label)) continue;
    grid.push(s.label);
  }
  grid.sort();

  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6,
        maxHeight: 240, overflowY: 'auto',
        padding: 8, background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
      }}>
        {grid.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '32px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
            No future slots available for this day.
          </div>
        )}
        {grid.map((t) => {
          const slot = slotByLabel.get(t);
          // The doctor doesn't have rules for this minute → off-hours.
          // Render a dim placeholder so the grid keeps its rhythm without
          // looking like a bookable slot.
          if (!slot) {
            return (
              <button
                key={t}
                type="button"
                disabled
                title="Doctor not available"
                style={offHoursStyle}>
                {t}
              </button>
            );
          }

          const isSelected = slot.status === 'available' && t === value;
          const isClickable = slot.status === 'available';
          const tooltip =
            slot.status === 'booked'
              ? `Booked${slot.bookedBy?.patientName ? ` · ${slot.bookedBy.patientName}` : ''}`
              : slot.status === 'past'
                ? 'Past time'
                : slot.status === 'too-short'
                  ? "Doesn't fit selected duration"
                  : undefined;

          return (
            <button
              key={t}
              type="button"
              disabled={!isClickable}
              title={tooltip}
              onClick={() => isClickable && onChange(t)}
              style={slotStyle(slot.status, isSelected)}>
              <span style={{ display: 'block', lineHeight: 1.1 }}>{t}</span>
              {slot.status === 'booked' && (
                <span style={{ display: 'block', fontSize: 9, fontWeight: 700, color: 'var(--danger-500)', marginTop: 1, letterSpacing: '0.04em' }}>
                  {slot.bookedBy?.patientName
                    ? slot.bookedBy.patientName
                      .split(/\s+/)
                      .map((p) => p[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()
                    : 'BOOKED'}
                </span>
              )}
            </button>
          );
        })}
        {grid.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 12, fontSize: 12, color: 'var(--text-subtle)' }}>
            No slots configured.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 12, fontSize: 11, color: 'var(--text-subtle)', flexWrap: 'wrap', padding: '0 4px' }}>
        <Legend swatch="var(--surface)" border="var(--border)" label="Available" />
        <Legend swatch="rgba(239,68,68,0.12)" border="rgba(239,68,68,0.4)" label="Booked" />
        <Legend swatch="rgba(245,158,11,0.08)" border="rgba(245,158,11,0.35)" label="Won't fit" />
      </div>
    </div>
  );
}

const offHoursStyle: React.CSSProperties = {
  padding: '7px 4px',
  border: '1.5px dashed var(--border)',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--text-subtle)',
  opacity: 0.35,
  fontSize: 12,
  fontFamily: 'monospace',
  fontWeight: 500,
  cursor: 'not-allowed',
  textDecoration: 'line-through',
};

function slotStyle(status: SlotStatus, isSelected: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '10px 4px',
    borderRadius: 10,
    fontSize: 12,
    fontFamily: "'Manrope', sans-serif",
    transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1.5px solid transparent',
  };
  if (status === 'available') {
    return {
      ...base,
      border: `1.5px solid ${isSelected ? 'var(--brand-500)' : 'var(--border)'}`,
      background: isSelected ? 'var(--brand-50)' : 'var(--surface)',
      color: isSelected ? 'var(--brand-600)' : 'var(--text)',
      fontWeight: isSelected ? 700 : 600,
      cursor: 'pointer',
    };
  }
  if (status === 'booked') {
    // A clear "this is taken" affordance — soft red wash + dashed
    // border so it visually reads as occupied without looking like an
    // error. Patient initials render below; full name is in the tooltip.
    return {
      ...base,
      border: '1.5px solid rgba(239,68,68,0.4)',
      background: 'rgba(239,68,68,0.08)',
      color: 'var(--danger-500)',
      fontWeight: 600,
      cursor: 'not-allowed',
    };
  }
  if (status === 'too-short') {
    // Distinct from "past" so the operator immediately sees that the
    // current duration choice is the reason — switch to a shorter
    // duration and these slots come back as available.
    return {
      ...base,
      border: '1.5px dashed rgba(245,158,11,0.35)',
      background: 'rgba(245,158,11,0.06)',
      color: 'var(--text-subtle)',
      fontWeight: 500,
      cursor: 'not-allowed',
      opacity: 0.7,
    };
  }
  // past
  return {
    ...base,
    border: '1.5px solid var(--border)',
    background: 'var(--surface-muted)',
    color: 'var(--text-subtle)',
    fontWeight: 500,
    cursor: 'not-allowed',
    textDecoration: 'line-through',
    opacity: 0.55,
  };
}

function Legend({ swatch, border, label }: { swatch: string; border: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: swatch, border: `1.5px solid ${border}`, display: 'inline-block' }} />
      {label}
    </span>
  );
}

function DoctorPicker({
  doctorId, setDoctorId, doctors, fallbackLabel, loading,
}: {
  doctorId: string;
  setDoctorId: (v: string) => void;
  doctors: Array<{ _id: string; name: string }>;
  fallbackLabel: string;
  loading?: boolean;
}) {
  // If the current doctorId isn't in the fetched list (e.g., the caller
  // lacks user:read or the list hasn't landed yet), surface a synthetic
  // option so the picker shows *something* coherent instead of going
  // blank — the value attribute drives the selection.
  const inList = doctors.some((d) => d._id === doctorId);
  return (
    <select
      value={doctorId}
      onChange={(e) => setDoctorId(e.target.value)}
      style={{ ...selectStyle, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}
      disabled={loading}
    >
      {loading && <option value="">Loading doctors...</option>}
      {!loading && !inList && doctorId && (
        <option value={doctorId}>{fallbackLabel}</option>
      )}
      {doctors.map((d) => {
        const displayName = d.name.toLowerCase().startsWith('dr.') ? d.name : `Dr. ${d.name}`;
        return (
          <option key={d._id} value={d._id}>{displayName}</option>
        );
      })}
      {!loading && doctors.length === 0 && !doctorId && (
        <option value="">— no doctors available —</option>
      )}
    </select>
  );
}

// Inline payment form rendered as step 3. Mirrors the BillingScreen
// PaymentSheet's layout so the front desk sees a familiar UI: method
// chips, amount field with quick-suggest chips, optional reference, and
// the idempotency key footnote. Works in two modes:
//   • visitType set → amount is pegged to the catalog price (front desk
//     can still type but can't undercollect; enforced at Continue).
//   • visitType null → manual entry, fallbackLabel is shown as the bill
//     line, no preset price, suggestion chips fall back to common
//     consultation amounts.
function PaymentStep({
  visitType, fallbackLabel, currency,
  payMethod, setPayMethod, payAmount, setPayAmount, payRef, setPayRef, idempotencyKey,
  isIndiaRegion,
}: {
  visitType: { _id: string; name: string; price: number; currency: string } | null;
  fallbackLabel: string;
  currency: string;
  payMethod: string; setPayMethod: (v: string) => void;
  payAmount: string; setPayAmount: (v: string) => void;
  payRef: string; setPayRef: (v: string) => void;
  idempotencyKey: string;
  isIndiaRegion: boolean;
}) {
  const due = visitType?.price ?? 0;
  const label = visitType?.name ?? fallbackLabel;
  // Quick-amount suggestion chips removed entirely. With a visit type
  // the amount is the locked catalog fee; for walk-ins the operator
  // types the exact amount. The arbitrary 300/500/1000 chips were
  // just noise.
  const suggestions: number[] = [];

  const filteredPaymentMethods = useMemo(() => {
    if (isIndiaRegion) {
      return PAYMENT_METHODS;
    } else {
      return PAYMENT_METHODS.filter((m) => m.id !== 'UPI');
    }
  }, [isIndiaRegion]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--brand-50)', border: '1px solid var(--brand-100)', borderRadius: 10 }}>
        <Icon name="receipt" size={20} style={{ color: 'var(--brand-600)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand-700)' }}>{label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>
            {visitType ? 'Consultation fee due' : 'Enter the consultation fee to collect'}
          </div>
        </div>
        {visitType && (
          <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 18, fontWeight: 800, color: 'var(--brand-700)', fontVariantNumeric: 'tabular-nums' }}>
            {visitType.currency} {due.toLocaleString('en-IN')}
          </div>
        )}
      </div>

      <div>
        <label style={labelStyle}>Method</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {filteredPaymentMethods.map((m) => (
            <button key={m.id} type="button" onClick={() => setPayMethod(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px',
                border: `1.5px solid ${payMethod === m.id ? 'var(--brand-500)' : 'var(--border)'}`,
                borderRadius: 10,
                background: payMethod === m.id ? 'var(--brand-50)' : 'var(--surface-muted)',
                color: payMethod === m.id ? 'var(--brand-600)' : 'var(--text-muted)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>
              <Icon name={m.icon} size={13} />
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={labelStyle}>
          Amount <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>({currency})</span>
          {visitType && (
            <span style={{ color: 'var(--brand-600)', fontWeight: 600, marginLeft: 6 }}>
              · Full fee (no partial payment)
            </span>
          )}
        </label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Manrope',sans-serif", fontWeight: 700 }}>
            {currency}
          </span>
          <input
            type="number"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            placeholder={visitType ? undefined : 'Enter amount'}
            // When a visit type is picked, the amount is locked to its
            // catalog price (auto-filled in continueFromStep2). Partial
            // payments are disabled for now per clinic policy.
            readOnly={!!visitType}
            style={{
              width: '100%', height: 52, padding: '0 14px 0 44px',
              background: visitType ? 'var(--brand-50)' : 'var(--surface-muted)',
              border: `1.5px solid ${visitType ? 'var(--brand-100)' : 'var(--border)'}`,
              borderRadius: 12,
              fontSize: 22, fontWeight: 700, color: 'var(--text)',
              fontFamily: "'Manrope',sans-serif", outline: 'none', boxSizing: 'border-box',
              fontVariantNumeric: 'tabular-nums',
              cursor: visitType ? 'not-allowed' : 'text',
            }}
          />
        </div>
        {suggestions.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {suggestions.map((v) => (
              <button key={v} type="button" onClick={() => setPayAmount(String(v))}
                style={{
                  padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--surface-muted)', fontSize: 11, fontWeight: 500,
                  color: 'var(--text-muted)', cursor: 'pointer', fontVariantNumeric: 'tabular-nums',
                }}>
                {currency} {v.toLocaleString('en-IN')}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label style={labelStyle}>
          Reference / transaction ID <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          value={payRef}
          onChange={(e) => setPayRef(e.target.value)}
          placeholder="UPI ref, cheque no."
          style={{
            width: '100%', height: 40, padding: '0 12px',
            background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
            fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ background: 'var(--surface-muted)', borderRadius: 12, padding: '10px 12px', border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-subtle)' }}>
        Idempotency key: <code style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{idempotencyKey.slice(0, 8)}…</code>
      </div>
    </>
  );
}

function ConfirmStep({
  patient, apptKind, date, time, duration, apptType, doctorName, room, visitType, paid,
}: {
  patient: PatientLite | null;
  apptKind: AppointmentType;
  date: string; time: string; duration: number;
  apptType: string; doctorName: string; room: string;
  visitType: { _id: string; name: string; price: number; currency: string } | null;
  paid: { method: string; amount: number; reference?: string; currency: string } | null;
}) {
  const typeLabel = visitType?.name ?? apptType;
  const feeRow = visitType
    ? [{ label: 'Fee due', value: `${visitType.currency} ${visitType.price.toLocaleString('en-IN')}`, icon: 'clipboard' as const }]
    : [];
  const paidRow = paid
    ? [{
      label: 'Payment',
      value: `${paid.currency} ${paid.amount.toLocaleString('en-IN')} · ${paid.method}${paid.reference ? ` · ${paid.reference}` : ''}`,
      icon: 'receipt' as const,
    }]
    : [];
  const rows: { label: string; value: string; icon: 'user' | 'calendar' | 'clock' | 'clipboard' | 'stethoscope' | 'mapPin' | 'receipt' }[] = apptKind === 'QUEUE'
    ? [
      { label: 'Patient', value: patient?.fullName ?? '—', icon: 'user' },
      { label: 'Date', value: date || '—', icon: 'calendar' },
      { label: 'Type', value: typeLabel, icon: 'clipboard' },
      { label: 'Doctor', value: doctorName, icon: 'stethoscope' },
      ...feeRow,
      ...paidRow,
    ]
    : [
      { label: 'Patient', value: patient?.fullName ?? '—', icon: 'user' },
      { label: 'Date', value: date || '—', icon: 'calendar' },
      { label: 'Time', value: `${time || '—'} · ${duration} min`, icon: 'clock' },
      { label: 'Type', value: typeLabel, icon: 'clipboard' },
      { label: 'Doctor', value: doctorName, icon: 'stethoscope' },
      { label: 'Room', value: room, icon: 'mapPin' },
      ...feeRow,
      ...paidRow,
    ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--brand-50)', border: '1px solid var(--brand-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
        <Icon name="calendar" size={26} style={{ color: 'var(--brand-500)' }} />
      </div>
      <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>Confirm appointment</div>
      <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginBottom: 10 }}>Please review the details below</div>

      <div style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{
            display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: 12,
            padding: '12px 16px',
            borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
            background: i % 2 === 0 ? 'var(--surface-muted)' : 'var(--surface)',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-subtle)' }}>
              <Icon name={r.icon} size={14} style={{ color: 'var(--brand-500)' }} />
              {r.label}
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%', height: 40, padding: '0 12px',
  background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
  fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
};
