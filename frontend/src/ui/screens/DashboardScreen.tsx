import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Perm, usePerm } from '../../app/permissions';
import { Sparkline, StatusPill, formatMoney, formatMoneyCompact } from '../shared/primitives';
import { Icon, type IconName } from '../shared/Icon';
import { Counter } from '../shared/Counter';
import { Skeleton } from '../shared/Skeleton';
import { AreaChart } from '../shared/AreaChart';
import { DatePickerChip } from '../shared/DatePickerChip';
import {
  HBarChart, KpiDetailModal, SectionHeader, StatCard, StatGrid, VBarChart, usePolling,
} from '../shared/KpiDetailModal';
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

function shortDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function isoToTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

type KpiKey = 'revenue' | 'bills' | 'pending' | 'appointments';

export function DashboardScreen() {
  const { ctx, setScreen, selectedDate, setSelectedEncounterId } = useApp();
  const { has } = usePerm();
  // Per-tile visibility. Mapping per role:
  //   Super Admin → all four (has every permission)
  //   Manager     → Revenue + Bills + Pending (ReportsRead + BillingRead, no ClinicWrite)
  //   Front Desk  → Bills + Pending (BillingRead only)
  //   Pharmacist  → Bills + Pending (BillingRead only)
  //   Doctor      → PatientRead + ClinicWrite but NOT ReportsRead → sees
  //                 encounter-oriented dashboard (recent encounters widget).
  const canSeeRevenue      = has(Perm.ReportsRead);
  const canSeeBills        = has(Perm.BillingRead);
  const canSeePending      = has(Perm.BillingRead);
  const canSeeAppointments = has(Perm.ClinicWrite);
  // Doctors have patient:read (clinical access) but not reports:read
  // (financial/analytics access). This flag drives the encounter-focused
  // dashboard layout: recent encounters widget + no pending payments table.
  const isDoctor = has(Perm.PatientRead) && !has(Perm.ReportsRead);
  const [revenue, setRevenue] = useState<RevenueResp | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResp | null>(null);
  const [pending, setPending] = useState<PendingResp | null>(null);
  const [activity, setActivity] = useState<AuditLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openKpi, setOpenKpi] = useState<KpiKey | null>(null);

  async function load() {
    setError(null);
    try {
      // Revenue + bills-issued tiles show the metric for *this one day* —
      // the popup is where a longer window is explored. Keeping a single
      // day at the tile layer makes the header date the obvious driver:
      // change the header, the tile changes.
      const to = selectedDate;
      const from = selectedDate;
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
        {canSeeRevenue && (
          <KPITile label={isToday ? "Today's revenue" : 'Revenue'}
            value={revenue ? <Counter value={revenue.payments.totalPaid} format={(n) => formatMoney(n, ctx.currency)} /> : '—'}
            sub={revenue ? `${revenue.payments.count} payments · ${shortDayLabel(selectedDate)}` : 'No data'} data={fauxSpark} color="var(--brand-500)" icon="trendingUp"
            onClick={() => setOpenKpi('revenue')} />
        )}
        {canSeeBills && (
          <KPITile label={isToday ? "Today's bills" : 'Bills issued'}
            value={revenue ? <Counter value={revenue.issuedBills.count} /> : '—'}
            sub={revenue ? `${formatMoney(revenue.issuedBills.totalBilled, ctx.currency)} billed · ${shortDayLabel(selectedDate)}` : 'No data'} data={fauxSpark.map((v) => v / 1000)} color="var(--accent-500)" icon="receipt"
            onClick={() => setOpenKpi('bills')} />
        )}
        {canSeePending && (
          <KPITile label="Pending payments"
            value={<Counter value={pending?.count ?? 0} />}
            sub={`${formatMoney(totalOutstanding, ctx.currency)} outstanding`} data={fauxSpark.map((v) => v / 2)} color="var(--warning-500)" icon="clock"
            onClick={() => setOpenKpi('pending')} />
        )}
        {canSeeAppointments && (
          <KPITile label="Today's appointments"
            value={schedule ? <Counter value={schedule.total} /> : '—'}
            sub={ctx.branchId ? '' : 'Set branch ID to see schedule'} data={fauxSpark.map((v) => v / 4)} color="var(--info-500)" icon="calendar"
            onClick={() => setOpenKpi('appointments')} />
        )}
      </div>

      {openKpi === 'revenue' && (
        <RevenueDetail onClose={() => setOpenKpi(null)} selectedDate={selectedDate} />
      )}
      {openKpi === 'bills' && (
        <BillsIssuedDetail onClose={() => setOpenKpi(null)} selectedDate={selectedDate} />
      )}
      {openKpi === 'pending' && (
        <PendingPaymentsDetail onClose={() => setOpenKpi(null)} />
      )}
      {openKpi === 'appointments' && (
        <AppointmentsDetail onClose={() => setOpenKpi(null)} selectedDate={selectedDate} />
      )}

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

          {!isDoctor && (
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
                      <td style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(b.total, ctx.currency)}</td>
                      <td style={{ padding: '8px 16px', fontSize: 12, color: 'var(--danger-500)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatMoney(b.outstanding, ctx.currency)}</td>
                      <td style={{ padding: '8px 16px' }}><StatusPill status={(b.status || '').toLowerCase()} small /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 280px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Quick actions card — hidden for doctors. Clinicians work
              inside their consultation flow and don't need the
              admin-style register/book/bill shortcuts on the dashboard. */}
          {!isDoctor && (
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
          )}


          {isDoctor ? (
            <RecentEncountersWidget onOpen={(id) => {
              // Open the specific consultation — set the encounter id
              // first so EncounterScreen's mount effect picks it up,
              // then navigate. Going through setSelectedEncounterId
              // matches the same flow as opening from the queue list.
              setSelectedEncounterId(id);
              setScreen('encounters');
            }} />
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}

/* ── KPI detail panels ────────────────────────────────────────
   Each panel manages its own data + polling so opening one
   doesn't refetch siblings. They live inside KpiDetailModal
   which provides the chrome (header, close, scroll, theme). */

type RevenueBucket = { bucket: string; totalPaid: number; paidCount: number; totalRefunded: number; refundCount: number; netRevenue: number };
type RevenueTimeseriesResp = { from?: string; to?: string; bucket: string; buckets: RevenueBucket[] };
type BillsBucket = { bucket: string; count: number; totalBilled: number };
type BillsTimeseriesResp = { from?: string; to?: string; bucket: string; buckets: BillsBucket[] };

const POLL_MS = 15_000;

function rangeQs(selectedDate: string) {
  // 14-day window ending on the dashboard's selected date.
  const [y, m, d] = selectedDate.split('-').map(Number);
  const end = new Date(y, (m ?? 1) - 1, d ?? 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 13);
  const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  return { from: fmt(start), to: fmt(end) };
}

function shortDate(iso: string) {
  // 'YYYY-MM-DD' → 'DD MMM'
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/**
 * Local from/to date range used inside the KPI popups. Initialised from
 * the dashboard's selected date (14d window ending on it) so the popup
 * matches the tile context on first open, but the user can adjust either
 * end with the DatePickerChips below and the chart refetches.
 */
function useDateRange(selectedDate: string) {
  const initial = useMemo(() => rangeQs(selectedDate), [selectedDate]);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  // When the dashboard's header date changes while the modal is open,
  // slide the range with it. Without this effect the modal keeps the
  // stale range the user originally opened it on.
  useEffect(() => {
    setFrom(initial.from);
    setTo(initial.to);
  }, [initial.from, initial.to]);

  // Guard against `from > to`: nudge whichever side wasn't just touched.
  const setFromGuarded = (next: string) => {
    setFrom(next);
    if (next > to) setTo(next);
  };
  const setToGuarded = (next: string) => {
    setTo(next);
    if (next < from) setFrom(next);
  };

  return { from, to, setFrom: setFromGuarded, setTo: setToGuarded };
}

function RangePicker({
  from, to, onChangeFrom, onChangeTo,
}: {
  from: string; to: string;
  onChangeFrom: (iso: string) => void;
  onChangeTo: (iso: string) => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '12px 14px', marginBottom: 16,
      background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12,
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>From</span>
      <DatePickerChip value={from} onChange={onChangeFrom} size="sm" />
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>To</span>
      <DatePickerChip value={to} onChange={onChangeTo} size="sm" />
    </div>
  );
}

function RevenueDetail({ onClose, selectedDate }: { onClose: () => void; selectedDate: string }) {
  const { ctx } = useApp();
  const { from, to, setFrom, setTo } = useDateRange(selectedDate);
  const branchQs = ctx.branchId ? `&branchId=${ctx.branchId}` : '';

  const { data, error, refreshing } = usePolling<RevenueTimeseriesResp>(
    () => apiGet<RevenueTimeseriesResp>(ctx, `/reports/revenue/timeseries?from=${from}&to=${to}&bucket=day${branchQs}`),
    POLL_MS,
    [ctx.clinicId, ctx.branchId, from, to],
  );

  const buckets = data?.buckets ?? [];
  const totalPaid = buckets.reduce((s, b) => s + b.totalPaid, 0);
  const totalPayments = buckets.reduce((s, b) => s + b.paidCount, 0);
  const totalRefunded = buckets.reduce((s, b) => s + b.totalRefunded, 0);
  const netRevenue = totalPaid - totalRefunded;
  const avgDaily = buckets.length ? totalPaid / buckets.length : 0;

  return (
    <KpiDetailModal title="Revenue" subtitle={`${from} → ${to}${ctx.branchName ? ` · ${ctx.branchName}` : ''}`}
      icon="trendingUp" accentColor="var(--brand-500)" live={refreshing} onClose={onClose}
      footer={<span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Auto-refresh every {POLL_MS / 1000}s · paid amount net of refunds</span>}>
      <RangePicker from={from} to={to} onChangeFrom={setFrom} onChangeTo={setTo} />
      {error && <KpiError msg={error} />}
      <StatGrid>
        <StatCard label="Total paid" value={formatMoney(totalPaid, ctx.currency)} sub={`${totalPayments} payments`} accent="var(--brand-500)" />
        <StatCard label="Refunded" value={formatMoney(totalRefunded, ctx.currency)} sub="Via credit notes" accent="var(--danger-500)" />
        <StatCard label="Net revenue" value={formatMoney(netRevenue, ctx.currency)} sub="Paid − refunded" accent="var(--success-500)" />
        <StatCard label="Avg / day" value={formatMoney(Math.round(avgDaily), ctx.currency)} sub={`${buckets.length} day window`} />
      </StatGrid>

      <SectionHeader>Daily payments</SectionHeader>
      {data == null ? (
        <Skeleton height={220} radius={12} />
      ) : buckets.length === 0 ? (
        <KpiEmpty />
      ) : (
        <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, padding: '8px 4px 0' }}>
          <AreaChart
            data={buckets.map((b) => b.totalPaid)}
            labels={buckets.map((b) => shortDate(b.bucket))}
            color="var(--brand-500)"
            height={240}
            yFormat={(v) => formatMoneyCompact(v, ctx.currency)}
          />
        </div>
      )}
    </KpiDetailModal>
  );
}

function BillsIssuedDetail({ onClose, selectedDate }: { onClose: () => void; selectedDate: string }) {
  const { ctx } = useApp();
  const { from, to, setFrom, setTo } = useDateRange(selectedDate);
  const branchQs = ctx.branchId ? `&branchId=${ctx.branchId}` : '';

  const { data, error, refreshing } = usePolling<BillsTimeseriesResp>(
    () => apiGet<BillsTimeseriesResp>(ctx, `/reports/bills-issued/timeseries?from=${from}&to=${to}&bucket=day${branchQs}`),
    POLL_MS,
    [ctx.clinicId, ctx.branchId, from, to],
  );

  const buckets = data?.buckets ?? [];
  const totalCount = buckets.reduce((s, b) => s + b.count, 0);
  const totalBilled = buckets.reduce((s, b) => s + b.totalBilled, 0);
  const avgValue = totalCount ? totalBilled / totalCount : 0;
  const avgPerDay = buckets.length ? totalCount / buckets.length : 0;

  return (
    <KpiDetailModal title="Bills issued" subtitle={`${from} → ${to}${ctx.branchName ? ` · ${ctx.branchName}` : ''}`}
      icon="receipt" accentColor="var(--accent-500)" live={refreshing} onClose={onClose}
      footer={<span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Auto-refresh every {POLL_MS / 1000}s · includes paid bills</span>}>
      <RangePicker from={from} to={to} onChangeFrom={setFrom} onChangeTo={setTo} />
      {error && <KpiError msg={error} />}
      <StatGrid>
        <StatCard label="Bills issued" value={totalCount} sub={`${buckets.length} day window`} accent="var(--accent-500)" />
        <StatCard label="Total billed" value={formatMoney(totalBilled, ctx.currency)} sub="Across all bills" />
        <StatCard label="Avg bill" value={formatMoney(Math.round(avgValue), ctx.currency)} sub="Per issued bill" />
        <StatCard label="Avg / day" value={avgPerDay.toFixed(1)} sub="Bills per day" />
      </StatGrid>

      <SectionHeader>Daily issuance</SectionHeader>
      {data == null ? (
        <Skeleton height={220} radius={12} />
      ) : buckets.length === 0 ? (
        <KpiEmpty />
      ) : (
        <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, padding: '8px 4px 0' }}>
          <AreaChart
            data={buckets.map((b) => b.count)}
            labels={buckets.map((b) => shortDate(b.bucket))}
            color="var(--accent-500)"
            height={240}
            yFormat={(v) => String(Math.round(v))}
          />
        </div>
      )}
    </KpiDetailModal>
  );
}

function PendingPaymentsDetail({ onClose }: { onClose: () => void }) {
  const { ctx } = useApp();
  const branchQs = ctx.branchId ? `&branchId=${ctx.branchId}` : '';

  const { data, error, refreshing } = usePolling<PendingResp>(
    () => apiGet<PendingResp>(ctx, `/reports/pending-payments?limit=20${branchQs}`),
    POLL_MS,
    [ctx.clinicId, ctx.branchId],
  );

  const rows = data?.rows ?? [];
  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
  const totalBilled = rows.reduce((s, r) => s + r.total, 0);
  const top = rows.slice(0, 10).map((r) => ({
    label: r.patient?.fullName ?? `#${r.patientId.slice(-6)}`,
    value: r.outstanding,
    sub: r.billNo ? `#${r.billNo}` : `#${r._id.slice(-6)}`,
  }));

  // Status breakdown across the returned rows (not the whole clinic — the
  // endpoint already trimmed to outstanding>0, so all rows are by definition
  // unpaid; group on `status` to surface DRAFT/ISSUED/etc. if any leak through).
  const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
    const k = (r.status || 'UNKNOWN').toUpperCase();
    acc[k] = (acc[k] ?? 0) + r.outstanding;
    return acc;
  }, {});
  const statusRows = Object.entries(byStatus)
    .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v }))
    .sort((a, b) => b.value - a.value);

  return (
    <KpiDetailModal title="Pending payments" subtitle={ctx.branchName ?? 'All branches'}
      icon="clock" accentColor="var(--warning-500)" live={refreshing} onClose={onClose}
      footer={<span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Auto-refresh every {POLL_MS / 1000}s · top 20 outstanding bills</span>}>
      {error && <KpiError msg={error} />}
      <StatGrid>
        <StatCard label="Open bills" value={data?.count ?? 0} accent="var(--warning-500)" />
        <StatCard label="Total outstanding" value={formatMoney(totalOutstanding, ctx.currency)} accent="var(--danger-500)" />
        <StatCard label="Total billed" value={formatMoney(totalBilled, ctx.currency)} />
        <StatCard label="Collected" value={formatMoney(Math.max(0, totalBilled - totalOutstanding), ctx.currency)} accent="var(--success-500)" />
      </StatGrid>

      <SectionHeader>Top patients by outstanding</SectionHeader>
      {data == null ? (
        <Skeleton height={200} radius={12} />
      ) : top.length === 0 ? (
        <KpiEmpty msg="No open bills. Nice work." />
      ) : (
        <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 20 }}>
          <HBarChart rows={top} color="var(--warning-500)" formatValue={(v) => formatMoney(v, ctx.currency)} />
        </div>
      )}

      {statusRows.length > 1 && (
        <>
          <SectionHeader>By status</SectionHeader>
          <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <HBarChart rows={statusRows} color="var(--warning-500)" formatValue={(v) => formatMoney(v, ctx.currency)} />
          </div>
        </>
      )}
    </KpiDetailModal>
  );
}

