import { useMemo, useState } from 'react';
import { apiGet } from '../../app/api';
import type { DevContext } from '../../app/context';
import { Card, Field, ScreenTitle, SecondaryButton } from '../components/ui';

export function ReportsScreen({ ctx }: { ctx: DevContext }) {
  const canCall = useMemo(
    () => Boolean(ctx.apiBaseUrl && ctx.clinicId && (ctx.accessToken || ctx.userId)),
    [ctx],
  );

  const [branchId, setBranchId] = useState(ctx.branchId ?? '');
  const [err, setErr] = useState<string | null>(null);

  const [revFrom, setRevFrom] = useState(() => monthStartIso());
  const [revTo, setRevTo] = useState(() => todayIso());
  const [revenue, setRevenue] = useState<unknown>(null);
  const [revLoading, setRevLoading] = useState(false);

  const [schedDate, setSchedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [schedBranch, setSchedBranch] = useState(ctx.branchId ?? '');
  const [schedule, setSchedule] = useState<unknown>(null);
  const [schedLoading, setSchedLoading] = useState(false);

  const [pendLimit, setPendLimit] = useState('50');
  const [pending, setPending] = useState<unknown>(null);
  const [pendLoading, setPendLoading] = useState(false);

  async function loadRevenue() {
    if (!canCall) return;
    setErr(null);
    setRevLoading(true);
    try {
      const qs = new URLSearchParams({ from: revFrom.trim(), to: revTo.trim() });
      if (branchId.trim()) qs.set('branchId', branchId.trim());
      const data = await apiGet<unknown>(ctx, `/reports/revenue?${qs.toString()}`);
      setRevenue(data);
    } catch (e) {
      setErr(String(e));
      setRevenue(null);
    } finally {
      setRevLoading(false);
    }
  }

  async function loadSchedule() {
    if (!canCall) return;
    setErr(null);
    setSchedLoading(true);
    try {
      const qs = new URLSearchParams({ date: schedDate.trim(), branchId: schedBranch.trim() });
      const data = await apiGet<unknown>(ctx, `/reports/schedule/daily?${qs.toString()}`);
      setSchedule(data);
    } catch (e) {
      setErr(String(e));
      setSchedule(null);
    } finally {
      setSchedLoading(false);
    }
  }

  async function loadPending() {
    if (!canCall) return;
    setErr(null);
    setPendLoading(true);
    try {
      const qs = new URLSearchParams({ limit: pendLimit.trim() || '50' });
      if (branchId.trim()) qs.set('branchId', branchId.trim());
      const data = await apiGet<unknown>(ctx, `/reports/pending-payments?${qs.toString()}`);
      setPending(data);
    } catch (e) {
      setErr(String(e));
      setPending(null);
    } finally {
      setPendLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      <ScreenTitle title="Reports" subtitle="Revenue, schedule, and pending payments." />
      {!canCall ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Configure API + clinic and sign in from Home.
        </div>
      ) : null}
      {err ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 whitespace-pre-wrap break-all">
          {err}
        </div>
      ) : null}

      <Card>
        <div className="text-xs font-semibold text-brand-ink">Default branch (optional)</div>
        <div className="mt-2">
          <Field label="Branch ID" value={branchId} onChange={setBranchId} placeholder="Used for revenue & pending if set" />
        </div>
        <div className="mt-2 text-[11px] text-brand-inkMuted">
          Daily schedule needs its own branch below. Revenue/pending use this when provided.
        </div>
      </Card>

      <Card title="Revenue">
        <div className="text-[11px] text-brand-inkMuted">
          Requires <code className="text-brand-ink">billing:read</code>.
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="From (YYYY-MM-DD)" value={revFrom} onChange={setRevFrom} />
          <Field label="To (YYYY-MM-DD)" value={revTo} onChange={setRevTo} />
        </div>
        <div className="mt-2">
          <SecondaryButton onClick={() => void loadRevenue()} disabled={!canCall || revLoading}>
            {revLoading ? 'Loading…' : 'Load revenue'}
          </SecondaryButton>
        </div>
        {revenue ? (
          <pre className="mt-3 max-h-56 overflow-auto rounded-2xl border border-violet-100/70 bg-violet-50/40 p-3 text-[11px] text-brand-ink shadow-inner ring-1 ring-fuchsia-100/30">
            {JSON.stringify(revenue, null, 2)}
          </pre>
        ) : null}
      </Card>

      <Card title="Daily schedule">
        <div className="text-[11px] text-brand-inkMuted">
          Requires <code className="text-brand-ink">appointment:read</code>.
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Date" value={schedDate} onChange={setSchedDate} />
          <Field label="Branch ID" value={schedBranch} onChange={setSchedBranch} />
        </div>
        <div className="mt-2">
          <SecondaryButton onClick={() => void loadSchedule()} disabled={!canCall || schedLoading || !schedBranch.trim()}>
            {schedLoading ? 'Loading…' : 'Load schedule'}
          </SecondaryButton>
        </div>
        {schedule ? (
          <pre className="mt-3 max-h-72 overflow-auto rounded-2xl border border-violet-100/70 bg-violet-50/40 p-3 text-[11px] text-brand-ink shadow-inner ring-1 ring-fuchsia-100/30">
            {JSON.stringify(schedule, null, 2)}
          </pre>
        ) : null}
      </Card>

      <Card title="Pending payments">
        <div className="text-[11px] text-brand-inkMuted">
          Requires <code className="text-brand-ink">billing:read</code>.
        </div>
        <div className="mt-2">
          <Field label="Limit" value={pendLimit} onChange={setPendLimit} />
        </div>
        <div className="mt-2">
          <SecondaryButton onClick={() => void loadPending()} disabled={!canCall || pendLoading}>
            {pendLoading ? 'Loading…' : 'Load pending'}
          </SecondaryButton>
        </div>
        {pending ? (
          <pre className="mt-3 max-h-72 overflow-auto rounded-2xl border border-violet-100/70 bg-violet-50/40 p-3 text-[11px] text-brand-ink shadow-inner ring-1 ring-fuchsia-100/30">
            {JSON.stringify(pending, null, 2)}
          </pre>
        ) : null}
      </Card>
    </section>
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}
