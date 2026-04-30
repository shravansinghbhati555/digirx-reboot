import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Avatar, EmptyState, Field, Spinner, StatusPill, formatINR, labelStyle, useToast } from '../shared/primitives';
import { Icon, type IconName } from '../shared/Icon';
import { Skeleton } from '../shared/Skeleton';
import { useShake } from '../shared/useShake';
import { Counter } from '../shared/Counter';

type BillItem = {
  description?: string;
  customName?: string;
  serviceCatalogItemId?: string;
  quantity: number;
  unitPrice: number;
  amount?: number;
};

type Bill = {
  _id: string;
  billNo?: string;
  status: 'DRAFT' | 'ISSUED' | 'VOID' | 'PAID';
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  patientId: string;
  branchId: string;
  items: BillItem[];
  issuedAt?: string;
  createdAt?: string;
};

type Payment = {
  _id: string;
  method: string;
  amount: number;
  paidAt: string;
  reference?: string;
};

type Service = {
  _id: string;
  name: string;
  defaultPrice: number;
};

type PendingRow = Bill & { totalPaid: number; outstanding: number };
type PendingPayments = { branchId: string | null; count: number; rows: PendingRow[] };

const PAYMENT_METHODS: { id: string; label: string; icon: IconName }[] = [
  { id: 'CASH',          label: 'Cash',          icon: 'banknote' },
  { id: 'UPI',           label: 'UPI',           icon: 'smartphone' },
  { id: 'CARD',          label: 'Card',          icon: 'creditCard' },
  { id: 'ONLINE',        label: 'Online',        icon: 'send' },
  { id: 'BANK_TRANSFER', label: 'Bank',          icon: 'arrowUp' },
];

export function BillingScreen() {
  const { ctx } = useApp();
  const [pending, setPending] = useState<PendingRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'draft' | 'issued' | 'paid' | 'void'>('all');
  const [selected, setSelected] = useState<Bill | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [lookupId, setLookupId] = useState('');

  async function loadPending() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (ctx.branchId) qs.set('branchId', ctx.branchId);
      const data = await apiGet<PendingPayments>(ctx, `/reports/pending-payments?${qs.toString()}`);
      setPending(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadPending(); }, [ctx.clinicId, ctx.branchId]);

  async function loadBill(id: string) {
    if (!id.trim()) return;
    setError(null);
    try {
      const bill = await apiGet<Bill>(ctx, `/bills/${id.trim()}`);
      setSelected(bill);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const filtered = useMemo(() => {
    if (!pending) return [];
    if (filter === 'all' || filter === 'issued') return pending;
    return pending.filter((b) => b.status.toLowerCase() === filter);
  }, [pending, filter]);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ width: selected ? 520 : '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: selected ? '1px solid var(--border)' : 'none', transition: 'width 240ms ease-out' }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-muted)', borderRadius: 10, padding: 3, border: '1px solid var(--border)' }}>
            {(['all', 'draft', 'issued', 'paid', 'void'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: filter === f ? 'var(--surface)' : 'transparent', color: filter === f ? 'var(--text)' : 'var(--text-muted)', fontSize: 12, fontWeight: filter === f ? 600 : 400, cursor: 'pointer', textTransform: 'capitalize' }}>
                {f}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Bill ID lookup…"
            onKeyDown={(e) => e.key === 'Enter' && loadBill(lookupId)}
            style={{ height: 34, padding: '0 12px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, color: 'var(--text)', outline: 'none', minWidth: 200, fontFamily: 'monospace' }} />
          <button onClick={() => loadBill(lookupId)}
            style={{ height: 34, padding: '0 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
            Load
          </button>
          <button onClick={() => setShowCreate(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            <Icon name="plus" size={13} strokeWidth={2.5} /> New bill
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
          {loading && (
            <div style={{ padding: 12 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px', borderBottom: '1px solid var(--border)' }}>
                  <Skeleton width={80} height={11} />
                  <Skeleton width={26} height={26} radius={13} />
                  <Skeleton width="30%" height={12} />
                  <Skeleton width={70} height={11} style={{ marginLeft: 'auto' }} />
                  <Skeleton width={70} height={11} />
                  <Skeleton width={64} height={18} radius={9} />
                </div>
              ))}
            </div>
          )}
          {error && <div style={{ padding: 16, fontSize: 13, color: 'var(--danger-500)' }}>{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <EmptyState illustration="receipt" title="No issued bills with outstanding balance"
              hint="Create a bill or look one up by ID. Drafts don't appear here yet." />
          )}
          {filtered.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Bill no', 'Patient', 'Total', 'Outstanding', 'Status'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: i >= 2 && i <= 3 ? 'right' : 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b._id} onClick={() => loadBill(b._id)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected?._id === b._id ? 'var(--brand-50)' : 'transparent' }}>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-subtle)', fontFamily: 'monospace', fontWeight: 500 }}>{b.billNo ?? b._id.slice(-6)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={b.patientId.slice(-4)} size={26} />
                        <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, fontFamily: 'monospace' }}>{b.patientId.slice(-12)}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatINR(b.total)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: b.outstanding > 0 ? 'var(--danger-500)' : 'var(--success-500)' }}>
                      {b.outstanding > 0 ? formatINR(b.outstanding) : '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}><StatusPill status={b.status.toLowerCase()} small /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && (
        <BillDetail bill={selected} onClose={() => setSelected(null)} onChanged={(b) => { setSelected(b); void loadPending(); }} />
      )}

      {showCreate && (
        <CreateBillSheet
          onClose={() => setShowCreate(false)}
          onCreated={(b) => { setShowCreate(false); setSelected(b); void loadPending(); }}
        />
      )}
    </div>
  );
}

