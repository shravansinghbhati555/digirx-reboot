import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Perm, usePerm } from '../../app/permissions';
import { Avatar, EmptyState, Spinner, StatusPill, formatINR, labelStyle, useToast } from '../shared/primitives';
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

type BillRow = Bill & { totalPaid: number; outstanding: number; patientName?: string };
type BillList = { branchId: string | null; count: number; rows: BillRow[] };

const PAYMENT_METHODS: { id: string; label: string; icon: IconName }[] = [
  { id: 'CASH',          label: 'Cash',          icon: 'banknote' },
  { id: 'UPI',           label: 'UPI',           icon: 'smartphone' },
  { id: 'CARD',          label: 'Card',          icon: 'creditCard' },
  { id: 'ONLINE',        label: 'Online',        icon: 'send' },
  { id: 'BANK_TRANSFER', label: 'Bank',          icon: 'arrowUp' },
];

export function BillingScreen() {
  const { ctx } = useApp();
  const { has } = usePerm();
  const canCreateBill = has(Perm.BillingWrite);
  const [bills, setBills] = useState<BillRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'draft' | 'issued' | 'paid' | 'void'>('all');
  const [selected, setSelected] = useState<Bill | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [lookupId, setLookupId] = useState('');

  async function loadBills() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (ctx.branchId) qs.set('branchId', ctx.branchId);
      if (filter !== 'all') qs.set('status', filter);
      const data = await apiGet<BillList>(ctx, `/bills?${qs.toString()}`);
      setBills(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadBills(); }, [ctx.clinicId, ctx.branchId, filter]);

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

  const filtered = useMemo(() => bills ?? [], [bills]);

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
          <button onClick={() => canCreateBill && setShowCreate(true)}
            disabled={!canCreateBill}
            title={canCreateBill ? undefined : 'You do not have permission to create bills'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: canCreateBill ? 'pointer' : 'not-allowed', opacity: canCreateBill ? 1 : 0.5 }}>
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
            <EmptyState illustration="receipt" title={filter === 'all' ? 'No bills yet' : `No ${filter} bills`}
              hint="Create a bill or change the status filter." />
          )}
          {!loading && filtered.length > 0 && (
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
                        <Avatar name={b.patientName ?? '?'} size={26} />
                        <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
                          {b.patientName ?? <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Unknown patient</span>}
                        </span>
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
        <BillDetail bill={selected} onClose={() => setSelected(null)} onChanged={(b) => { setSelected(b); void loadBills(); }} />
      )}

      {showCreate && (
        <CreateBillSheet
          onClose={() => setShowCreate(false)}
          onCreated={(b) => { setShowCreate(false); setSelected(b); void loadBills(); }}
        />
      )}
    </div>
  );
}

