import { useEffect, useState } from 'react';
import { apiGet } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { EmptyState, Field, StatusPill, formatINR } from '../shared/primitives';
import { AreaChart } from '../shared/AreaChart';
import { AnimatedTabs } from '../shared/AnimatedTabs';
import { Counter } from '../shared/Counter';
import { Skeleton } from '../shared/Skeleton';

type RevenueResp = {
  from?: string; to?: string; timezone: string; branchId: string | null;
  issuedBills: { count: number; totalBilled: number };
  payments: { count: number; totalPaid: number };
};

type ScheduleResp = {
  date: string; timezone: string; branchId: string;
  total: number;
  byDoctor: Record<string, { total: number; byStatus: Record<string, number>; byType: Record<string, number> }>;
  items: { _id: string; type: string; status: string; doctorId: string; patientId: string; startAt?: string; endAt?: string; queueDate?: string; queueNumber?: number }[];
};

type PendingRow = { _id: string; billNo?: string; total: number; outstanding: number; totalPaid: number; status: string; patientId: string };
type PendingResp = { branchId: string | null; count: number; rows: PendingRow[] };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

type ReportTab = 'revenue' | 'schedule' | 'pending' | 'utilization';
const REPORT_TABS = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'pending', label: 'Pending payments' },
  { id: 'utilization', label: 'Doctor utilization' },
] as const;