function BillDetail({ bill, onClose, onChanged }: { bill: Bill; onClose: () => void; onChanged: (b: Bill) => void }) {
  const { ctx } = useApp();
  const toast = useToast();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [billNoFreshKey, setBillNoFreshKey] = useState(0);
  const [latestPaymentId, setLatestPaymentId] = useState<string | null>(null);
  const prevBillNoRef = useRef<string | undefined>(bill.billNo);

  useEffect(() => {
    if (!prevBillNoRef.current && bill.billNo) {
      setBillNoFreshKey((k) => k + 1);
    }
    prevBillNoRef.current = bill.billNo;
  }, [bill.billNo]);

  async function loadPayments(highlightLatest = false) {
    try {
      const data = await apiGet<Payment[]>(ctx, `/bills/${bill._id}/payments`);
      setPayments(data);
      if (highlightLatest && data.length > 0) {
        const sorted = [...data].sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
        setLatestPaymentId(sorted[0]._id);
        setTimeout(() => setLatestPaymentId(null), 1200);
      }
    } catch {
      setPayments([]);
    }
  }

  useEffect(() => { void loadPayments(); }, [bill._id]);

  const paid = (payments ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
  const balance = Math.max(0, bill.total - paid);
  const isDraft = bill.status === 'DRAFT';
  const isIssued = bill.status === 'ISSUED';

  async function issue() {
    setBusy(true);
    try {
      const updated = await apiPost<Bill>(ctx, `/bills/${bill._id}/issue`, {});
      onChanged(updated);
      toast(`Issued ${updated.billNo ?? ''}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Issue failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    try {
      const res = await apiGet<{ url: string }>(ctx, `/bills/${bill._id}/pdf`);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'PDF unavailable', 'error');
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflowY: 'auto', animation: 'slideInRight 240ms ease-out' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 4 }}><Icon name="chevronLeft" size={18} /></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            <span key={billNoFreshKey} style={{ display: 'inline-block', animation: billNoFreshKey > 0 ? 'slideInRight 240ms var(--ease-out)' : undefined }}>
              {bill.billNo ?? bill._id}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>{bill.patientId.slice(-12)} · {bill.currency}</div>
        </div>
        <StatusPill status={bill.status.toLowerCase()} />
        {isDraft && <button onClick={issue} disabled={busy} style={{ height: 36, padding: '0 16px', background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>Issue bill</button>}
        {isIssued && balance > 0 && <button onClick={() => setShowPay(true)} style={{ height: 36, padding: '0 16px', background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Record payment</button>}
        <button onClick={downloadPdf} title="PDF" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 9, cursor: 'pointer', color: 'var(--text-muted)' }}>
          <Icon name="download" size={14} />
        </button>
      </div>

      <div style={{ padding: '20px 24px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-muted)' }}>
                  {['Description', 'Qty', 'Rate', 'Amount'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: i >= 1 ? 'right' : 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bill.items.map((item, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text)' }}>{item.description ?? item.customName ?? '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'right' }}>{item.quantity}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatINR(item.unitPrice)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatINR(item.amount ?? item.quantity * item.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Summary</div>
            {([
              ['Subtotal', formatINR(bill.subtotal)],
              ['Discount', formatINR(bill.discount)],
              ['Tax', formatINR(bill.tax)],
              ['Total', formatINR(bill.total)],
              ['Paid', formatINR(paid)],
            ] as [string, string][]).map(([l, v], i) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: i === 3 ? '10px 0 8px' : '4px 0', borderTop: i === 3 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 12, color: i === 3 ? 'var(--text)' : 'var(--text-muted)', fontWeight: i === 3 ? 700 : 400 }}>{l}</span>
                <span style={{ fontSize: 12, color: i === 3 ? 'var(--text)' : 'var(--text-muted)', fontWeight: i === 3 ? 700 : 500, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            ))}
            {balance > 0 ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--danger-500)', fontWeight: 700 }}>Balance due</span>
                <span style={{ fontSize: 13, color: 'var(--danger-500)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatINR(balance)}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '8px', background: 'rgba(16,185,129,0.08)', borderRadius: 8 }}>
                <Icon name="checkCircle" size={14} style={{ color: 'var(--success-500)' }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success-500)' }}>Fully paid</span>
              </div>
            )}
          </div>

          {payments && payments.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Payments</div>
              {payments.map((p) => {
                const isFresh = latestPaymentId === p._id;
                return (
                  <div key={p._id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
                      borderBottom: '1px solid var(--border)',
                      animation: isFresh ? 'slideUp 320ms var(--ease-out), successHalo 1000ms var(--ease-out)' : undefined,
                      borderRadius: isFresh ? 10 : 0,
                    }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="check" size={13} style={{ color: 'var(--success-500)' }} strokeWidth={2.5} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{formatINR(p.amount)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{p.method} · {new Date(p.paidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showPay && (
        <PaymentSheet bill={bill} balance={balance}
          onClose={() => setShowPay(false)}
          onSuccess={async () => { setShowPay(false); await loadPayments(true); try { const fresh = await apiGet<Bill>(ctx, `/bills/${bill._id}`); onChanged(fresh); } catch {} }}
        />
      )}
    </div>
  );
}

function PaymentSheet({ bill, balance, onClose, onSuccess }: { bill: Bill; balance: number; onClose: () => void; onSuccess: () => void }) {
  const { ctx } = useApp();
  const toast = useToast();
  const [method, setMethod] = useState('UPI');
  const [amount, setAmount] = useState(String(balance));
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const { shakeProps, shake } = useShake();

  async function submit() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setError('Enter a valid amount'); shake(); return;
    }
    setLoading(true); setError(null);
    try {
      await apiPost(ctx, `/bills/${bill._id}/payments`, {
        method, amount: Number(amount), reference: reference.trim() || undefined, idempotencyKey,
      });
      toast(`Payment of ${formatINR(Number(amount))} recorded`, 'success');
      onSuccess();
    } catch (e) {
      shake();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', background: 'rgba(15,23,42,0.3)', backdropFilter: 'blur(2px)' }} onClick={onClose}>
      <div {...shakeProps}
        style={{ width: 420, height: '100%', background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: '-8px 0 32px rgba(15,23,42,0.12)', display: 'flex', flexDirection: 'column', animation: 'slideInRight 240ms ease-out', ...shakeProps.style }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Record payment</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>{bill.billNo ?? bill._id.slice(-6)} · Balance {formatINR(balance)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}><Icon name="x" size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={labelStyle}>Method</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PAYMENT_METHODS.map((m) => (
                <button key={m.id} onClick={() => setMethod(m.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: `1.5px solid ${method === m.id ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 10, background: method === m.id ? 'var(--brand-50)' : 'var(--surface-muted)', color: method === m.id ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  <Icon name={m.icon} size={13} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Amount <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>(₹)</span></label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: 'var(--text-muted)', fontFamily: "'Manrope',sans-serif", fontWeight: 700 }}>₹</span>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                style={{ width: '100%', height: 52, padding: '0 14px 0 34px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 12, fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: "'Manrope',sans-serif", outline: 'none', boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums' }} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[balance, Math.round(balance / 2), 500, 1000].filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 4).map((v) => (
                <button key={v} onClick={() => setAmount(String(v))}
                  style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-muted)', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(v)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Reference / transaction ID <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>(optional)</span></label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI ref, cheque no."
              style={{ width: '100%', height: 40, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }} />
          </div>

          <div style={{ background: 'var(--surface-muted)', borderRadius: 12, padding: '12px 14px', border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-subtle)' }}>
            Idempotency key: <code style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{idempotencyKey.slice(0, 8)}…</code>
          </div>

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
          <button onClick={submit} disabled={loading || !amount || Number(amount) <= 0}
            style={{ width: '100%', height: 46, background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.8 : 1 }}>
            {loading ? <Spinner /> : <><Icon name="check" size={16} strokeWidth={2.5} />Record {formatINR(Number(amount) || 0)}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateBillSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Bill) => void }) {
  const { ctx } = useApp();
  const toast = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [patientId, setPatientId] = useState('');
  const [items, setItems] = useState<{ name: string; serviceId?: string; qty: number; price: number }[]>([
    { name: 'Consultation', qty: 1, price: 500 },
  ]);
  const [discount, setDiscount] = useState('0');
  const [tax, setTax] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { shakeProps, shake } = useShake();

  useEffect(() => {
    apiGet<Service[]>(ctx, '/catalog/services').then(setServices).catch(() => setServices([]));
  }, [ctx]);

  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const total = Math.max(0, subtotal - Number(discount || 0) + Number(tax || 0));

  function addItem() {
    setItems((rows) => [...rows, { name: '', qty: 1, price: 0 }]);
  }
  function updateItem(i: number, patch: Partial<typeof items[number]>) {
    setItems((rows) => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function removeItem(i: number) {
    setItems((rows) => rows.filter((_, idx) => idx !== i));
  }
  function pickService(i: number, serviceId: string) {
    const s = services.find((x) => x._id === serviceId);
    if (s) updateItem(i, { name: s.name, serviceId: s._id, price: s.defaultPrice });
  }

  async function submit() {
    if (!ctx.branchId) { setError('Set a branch ID (sign in to a branch).'); shake(); return; }
    if (!patientId.trim()) { setError('Patient ID is required.'); shake(); return; }
    if (items.length === 0 || items.some((i) => !i.name.trim() || i.qty <= 0)) {
      setError('All items need a name and a quantity > 0.');
      shake();
      return;
    }
    setSaving(true); setError(null);
    try {
      const body = {
        branchId: ctx.branchId,
        patientId: patientId.trim(),
        currency: 'INR',
        items: items.map((i) => ({
          serviceCatalogItemId: i.serviceId,
          customName: i.serviceId ? undefined : i.name,
          quantity: i.qty,
          unitPrice: i.price,
        })),
        discount: Number(discount || 0),
        tax: Number(tax || 0),
      };
      const created = await apiPost<Bill>(ctx, '/bills', body);
      toast('Draft bill created', 'success');
      onCreated(created);
    } catch (e) {
      shake();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div {...shakeProps}
        style={{ background: 'var(--surface)', borderRadius: 18, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 640, maxHeight: '92vh', display: 'flex', flexDirection: 'column', ...shakeProps.style }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>New bill</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}><Icon name="x" size={18} /></button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <Field label="Patient ID" value={patientId} onChange={setPatientId} placeholder="ObjectId" />

          <div>
            <label style={labelStyle}>Items</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((it, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {services.length > 0 ? (
                    <select value={it.serviceId ?? ''} onChange={(e) => e.target.value ? pickService(i, e.target.value) : updateItem(i, { serviceId: undefined })}
                      style={{ flex: 2, height: 36, padding: '0 10px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 9, fontSize: 12, color: 'var(--text)', outline: 'none', cursor: 'pointer' }}>
                      <option value="">— Custom —</option>
                      {services.map((s) => <option key={s._id} value={s._id}>{s.name} (₹{s.defaultPrice})</option>)}
                    </select>
                  ) : null}
                  <input value={it.name} onChange={(e) => updateItem(i, { name: e.target.value, serviceId: undefined })} placeholder="Description"
                    style={{ flex: 3, height: 36, padding: '0 10px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 9, fontSize: 12, color: 'var(--text)', outline: 'none' }} />
                  <input type="number" value={it.qty} onChange={(e) => updateItem(i, { qty: Number(e.target.value) || 1 })} placeholder="Qty"
                    style={{ width: 60, height: 36, padding: '0 10px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 9, fontSize: 12, color: 'var(--text)', outline: 'none', textAlign: 'right' }} />
                  <input type="number" value={it.price} onChange={(e) => updateItem(i, { price: Number(e.target.value) || 0 })} placeholder="Price"
                    style={{ width: 90, height: 36, padding: '0 10px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 9, fontSize: 12, color: 'var(--text)', outline: 'none', textAlign: 'right' }} />
                  <button onClick={() => removeItem(i)} disabled={items.length === 1}
                    style={{ width: 36, height: 36, background: 'none', border: '1px solid var(--border)', borderRadius: 9, cursor: items.length === 1 ? 'not-allowed' : 'pointer', color: 'var(--danger-500)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: items.length === 1 ? 0.4 : 1 }}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={addItem}
              style={{ marginTop: 8, padding: '6px 12px', border: '1.5px dashed var(--border)', borderRadius: 9, background: 'none', color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="plus" size={12} strokeWidth={2.5} /> Add item
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}><Field label="Discount" value={discount} onChange={setDiscount} /></div>
            <div style={{ flex: 1 }}><Field label="Tax" value={tax} onChange={setTax} /></div>
          </div>

          <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>Subtotal</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}><Counter value={subtotal} duration={280} format={(n) => formatINR(n)} /></span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginTop: 6, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <span>Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}><Counter value={total} duration={280} format={(n) => formatINR(n)} /></span>
            </div>
          </div>

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={saving}
            style={{ flex: 2, height: 42, background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Saving…' : 'Create draft bill'}
          </button>
        </div>
      </div>
    </div>
  );
}
