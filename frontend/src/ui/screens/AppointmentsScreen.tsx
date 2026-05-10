import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Perm, usePerm } from '../../app/permissions';
import { Avatar, EmptyState, Spinner, StatusPill, labelStyle, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';
import { ListItemSkeleton, Skeleton } from '../shared/Skeleton';

type AppointmentType = 'TIME' | 'QUEUE';

type Appointment = {
  _id: string;
  type: AppointmentType;
  status: string;
  doctorId: string;
  patientId: string;
  startAt?: string;
  endAt?: string;
  queueDate?: string;
  queueNumber?: number;
  notes?: string;
};

type PatientLite = {
  _id: string;
  fullName: string;
  phones?: string[];
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | string;
  dob?: string;
  tags?: string[];
};

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);
const HOUR_H = 72;

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

function WeekView({
  date, weekItems, loading, getName, onSelect, onPickDay, showCancelled,
}: {
  date: string;
  weekItems: Map<string, Appointment[]>;
  loading: boolean;
  getName: (id: string) => string;
  onSelect: (a: Appointment) => void;
  onPickDay: (iso: string) => void;
  showCancelled: boolean;
}) {
  const days = weekDates(date);
  const todayIso = new Date().toISOString().slice(0, 10);
  const COL_W = 120;

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div style={{ width: 60, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', paddingTop: 40 }}>
        {HOURS.map((h) => (
          <div key={h} style={{ height: HOUR_H, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 10, paddingTop: 6, fontSize: 11, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid var(--border)', boxSizing: 'border-box' }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, height: 40, minWidth: COL_W * 7 }}>
          {days.map((d) => {
            const [, mm, dd] = d.split('-');
            const dt = new Date(Number(d.slice(0, 4)), Number(mm) - 1, Number(dd));
            const dayLabel = dt.toLocaleDateString('en-IN', { weekday: 'short' });
            const isToday = d === todayIso;
            return (
              <button key={d} onClick={() => onPickDay(d)}
                style={{
                  flex: 1, minWidth: COL_W, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 1, borderRight: '1px solid var(--border)', padding: '4px 0',
                  background: 'none', border: 'none', cursor: 'pointer',
                }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: isToday ? 'var(--brand-500)' : 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{dayLabel}</span>
                <span style={{
                  fontSize: 13, fontWeight: 700,
                  width: 26, height: 26, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isToday ? 'var(--brand-500)' : 'transparent',
                  color: isToday ? 'var(--brand-text)' : 'var(--text)',
                }}>
                  {dd}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', position: 'relative', display: 'flex', minWidth: COL_W * 7 }}>
          {days.map((d) => {
            let dayAppts = (weekItems.get(d) ?? []).filter((a) => a.type === 'TIME');
            if (showCancelled) {
              dayAppts = dayAppts.filter(a => statusKey(a.status) === 'CANCELLED');
            } else {
              dayAppts = dayAppts.filter(a => statusKey(a.status) !== 'CANCELLED');
            }
            const isToday = d === todayIso;
            return (
              <div key={d} style={{ flex: 1, minWidth: COL_W, borderRight: '1px solid var(--border)', position: 'relative', background: isToday ? 'rgba(59,130,246,0.015)' : 'transparent' }}>
                {HOURS.map((h) => (
                  <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - 8) * HOUR_H, height: HOUR_H, borderBottom: '1px solid var(--border)', boxSizing: 'border-box' }} />
                ))}
                {(() => {
                  const dayLayout = computeDayLayout(dayAppts);
                  return dayAppts.map((a) => {
                    const startMin = isoToMin(a.startAt);
                    const endMin = isoToMin(a.endAt);
                    const dur = Math.max(endMin - startMin, 15);
                    const top = ((startMin - 8 * 60) / 60) * HOUR_H;
                    if (top < 0) return null;
                    const height = Math.max((dur / 60) * HOUR_H - 2, 20);
                    const col = STATUS_COLORS[statusKey(a.status)] ?? STATUS_COLORS.BOOKED;
                    const layout = dayLayout.get(a._id) ?? { left: '2px', width: 'calc(100% - 4px)', zIndex: 1, opacity: 1 };
                    const isCancelled = statusKey(a.status) === 'CANCELLED';

                    return (
                      <div key={a._id} onClick={() => onSelect(a)}
                        style={{
                          position: 'absolute',
                          left: layout.left,
                          width: layout.width,
                          top,
                          height,
                          background: col.bg,
                          border: `1px solid ${col.border}`,
                          borderStyle: isCancelled ? 'dashed' : 'solid',
                          borderRadius: 6,
                          padding: '3px 6px',
                          cursor: 'pointer',
                          overflow: 'hidden',
                          zIndex: layout.zIndex,
                          opacity: layout.opacity,
                        }}>
                        <div style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: col.text,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          lineHeight: 1.3,
                          textDecoration: isCancelled ? 'line-through' : 'none',
                        }}>
                          {getName(a.patientId)}
                          {isCancelled && <span style={{ marginLeft: 2, opacity: 0.6, fontSize: 8 }}>[C]</span>}
                        </div>
                        {height > 28 && <div style={{ fontSize: 9, color: col.text, opacity: 0.8 }}>{isoToTime(a.startAt)}</div>}
                      </div>
                    );
                  });
                })()}
                {loading && (weekItems.get(d) ?? []).length === 0 && (
                  <>
                    <Skeleton style={{ position: 'absolute', top: 1 * HOUR_H + 4, left: 3, right: 3, height: HOUR_H * 0.5 - 4 }} radius={6} />
                    <Skeleton style={{ position: 'absolute', top: 3 * HOUR_H + 8, left: 3, right: 3, height: HOUR_H * 0.75 - 4 }} radius={6} />
                    <Skeleton style={{ position: 'absolute', top: 5 * HOUR_H + 12, left: 3, right: 3, height: HOUR_H * 0.5 - 4 }} radius={6} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function weekDates(centerIso: string): string[] {
  const [y, m, d] = centerIso.split('-').map(Number);
  const center = new Date(y, (m ?? 1) - 1, d ?? 1);
  // Start week on Monday
  const dayOfWeek = center.getDay(); // 0 Sun..6 Sat
  const offsetToMon = (dayOfWeek + 6) % 7;
  const start = new Date(center);
  start.setDate(start.getDate() - offsetToMon);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  });
}

function isoToMin(iso: string | undefined): number {
  if (!iso) return 0;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  return d.getHours() * 60 + d.getMinutes();
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
  const { ctx, selectedPatientId, setSelectedPatientId, setScreen, setSelectedAppointmentId, setSelectedBillId } = useApp();
  const { has } = usePerm();
  const canBook = has(Perm.AppointmentWrite);
  const toast = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [view, setView] = useState<'day' | 'week' | 'queue'>('day');
  const [weekItems, setWeekItems] = useState<Map<string, Appointment[]>>(new Map());
  const [weekLoading, setWeekLoading] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [showBook, setShowBook] = useState(false);
  const [patients, setPatients] = useState<Map<string, PatientLite>>(new Map());

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
      // Lazy-load patient names
      const ids = Array.from(new Set(data.map((a) => a.patientId).filter(Boolean)));
      if (ids.length) {
        const next = new Map(patients);
        await Promise.all(ids.filter((id) => !next.has(id)).map(async (id) => {
          try {
            const p = await apiGet<PatientLite>(ctx, `/patients/${id}`);
            next.set(id, p);
          } catch {
            next.set(id, { _id: id, fullName: id.slice(-6) });
          }
        }));
        setPatients(next);
      }
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

  useEffect(() => {
    if (view !== 'week') return;
    if (!ctx.branchId) return;
    setWeekLoading(true);
    const days = weekDates(date);
    Promise.all(days.map(async (d) => {
      try {
        const qs = new URLSearchParams({ branchId: ctx.branchId!, date: d });
        const data = await apiGet<Appointment[]>(ctx, `/appointments?${qs.toString()}`);
        return [d, data] as const;
      } catch {
        return [d, [] as Appointment[]] as const;
      }
    }))
      .then((results) => {
        const map = new Map<string, Appointment[]>();
        results.forEach(([d, items]) => map.set(d, items));
        setWeekItems(map);
        // Also pull in patient names from week data
        const ids = Array.from(new Set(results.flatMap(([, items]) => items.map((a) => a.patientId))));
        const next = new Map(patients);
        Promise.all(ids.filter((id) => !next.has(id)).map(async (id) => {
          try { next.set(id, await apiGet<PatientLite>(ctx, `/patients/${id}`)); }
          catch { next.set(id, { _id: id, fullName: id.slice(-6) }); }
        })).then(() => setPatients(next));
      })
      .finally(() => setWeekLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date, ctx.branchId, ctx.clinicId]);

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

  function getName(id: string): string {
    return patients.get(id)?.fullName ?? id.slice(-6);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => shiftDate(view === 'week' ? -7 : -1)}
          aria-label={view === 'week' ? 'Previous week' : 'Previous day'}
          style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)' }}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          style={{ height: 32, padding: '0 10px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text)', outline: 'none' }} />
        <button onClick={() => shiftDate(view === 'week' ? 7 : 1)}
          aria-label={view === 'week' ? 'Next week' : 'Next day'}
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

          <div style={{ display: 'flex', gap: 2, background: 'var(--surface-muted)', borderRadius: 10, padding: 3, border: '1px solid var(--border)' }}>
            {(['day', 'week', 'queue'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                style={{ padding: '5px 14px', borderRadius: 8, border: 'none', background: view === v ? 'var(--surface)' : 'transparent', color: view === v ? 'var(--text)' : 'var(--text-muted)', fontSize: 12, fontWeight: view === v ? 600 : 400, cursor: 'pointer', textTransform: 'capitalize' }}>
                {v}
              </button>
            ))}
          </div>
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

      <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
        {view === 'day' && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div style={{ width: 60, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', overflowY: 'auto' }}>
              {HOURS.map((h) => (
                <div key={h} style={{ height: HOUR_H, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 10, paddingTop: 6, fontSize: 11, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid var(--border)', boxSizing: 'border-box' }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
            <div style={{ flex: 1, position: 'relative', background: 'var(--bg)', overflowY: 'auto' }}>
              {HOURS.map((h) => (
                <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - 8) * HOUR_H, height: HOUR_H, borderBottom: '1px solid var(--border)', boxSizing: 'border-box' }} />
              ))}
              {loading && (
                <>
                  {[
                    { hh: 1, dur: 0.5 },
                    { hh: 2.5, dur: 0.75 },
                    { hh: 4, dur: 1 },
                    { hh: 6, dur: 0.5 },
                    { hh: 8.5, dur: 0.75 },
                  ].map((s, i) => (
                    <Skeleton key={i} radius={8}
                      style={{ position: 'absolute', left: 6, right: 6, top: s.hh * HOUR_H + 2, height: s.dur * HOUR_H - 4 }} />
                  ))}
                </>
              )}
              {!loading && dayAppts.length === 0 && !error && (
                <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--text-subtle)' }}>
                  <EmptyState icon="calendar" title="No time-based appointments" hint="Use the Book button to create one." />
                </div>
              )}
              {!loading && dayAppts.map((a) => {
                const startMin = isoToMin(a.startAt);
                const endMin = isoToMin(a.endAt);
                const dur = Math.max(endMin - startMin, 15);
                const top = (startMin - 8 * 60) / 60 * HOUR_H;
                if (top < 0) return null;
                const height = Math.max(dur / 60 * HOUR_H - 2, 28);
                const col = STATUS_COLORS[statusKey(a.status)] ?? STATUS_COLORS.BOOKED;
                return (
                  <div key={a._id} onClick={() => setSelected(a)}
                    style={{ position: 'absolute', left: 4, right: 4, top, height, background: col.bg, border: `1.5px solid ${col.border}`, borderRadius: 8, padding: '4px 8px', cursor: 'pointer', overflow: 'hidden', zIndex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: col.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getName(a.patientId)}</div>
                    {height > 38 && <div style={{ fontSize: 10, color: col.text, opacity: 0.8, marginTop: 1 }}>{isoToTime(a.startAt)} → {isoToTime(a.endAt)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === 'week' && (
          <WeekView
            date={date}
            weekItems={weekItems}
            loading={weekLoading}
            getName={getName}
            onSelect={setSelected}
            onPickDay={(d) => { setDate(d); setView('day'); }}
            showCancelled={showCancelled}
          />
        )}

        {view === 'queue' && (
          <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, maxWidth: 720 }}>
              <div>
                <h2 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Walk-in queue</h2>
                <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{loading ? '—' : queueAppts.filter((a) => statusKey(a.status) === 'BOOKED').length} waiting</p>
              </div>
            </div>
            {loading ? (
              <div style={{ maxWidth: 720, background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                {Array.from({ length: 5 }).map((_, i) => <ListItemSkeleton key={i} />)}
              </div>
            ) : queueAppts.length === 0 ? <EmptyState icon="users" title="No queue tokens for this date" /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
                {queueAppts.map((a) => (
                  <div key={a._id} onClick={() => setSelected(a)}
                    style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 14, cursor: 'pointer' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-muted)', border: '1.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Manrope',sans-serif", fontSize: 18, fontWeight: 800, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {a.queueNumber ?? '—'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{getName(a.patientId)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>Doctor {a.doctorId.slice(-6)}</div>
                    </div>
                    <StatusPill status={statusToken(a.status)} small />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {selected && (
        <ApptSheet appt={selected} patientName={getName(selected.patientId)} onClose={() => setSelected(null)}
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

function ApptSheet({ appt, patientName, onClose, onChanged }: { appt: Appointment; patientName: string; onClose: () => void; onChanged: () => void }) {
  const { ctx, setScreen, setSelectedAppointmentId, setSelectedBillId } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [bill, setBill] = useState<any>(null);
  const [billLoading, setBillLoading] = useState(true);

  useEffect(() => {
    setBillLoading(true);
    apiGet<any>(ctx, `/bills/context/find?appointmentId=${appt._id}`)
      .then(setBill)
      .catch(() => setBill(null))
      .finally(() => setBillLoading(false));
  }, [appt._id, ctx]);

  async function checkIn() {
    setBusy(true);
    try {
      await apiPost(ctx, `/appointments/${appt._id}/checkin`, {});
      toast(`${patientName} checked in`, 'success');
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Check-in failed', 'error');
    } finally {
      setBusy(false);
    }
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
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontFamily: 'monospace' }}>{appt.patientId.slice(-12)}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Cell label="Doctor" value={appt.doctorId.slice(-8)} />
            <Cell label="Status" value={statusToken(appt.status)} />
            <Cell label="Type" value={appt.type} />
            <Cell label="ID" value={appt._id.slice(-8)} />
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
              Continue encounter
            </button>
          )}
          {(status === 'BOOKED' || status === 'CHECKED_IN') && (
            <button onClick={cancel} disabled={busy} className="press-scale"
              style={{ height: 40, background: 'none', border: '1.5px solid var(--danger-500)', color: 'var(--danger-500)', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
              Cancel appointment
            </button>
          )}
        </div>
      </div>
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

type SlotChoice = { startAt: string; endAt: string; label: string };

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
  const { ctx } = useApp();
  const [step, setStep] = useState<1 | 2 | 3>(defaultPatientId ? 2 : 1);

  // Step 1
  const [patientQuery, setPatientQuery] = useState('');
  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientLite | null>(null);

  // Step 2
  const [apptKind, setApptKind] = useState<AppointmentType>('TIME');
  const [date, setDate] = useState(defaultDate);
  const [slotStart, setSlotStart] = useState(''); // 'HH:MM' local
  const [slots, setSlots] = useState<SlotChoice[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotMinutes, setSlotMinutes] = useState<number>(15);
  const [apptType, setApptType] = useState<typeof APPT_TYPES[number]>('Consultation');
  const [duration, setDuration] = useState<number>(30);
  const [doctorId] = useState(ctx.userId);
  const [doctorName, setDoctorName] = useState(ctx.fullName ? `Dr. ${ctx.fullName}` : 'Doctor');
  const [room, setRoom] = useState<typeof ROOMS[number]>('Room 1');
  const [notes, setNotes] = useState('');

  // Submit
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load patient list (step 1) — refetch on query change
  useEffect(() => {
    if (step !== 1) return;
    setPatientsLoading(true);
    const qs = new URLSearchParams();
    if (patientQuery.trim()) qs.set('query', patientQuery.trim());
    qs.set('limit', '50');
    const t = setTimeout(() => {
      apiGet<PatientLite[]>(ctx, `/patients?${qs.toString()}`)
        .then(setPatients)
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setPatientsLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [step, patientQuery, ctx]);

  // Pre-load patient when referred from another screen
  useEffect(() => {
    if (!defaultPatientId) return;
    apiGet<PatientLite>(ctx, `/patients/${defaultPatientId}`)
      .then((p) => setSelectedPatient(p))
      .catch(() => undefined);
  }, [defaultPatientId, ctx]);

  // Load doctor name (best effort) — /me wraps the user under .user
  useEffect(() => {
    if (!doctorId.trim() || ctx.fullName) return;
    apiGet<{ user?: { name?: string; fullName?: string } }>(ctx, `/me`).then((res) => {
      const n = res.user?.fullName ?? res.user?.name;
      if (n) setDoctorName(`Dr. ${n}`);
    }).catch(() => undefined);
  }, [doctorId, ctx]);

  // Whenever ctx.fullName becomes available (e.g., after /me lands), update label
  useEffect(() => {
    if (ctx.fullName) setDoctorName(`Dr. ${ctx.fullName}`);
  }, [ctx.fullName]);

  // Load available slots (step 2) when doctor / date changes (TIME only)
  useEffect(() => {
    if (step !== 2 || apptKind !== 'TIME' || !doctorId.trim() || !date || !ctx.branchId) {
      setSlots([]);
      return;
    }
    setSlotsLoading(true);
    const qs = new URLSearchParams({ branchId: ctx.branchId, date });
    apiGet<{ slotMinutes?: number; slots: { startAt: string; endAt: string }[] }>(
      ctx,
      `/availability/doctors/${doctorId.trim()}/day?${qs.toString()}`,
    )
      .then((r) => {
        const labeled = (r.slots ?? []).map((s) => ({ ...s, label: fmtSlotLabel(s.startAt) }));
        setSlots(labeled);
        if (typeof r.slotMinutes === 'number' && r.slotMinutes > 0) setSlotMinutes(r.slotMinutes);
        if (labeled.length && !labeled.find((s) => s.label === slotStart)) {
          setSlotStart(labeled[0].label);
        }
      })
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, apptKind, doctorId, date, ctx.branchId]);

  function continueFromStep1() {
    if (!selectedPatient) return;
    setStep(2);
  }

  function continueFromStep2() {
    if (!doctorId.trim()) { setError('Doctor is required.'); return; }
    if (apptKind === 'TIME' && !slotStart) { setError('Pick a time slot.'); return; }
    setError(null);
    setStep(3);
  }

  async function submit() {
    if (!ctx.branchId) { setError('Branch ID is required (sign in to a branch).'); return; }
    if (!selectedPatient) { setError('Patient is required.'); return; }
    if (!doctorId.trim()) { setError('Doctor is required.'); return; }
    setSaving(true); setError(null);
    try {
      if (apptKind === 'QUEUE') {
        await apiPost(ctx, '/appointments', {
          type: 'QUEUE',
          branchId: ctx.branchId,
          doctorId: doctorId.trim(),
          patientId: selectedPatient._id,
          queueDate: date,
          notes: notes.trim() || undefined,
        });
      } else {
        if (!slotStart) { setError('Time slot is required.'); setSaving(false); return; }
        const start = combineToIso(date, slotStart);
        const end = new Date(start.getTime() + duration * 60_000);
        const composedNotes = [apptType, room, notes.trim()].filter(Boolean).join(' · ');
        await apiPost(ctx, '/appointments', {
          type: 'TIME',
          branchId: ctx.branchId,
          doctorId: doctorId.trim(),
          patientId: selectedPatient._id,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          notes: composedNotes,
        });
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const stepLabel = step === 1 ? 'Patient' : step === 2 ? 'Details' : 'Confirm';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 18, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 540, animation: 'slideUp 200ms ease-out', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Book appointment</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>Step {step} of 3 — {stepLabel}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ padding: '12px 24px 0', display: 'flex', gap: 6 }}>
          {[1, 2, 3].map((n) => (
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
            />
          )}

          {step === 2 && (
            <DetailsStep
              patient={selectedPatient}
              onChangePatient={() => setStep(1)}
              apptKind={apptKind} setApptKind={setApptKind}
              date={date} setDate={setDate}
              slotStart={slotStart} setSlotStart={setSlotStart}
              slots={slots} slotsLoading={slotsLoading} slotMinutes={slotMinutes}
              apptType={apptType} setApptType={setApptType}
              duration={duration} setDuration={setDuration}
              doctorName={doctorName}
              room={room} setRoom={setRoom}
              notes={notes} setNotes={setNotes}
            />
          )}

          {step === 3 && (
            <ConfirmStep
              patient={selectedPatient}
              apptKind={apptKind}
              date={date} time={slotStart} duration={duration}
              apptType={apptType} doctorName={doctorName} room={room}
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
              <button onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                style={{ flex: 1, height: 44, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
                Back
              </button>
              {step === 2 ? (
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
              ) : (
                <button onClick={submit} disabled={saving}
                  style={{ flex: 2, height: 44, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {saving ? <Spinner /> : <><Icon name="check" size={14} strokeWidth={2.5} /> Confirm booking</>}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PatientStep({
  query, onQuery, patients, loading, selected, onPick,
}: {
  query: string; onQuery: (v: string) => void;
  patients: PatientLite[]; loading: boolean;
  selected: PatientLite | null; onPick: (p: PatientLite) => void;
}) {
  return (
    <>
      <div style={{ position: 'relative' }}>
        <Icon name="search" size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search by name or phone…"
          style={{
            width: '100%', height: 44, padding: '0 14px 0 40px',
            background: 'var(--surface-muted)', border: '1.5px solid var(--brand-500)', borderRadius: 10,
            fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
          }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
        {loading && patients.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-subtle)' }}>Searching…</div>
        )}
        {!loading && patients.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-subtle)' }}>No patients match.</div>
        )}
        {patients.map((p) => {
          const age = getAge(p.dob);
          const phone = p.phones?.[0] ?? '';
          const tag = p.tags?.[0];
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
              <Avatar name={p.fullName} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.fullName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
                  {[genderInitial(p.gender), age != null ? `${age}y` : null, phone].filter(Boolean).join(' · ')}
                </div>
              </div>
              {tag && (
                <span style={{ padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
                  {tag}
                </span>
              )}
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
  apptKind, setApptKind,
  date, setDate, slotStart, setSlotStart, slots, slotsLoading, slotMinutes,
  apptType, setApptType, duration, setDuration,
  doctorName, room, setRoom, notes, setNotes,
}: {
  patient: PatientLite | null;
  onChangePatient: () => void;
  apptKind: AppointmentType; setApptKind: (v: AppointmentType) => void;
  date: string; setDate: (v: string) => void;
  slotStart: string; setSlotStart: (v: string) => void;
  slots: SlotChoice[]; slotsLoading: boolean; slotMinutes: number;
  apptType: typeof APPT_TYPES[number]; setApptType: (v: typeof APPT_TYPES[number]) => void;
  duration: number; setDuration: (v: number) => void;
  doctorName: string;
  room: typeof ROOMS[number]; setRoom: (v: typeof ROOMS[number]) => void;
  notes: string; setNotes: (v: string) => void;
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

      {/* Appointment kind toggle */}
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

      <div>
        <label style={labelStyle}>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={selectStyle} />
      </div>

      {apptKind === 'TIME' && (
        <>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Time slot</label>
              <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                {slotsLoading ? 'Loading…' : `${slots.length} available`}
              </span>
            </div>
            <TimeSlotGrid
              slotMinutes={slotMinutes}
              available={slots}
              value={slotStart}
              onChange={setSlotStart}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'flex-start' }}>
            <div>
              <label style={labelStyle}>Type</label>
              <select value={apptType} onChange={(e) => setApptType(e.target.value as typeof APPT_TYPES[number])} style={selectStyle}>
                {APPT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
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
      )}

      {apptKind === 'TIME' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Doctor</label>
            <select value={doctorName} disabled style={{ ...selectStyle, opacity: 0.85 }}>
              <option>{doctorName}</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Room</label>
            <select value={room} onChange={(e) => setRoom(e.target.value as typeof ROOMS[number])} style={selectStyle}>
              {ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <div>
          <label style={labelStyle}>Doctor</label>
          <select value={doctorName} disabled style={{ ...selectStyle, opacity: 0.85 }}>
            <option>{doctorName}</option>
          </select>
        </div>
      )}

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
  slotMinutes, available, value, onChange,
}: {
  slotMinutes: number;
  available: SlotChoice[];
  value: string;
  onChange: (v: string) => void;
}) {
  // Day window: 08:00–20:00 in `slotMinutes` increments. Wide enough for typical
  // clinic hours; ones outside the doctor's rules render faded/disabled.
  const startMin = 8 * 60;
  const endMin = 20 * 60;
  const step = Math.max(5, Math.min(180, slotMinutes || 15));
  const grid: string[] = [];
  for (let m = startMin; m + step <= endMin; m += step) {
    grid.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  // Make sure any backend-returned slots that fall outside the default window still appear.
  for (const s of available) if (!grid.includes(s.label)) grid.push(s.label);
  grid.sort();

  const availSet = new Set(available.map((s) => s.label));

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6,
      maxHeight: 240, overflowY: 'auto',
      padding: 8, background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
    }}>
      {grid.map((t) => {
        const isAvail = availSet.has(t);
        const isSelected = isAvail && t === value;
        return (
          <button
            key={t}
            type="button"
            disabled={!isAvail}
            onClick={() => isAvail && onChange(t)}
            style={{
              padding: '7px 4px',
              border: `1.5px solid ${isSelected ? 'var(--brand-500)' : (isAvail ? 'var(--border)' : 'transparent')}`,
              borderRadius: 8,
              background: isSelected ? 'var(--brand-50)' : 'var(--surface)',
              color: isSelected ? 'var(--brand-600)' : 'var(--text)',
              opacity: isAvail ? 1 : 0.32,
              fontSize: 12,
              fontFamily: 'monospace',
              fontWeight: isSelected ? 700 : 600,
              cursor: isAvail ? 'pointer' : 'not-allowed',
              transition: 'all 120ms',
            }}>
            {t}
          </button>
        );
      })}
      {grid.length === 0 && (
        <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 12, fontSize: 12, color: 'var(--text-subtle)' }}>
          No slots configured.
        </div>
      )}
    </div>
  );
}

function ConfirmStep({
  patient, apptKind, date, time, duration, apptType, doctorName, room,
}: {
  patient: PatientLite | null;
  apptKind: AppointmentType;
  date: string; time: string; duration: number;
  apptType: string; doctorName: string; room: string;
}) {
  const rows: { label: string; value: string; icon: 'user' | 'calendar' | 'clock' | 'clipboard' | 'stethoscope' | 'mapPin' }[] = apptKind === 'QUEUE'
    ? [
      { label: 'Patient', value: patient?.fullName ?? '—', icon: 'user' },
      { label: 'Date', value: date || '—', icon: 'calendar' },
      { label: 'Type', value: 'Walk-in queue', icon: 'clipboard' },
      { label: 'Doctor', value: doctorName, icon: 'stethoscope' },
    ]
    : [
      { label: 'Patient', value: patient?.fullName ?? '—', icon: 'user' },
      { label: 'Date', value: date || '—', icon: 'calendar' },
      { label: 'Time', value: `${time || '—'} · ${duration} min`, icon: 'clock' },
      { label: 'Type', value: apptType, icon: 'clipboard' },
      { label: 'Doctor', value: doctorName, icon: 'stethoscope' },
      { label: 'Room', value: room, icon: 'mapPin' },
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
