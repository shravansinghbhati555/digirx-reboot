import { useEffect, useState } from 'react';
import { apiGet } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Sparkline, StatusPill, formatINR } from '../shared/primitives';
import { Icon, type IconName } from '../shared/Icon';
import { Counter } from '../shared/Counter';
import { Skeleton } from '../shared/Skeleton';
import type { ReactNode } from 'react';

type RevenueResp = {
  from?: string; to?: string;
  issuedBills: { count: number; totalBilled: number };
  payments: { count: number; totalPaid: number };
};

type ScheduleResp = {
  date: string; total: number;
  items: { _id: string; type: string; status: string; doctorId: string; patientId: { _id: string; mrn?: string; fullName: string } | string; startAt?: string; endAt?: string; queueNumber?: number }[];
};

type PendingRow = { _id: string; billNo?: string; total: number; outstanding: number; status: string; patientId: string; patient?: { _id: string; mrn?: string; fullName: string } };
type PendingResp = { branchId: string | null; count: number; rows: PendingRow[] };

type AuditLog = { _id: string; action: string; entityType: string; entityId: string; targetLabel?: string; meta?: { method?: string; path?: string }; createdAt: string };
type AuditLogsResp = { rows: AuditLog[]; nextBefore?: string };

function daysAgoIso(base: string, n: number) {
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() - n);
  const y2 = dt.getFullYear();
  const m2 = String(dt.getMonth() + 1).padStart(2, '0');
  const d2 = String(dt.getDate()).padStart(2, '0');
  return `${y2}-${m2}-${d2}`;
}

function isoToTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function DashboardScreen() {
  const { ctx, setScreen, selectedDate } = useApp();
  const [revenue, setRevenue] = useState<RevenueResp | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResp | null>(null);
  const [pending, setPending] = useState<PendingResp | null>(null);
  const [activity, setActivity] = useState<AuditLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const to = selectedDate;
      const from = daysAgoIso(selectedDate, 13);
      const branchQs = ctx.branchId ? `&branchId=${ctx.branchId}` : '';
      setSchedule(null);
      const tasks: Promise<unknown>[] = [
        apiGet<RevenueResp>(ctx, `/reports/revenue?from=${from}&to=${to}${branchQs}`).then(setRevenue).catch(() => undefined),
        apiGet<PendingResp>(ctx, `/reports/pending-payments?limit=10${branchQs}`).then(setPending).catch(() => undefined),
        // result is already filtered BE-side to CREATE/UPDATE/DELETE actions.
        apiGet<AuditLogsResp>(ctx, `/audit-logs?limit=20`).then((r) => setActivity(r.rows)).catch(() => undefined),
      ];
      if (ctx.branchId) {
        tasks.push(apiGet<ScheduleResp>(ctx, `/reports/schedule/daily?date=${to}&branchId=${ctx.branchId}`).then(setSchedule).catch(() => undefined));
      }
      await Promise.all(tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void load(); }, [ctx.clinicId, ctx.branchId, selectedDate]);

  const totalOutstanding = pending?.rows.reduce((s, r) => s + r.outstanding, 0) ?? 0;
  const todayIso = new Date().toISOString().slice(0, 10);
  const isToday = selectedDate === todayIso;
  const greeting = (() => {
    if (!isToday) return 'Viewing';
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();
  const dateLabel = (() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    return dt.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  })();

  // Mock sparkline data — backend doesn't yet expose daily series
  const fauxSpark = [42, 38, 51, 47, 55, 49, 62, 58, 44, 67, 71, 65, 58, 74];

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, width: '100%', height: '100%', overflowY: 'auto' }}>
      <div>
        <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px', margin: 0 }}>
          {isToday ? `${greeting}, ${ctx.fullName ?? 'Dr.'}` : `Dashboard for ${dateLabel}`}
        </h1>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {isToday ? dateLabel : 'Pick a different date in the topbar'}
          {ctx.branchName ? ` · ${ctx.branchName}` : ctx.branchId ? ` · Branch ${ctx.branchId.slice(-6)}` : ''}
        </p>
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <KPITile label="Revenue (14d)"
          value={revenue ? <Counter value={revenue.payments.totalPaid} format={(n) => formatINR(n)} /> : '—'}
          sub={revenue ? `${revenue.payments.count} payments` : 'No data'} data={fauxSpark} color="var(--brand-500)" icon="trendingUp" />
        <KPITile label="Bills issued (14d)"
          value={revenue ? <Counter value={revenue.issuedBills.count} /> : '—'}
          sub={revenue ? `${formatINR(revenue.issuedBills.totalBilled)} billed` : 'No data'} data={fauxSpark.map((v) => v / 1000)} color="var(--accent-500)" icon="receipt" />
        <KPITile label="Pending payments"
          value={<Counter value={pending?.count ?? 0} />}
          sub={`${formatINR(totalOutstanding)} outstanding`} data={fauxSpark.map((v) => v / 2)} color="var(--warning-500)" icon="clock" />
        <KPITile label="Today's appointments"
          value={schedule ? <Counter value={schedule.total} /> : '—'}
          sub={ctx.branchId ? '' : 'Set branch ID to see schedule'} data={fauxSpark.map((v) => v / 4)} color="var(--info-500)" icon="calendar" />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 60%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{isToday ? "Today's schedule" : `Schedule · ${selectedDate}`}</span>
              <button onClick={() => setScreen('appointments')} style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--brand-500)', cursor: 'pointer', fontWeight: 500 }}>View all →</button>
            </div>
            {!ctx.branchId ? (
              <div style={{ padding: 20, fontSize: 12, color: 'var(--text-subtle)' }}>Set a branch ID in your context to see today's schedule.</div>
            ) : !schedule ? (
              <div style={{ display: 'flex', gap: 10, padding: '12px 16px', overflowX: 'auto' }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={{ flexShrink: 0, width: 150, background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Skeleton width="40%" height={8} />
                    <Skeleton width="80%" height={10} />
                    <Skeleton width={60} height={14} radius={7} />
                  </div>
                ))}
              </div>
            ) : schedule.items.length === 0 ? (
              <div style={{ padding: 20, fontSize: 12, color: 'var(--text-subtle)' }}>No appointments on this date.</div>
            ) : (
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '12px 16px' }}>
                {schedule.items.slice(0, 12).map((a) => (
                  <div key={a._id}
                    style={{ flexShrink: 0, width: 150, background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                        {a.type === 'TIME' ? isoToTime(a.startAt) : `Q#${a.queueNumber ?? ''}`}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {typeof a.patientId === 'object'
                        ? a.patientId.fullName
                        : `#${a.patientId.slice(-6)}`}
                    </div>
                    <StatusPill status={(a.status || '').toLowerCase().replace(/_/g, '-')} small />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Pending payments</span>
              <button onClick={() => setScreen('billing')} style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--brand-500)', cursor: 'pointer', fontWeight: 500 }}>View billing →</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-muted)' }}>
                  {['Bill no', 'Patient', 'Total', 'Outstanding', 'Status'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 16px', textAlign: i >= 2 && i <= 3 ? 'right' : 'left', fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!pending && <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12 }}>Loading…</td></tr>}
                {pending && pending.rows.length === 0 && <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12 }}>All bills are paid.</td></tr>}
                {pending?.rows.slice(0, 8).map((b) => (
                  <tr key={b._id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 16px', fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'monospace' }}>{b.billNo ?? b._id.slice(-6)}</td>
                    <td style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text)' }}>
                      {b.patient?.fullName ?? (b.patient?.mrn ?? `#${b.patientId.slice(-6)}`)}
                    </td>
                    <td style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatINR(b.total)}</td>
                    <td style={{ padding: '8px 16px', fontSize: 12, color: 'var(--danger-500)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatINR(b.outstanding)}</td>
                    <td style={{ padding: '8px 16px' }}><StatusPill status={(b.status || '').toLowerCase()} small /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ flex: '1 1 280px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Quick actions</span>
            </div>
            <div style={{ padding: '6px 0' }}>
              {([
                { id: 'patients', label: 'Register patient', icon: 'users' as const },
                { id: 'appointments', label: 'Book appointment', icon: 'calendar' as const },
                { id: 'billing', label: 'New bill', icon: 'receipt' as const },
                { id: 'documents', label: 'Upload document', icon: 'upload' as const },
              ] as const).map((a) => (
                <button key={a.id} onClick={() => setScreen(a.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'none', border: 'none', borderRadius: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 12, fontWeight: 500, textAlign: 'left', width: '100%', transition: 'background 80ms' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-muted)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
                  <Icon name={a.icon} size={14} style={{ color: 'var(--brand-500)' }} />
                  {a.label}
                  <Icon name="chevronRight" size={12} style={{ marginLeft: 'auto', color: 'var(--text-subtle)' }} />
                </button>
              ))}
            </div>
          </div>


          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Recent activity</span>
            </div>
            <div style={{ padding: '4px 0', maxHeight: 360, overflowY: 'auto' }}>
              {activity === null && <div style={{ padding: 16, fontSize: 12, color: 'var(--text-subtle)' }}>Loading…</div>}
              {activity && activity.length === 0 && <div style={{ padding: 16, fontSize: 12, color: 'var(--text-subtle)' }}>No activity yet.</div>}
              {activity?.slice(0, 12).map((log, i) => {
                const desc = describeActivity(log);
                return (
                  <div key={log._id} style={{ display: 'flex', gap: 10, padding: '10px 16px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-muted)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                      <Icon name={desc.icon} size={12} style={{ color: 'var(--brand-500)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4 }}>
                        <span style={{ fontWeight: 600 }}>{desc.label}</span>
                        {log.targetLabel && <span style={{ color: 'var(--text-muted)' }}> for {log.targetLabel}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>{relativeTime(log.createdAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function describeActivity(log: AuditLog): { label: string; icon: IconName } {
  const p = log.meta?.path ?? '';
  if (log.action === 'CREATE') {
    if (/^\/patients(\/.*)?$/.test(p)) return { label: 'Patient registered', icon: 'users' };
    if (/^\/appointments$/.test(p)) return { label: 'Appointment booked', icon: 'calendar' };
    if (/\/checkin$/.test(p)) return { label: 'Patient checked in', icon: 'checkCircle' };
    if (/^\/encounters$/.test(p)) return { label: 'Encounter started', icon: 'clipboard' };
    if (/\/sign$/.test(p)) return { label: 'Encounter signed', icon: 'lock' };
    if (/^\/encounters\/[^/]+\/prescriptions$/.test(p)) return { label: 'Prescription issued', icon: 'pill' };
    if (/^\/bills\/from-prescription/.test(p)) return { label: 'Bill created', icon: 'receipt' };
    if (/^\/bills$/.test(p)) return { label: 'Bill drafted', icon: 'receipt' };
    if (/\/issue$/.test(p)) return { label: 'Bill issued', icon: 'fileText' };
    if (/\/payments$/.test(p)) return { label: 'Payment recorded', icon: 'checkCircle' };
    if (/\/documents\/.*\/confirm$/.test(p)) return { label: 'Document uploaded', icon: 'checkCircle' };
    if (/^\/documents\/upload-url$/.test(p)) return { label: 'Document upload started', icon: 'upload' };
    return { label: 'Record created', icon: 'plus' };
  }
  if (log.action === 'UPDATE') {
    if (/^\/bills\//.test(p)) return { label: 'Bill updated', icon: 'edit' };
    if (/^\/clinics\/[^/]+\/settings$/.test(p)) return { label: 'Settings updated', icon: 'settings' };
    return { label: 'Record updated', icon: 'edit' };
  }
  if (log.action === 'DELETE') return { label: 'Record deleted', icon: 'trash' };
  return { label: 'Activity', icon: 'activity' };
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function KPITile({ label, value, sub, data, color, icon }: { label: string; value: ReactNode; sub: string; data: number[]; color: string; icon: IconName }) {
  return (
    <div style={{ flex: '1 1 220px', minWidth: 180, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <Icon name={icon} size={13} style={{ color }} />
          {label}
        </span>
        <Sparkline data={data} color={color} width={80} height={28} />
      </div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: "'Manrope',sans-serif", letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}
