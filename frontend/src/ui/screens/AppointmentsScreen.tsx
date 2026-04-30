import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Avatar, EmptyState, Field, Spinner, StatusPill, labelStyle, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';

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

type PatientLite = { _id: string; fullName: string; phones?: string[] };

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);
const HOUR_H = 72;

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  DONE:        { bg: 'rgba(16,185,129,0.12)', border: '#10B981', text: '#065F46' },
  CHECKED_IN:  { bg: 'rgba(20,184,166,0.14)', border: '#14B8A6', text: '#0F766E' },
  IN_PROGRESS: { bg: 'rgba(99,102,241,0.12)', border: '#6366F1', text: '#4338CA' },
  BOOKED:      { bg: 'rgba(59,130,246,0.12)', border: '#3B82F6', text: '#1E40AF' },
  CANCELLED:   { bg: 'rgba(239,68,68,0.08)',  border: '#EF4444', text: '#991B1B' },
  NO_SHOW:     { bg: 'rgba(245,158,11,0.1)',  border: '#F59E0B', text: '#92400E' },
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
  date, weekItems, loading, getName, onSelect, onPickDay,
}: {
  date: string;
  weekItems: Map<string, Appointment[]>;
  loading: boolean;
  getName: (id: string) => string;
  onSelect: (a: Appointment) => void;
  onPickDay: (iso: string) => void;
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

      <div style={{ flex: 1, overflowX: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, height: 40 }}>
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
                  color: isToday ? '#fff' : 'var(--text)',
                }}>
                  {dd}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', position: 'relative', display: 'flex' }}>
          {days.map((d) => {
            const dayAppts = (weekItems.get(d) ?? []).filter((a) => a.type === 'TIME');
            const isToday = d === todayIso;
            return (
              <div key={d} style={{ flex: 1, minWidth: COL_W, borderRight: '1px solid var(--border)', position: 'relative', background: isToday ? 'rgba(59,130,246,0.015)' : 'transparent' }}>
                {HOURS.map((h) => (
                  <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - 8) * HOUR_H, height: HOUR_H, borderBottom: '1px solid var(--border)', boxSizing: 'border-box' }} />
                ))}
                {dayAppts.map((a) => {
                  const startMin = isoToMin(a.startAt);
                  const endMin = isoToMin(a.endAt);
                  const dur = Math.max(endMin - startMin, 15);
                  const top = ((startMin - 8 * 60) / 60) * HOUR_H;
                  if (top < 0) return null;
                  const height = Math.max((dur / 60) * HOUR_H - 2, 20);
                  const col = STATUS_COLORS[statusKey(a.status)] ?? STATUS_COLORS.BOOKED;
                  return (
                    <div key={a._id} onClick={() => onSelect(a)}
                      style={{ position: 'absolute', left: 2, right: 2, top, height, background: col.bg, border: `1px solid ${col.border}`, borderRadius: 6, padding: '3px 6px', cursor: 'pointer', overflow: 'hidden', zIndex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: col.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{getName(a.patientId)}</div>
                      {height > 28 && <div style={{ fontSize: 9, color: col.text, opacity: 0.8 }}>{isoToTime(a.startAt)}</div>}
                    </div>
                  );
                })}
                {loading && (weekItems.get(d) ?? []).length === 0 && (
                  <div style={{ position: 'absolute', top: 8, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: 'var(--text-subtle)' }}>Loading…</div>
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

export function AppointmentsScreen() {
  const { ctx, selectedPatientId, setSelectedPatientId } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [view, setView] = useState<'day' | 'week' | 'queue'>('day');
  const [weekItems, setWeekItems] = useState<Map<string, Appointment[]>>(new Map());
  const [weekLoading, setWeekLoading] = useState(false);
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

  const dayAppts = useMemo(() => items.filter((a) => a.type === 'TIME'), [items]);
  const queueAppts = useMemo(() => items.filter((a) => a.type === 'QUEUE').sort((a, b) => (a.queueNumber ?? 0) - (b.queueNumber ?? 0)), [items]);

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
        <button onClick={() => shiftDate(-1)}
          style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)' }}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          style={{ height: 32, padding: '0 10px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text)', outline: 'none' }} />
        <button onClick={() => shiftDate(1)}
          style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)' }}>
          <Icon name="chevronRight" size={16} />
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, background: 'var(--surface-muted)', borderRadius: 10, padding: 3, border: '1px solid var(--border)' }}>
          {(['day', 'week', 'queue'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '5px 14px', borderRadius: 8, border: 'none', background: view === v ? 'var(--surface)' : 'transparent', color: view === v ? 'var(--text)' : 'var(--text-muted)', fontSize: 12, fontWeight: view === v ? 600 : 400, cursor: 'pointer', textTransform: 'capitalize' }}>
              {v}
            </button>
          ))}
        </div>

        <button onClick={() => setShowBook(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <Icon name="plus" size={14} strokeWidth={2.5} /> Book
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 24px', background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid var(--border)', color: 'var(--danger-500)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
        {loading && <div style={{ padding: 24, color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>}

        {!loading && view === 'day' && (
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
              {dayAppts.length === 0 && !error && (
                <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--text-subtle)' }}>
                  <EmptyState icon="calendar" title="No time-based appointments" hint="Use the Book button to create one." />
                </div>
              )}
              {dayAppts.map((a) => {
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
          />
        )}

        {!loading && view === 'queue' && (
          <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, maxWidth: 720 }}>
              <div>
                <h2 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Walk-in queue</h2>
                <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{queueAppts.filter((a) => statusKey(a.status) === 'BOOKED').length} waiting</p>
              </div>
            </div>
            {queueAppts.length === 0 ? <EmptyState icon="users" title="No queue tokens for this date" /> : (
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
  const { ctx } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

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
        </div>
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {status === 'BOOKED' && (
            <button onClick={checkIn} disabled={busy}
              style={{ height: 42, background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Checking in…' : 'Check in patient'}
            </button>
          )}
          {(status === 'BOOKED' || status === 'CHECKED_IN') && (
            <button onClick={cancel} disabled={busy}
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

function BookSheet({
  defaultDate, defaultPatientId, onClose, onCreated,
}: {
  defaultDate: string;
  defaultPatientId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { ctx } = useApp();
  const [type, setType] = useState<AppointmentType>('TIME');
  const [doctorId, setDoctorId] = useState('');
  const [patientId, setPatientId] = useState(defaultPatientId ?? '');
  const [patientLabel, setPatientLabel] = useState<string | null>(null);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientHits, setPatientHits] = useState<PatientLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('10:15');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!defaultPatientId) return;
    apiGet<PatientLite>(ctx, `/patients/${defaultPatientId}`)
      .then((p) => setPatientLabel(p.fullName))
      .catch(() => setPatientLabel(defaultPatientId));
  }, [defaultPatientId, ctx]);

  async function searchPatients() {
    setSearching(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (patientQuery.trim()) qs.set('query', patientQuery.trim());
      qs.set('limit', '15');
      const data = await apiGet<PatientLite[]>(ctx, `/patients?${qs.toString()}`);
      setPatientHits(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  function pickPatient(p: PatientLite) {
    setPatientId(p._id);
    setPatientLabel(p.fullName);
    setPatientHits([]);
  }

  function combineToIso(d: string, hm: string): string {
    const [h, m] = hm.split(':').map(Number);
    const date = new Date(d);
    date.setHours(h, m, 0, 0);
    return date.toISOString();
  }

  async function submit() {
    if (!ctx.branchId) { setError('Branch ID is required (sign in to a branch).'); return; }
    if (!doctorId.trim() || !patientId.trim()) { setError('Doctor and patient are required.'); return; }
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        type,
        branchId: ctx.branchId,
        doctorId: doctorId.trim(),
        patientId: patientId.trim(),
      };
      if (type === 'TIME') {
        body.startAt = combineToIso(date, startTime);
        body.endAt = combineToIso(date, endTime);
      } else {
        body.queueDate = date;
      }
      await apiPost(ctx, '/appointments', body);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 18, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 460, animation: 'slideUp 200ms ease-out', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Book appointment</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <div>
            <label style={labelStyle}>Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['TIME', 'QUEUE'] as const).map((t) => (
                <button key={t} onClick={() => setType(t)}
                  style={{ flex: 1, padding: '8px 0', border: `1.5px solid ${type === t ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 10, background: type === t ? 'var(--brand-50)' : 'var(--surface-muted)', color: type === t ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <Field label="Doctor user ID" value={doctorId} onChange={setDoctorId} placeholder="ObjectId" />

          <div>
            <label style={labelStyle}>Patient</label>
            {patientLabel ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--brand-50)', border: '1.5px solid var(--brand-100)', borderRadius: 10 }}>
                <Avatar name={patientLabel} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-700)' }}>{patientLabel}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'monospace' }}>{patientId.slice(-12)}</div>
                </div>
                <button onClick={() => { setPatientId(''); setPatientLabel(null); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 4 }}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)} placeholder="Search by name or phone…"
                  onKeyDown={(e) => e.key === 'Enter' && searchPatients()}
                  style={{ flex: 1, height: 40, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none' }} />
                <button onClick={searchPatients} disabled={searching}
                  style={{ height: 40, padding: '0 14px', background: 'var(--brand-50)', border: '1px solid var(--brand-100)', borderRadius: 10, color: 'var(--brand-600)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {searching ? '…' : 'Find'}
                </button>
              </div>
            )}
            {patientHits.length > 0 && (
              <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', maxHeight: 160, overflowY: 'auto' }}>
                {patientHits.map((p) => (
                  <button key={p._id} onClick={() => pickPatient(p)}
                    style={{ width: '100%', padding: '8px 12px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{p.fullName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{p.phones?.[0] ?? p._id.slice(-12)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Field label="Date" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />

          {type === 'TIME' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}><Field label="Start time" value={startTime} onChange={setStartTime} placeholder="HH:MM" /></div>
              <div style={{ flex: 1 }}><Field label="End time" value={endTime} onChange={setEndTime} placeholder="HH:MM" /></div>
            </div>
          )}

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={saving}
            style={{ flex: 2, height: 42, background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {saving ? <Spinner /> : 'Book appointment'}
          </button>
        </div>
      </div>
    </div>
  );
}
