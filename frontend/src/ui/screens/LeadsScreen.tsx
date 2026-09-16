import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { useIsMobile } from '../../app/useIsMobile';
import { EmptyState, Spinner, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';
import { AnimatedTabs } from '../shared/AnimatedTabs';

/**
 * Enquiries from the marketing site's contact form.
 *
 * Platform-level like the approval queue: leads arrive before any clinic
 * exists, so these rows carry no clinicId and only DigiRx staff can see them.
 */

type LeadStatus = 'NEW' | 'CONTACTED' | 'WON' | 'CLOSED';

type LeadRow = {
  _id: string;
  name: string;
  email: string;
  phone: string | null;
  reason: string | null;
  message: string;
  source: string;
  status: LeadStatus;
  notes: string | null;
  notified: boolean;
  handledAt: string | null;
  createdAt: string | null;
};

type Summary = { counts: Record<string, number>; total: number };

const TABS = [
  { id: 'NEW', label: 'New' },
  { id: 'CONTACTED', label: 'Contacted' },
  { id: 'WON', label: 'Won' },
  { id: 'CLOSED', label: 'Closed' },
  { id: 'ALL', label: 'All' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const STATUS_STYLE: Record<LeadStatus, { bg: string; color: string }> = {
  NEW: { bg: 'var(--warning-bg)', color: 'var(--warning-text)' },
  CONTACTED: { bg: 'var(--info-bg)', color: 'var(--info-text)' },
  WON: { bg: 'var(--success-bg)', color: 'var(--success-text)' },
  CLOSED: { bg: 'var(--neutral-bg)', color: 'var(--neutral-text)' },
};

function StatusPill({ status }: { status: LeadStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 100,
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap',
      background: s.bg, color: s.color,
    }}>
      {status}
    </span>
  );
}

function formatWhen(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function LeadsScreen() {
  const { ctx } = useApp();
  const toast = useToast();
  const isMobile = useIsMobile();

  const [tab, setTab] = useState<TabId>('NEW');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ status: tab, limit: '100' });
      if (query.trim()) qs.set('query', query.trim());
      const [list, counts] = await Promise.all([
        apiGet<{ rows: LeadRow[] }>(ctx, `/platform/leads?${qs.toString()}`),
        apiGet<Summary>(ctx, '/platform/leads/summary'),
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

  async function setStatus(lead: LeadRow, status: LeadStatus) {
    setBusyId(lead._id);
    try {
      await apiPatch(ctx, `/platform/leads/${lead._id}`, { status });
      toast(`${lead.name} marked ${status.toLowerCase()}`, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusyId(null);
    }
  }

  const newCount = summary?.counts.NEW ?? 0;

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
          Website enquiries
        </h1>
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
          Every message sent from the contact form on the DigiRx website lands here.
        </p>
      </div>

      {newCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'var(--warning-bg)', border: '1px solid var(--warning-border-soft)', color: 'var(--warning-text)', fontSize: 12.5 }}>
          <Icon name="mail" size={15} style={{ flexShrink: 0 }} />
          {newCount} new enquir{newCount === 1 ? 'y' : 'ies'} waiting for a reply.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <AnimatedTabs tabs={tabsWithCounts} value={tab} onChange={(v) => setTab(v as TabId)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', padding: '6px 10px', minWidth: 220 }}>
          <Icon name="search" size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or message…"
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
        <EmptyState icon="mail" title={tab === 'NEW' ? 'No new enquiries' : 'Nothing here'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((lead) => (
            <div
              key={lead._id}
              style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: "'Manrope',sans-serif", fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>
                      {lead.name}
                    </span>
                    <StatusPill status={lead.status} />
                    {lead.reason && (
                      <span style={{ fontSize: 11, color: 'var(--text-subtle)', border: '1px solid var(--border)', borderRadius: 100, padding: '1px 8px' }}>
                        {lead.reason}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    <a href={`mailto:${lead.email}`} style={{ color: 'var(--brand-600)', textDecoration: 'none' }}>
                      {lead.email}
                    </a>
                    {lead.phone && <a href={`tel:${lead.phone}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>{lead.phone}</a>}
                    <span>{formatWhen(lead.createdAt)}</span>
                    {!lead.notified && (
                      <span title="The notification email did not go out — check LEADS_NOTIFY_EMAIL and the mail provider."
                        style={{ color: 'var(--warning-text)' }}>
                        email not sent
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {busyId === lead._id ? (
                    <Spinner size={16} />
                  ) : (
                    <>
                      {lead.status === 'NEW' && (
                        <ActionButton tone="primary" icon="checkCircle" label="Mark contacted"
                          onClick={() => void setStatus(lead, 'CONTACTED')} />
                      )}
                      {lead.status === 'CONTACTED' && (
                        <ActionButton tone="primary" icon="checkCircle" label="Won"
                          onClick={() => void setStatus(lead, 'WON')} />
                      )}
                      {lead.status !== 'CLOSED' && (
                        <ActionButton tone="muted" icon="x" label="Close"
                          onClick={() => void setStatus(lead, 'CLOSED')} />
                      )}
                    </>
                  )}
                </div>
              </div>

              <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', margin: 0, whiteSpace: 'pre-wrap' }}>
                {lead.message}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label, icon, tone, onClick,
}: {
  label: string;
  icon: 'checkCircle' | 'x';
  tone: 'primary' | 'muted';
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
        color: primary ? 'var(--brand-text)' : 'var(--text-muted)',
      }}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}