function AppointmentsDetail({ onClose, selectedDate }: { onClose: () => void; selectedDate: string }) {
  const { ctx } = useApp();
  const branchQs = ctx.branchId ? `&branchId=${ctx.branchId}` : '';

  const { data, error, refreshing } = usePolling<ScheduleResp>(
    () => apiGet<ScheduleResp>(ctx, `/reports/schedule/daily?date=${selectedDate}${branchQs}`),
    POLL_MS,
    [ctx.clinicId, ctx.branchId, selectedDate],
  );

  if (!ctx.branchId) {
    return (
      <KpiDetailModal title="Appointments" subtitle={selectedDate}
        icon="calendar" accentColor="var(--info-500)" onClose={onClose}>
        <KpiEmpty msg="Set a branch ID in your context to see today's schedule." />
      </KpiDetailModal>
    );
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // Status breakdown — bars share the modal's accent theme token below.
  const byStatus: Record<string, number> = {};
  for (const a of items) {
    const k = (a.status || 'UNKNOWN').toUpperCase();
    byStatus[k] = (byStatus[k] ?? 0) + 1;
  }
  const statusRows = Object.entries(byStatus)
    .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v }))
    .sort((a, b) => b.value - a.value);

  // Hourly distribution (TIME appointments only; QUEUE has no start time).
  const hourCounts = Array.from({ length: 14 }, () => 0); // 8h..21h
  for (const a of items) {
    if (a.type !== 'TIME' || !a.startAt) continue;
    const hr = new Date(a.startAt).getHours();
    const idx = hr - 8;
    if (idx >= 0 && idx < hourCounts.length) hourCounts[idx] += 1;
  }
  const hourBars = hourCounts.map((c, i) => ({ label: `${String(i + 8).padStart(2, '0')}h`, value: c }));

  const timeCount = items.filter((a) => a.type === 'TIME').length;
  const queueCount = items.filter((a) => a.type === 'QUEUE').length;
  const doneCount = byStatus['DONE'] ?? 0;
  const cancelledCount = (byStatus['CANCELLED'] ?? 0) + (byStatus['NO_SHOW'] ?? 0);

  return (
    <KpiDetailModal title="Appointments" subtitle={`${selectedDate}${ctx.branchName ? ` · ${ctx.branchName}` : ''}`}
      icon="calendar" accentColor="var(--info-500)" live={refreshing} onClose={onClose}
      footer={<span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Auto-refresh every {POLL_MS / 1000}s · time + walk-in tokens</span>}>
      {error && <KpiError msg={error} />}
      <StatGrid>
        <StatCard label="Total" value={total} accent="var(--info-500)" />
        <StatCard label="Time-slot" value={timeCount} sub={`${queueCount} queue tokens`} />
        <StatCard label="Completed" value={doneCount} sub={total ? `${Math.round((doneCount / total) * 100)}%` : ''} accent="var(--success-500)" />
        <StatCard label="Cancelled / no-show" value={cancelledCount} accent="var(--danger-500)" />
      </StatGrid>

      {timeCount > 0 && (
        <>
          <SectionHeader>By hour (time-slot appointments)</SectionHeader>
          <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 14px 24px', marginBottom: 20 }}>
            <VBarChart bars={hourBars} color="var(--info-500)" height={180} />
          </div>
        </>
      )}

      <SectionHeader>By status</SectionHeader>
      {data == null ? (
        <Skeleton height={140} radius={12} />
      ) : statusRows.length === 0 ? (
        <KpiEmpty msg="No appointments on this date." />
      ) : (
        <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
          <HBarChart rows={statusRows} color="var(--info-500)" />
        </div>
      )}
    </KpiDetailModal>
  );
}

