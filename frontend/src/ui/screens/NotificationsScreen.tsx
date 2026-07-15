import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { useIsMobile } from '../../app/useIsMobile';
import { EmptyState, Field, formatDateTime, labelStyle, useToast } from '../shared/primitives';
import { Icon, type IconName } from '../shared/Icon';
import { AnimatedTabs } from '../shared/AnimatedTabs';
import { Skeleton } from '../shared/Skeleton';

type NotifLog = {
  _id: string;
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP' | string;
  to: string;
  // Patient name resolved from `to` by the backend, when the recipient
  // matches a patient on file. Absent for non-patient recipients.
  recipientName?: string;
  body: string;
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'PENDING' | string;
  attempts?: number;
  sentAt?: string;
  createdAt?: string;
  templateKey?: string;
};

type Template = {
  _id?: string;
  channel: string;
  key: string;
  body: string;
  active?: boolean;
};

const CHANNELS: Record<string, { label: string; color: string; bg: string; icon: IconName }> = {
  EMAIL:    { label: 'Email',    color: 'var(--brand-500)',   bg: 'var(--brand-bg-soft)', icon: 'mail' },
  SMS:      { label: 'SMS',      color: 'var(--purple-500)',  bg: 'var(--purple-bg)',     icon: 'smartphone' },
  WHATSAPP: { label: 'WhatsApp', color: 'var(--success-500)', bg: 'var(--success-bg)',    icon: 'send' },
};

const NOTIF_STATUS_COLORS: Record<string, string> = {
  SENT: 'var(--success-500)',
  FAILED: 'var(--danger-500)',
  PENDING: 'var(--warning-500)',
  QUEUED: 'var(--text-subtle)',
};

const SAMPLE = {
  patientName: 'Anjali Mehta',
  doctorName: 'Dr. S. Verma',
  appointmentTime: '10:00 AM',
  clinicName: 'Apollo Health Centre',
  branchName: 'Bandra West',
  prescriptionUrl: 'digirx.in/rx/abc123',
  billNo: 'AHC-2026-0846',
  billAmount: '₹2,450',
  followUpDate: '10 May 2026',
};
const TOKENS = Object.keys(SAMPLE);
function renderPreview(body: string) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (SAMPLE as Record<string, string>)[k] ?? `{{${k}}}`);
}

export function NotificationsScreen() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<'logs' | 'templates'>('logs');

  return (
    <div style={{ padding: isMobile ? 16 : '24px 28px', display: 'flex', flexDirection: 'column', gap: isMobile ? 16 : 20, height: '100%', overflowY: 'auto' }}>
      <div>
        <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>Notifications</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>SMS · WhatsApp · Email — delivery logs and templates.</p>
      </div>

      <AnimatedTabs
        tabs={[{ id: 'logs', label: 'Logs' }, { id: 'templates', label: 'Templates' }] as const}
        value={tab}
        onChange={setTab}
      />

      <div key={tab} style={{ animation: 'slideUp 180ms ease-out' }}>
        {tab === 'logs' && <LogsTab />}
        {tab === 'templates' && <TemplatesTab />}
      </div>
    </div>
  );
}