function BillDetail({ bill, onClose, onChanged }: { bill: Bill; onClose: () => void; onChanged: (b: Bill) => void }) {
  const { ctx } = useApp();
  const toast = useToast();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [patientName, setPatientName] = useState<string | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [billNoFreshKey, setBillNoFreshKey] = useState(0);
  const [latestPaymentId, setLatestPaymentId] = useState<string | null>(null);
  const prevBillNoRef = useRef<string | undefined>(bill.billNo);

  useEffect(() => {
    let cancelled = false;
    setPatientName(null);
    apiGet<{ fullName?: string }>(ctx, `/patients/${bill.patientId}`)
      .then((p) => { if (!cancelled) setPatientName(p.fullName ?? null); })
      .catch(() => { if (!cancelled) setPatientName(null); });
    return () => { cancelled = true; };
  }, [bill.patientId, ctx]);

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
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>{patientName ?? '—'} · {bill.currency}</div>
        </div>
        <StatusPill status={bill.status.toLowerCase()} />
        {isDraft && <button onClick={issue} disabled={busy} style={{ height: 36, padding: '0 16px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>Issue bill</button>}
        {isIssued && balance > 0 && <button onClick={() => setShowPay(true)} style={{ height: 36, padding: '0 16px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Record payment</button>}
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
        method, amount: Number(amount), providerRef: reference.trim() || undefined, idempotencyKey,
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
            style={{ width: '100%', height: 46, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.8 : 1 }}>
            {loading ? <Spinner /> : <><Icon name="check" size={16} strokeWidth={2.5} />Record {formatINR(Number(amount) || 0)}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

type PatientHit = { _id: string; fullName: string; phones?: string[]; gender?: string; dob?: string };

type DraftItem = { name: string; serviceId?: string; qty: number; price: number };

function CreateBillSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Bill) => void }) {
  const { ctx } = useApp();
  const toast = useToast();
  const [services, setServices] = useState<Service[]>([]);

  // Patient picker
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientHits, setPatientHits] = useState<PatientHit[]>([]);
  const [patientFocused, setPatientFocused] = useState(false);

  const [items, setItems] = useState<DraftItem[]>([{ name: 'Consultation', qty: 1, price: 800 }]);
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { shakeProps, shake } = useShake();

  const subtitle = [ctx.clinicName, formatHeaderDate(new Date())].filter(Boolean).join(' · ');

  useEffect(() => {
    apiGet<Service[]>(ctx, '/catalog/services').then(setServices).catch(() => setServices([]));
  }, [ctx]);

  // Patient search
  useEffect(() => {
    if (patient) { setPatientHits([]); return; }
    if (!patientQuery.trim()) { setPatientHits([]); return; }
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ query: patientQuery.trim(), limit: '10' });
      apiGet<PatientHit[]>(ctx, `/patients?${qs.toString()}`)
        .then(setPatientHits)
        .catch(() => setPatientHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [patientQuery, patient, ctx]);

  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const discountNum = Math.max(0, Number(discount || 0));
  const total = Math.max(0, subtotal - discountNum);

  function addItem() {
    setItems((rows) => [...rows, { name: '', qty: 1, price: 0 }]);
  }
  function updateItem(i: number, patch: Partial<DraftItem>) {
    setItems((rows) => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function removeItem(i: number) {
    setItems((rows) => rows.filter((_, idx) => idx !== i));
  }
  function pickService(i: number, serviceId: string) {
    const s = services.find((x) => x._id === serviceId);
    if (s) updateItem(i, { name: s.name, serviceId: s._id, price: s.defaultPrice });
  }

  function validate(): boolean {
    if (!ctx.branchId) { setError('Set a branch (sign in to a branch).'); shake(); return false; }
    if (!patient) { setError('Pick a patient.'); shake(); return false; }
    if (items.length === 0 || items.some((i) => !i.name.trim() || i.qty <= 0)) {
      setError('Each item needs a description and a quantity > 0.');
      shake();
      return false;
    }
    setError(null);
    return true;
  }

  async function postDraft(): Promise<Bill | null> {
    const body = {
      branchId: ctx.branchId,
      patientId: patient!._id,
      currency: 'INR',
      items: items.map((i) => ({
        serviceCatalogItemId: i.serviceId,
        customName: i.serviceId ? undefined : i.name,
        quantity: i.qty,
        unitPrice: i.price,
      })),
      discount: discountNum,
      tax: 0,
      notes: notes.trim() || undefined,
    };
    return await apiPost<Bill>(ctx, '/bills', body);
  }

  async function saveDraft() {
    if (!validate()) return;
    setSavingDraft(true);
    try {
      const created = await postDraft();
      toast('Draft bill saved', 'success');
      if (created) onCreated(created);
    } catch (e) {
      shake();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDraft(false);
    }
  }

  async function issueBill() {
    if (!validate()) return;
    setIssuing(true);
    try {
      const draft = await postDraft();
      if (!draft) throw new Error('Could not create draft');
      const issued = await apiPost<Bill>(ctx, `/bills/${draft._id}/issue`, {});
      toast(`Bill ${issued.billNo ?? ''} issued`, 'success');
      onCreated(issued);
    } catch (e) {
      shake();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', background: 'rgba(15,23,42,0.3)', backdropFilter: 'blur(2px)' }} onClick={onClose}>
      <div {...shakeProps}
        style={{
          width: 560, maxWidth: '100%', height: '100%', background: 'var(--surface)',
          borderLeft: '1px solid var(--border)', boxShadow: '-8px 0 32px rgba(15,23,42,0.12)',
          display: 'flex', flexDirection: 'column',
          animation: 'slideInRight 240ms ease-out',
          ...shakeProps.style,
        }}
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>New bill</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{subtitle || '—'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Patient */}
          <div>
            <label style={labelStyle}>Patient</label>
            {patient ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--brand-50)', border: '1.5px solid var(--brand-100)', borderRadius: 10 }}>
                <Avatar name={patient.fullName} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand-700)' }}>{patient.fullName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{patient.phones?.[0] ?? '—'}</div>
                </div>
                <button onClick={() => { setPatient(null); setPatientQuery(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--brand-600)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Change
                </button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <Icon name="search" size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                <input value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  onFocus={() => setPatientFocused(true)}
                  onBlur={() => setTimeout(() => setPatientFocused(false), 150)}
                  placeholder="Search patient by name or phone…"
                  style={{
                    width: '100%', height: 42, padding: '0 14px 0 40px',
                    background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
                    fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocusCapture={(e) => (e.currentTarget.style.borderColor = 'var(--brand-500)')}
                  onBlurCapture={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
                {patientFocused && patientQuery.trim() && patientHits.length > 0 && (
                  <div style={{ position: 'absolute', top: 46, left: 0, right: 0, zIndex: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, maxHeight: 240, overflowY: 'auto', boxShadow: '0 8px 24px rgba(15,23,42,0.08)' }}>
                    {patientHits.map((p) => (
                      <button key={p._id} onMouseDown={() => { setPatient(p); setPatientHits([]); setPatientQuery(''); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                        <Avatar name={p.fullName} size={30} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.fullName}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{p.phones?.[0] ?? '—'}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Items */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ ...labelStyle, marginBottom: 0 }}>Bill items</span>
              <button onClick={addItem}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'none', border: 'none', color: 'var(--brand-600)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                <Icon name="plus" size={13} strokeWidth={2.5} /> Add item
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 100px 30px', gap: 8, padding: '0 4px 6px', fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <span>Description</span>
              <span style={{ textAlign: 'center' }}>Qty</span>
              <span style={{ textAlign: 'right' }}>Rate (₹)</span>
              <span />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 100px 30px', gap: 8, alignItems: 'center' }}>
                  {services.length > 0 && !it.name && !it.serviceId ? (
                    <select value={it.serviceId ?? ''}
                      onChange={(e) => e.target.value ? pickService(i, e.target.value) : updateItem(i, { serviceId: undefined })}
                      style={inlineInputStyle}>
                      <option value="">— pick service or type —</option>
                      {services.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                    </select>
                  ) : (
                    <input value={it.name}
                      onChange={(e) => updateItem(i, { name: e.target.value, serviceId: undefined })}
                      placeholder="Description" style={inlineInputStyle} />
                  )}
                  <input type="number" min={1} value={it.qty}
                    onChange={(e) => updateItem(i, { qty: Number(e.target.value) || 1 })}
                    style={{ ...inlineInputStyle, textAlign: 'center' }} />
                  <input type="number" min={0} value={it.price}
                    onChange={(e) => updateItem(i, { price: Number(e.target.value) || 0 })}
                    style={{ ...inlineInputStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
                  <button onClick={() => removeItem(i)} disabled={items.length === 1}
                    style={{ width: 30, height: 38, background: 'none', border: 'none', cursor: items.length === 1 ? 'not-allowed' : 'pointer', color: 'var(--danger-500)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: items.length === 1 ? 0.3 : 1 }}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>

            <button onClick={addItem}
              style={{ marginTop: 8, width: '100%', padding: '8px 12px', border: '1.5px dashed var(--border)', borderRadius: 9, background: 'none', color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="plus" size={12} strokeWidth={2.5} /> Add another item
            </button>
          </div>

          {/* Totals card */}
          <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13, color: 'var(--text-muted)' }}>
              <span>Subtotal</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text)' }}>
                <Counter value={subtotal} duration={280} format={(n) => formatINR(n)} />
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13, color: 'var(--text-muted)' }}>
              <span>Discount <span style={{ color: 'var(--text-subtle)' }}>(₹)</span></span>
              <input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)}
                style={{ width: 96, height: 32, padding: '0 10px', background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text)', outline: 'none', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0 4px', borderTop: '1px solid var(--border)', marginTop: 4, fontSize: 14, fontWeight: 700 }}>
              <span style={{ color: 'var(--text)' }}>Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--brand-600)' }}>
                <Counter value={total} duration={280} format={(n) => formatINR(n)} />
              </span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>
              Notes <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Any billing notes or instructions…"
              style={{
                width: '100%', minHeight: 64, padding: '10px 12px',
                background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
                fontSize: 13, color: 'var(--text)', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                fontFamily: 'inherit',
              }} />
          </div>

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        {/* Footer — two equal-weight buttons */}
        <div style={{ padding: '16px 24px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
          <button onClick={saveDraft} disabled={savingDraft || issuing}
            style={{ flex: 1, height: 46, background: 'none', border: '1.5px solid var(--border)', borderRadius: 12, fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: (savingDraft || issuing) ? 'wait' : 'pointer' }}>
            {savingDraft ? 'Saving…' : 'Save draft'}
          </button>
          <button onClick={issueBill} disabled={savingDraft || issuing}
            style={{ flex: 1, height: 46, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: (savingDraft || issuing) ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {issuing ? <Spinner /> : <><Icon name="receipt" size={14} /> Issue bill</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatHeaderDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const inlineInputStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 10px',
  background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 9,
  fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
};