export function ReportsScreen() {
  const [tab, setTab] = useState<ReportTab>('revenue');

  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>Reports</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Revenue, schedule, pending payments and doctor utilization.</p>
      </div>

      <AnimatedTabs tabs={REPORT_TABS} value={tab} onChange={setTab} />

      <div key={tab} style={{ animation: 'slideUp 200ms ease-out' }}>
        {tab === 'revenue' && <RevenueTab />}
        {tab === 'schedule' && <ScheduleTab />}
        {tab === 'pending' && <PendingTab />}
        {tab === 'utilization' && <UtilizationTab />}
      </div>
    </div>
  );
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="press-scale"
      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
      <span style={{ fontWeight: 600 }}>↓</span> CSV
    </button>
  );
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function RevenueTab() {
  const { ctx } = useApp();
  const [from, setFrom] = useState(daysAgoIso(13));
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<RevenueResp | null>(null);
  const [series, setSeries] = useState<{ labels: string[]; values: number[]; full: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ from, to });
      if (ctx.branchId) qs.set('branchId', ctx.branchId);
      const res = await apiGet<RevenueResp>(ctx, `/reports/revenue?${qs.toString()}`);
      setData(res);
      // Build a daily series via parallel single-day calls (cap at 31 days)
      const dates = enumerateDays(from, to).slice(-31);
      const dailyResults = await Promise.all(dates.map(async (d) => {
        try {
          const params = new URLSearchParams({ from: d, to: d });
          if (ctx.branchId) params.set('branchId', ctx.branchId);
          const r = await apiGet<RevenueResp>(ctx, `/reports/revenue?${params.toString()}`);
          return { date: d, value: r.payments.totalPaid };
        } catch {
          return { date: d, value: 0 };
        }
      }));
      setSeries({
        labels: dailyResults.map((r) => r.date.slice(5)),
        values: dailyResults.map((r) => r.value),
        full: dailyResults.map((r) => r.date),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [ctx.clinicId, ctx.branchId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><Field label="From" value={from} onChange={setFrom} placeholder="YYYY-MM-DD" /></div>
        <div style={{ flex: 1 }}><Field label="To" value={to} onChange={setTo} placeholder="YYYY-MM-DD" /></div>
        <button onClick={load} disabled={loading}
          style={{ height: 40, padding: '0 20px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Loading…' : 'Reload'}
        </button>
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 14 }}>
            <KpiTile label="Issued bills" value={<Counter value={data.issuedBills.count} />} sub={`${formatINR(data.issuedBills.totalBilled)} billed`} />
            <KpiTile label="Payments" value={<Counter value={data.payments.count} />} sub={`${formatINR(data.payments.totalPaid)} paid`} />
            <KpiTile label="Net collected" value={<Counter value={data.payments.totalPaid} format={(n) => formatINR(n)} />} sub={`${data.from} → ${data.to}`} />
            <KpiTile label="Timezone" value={data.timezone} sub={data.branchId ? `Branch: ${data.branchId.slice(-6)}` : 'All branches'} />
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Daily revenue</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{from} → {to}</span>
                {series && <ExportButton onClick={() => downloadCsv(`revenue-${from}-to-${to}.csv`, [['Date', 'Revenue (INR)'], ...series.full.map((d, i) => [d, String(series.values[i])])])} />}
              </div>
            </div>
            {series ? (
              <>
                <AreaChart data={series.values} labels={series.labels} height={220} />
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-muted)' }}>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.full.map((d, i) => (
                        <tr key={d} style={{ borderTop: '1px solid var(--border)', animation: `slideUp 150ms ease-out ${Math.min(i * 20, 240)}ms both` }}>
                          <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)' }}>{d}</td>
                          <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatINR(series.values[i])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{ padding: 16 }}>
                <Skeleton height={200} />
                <div style={{ marginTop: 12 }}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, padding: '6px 0' }}>
                      <Skeleton width="40%" height={11} />
                      <Skeleton width="20%" height={11} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function UtilizationTab() {
  const { ctx } = useApp();
  const [date, setDate] = useState(todayIso());
  const [branchId, setBranchId] = useState(ctx.branchId ?? '');
  const [data, setData] = useState<ScheduleResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!branchId.trim()) { setError('Branch ID is required.'); return; }
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ date, branchId: branchId.trim() });
      const res = await apiGet<ScheduleResp>(ctx, `/reports/schedule/daily?${qs.toString()}`);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [ctx.clinicId]);

  const rows = data ? Object.entries(data.byDoctor).map(([doctorId, d]) => {
    const completed = (d.byStatus.DONE ?? 0) + (d.byStatus.CHECKED_IN ?? 0) + (d.byStatus.IN_PROGRESS ?? 0);
    const cancelled = (d.byStatus.CANCELLED ?? 0) + (d.byStatus.NO_SHOW ?? 0);
    const utilPct = d.total > 0 ? Math.round((completed / d.total) * 100) : 0;
    return { doctorId, total: d.total, completed, cancelled, time: d.byType.TIME ?? 0, queue: d.byType.QUEUE ?? 0, utilPct };
  }).sort((a, b) => b.total - a.total) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><Field label="Date" value={date} onChange={setDate} placeholder="YYYY-MM-DD" /></div>
        <div style={{ flex: 1 }}><Field label="Branch ID" value={branchId} onChange={setBranchId} placeholder="ObjectId" /></div>
        <button onClick={load} disabled={loading} className="press-scale"
          style={{ height: 40, padding: '0 20px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Loading…' : 'Reload'}
        </button>
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

      {data && rows.length > 0 ? (
        <>
          <div style={{ display: 'flex', gap: 14 }}>
            <KpiTile label="Doctors active" value={<Counter value={rows.length} />} sub={`${data.total} appts total`} />
            <KpiTile label="Avg per doctor" value={<Counter value={Math.round(data.total / Math.max(rows.length, 1))} />} sub="Across all types" />
            <KpiTile label="Time-based" value={<Counter value={rows.reduce((s, r) => s + r.time, 0)} />} sub="Booked slots" />
            <KpiTile label="Queue" value={<Counter value={rows.reduce((s, r) => s + r.queue, 0)} />} sub="Walk-in tokens" />
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>By doctor</div>
              <ExportButton onClick={() => downloadCsv(`utilization-${date}.csv`,
                [['Doctor', 'Total', 'Completed', 'Cancelled', 'Time', 'Queue', 'Utilization %'],
                  ...rows.map((r) => [r.doctorId, String(r.total), String(r.completed), String(r.cancelled), String(r.time), String(r.queue), String(r.utilPct)])])} />
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-muted)' }}>
                  {['Doctor', 'Total', 'Completed', 'Cancelled', 'Time', 'Queue', 'Utilization'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: i === 0 ? 'left' : 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.doctorId} style={{ borderTop: '1px solid var(--border)', animation: `slideUp 150ms ease-out ${Math.min(i * 20, 240)}ms both` }}>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text)', fontFamily: 'monospace' }}>{r.doctorId.slice(-8)}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.total}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--success-500)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.completed}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--danger-500)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.cancelled}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.time}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.queue}</td>
                    <td style={{ padding: '11px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 60, height: 6, background: 'var(--surface-muted)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${r.utilPct}%`, height: '100%', background: 'var(--brand-500)', borderRadius: 3, transition: 'width 600ms var(--ease-out)' }} />
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 30 }}>{r.utilPct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : data && rows.length === 0 ? (
        <EmptyState illustration="calendar" title="No appointments to analyze" hint="Pick a different date or branch." />
      ) : !loading && !data ? null : (
        <Skeleton height={240} />
      )}
    </div>
  );
}

function enumerateDays(fromIso: string, toIso: string): string[] {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const start = new Date(fy, (fm ?? 1) - 1, fd ?? 1);
  const end = new Date(ty, (tm ?? 1) - 1, td ?? 1);
  if (end < start) return [fromIso];
  const out: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function ScheduleTab() {
  const { ctx } = useApp();
  const [date, setDate] = useState(todayIso());
  const [branchId, setBranchId] = useState(ctx.branchId ?? '');
  const [data, setData] = useState<ScheduleResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!branchId.trim()) { setError('Branch ID is required.'); return; }
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ date, branchId: branchId.trim() });
      const res = await apiGet<ScheduleResp>(ctx, `/reports/schedule/daily?${qs.toString()}`);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [ctx.clinicId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><Field label="Date" value={date} onChange={setDate} placeholder="YYYY-MM-DD" /></div>
        <div style={{ flex: 1 }}><Field label="Branch ID" value={branchId} onChange={setBranchId} placeholder="ObjectId" /></div>
        <button onClick={load} disabled={loading}
          style={{ height: 40, padding: '0 20px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Loading…' : 'Reload'}
        </button>
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 14 }}>
            <KpiTile label="Total appts" value={String(data.total)} sub={`${data.timezone}`} />
            <KpiTile label="Doctors" value={String(Object.keys(data.byDoctor).length)} sub={`Branch ${branchId.slice(-6)}`} />
          </div>
          {data.items.length === 0 ? (
            <EmptyState illustration="calendar" title="No appointments on this date" />
          ) : (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-muted)' }}>
                    {['Type', 'Patient', 'Doctor', 'Window', 'Status'].map((h) => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a._id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text-muted)' }}>{a.type}</td>
                      <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text)', fontFamily: 'monospace' }}>{a.patientId.slice(-8)}</td>
                      <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{a.doctorId.slice(-8)}</td>
                      <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                        {a.type === 'TIME' ? `${formatTime(a.startAt)} → ${formatTime(a.endAt)}` : `Q#${a.queueNumber ?? '—'}`}
                      </td>
                      <td style={{ padding: '11px 16px' }}><StatusPill status={(a.status || '').toLowerCase().replace(/_/g, '-')} small /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PendingTab() {
  const { ctx } = useApp();
  const [data, setData] = useState<PendingResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (ctx.branchId) qs.set('branchId', ctx.branchId);
      const res = await apiGet<PendingResp>(ctx, `/reports/pending-payments?${qs.toString()}`);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [ctx.clinicId, ctx.branchId]);

  const total = data?.rows.reduce((s, r) => s + r.outstanding, 0) ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 14 }}>
        <KpiTile label="Pending bills" value={data ? String(data.count) : '—'} sub="Issued, balance > 0" />
        <KpiTile label="Total outstanding" value={formatINR(total)} sub={ctx.branchId ? `Branch ${ctx.branchId.slice(-6)}` : 'All branches'} />
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

      {loading && !data && <div style={{ padding: 24, color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>}

      {data && (data.rows.length === 0 ? (
        <EmptyState illustration="receipt" title="All bills paid" hint="There are no issued bills with outstanding balances." />
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-muted)' }}>
                {['Bill no', 'Patient', 'Total', 'Paid', 'Outstanding'].map((h, i) => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: i >= 2 ? 'right' : 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((b) => (
                <tr key={b._id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text-subtle)', fontFamily: 'monospace' }}>{b.billNo ?? b._id.slice(-6)}</td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text)', fontFamily: 'monospace' }}>{b.patientId.slice(-12)}</td>
                  <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatINR(b.total)}</td>
                  <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatINR(b.totalPaid)}</td>
                  <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--danger-500)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatINR(b.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', fontFamily: "'Manrope',sans-serif", letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function formatTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
