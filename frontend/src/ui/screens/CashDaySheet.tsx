import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPostQueued } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Perm, usePerm } from '../../app/permissions';
import { isOnline, subscribeConnectivity } from '../../offline/connectivity';
import { localDate, queuedCashFor, type QueuedCash } from '../../offline/cash';
import { listPending } from '../../offline/queue';
import { Field, PrimaryButton, Spinner, formatDateTime, formatMoney, labelStyle, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';

type CashDayRecord = {
  _id: string;
  date: string;
  branchId: string;
  status: 'SUBMITTED' | 'APPROVED';
  countedCash: number;
  expectedAtCount: number;
  countNote?: string;
  countedAt: string;
  expectedAtApproval?: number;
  approvalNote?: string;
  approvedAt?: string;
};

type Summary = {
  date: string;
  expectedCash: number;
  cashIn: number;
  cashRefunded: number;
  paymentCount: number;
  record: CashDayRecord | null;
};

type PendingDay = CashDayRecord & { expectedCash: number };

const paise = (n: number) => Math.round(n * 100);

/**
 * Day-end cash — ticket C6.
 *
 * One shared drawer per branch, no opening float. Whoever ran the desk counts
 * the drawer here — online or not — against what this device expects: the
 * server's figure from its last sync plus cash recorded here that has not
 * synced yet. The Super Admin or Manager then approves each day against the
 * server's figure once every device has synced.
 */
export function CashDaySheet({ onClose }: { onClose: () => void }) {
  const { ctx } = useApp();
  const { has } = usePerm();
  const toast = useToast();
  const tz = ctx.clinicTimezone ?? ctx.timezone;
  const currency = ctx.currency ?? 'INR';
  const money = (n: number) => formatMoney(n, currency);

  const [online, setOnline] = useState(() => isOnline());
  useEffect(() => subscribeConnectivity(setOnline), []);

  const [date, setDate] = useState(() => localDate(Date.now(), tz));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [serverMissing, setServerMissing] = useState(false);
  const [queued, setQueued] = useState<QueuedCash>({ amount: 0, count: 0 });
  const [countQueued, setCountQueued] = useState(false);
  const [loading, setLoading] = useState(true);

  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await apiGet<Summary>(ctx, `/cash-days?date=${date}`));
      setServerMissing(false);
    } catch {
      // Offline with nothing cached for this day: the device can still count
      // what it recorded itself.
      setSummary(null);
      setServerMissing(true);
    }
    try {
      setQueued(await queuedCashFor(ctx.clinicId, date, tz));
      const pending = await listPending(ctx.clinicId);
      setCountQueued(
        pending.some((e) => e.path === '/cash-days' && (e.body as { date?: string })?.date === date),
      );
    } catch {
      setQueued({ amount: 0, count: 0 });
    }
    setLoading(false);
  }, [ctx, date, tz]);

  useEffect(() => {
    void load();
  }, [load, online]);

  const serverExpected = summary?.expectedCash ?? 0;
  const expected = (paise(serverExpected) + paise(queued.amount)) / 100;
  const countedNum = counted.trim() === '' ? null : Number(counted);
  const validCount = countedNum != null && Number.isFinite(countedNum) && countedNum >= 0;
  const diff = validCount ? (paise(countedNum) - paise(expected)) / 100 : 0;
  const mismatch = validCount && diff !== 0;
  const record = summary?.record ?? null;
  const approved = record?.status === 'APPROVED';

  async function submit() {
    if (!validCount) {
      setError('Enter the cash counted in the drawer');
      return;
    }
    if (mismatch && !note.trim()) {
      setError('The count does not match — add a note explaining the difference');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { queued: wasQueued } = await apiPostQueued(
        ctx,
        '/cash-days',
        {
          date,
          countedCash: countedNum,
          expectedCash: expected,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        { label: `Cash count — ${date}` },
      );
      toast(
        wasQueued ? 'Count saved on this device. It will sync when you reconnect.' : 'Cash count submitted for approval',
        'success',
      );
      setCounted('');
      setNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'flex-end', background: 'rgba(15,23,42,0.3)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, maxWidth: '100%', height: '100%', background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: '-8px 0 32px rgba(15,23,42,0.12)', display: 'flex', flexDirection: 'column', animation: 'slideInRight 240ms ease-out' }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Day-end cash</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{ctx.branchName ?? 'This branch'} · shared drawer</div>
          </div>
          <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ maxWidth: 220 }}>
            <Field label="Day" type="date" value={date} onChange={(v) => v && setDate(v)} />
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <Spinner size={20} />
            </div>
          ) : (
            <>
              {/* Expected */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Expected in the drawer</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{money(expected)}</div>
                <Row label={serverMissing ? 'Synced (not available offline)' : online ? 'Synced cash, less cash refunds' : 'Synced, as of this device’s last sync'} value={serverMissing ? '—' : money(serverExpected)} />
                {queued.count > 0 && (
                  <Row label={`On this device, not yet synced (${queued.count})`} value={money(queued.amount)} />
                )}
                {!online && (
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
                    Cash taken on other devices during the outage shows up once they sync. Your
                    manager approves the day against the full figure.
                  </div>
                )}
              </div>

              {/* Existing record */}
              {record && (
                <div style={{ borderRadius: 12, padding: 14, background: approved ? 'var(--success-bg)' : 'var(--info-bg)', color: approved ? 'var(--success-text)' : 'var(--info-text)', fontSize: 13, lineHeight: 1.5 }}>
                  <strong>{approved ? 'Approved' : 'Counted — awaiting approval'}</strong>
                  <div>
                    Counted {money(record.countedCash)} on {formatDateTime(record.countedAt)}
                    {record.countNote ? ` · “${record.countNote}”` : ''}
                  </div>
                  {approved && record.approvedAt && (
                    <div>
                      Signed off {formatDateTime(record.approvedAt)} against {money(record.expectedAtApproval ?? 0)}
                      {record.approvalNote ? ` · “${record.approvalNote}”` : ''}
                    </div>
                  )}
                </div>
              )}
              {countQueued && (
                <div style={{ borderRadius: 12, padding: 14, background: 'var(--warning-bg)', color: 'var(--warning-text)', fontSize: 13 }}>
                  A count for this day is saved on this device and will sync when you reconnect.
                </div>
              )}

              {/* Count */}
              {!approved && has(Perm.BillingWrite) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Field label={`Cash counted (${currency})`} value={counted} onChange={(v) => setCounted(v.replace(/[^\d.]/g, ''))} placeholder="0" />
                  {validCount && (
                    <div style={{ fontSize: 13, fontWeight: 600, color: mismatch ? 'var(--danger-text)' : 'var(--success-text)' }}>
                      {mismatch
                        ? `${diff > 0 ? 'Over' : 'Short'} by ${money(Math.abs(diff))}`
                        : 'Matches expected cash'}
                    </div>
                  )}
                  {mismatch && (
                    <div>
                      <label style={labelStyle}>Why is there a difference? (required)</label>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={500}
                        rows={3}
                        style={{ width: '100%', padding: 10, background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
                      />
                    </div>
                  )}
                  {error && <div style={{ fontSize: 12, color: 'var(--danger-text)', background: 'var(--danger-bg)', borderRadius: 8, padding: '8px 10px' }}>{error}</div>}
                  <PrimaryButton onClick={() => void submit()} disabled={saving || !validCount}>
                    {saving ? <Spinner size={14} /> : record ? 'Submit recount' : 'Submit count'}
                  </PrimaryButton>
                </div>
              )}
            </>
          )}

          {has(Perm.CashApprove) && <ApprovalList online={online} money={money} onApproved={load} />}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

/** Super Admin / Manager: counted days awaiting sign-off. Online only. */
function ApprovalList({
  online,
  money,
  onApproved,
}: {
  online: boolean;
  money: (n: number) => string;
  onApproved: () => void;
}) {
  const { ctx } = useApp();
  const toast = useToast();
  const [days, setDays] = useState<PendingDay[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!online) return;
    try {
      setDays(await apiGet<PendingDay[]>(ctx, '/cash-days/pending'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load counts');
    }
  }, [ctx, online]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(day: PendingDay) {
    setBusy(day._id);
    setError(null);
    try {
      const note = notes[day._id]?.trim();
      await apiPost(ctx, `/cash-days/${day._id}/approve`, note ? { note } : {});
      toast(`Approved ${day.date}`, 'success');
      await load();
      onApproved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Awaiting your approval</div>
      {!online && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Approving needs a connection — every device’s cash has to have synced first.</div>}
      {online && !days && !error && <Spinner size={16} />}
      {error && <div style={{ fontSize: 12, color: 'var(--danger-text)' }}>{error}</div>}
      {days && days.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Nothing waiting.</div>}
      {days?.map((d) => {
        const diff = (paise(d.countedCash) - paise(d.expectedCash)) / 100;
        const otherBranch = ctx.branchId && d.branchId !== ctx.branchId;
        return (
          <div key={d._id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              <span>{d.date}{otherBranch ? ' · other branch' : ''}</span>
              <span style={{ color: diff === 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>
                {diff === 0 ? 'Matches' : `${diff > 0 ? 'Over' : 'Short'} ${money(Math.abs(diff))}`}
              </span>
            </div>
            <Row label="Counted" value={money(d.countedCash)} />
            <Row label="Expected (all devices synced)" value={money(d.expectedCash)} />
            {d.countNote && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Counter’s note: “{d.countNote}”</div>}
            {diff !== 0 && (
              <input
                value={notes[d._id] ?? ''}
                onChange={(e) => setNotes((n) => ({ ...n, [d._id]: e.target.value }))}
                placeholder="Reason for accepting the difference (required)"
                maxLength={500}
                style={{ height: 34, padding: '0 10px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)' }}
              />
            )}
            <PrimaryButton
              onClick={() => void approve(d)}
              disabled={!online || busy === d._id || (diff !== 0 && !notes[d._id]?.trim())}
            >
              {busy === d._id ? <Spinner size={14} /> : 'Approve'}
            </PrimaryButton>
          </div>
        );
      })}
    </div>
  );
}
