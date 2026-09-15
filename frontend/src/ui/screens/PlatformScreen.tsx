import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { useIsMobile } from '../../app/useIsMobile';
import { EmptyState, Spinner, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';
import { AnimatedTabs } from '../shared/AnimatedTabs';

/**
 * DigiRx clinic approval queue.
 *
 * The only cross-tenant screen in the app: it lists clinics from every
 * tenant so the platform team can approve, reject or suspend them. Access is
 * gated on `isPlatformAdmin` in App.tsx and again by PlatformAdminGuard on
 * the server, so an ordinary clinic admin cannot reach it by URL.
 */

type ClinicStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

type ClinicRow = {
  _id: string;
  name: string;
  status: ClinicStatus;
  countryCode: string;
  timezone: string;
  currency: string;
  requestedByName: string | null;
  requestedByEmail: string | null;
  statusReason: string | null;
  statusChangedAt: string | null;
  createdAt: string | null;
  branchCount: number;
  userCount: number;
};

type Summary = { counts: Record<string, number>; total: number };

const TABS = [
  { id: 'PENDING', label: 'Pending' },
  { id: 'ACTIVE', label: 'Approved' },
  { id: 'SUSPENDED', label: 'Suspended' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'ALL', label: 'All' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const STATUS_STYLE: Record<ClinicStatus, { bg: string; color: string }> = {
  PENDING: { bg: 'var(--warning-bg)', color: 'var(--warning-text)' },
  ACTIVE: { bg: 'var(--success-bg)', color: 'var(--success-text)' },
  REJECTED: { bg: 'var(--danger-bg)', color: 'var(--danger-text)' },
  SUSPENDED: { bg: 'var(--danger-bg)', color: 'var(--danger-text)' },
};

function ClinicStatusPill({ status }: { status: ClinicStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 100,
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap',
      background: style.bg, color: style.color,
    }}>
      {status}
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function PlatformScreen() {
  const { ctx } = useApp();
  const toast = useToast();
  const isMobile = useIsMobile();

  const [tab, setTab] = useState<TabId>('PENDING');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ClinicRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Clinic id currently being approved/rejected, so only that row's
  // buttons show a spinner rather than the whole list locking up.
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ status: tab, limit: '100' });
      if (query.trim()) qs.set('query', query.trim());
      const [list, counts] = await Promise.all([
        apiGet<{ rows: ClinicRow[] }>(ctx, `/platform/clinics?${qs.toString()}`),
        apiGet<Summary>(ctx, '/platform/clinics/summary'),
      ]);
      setRows(list.rows);
      setSummary(counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [ctx, tab, query]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  async function act(
    clinic: ClinicRow,
    action: 'approve' | 'reject' | 'suspend' | 'reactivate',
  ) {
    // Reject and suspend cut off access, so make the operator say why.
    let reason: string | undefined;
    if (action === 'reject' || action === 'suspend') {
      const answer = window.prompt(
        action === 'reject'
          ? `Why is "${clinic.name}" being rejected? The admin sees this on their next sign-in attempt.`
          : `Why is "${clinic.name}" being suspended?`,
      );
      if (answer === null) return;
      reason = answer.trim() || undefined;
    }

    setBusyId(clinic._id);
    try {
      await apiPost(ctx, `/platform/clinics/${clinic._id}/${action}`, reason ? { reason } : {});
      const verb =
        action === 'approve' || action === 'reactivate'
          ? 'approved'
          : action === 'reject'
            ? 'rejected'
            : 'suspended';
      toast(`${clinic.name} ${verb}`, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = summary?.counts.PENDING ?? 0;

  const tabsWithCounts = useMemo(
    () =>
      TABS.map((t) => ({
        id: t.id,
        label:
          t.id === 'ALL'
            ? `${t.label}${summary ? ` (${summary.total})` : ''}`
            : `${t.label}${summary ? ` (${summary.counts[t.id] ?? 0})` : ''}`,
      })),
    [summary],
  );

  return (
    <div style={{ padding: isMobile ? 16 : '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, width: '100%', height: '100%', overflowY: 'auto' }}>
      <div>
        <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px', margin: 0 }}>
          Clinic approvals
        </h1>
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
          New sign-ups wait here until you approve them. Nobody from a pending
          clinic can sign in.
        </p>
      </div>

      {pendingCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'var(--warning-bg)', border: '1px solid var(--warning-border-soft)', color: 'var(--warning-text)', fontSize: 12.5 }}>
          <Icon name="clock" size={15} style={{ flexShrink: 0 }} />
          {pendingCount} clinic{pendingCount === 1 ? '' : 's'} waiting for approval.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <AnimatedTabs tabs={tabsWithCounts} value={tab} onChange={(v) => setTab(v as TabId)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', padding: '6px 10px', minWidth: 220 }}>
          <Icon name="search" size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clinic, admin or email…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 12.5, color: 'var(--text)' }}
          />
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--danger-500)' }}>
          {error}
        </div>
      )}

      {rows === null ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spinner size={22} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon="cross" title={tab === 'PENDING' ? 'No clinics waiting for approval' : 'No clinics here'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((clinic) => (
            <div
              key={clinic._id}
              style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', gap: 14 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: "'Manrope',sans-serif", fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>
                    {clinic.name}
                  </span>
                  <ClinicStatusPill status={clinic.status} />
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {clinic.requestedByName ?? 'Unknown admin'}
                  {clinic.requestedByEmail ? ` · ${clinic.requestedByEmail}` : ''}
                </div>

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-subtle)', marginTop: 6 }}>
                  <span>Registered {formatDate(clinic.createdAt)}</span>
                  <span>{clinic.countryCode} · {clinic.currency}</span>
                  <span>{clinic.timezone}</span>
                  <span>{clinic.userCount} user{clinic.userCount === 1 ? '' : 's'}</span>
                  <span>{clinic.branchCount} branch{clinic.branchCount === 1 ? '' : 'es'}</span>
                </div>

                {clinic.statusReason && (
                  <div style={{ fontSize: 11.5, color: 'var(--danger-text)', marginTop: 6 }}>
                    Reason: {clinic.statusReason}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {busyId === clinic._id ? (
                  <Spinner size={16} />
                ) : (
                  <>
                    {clinic.status === 'PENDING' && (
                      <>
                        <ActionButton tone="primary" icon="checkCircle" label="Approve" onClick={() => void act(clinic, 'approve')} />
                        <ActionButton tone="danger" icon="x" label="Reject" onClick={() => void act(clinic, 'reject')} />
                      </>
                    )}
                    {clinic.status === 'ACTIVE' && (
                      <ActionButton tone="danger" icon="lock" label="Suspend" onClick={() => void act(clinic, 'suspend')} />
                    )}
                    {(clinic.status === 'SUSPENDED' || clinic.status === 'REJECTED') && (
                      <ActionButton tone="primary" icon="checkCircle" label="Reactivate" onClick={() => void act(clinic, 'reactivate')} />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  tone,
  onClick,
}: {
  label: string;
  icon: 'checkCircle' | 'x' | 'lock';
  tone: 'primary' | 'danger';
  onClick: () => void;
}) {
  const primary = tone === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 34, padding: '0 12px', borderRadius: 9, cursor: 'pointer',
        fontSize: 12.5, fontWeight: 600,
        border: primary ? 'none' : '1px solid var(--border)',
        background: primary ? 'var(--brand-500)' : 'var(--surface)',
        color: primary ? 'var(--brand-text)' : 'var(--danger-500)',
      }}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}