function KpiError({ msg }: { msg: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 10, marginBottom: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--danger-500)', fontSize: 12 }}>
      <Icon name="alertTriangle" size={14} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{msg}</span>
    </div>
  );
}

function KpiEmpty({ msg = 'No data for this range.' }: { msg?: string }) {
  return (
    <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13, background: 'var(--surface-muted)', border: '1px dashed var(--border)', borderRadius: 12 }}>
      {msg}
    </div>
  );
}

function describeActivity(log: AuditLog): { label: string; icon: IconName } {
  const p = log.meta?.path ?? '';
  if (log.action === 'CREATE') {
    if (/^\/patients(\/.*)?$/.test(p)) return { label: 'Patient registered', icon: 'users' };
    if (/^\/appointments$/.test(p)) return { label: 'Appointment booked', icon: 'calendar' };
    if (/\/checkin$/.test(p)) return { label: 'Patient checked in', icon: 'checkCircle' };
    if (/^\/encounters$/.test(p)) return { label: 'Consultation started', icon: 'clipboard' };
    if (/\/sign$/.test(p)) return { label: 'Consultation signed', icon: 'lock' };
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

// ── Recent Encounters widget (shown on Dashboard for doctor roles) ──────────

type EncounterRow = {
  _id: string;
  readableId?: string;
  status: string;
  visitedAt: string;
  patientId: { _id: string; fullName: string; mrn?: string } | string;
};

function RecentEncountersWidget({ onOpen }: { onOpen: (id: string) => void }) {
  const { ctx } = useApp();
  const [rows, setRows] = useState<EncounterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: '20' });
    if (ctx.branchId) qs.set('branchId', ctx.branchId);
    apiGet<EncounterRow[]>(ctx, `/encounters?${qs.toString()}`)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [ctx.clinicId, ctx.branchId]);

  const filtered = rows.filter((r) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    const name = typeof r.patientId === 'object' ? r.patientId.fullName : '';
    const id = (r.readableId ?? r._id).toLowerCase();
    return name.toLowerCase().includes(q) || id.includes(q) || r.status.toLowerCase().includes(q);
  });

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Recent consultations</span>
        <div style={{ position: 'relative', width: 150 }}>
          <Icon name="search" size={11} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            style={{
              width: '100%', height: 28, padding: '0 8px 0 26px',
              background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 6,
              fontSize: 11, color: 'var(--text)', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--brand-400)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
        </div>
      </div>
      <div style={{ padding: '4px 0', maxHeight: 360, overflowY: 'auto' }}>
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ height: 48, background: 'var(--surface-muted)', borderRadius: 8, marginBottom: 4, animation: 'pulse 1.5s infinite' }} />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-subtle)' }}>
            {query ? 'No sessions match your search.' : 'No recent clinical sessions.'}
          </div>
        )}
        {!loading && filtered.map((r, i) => {
          const name = typeof r.patientId === 'object' ? r.patientId.fullName : `#${r._id.slice(-6)}`;
          const mrn = typeof r.patientId === 'object' ? (r.patientId.mrn ?? '') : '';
          const rid = r.readableId ?? `#${r._id.slice(-6).toUpperCase()}`;
          const dateStr = new Date(r.visitedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          return (
            <button
              key={r._id}
              onClick={() => onOpen(r._id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                textAlign: 'left', background: 'none', border: 'none', borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-muted)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-50)', border: '1px solid var(--brand-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="clipboard" size={14} style={{ color: 'var(--brand-500)' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <StatusPill status={r.status.toLowerCase()} small />
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--brand-600)', background: 'var(--brand-50)', padding: '0 3px', borderRadius: 3 }}>{rid}</span>
                  {mrn && <><span>·</span><span>{mrn}</span></>}
                  <span>·</span>
                  <span>{dateStr}</span>
                </div>
              </div>
              <Icon name="chevronRight" size={13} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function KPITile({ label, value, sub, data, color, icon, onClick }: {
  label: string; value: ReactNode; sub: string; data: number[]; color: string; icon: IconName;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <button type="button" onClick={onClick} disabled={!clickable}
      aria-label={`${label} — view details`}
      style={{
        flex: '1 1 220px', minWidth: 180,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
        padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: 8,
        textAlign: 'left', color: 'inherit', font: 'inherit',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)',
      }}
      onMouseEnter={(e) => {
        if (!clickable) return;
        e.currentTarget.style.borderColor = color;
        e.currentTarget.style.boxShadow = `0 4px 18px ${color}1F`;
      }}
      onMouseLeave={(e) => {
        if (!clickable) return;
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.boxShadow = 'none';
      }}>
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
      {clickable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, color, marginTop: 2 }}>
          View details <Icon name="chevronRight" size={11} />
        </div>
      )}
    </button>
  );
}