function LogsTab() {
  const { ctx } = useApp();
  const isMobile = useIsMobile();
  const [logs, setLogs] = useState<NotifLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'sent' | 'failed' | 'pending' | 'queued'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    // Pass the active branchId so switching branches narrows the log.
    // ctx.branchId is included in the dep array below so the effect
    // re-runs on branch change.
    const qs = new URLSearchParams({ limit: '100' });
    if (ctx.branchId) qs.set('branchId', ctx.branchId);
    apiGet<NotifLog[]>(ctx, `/notifications/logs?${qs.toString()}`)
      .then(setLogs)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ctx, ctx.branchId]);

  const filtered = logs?.filter((l) => filter === 'all' || (l.status || '').toLowerCase() === filter) ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="scroll-x-hidden" style={{ display: 'flex', gap: 4, background: 'var(--surface-muted)', borderRadius: 10, padding: 3, border: '1px solid var(--border)', alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }}>
        {(['all', 'sent', 'failed', 'pending', 'queued'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: isMobile ? '5px 12px' : '5px 14px', borderRadius: 8, border: 'none', background: filter === f ? 'var(--surface)' : 'transparent', color: filter === f ? 'var(--text)' : 'var(--text-muted)', fontSize: 12, fontWeight: filter === f ? 600 : 400, cursor: 'pointer', textTransform: 'capitalize', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {f}
          </button>
        ))}
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

      {!logs && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Skeleton width={64} height={18} radius={9} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Skeleton width="40%" height={11} />
                <Skeleton width="65%" height={9} />
              </div>
              <Skeleton width={80} height={11} />
            </div>
          ))}
        </div>
      )}

      {filtered && filtered.length === 0 && <EmptyState illustration="bell" title="No notifications yet" hint="Reminders are queued by the scheduler 24h and 2h before appointments." />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered?.map((log) => {
          const channel = CHANNELS[(log.channel || '').toUpperCase()] ?? { label: log.channel, color: 'var(--text-subtle)', bg: 'var(--surface-muted)', icon: 'bell' as IconName };
          const statusUp = (log.status || '').toUpperCase();
          const statusColor = NOTIF_STATUS_COLORS[statusUp] ?? 'var(--text-subtle)';
          const isExp = expanded === log._id;
          const channelBadge = (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 100, background: channel.bg, color: channel.color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              <Icon name={channel.icon} size={11} /> {channel.label}
            </span>
          );
          const statusBadge = (
            <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <Icon name={statusUp === 'SENT' ? 'checkCircle' : statusUp === 'FAILED' ? 'xCircle' : 'clock'} size={12} strokeWidth={2} />
              {statusUp}
            </span>
          );
          const attemptsBadge = (log.attempts ?? 0) > 1
            ? <span style={{ fontSize: 10, color: 'var(--text-subtle)', background: 'var(--surface-muted)', padding: '1px 6px', borderRadius: 6, border: '1px solid var(--border)' }}>{log.attempts} attempts</span>
            : null;
          const dateText = formatDateTime(log.sentAt ?? log.createdAt);
          return (
            <div key={log._id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', cursor: 'pointer' }}
              onClick={() => setExpanded(isExp ? null : log._id)}>
              {isMobile ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    {channelBadge}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {statusBadge}
                      <Icon name={isExp ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--text-subtle)' }} />
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {log.recipientName ?? log.to}
                    </div>
                    {log.recipientName && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.to}</div>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.templateKey ?? '—'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ minWidth: 0 }}>{attemptsBadge}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-subtle)', flexShrink: 0 }}>{dateText}</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                  {channelBadge}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {log.recipientName ?? log.to}
                    </div>
                    {log.recipientName && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {log.to}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {log.templateKey ?? '—'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {statusBadge}
                    {attemptsBadge}
                    <span style={{ fontSize: 11, color: 'var(--text-subtle)', minWidth: 130, textAlign: 'right' }}>{dateText}</span>
                    <Icon name={isExp ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--text-subtle)' }} />
                  </div>
                </div>
              )}
              {isExp && (
                <div style={{ padding: isMobile ? '10px 14px 12px' : '12px 16px 14px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Body</div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, background: 'var(--surface-muted)', padding: '10px 14px', borderRadius: 9, border: '1px solid var(--border)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{log.body}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TemplatesTab() {
  const { ctx } = useApp();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Template | null>(null);
  const [body, setBody] = useState('');
  const [key, setKey] = useState('');
  const [channel, setChannel] = useState<'SMS' | 'EMAIL' | 'WHATSAPP'>('SMS');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  async function reload() {
    try {
      const t = await apiGet<Template[]>(ctx, '/notifications/templates');
      setTemplates(t);
      if (!selected && t.length > 0) {
        setSelected(t[0]);
        setBody(t[0].body);
        setKey(t[0].key);
        setChannel(t[0].channel as 'SMS' | 'EMAIL' | 'WHATSAPP');
        setActive(t[0].active ?? true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void reload(); }, []);

  function pick(t: Template) {
    setSelected(t); setBody(t.body); setKey(t.key); setChannel(t.channel as 'SMS' | 'EMAIL' | 'WHATSAPP'); setActive(t.active ?? true);
  }

  function newTemplate() {
    setSelected({ channel: 'SMS', key: '', body: '', active: true });
    setBody(''); setKey(''); setChannel('SMS'); setActive(true);
  }

  async function save() {
    if (!key.trim() || !body.trim()) { setError('Key and body required.'); return; }
    setSaving(true); setError(null);
    try {
      await apiPost(ctx, '/notifications/templates', { channel, key: key.trim(), body, active });
      toast('Template saved', 'success');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function insertToken(tok: string) {
    setBody((b) => b + `{{${tok}}}`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 20, alignItems: 'flex-start' }}>
      <div style={{ width: isMobile ? '100%' : 240, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{templates?.length ?? 0} templates</span>
          <button onClick={newTemplate}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 600, color: 'var(--brand-500)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="plus" size={11} strokeWidth={2.5} /> New
          </button>
        </div>
        {!templates && <div style={{ padding: 16, fontSize: 12, color: 'var(--text-subtle)' }}>Loading…</div>}
        {templates?.map((t) => (
          <div key={`${t.channel}-${t.key}`} onClick={() => pick(t)}
            style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: selected?.key === t.key && selected?.channel === t.channel ? 'var(--brand-50)' : 'transparent', borderLeft: selected?.key === t.key ? '3px solid var(--brand-500)' : '3px solid transparent' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: selected?.key === t.key ? 'var(--brand-700)' : 'var(--text)', marginBottom: 4 }}>{t.key}</div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 100, background: 'var(--surface-muted)', color: 'var(--text-muted)', fontSize: 10, fontWeight: 700 }}>{t.channel}</span>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Channel</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value as 'SMS' | 'EMAIL' | 'WHATSAPP')}
                style={{ width: '100%', height: 38, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 9, fontSize: 13, color: 'var(--text)', outline: 'none', cursor: 'pointer' }}>
                <option value="SMS">SMS</option>
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <Field label="Key" value={key} onChange={setKey} placeholder="appointment_reminder_120m" />
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {TOKENS.map((tok) => (
              <button key={tok} onClick={() => insertToken(tok)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 100, background: 'var(--surface-muted)', color: 'var(--brand-600)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                <Icon name="plus" size={9} strokeWidth={3} />{`{{${tok}}}`}
              </button>
            ))}
          </div>

          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
            placeholder="Reminder: appointment at {{appointmentTime}}"
            style={{ width: '100%', padding: '10px 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: 1.6 }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active
            </label>
            <button onClick={save} disabled={saving}
              style={{ height: 36, padding: '0 20px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Live preview</div>
            <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Sample patient: {SAMPLE.patientName}</span>
          </div>
          <div style={{ background: 'var(--surface-muted)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--brand-100)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="cross" size={14} style={{ color: 'var(--brand-500)' }} strokeWidth={2.5} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>DigiRx</div>
                <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{channel} preview</div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{renderPreview(body) || <span style={{ color: 'var(--text-subtle)' }}>Type a body above to see the preview…</span>}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
