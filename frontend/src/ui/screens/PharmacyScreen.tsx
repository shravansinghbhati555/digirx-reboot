import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Perm, usePerm } from '../../app/permissions';
import { EmptyState, Spinner, useToast, formatMoney, getCurrencySymbol, getCurrencyConversionData } from '../shared/primitives';
import { Icon } from '../shared/Icon';

// ---- Types ---------------------------------------------------------------

type BillStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID';
type BillKind = 'SERVICE' | 'MEDICINE';
type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

type BillItem = {
  inventoryItemId?: string;
  customName?: string;
  quantity: number;
  unitPrice: number;
  amount?: number;
};

type Bill = {
  _id: string;
  billNo?: string;
  status: BillStatus;
  kind: BillKind;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  patientId: string;
  branchId: string;
  encounterId?: string;
  items: BillItem[];
  // Timestamps used by the recent-sales history rendering. The BE
  // already returns these from /bills aggregation; widening the local
  // type so we can read them safely.
  createdAt?: string;
  issuedAt?: string;
  paidAt?: string;
  inventoryDispensedAt?: string;
};

type AvailabilityRow = {
  _id: string;
  name: string;
  unit: string;
  onHand: number;
  status: StockStatus;
};

type Patient = {
  _id: string;
  fullName: string;
  phones?: string[];
  mrn?: string;
  // dob + gender are surfaced on the printed receipt's demographics
  // strip. The /patients/:id endpoint already returns them, so widening
  // the local type is enough — no backend changes needed.
  dob?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | string;
};

type RecentPrescription = {
  _id: string;
  patientId?: string | { fullName?: string };
  patientName?: string;
  itemCount?: number;
  createdAt?: string;
};

type RecentSale = Bill & {
  totalPaid?: number;
  outstanding?: number;
  patientName?: string;
};

const PAYMENT_METHODS: { id: string; label: string }[] = [
  { id: 'CASH', label: 'Cash' },
  { id: 'UPI', label: 'UPI' },
  { id: 'CARD', label: 'Card' },
  { id: 'ONLINE', label: 'Online' },
  { id: 'BANK_TRANSFER', label: 'Bank' },
];

// ---- Top-level screen ----------------------------------------------------

export function PharmacyScreen() {
  const { ctx } = useApp();
  const { has } = usePerm();
  const canRead = has(Perm.BillingRead);
  const canWrite = has(Perm.BillingWrite);
  const toast = useToast();

  const [pasteId, setPasteId] = useState('');
  const [recent, setRecent] = useState<RecentPrescription[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  // Recent paid medicine sales — surfaced in the empty state so a
  // pharmacist can reopen any past receipt without leaving the tab.
  // Different from the bill-list view in /billing — this one is curated
  // (status=PAID, kind=MEDICINE, last 20) for quick reprints.
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [recentSalesLoading, setRecentSalesLoading] = useState(false);

  const [bill, setBill] = useState<Bill | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [items, setItems] = useState<BillItem[]>([]);
  const [discount, setDiscount] = useState<string>('0');
  const [stockByItemId, setStockByItemId] = useState<Map<string, AvailabilityRow>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recent prescriptions are a "convenience picker" — best-effort. If the
  // BE doesn't expose /prescriptions yet we just silently fall back to the
  // paste-an-ID input below.
  useEffect(() => {
    if (!canRead) return;
    setRecentLoading(true);
    apiGet<RecentPrescription[] | { rows: RecentPrescription[] }>(ctx, '/prescriptions?limit=10')
      .then((res) => setRecent(Array.isArray(res) ? res : (res as any)?.rows ?? []))
      .catch(() => setRecent([]))
      .finally(() => setRecentLoading(false));
  }, [ctx.clinicId, ctx.accessToken, canRead]);

  // Recent paid medicine sales for the active branch. Refetched whenever
  // we land back in the empty state (bill set to null) so a sale that
  // just completed appears at the top without a manual refresh.
  function reloadRecentSales() {
    if (!canRead) return;
    setRecentSalesLoading(true);
    const qs = new URLSearchParams({
      kind: 'MEDICINE',
      status: 'PAID',
      limit: '20',
    });
    if (ctx.branchId) qs.set('branchId', ctx.branchId);
    apiGet<RecentSale[] | { rows: RecentSale[] }>(ctx, `/bills?${qs.toString()}`)
      .then((res) => setRecentSales(Array.isArray(res) ? res : (res as any)?.rows ?? []))
      .catch(() => setRecentSales([]))
      .finally(() => setRecentSalesLoading(false));
  }
  useEffect(() => {
    // Only fetch when we're on the empty state. While a bill is loaded
    // the user is in the cart/done flow, no need to re-pull history.
    if (!bill) reloadRecentSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.clinicId, ctx.accessToken, ctx.branchId, canRead, bill]);

  // Pull live stock for the bill's branch any time we load a bill — chips
  // should reflect inventory NOW, not whatever was on hand when the
  // prescription was written.
  useEffect(() => {
    if (!bill?.branchId) {
      setStockByItemId(new Map());
      return;
    }
    const qs = new URLSearchParams({ branchId: bill.branchId, limit: '200' });
    apiGet<AvailabilityRow[]>(ctx, `/inventory/availability?${qs.toString()}`)
      .then((rows) => {
        const map = new Map<string, AvailabilityRow>();
        for (const r of Array.isArray(rows) ? rows : []) map.set(r._id, r);
        setStockByItemId(map);
      })
      .catch(() => setStockByItemId(new Map()));
  }, [bill?.branchId, ctx]);

  /**
   * Reopen a past medicine bill directly by its _id, skipping the
   * prescription-drafter path. Used when a pharmacist clicks a row in
   * the "Recent sales" history. Refuses non-MEDICINE bills so a stray
   * service-bill _id can't accidentally land in the pharmacy view.
   */
  async function loadByBillId(billId: string) {
    setBusy(true);
    setError(null);
    try {
      const loaded = await apiGet<Bill>(ctx, `/bills/${billId}`);
      if (loaded.kind !== 'MEDICINE') {
        setError('That bill is not a pharmacy sale.');
        return;
      }
      setBill(loaded);
      setItems(loaded.items ?? []);
      setDiscount(String(loaded.discount ?? 0));
      apiGet<Patient>(ctx, `/patients/${loaded.patientId}`)
        .then(setPatient)
        .catch(() => setPatient(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadFromPrescription(input: string) {
    let prescriptionId = input.trim();
    if (!prescriptionId) {
      setError('Enter a prescription ID.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      // If the user entered a short code (like #7F6136 or 7F6136), try to resolve it.
      if (prescriptionId.startsWith('#')) prescriptionId = prescriptionId.slice(1);
      
      // If it looks like a hex tail (6-8 chars), search for the full ID.
      if (prescriptionId.length >= 6 && prescriptionId.length <= 10 && /^[0-9A-Fa-f]+$/.test(prescriptionId)) {
        // First check local recent list for a quick hit.
        const local = recent.find((r: RecentPrescription) => r._id.toUpperCase().endsWith(prescriptionId.toUpperCase()));
        if (local) {
          prescriptionId = local._id;
        } else {
          // Otherwise hit the search endpoint.
          const hits = await apiGet<RecentPrescription[] | { rows: RecentPrescription[] }>(ctx, `/prescriptions?query=${prescriptionId}&limit=5`);
          const rows = Array.isArray(hits) ? hits : (hits as { rows: RecentPrescription[] }).rows || [];
          const match = rows.find((r: RecentPrescription) => r._id.toUpperCase().endsWith(prescriptionId.toUpperCase()));
          if (match) prescriptionId = match._id;
        }
      }

      const drafted = await apiPost<Bill>(ctx, `/bills/from-prescription/${prescriptionId}`, {});
      setBill(drafted);
      setItems(drafted.items ?? []);
      setDiscount(String(drafted.discount ?? 0));
      apiGet<Patient>(ctx, `/patients/${drafted.patientId}`)
        .then(setPatient)
        .catch(() => setPatient(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setBill(null);
    setPatient(null);
    setItems([]);
    setDiscount('0');
    setError(null);
    setPasteId('');
  }

  if (!canRead) {
    return (
      <div style={{ padding: 32 }}>
        <EmptyState icon="lock" title="Pharmacy access required"
          hint="You need billing:read to use the pharmacy counter. Ask an admin to grant the role." />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Pharmacy</h1>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
          {!bill && 'Load a prescription to start a sale.'}
          {bill && bill.status === 'DRAFT' && 'Editing draft — adjust quantities and prices.'}
          {bill && bill.status === 'ISSUED' && 'Bill issued — collect payment to dispense stock.'}
          {bill && bill.status === 'PAID' && 'Sale complete — print the receipt or start another.'}
          {bill && bill.status === 'VOID' && 'This bill was voided.'}
        </div>
        {bill && (
          <button onClick={reset}
            style={{ marginLeft: 'auto', height: 32, padding: '0 12px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer' }}>
            New transaction
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 24px', background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid var(--border)', color: 'var(--danger-500)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', background: 'var(--bg)' }}>
        {!bill ? (
          <EmptyEntry
            pasteId={pasteId}
            setPasteId={setPasteId}
            onLoad={loadFromPrescription}
            onLoadBill={loadByBillId}
            busy={busy}
            recent={recent}
            recentLoading={recentLoading}
            recentSales={recentSales}
            recentSalesLoading={recentSalesLoading}
            currency={ctx?.currency ?? 'INR'}
          />
        ) : bill.status === 'PAID' ? (
          <DoneState bill={bill} patient={patient} items={items} discount={Number(discount) || 0} onNew={reset} />
        ) : bill.status === 'VOID' ? (
          <VoidState bill={bill} onNew={reset} />
        ) : (
          <CartState
            bill={bill}
            patient={patient}
            items={items}
            setItems={setItems}
            discount={discount}
            setDiscount={setDiscount}
            stockByItemId={stockByItemId}
            canWrite={canWrite}
            onPaid={(updated) => setBill(updated)}
            onChanged={(updated) => setBill(updated)}
            toast={toast}
          />
        )}
      </div>
    </div>
  );
}

// ---- Empty state — load a prescription ---------------------------------

function EmptyEntry({
  pasteId, setPasteId, onLoad, onLoadBill, busy,
  recent, recentLoading, recentSales, recentSalesLoading, currency,
}: {
  pasteId: string;
  setPasteId: (v: string) => void;
  onLoad: (id: string) => void;
  onLoadBill: (billId: string) => void;
  busy: boolean;
  recent: RecentPrescription[];
  recentLoading: boolean;
  recentSales: RecentSale[];
  recentSalesLoading: boolean;
  currency: string;
}) {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--brand-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="receipt" size={14} style={{ color: 'var(--brand-500)' }} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Start new sale</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={pasteId}
            onChange={(e) => setPasteId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onLoad(pasteId)}
            placeholder="Scan or paste Rx number (e.g. #7F6136)…"
            autoFocus
            style={{
              flex: 1, height: 32, padding: '0 10px',
              background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 100,
              fontSize: 12, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
              fontFamily: 'monospace',
            }}
          />
          <button onClick={() => onLoad(pasteId)} disabled={busy || !pasteId.trim()}
            style={{ height: 32, padding: '0 14px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 100, fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: !pasteId.trim() ? 0.5 : 1 }}>
            {busy ? <Spinner /> : <><Icon name="arrowUp" size={12} strokeWidth={2.5} /> Load</>}
          </button>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Recent prescriptions</div>
        {recentLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}><Spinner /></div>
        ) : recent.length === 0 ? (
          <div style={{ padding: '14px 14px', fontSize: 11, color: 'var(--text-subtle)' }}>
            None to show right now.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
                {['ID', 'Patient', 'Items', ''].map((h) => (
                  <th key={h} style={{ padding: '6px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map((p) => {
                const name = typeof p.patientId === 'object' && p.patientId ? p.patientId.fullName : p.patientName;
                return (
                  <tr key={p._id} onClick={() => onLoad(p._id)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 80ms' }}
                    className="hover-bg-muted">
                    <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'monospace' }}>{p._id.slice(-6).toUpperCase()}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{name ?? 'Unknown'}</td>
                    <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-subtle)' }}>{p.itemCount ?? 0} items</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                      <Icon name="chevronRight" size={14} style={{ color: 'var(--text-subtle)' }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent paid sales — click any row to reopen its receipt and reprint. */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="checkCircle" size={13} style={{ color: 'var(--success-text)' }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Recent sales (paid)</div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-subtle)' }}>
            Click a row to reprint
          </div>
        </div>
        {recentSalesLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}><Spinner /></div>
        ) : recentSales.length === 0 ? (
          <div style={{ padding: '14px 14px', fontSize: 11, color: 'var(--text-subtle)' }}>
            No completed sales yet — they'll appear here once a payment lands.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
                {['Bill #', 'Patient', 'Items', 'Total', 'When', ''].map((h) => (
                  <th key={h} style={{ padding: '6px 14px', textAlign: h === 'Total' ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSales.map((s) => {
                const when = s.paidAt
                  ? new Date(s.paidAt)
                  : s.createdAt ? new Date(s.createdAt) : null;
                return (
                  <tr key={s._id} onClick={() => onLoadBill(s._id)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 80ms' }}
                    className="hover-bg-muted">
                    <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--brand-600)', fontFamily: 'monospace', fontWeight: 600 }}>
                      {s.billNo ?? '#' + s._id.slice(-6).toUpperCase()}
                    </td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>
                      {s.patientName ?? `Patient #${s.patientId.slice(-6)}`}
                    </td>
                    <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-subtle)' }}>
                      {(s.items ?? []).length} item{(s.items ?? []).length === 1 ? '' : 's'}
                    </td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text)', fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(s.total ?? 0, s.currency ?? currency)}
                    </td>
                    <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-subtle)' }}>
                      {when ? formatRelative(when) : '—'}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                      <Icon name="printer" size={13} style={{ color: 'var(--text-subtle)' }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * Soft "X minutes ago" / "X hours ago" / "Today HH:MM" formatter for the
 * recent-sales table. Falls back to a date for anything older than a
 * week so the column doesn't say "73 hours ago" — that becomes
 * surprising fast.
 */
function formatRelative(d: Date): string {
  const now = Date.now();
  const diffMs = now - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---- Cart state — DRAFT/ISSUED, edit and collect payment ----------------

function CartState({
  bill, patient, items, setItems, discount, setDiscount, stockByItemId, canWrite,
  onPaid, onChanged, toast,
}: {
  bill: Bill;
  patient: Patient | null;
  items: BillItem[];
  setItems: (rows: BillItem[]) => void;
  discount: string;
  setDiscount: (v: string) => void;
  stockByItemId: Map<string, AvailabilityRow>;
  canWrite: boolean;
  onPaid: (updated: Bill) => void;
  onChanged: (updated: Bill) => void;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { ctx } = useApp();
  const [busy, setBusy] = useState(false);
  const [showPay, setShowPay] = useState(false);

  const isDraft = bill.status === 'DRAFT';

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.quantity * i.unitPrice, 0), [items]);
  const discountVal = Number(discount) || 0;
  const total = Math.max(0, subtotal - discountVal);

  function patchItem(idx: number, patch: Partial<BillItem>) {
    setItems(items.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  async function persistDraft(): Promise<Bill> {
    return await apiPatch<Bill>(ctx, `/bills/${bill._id}`, {
      items: items.map((i) => ({
        inventoryItemId: i.inventoryItemId,
        customName: i.customName,
        quantity: Number(i.quantity) || 1,
        unitPrice: Number(i.unitPrice) || 0,
      })),
      discount: discountVal,
    });
  }

  async function startCollect() {
    if (items.length === 0) {
      toast('Add at least one medicine before collecting payment.', 'error');
      return;
    }
    if (total <= 0) {
      toast('Set a price before collecting payment.', 'error');
      return;
    }
    setBusy(true);
    try {
      // If the pharmacist edited prices/qty, persist before issuing — the
      // bill number gets minted against whatever totals are stored, not
      // what's on screen.
      if (isDraft) {
        const updated = await persistDraft();
        await apiPost(ctx, `/bills/${updated._id}/issue`, {});
      }
      setShowPay(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not issue bill', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveOnly() {
    setBusy(true);
    try {
      const updated = await persistDraft();
      onChanged(updated);
      toast('Saved', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function voidBill() {
    if (!confirm('Cancel this sale? The draft bill will be voided.')) return;
    setBusy(true);
    try {
      await apiPatch(ctx, `/bills/${bill._id}`, { status: 'VOID' });
      const fresh = await apiGet<Bill>(ctx, `/bills/${bill._id}`);
      onChanged(fresh);
      toast('Sale cancelled', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Cancel failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onPaymentRecorded() {
    setShowPay(false);
    try {
      const fresh = await apiGet<Bill>(ctx, `/bills/${bill._id}`);
      onPaid(fresh);
      toast('Payment recorded', 'success');
    } catch {
      onPaid({ ...bill, status: 'PAID' });
    }
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PatientHeader bill={bill} patient={patient} />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Medicines</div>
          <div style={{ fontSize: 10, color: 'var(--text-subtle)', fontWeight: 600 }}>{items.length} items</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 2fr) 100px 70px 100px 110px 36px', gap: 8, padding: '6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)' }}>
          <span>Name</span>
          <span>Stock</span>
          <span>Qty</span>
          <span>Price</span>
          <span style={{ textAlign: 'right' }}>Total</span>
          <span />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((it, idx) => {
            const stock = it.inventoryItemId ? stockByItemId.get(it.inventoryItemId) : undefined;
            const onHand = stock?.onHand;
            const status = stock?.status;
            const short = (onHand != null && it.quantity > onHand) || status === 'OUT_OF_STOCK';
            return (
              <div key={idx} style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(200px, 2fr) 100px 70px 100px 110px 36px',
                gap: 8, alignItems: 'center',
                padding: '4px 12px',
                background: 'transparent',
                borderBottom: `1px solid ${short ? 'rgba(239,68,68,0.1)' : 'var(--border)'}`,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.customName ?? 'Medicine'}
                  </div>
                  {short && <div style={{ fontSize: 9, color: 'var(--danger-500)', fontWeight: 600 }}>Shortage</div>}
                </div>
                <StockChip status={status} onHand={onHand} unit={stock?.unit} unmatched={!it.inventoryItemId} />
                <input
                  type="number" min={1} step={1} value={it.quantity}
                  onChange={(e) => patchItem(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                  disabled={!isDraft || !canWrite}
                  style={miniInput}
                />
                <input
                  type="number" min={0} step="0.01" value={it.unitPrice}
                  onChange={(e) => patchItem(idx, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                  disabled={!isDraft || !canWrite}
                  placeholder="0.00"
                  style={miniInput}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(it.quantity * it.unitPrice, bill.currency)}
                </span>
                {isDraft && canWrite ? (
                  <button onClick={() => removeItem(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="trash" size={14} />
                  </button>
                ) : <span />}
              </div>
            );
          })}
          {items.length === 0 && (
            <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 11, color: 'var(--text-subtle)' }}>
              No items left.
            </div>
          )}
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SummaryRow label="Subtotal" value={formatMoney(subtotal, bill.currency)} />
        <SummaryRow
          label="Discount"
          value={isDraft ? (
            <input type="number" min={0} step="0.01" value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              disabled={!canWrite}
              style={{ ...miniInput, width: 120, textAlign: 'right' }} />
          ) : formatMoney(discountVal, bill.currency)}
        />
        <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
        <SummaryRow label="Total to collect" value={formatMoney(total, bill.currency)} bold large />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        {canWrite && isDraft && (
          <button onClick={voidBill} disabled={busy}
            style={{ height: 42, padding: '0 18px', background: 'none', border: '1.5px solid var(--danger-500)', color: 'var(--danger-500)', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
            Cancel sale
          </button>
        )}
        {canWrite && isDraft && (
          <button onClick={saveOnly} disabled={busy}
            style={{ height: 42, padding: '0 18px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', color: 'var(--text)', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
            Save changes
          </button>
        )}
        {canWrite && (
          <button onClick={startCollect} disabled={busy || items.length === 0 || total <= 0}
            style={{
              height: 42, padding: '0 22px',
              background: 'var(--brand-500)', color: 'var(--brand-text)',
              border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 700,
              cursor: busy ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: items.length === 0 || total <= 0 ? 0.5 : 1,
            }}>
            {busy ? <Spinner /> : <><Icon name="creditCard" size={14} /> Collect payment · {formatMoney(total, bill.currency)}</>}
          </button>
        )}
      </div>

      {showPay && (
        <PaymentModal
          bill={bill}
          outstanding={total}
          onClose={() => setShowPay(false)}
          onRecorded={onPaymentRecorded}
        />
      )}
    </div>
  );
}

// ---- Done state — PAID ---------------------------------------------------

function DoneState({
  bill, patient, items, discount, onNew,
}: {
  bill: Bill;
  patient: Patient | null;
  items: BillItem[];
  discount: number;
  onNew: () => void;
}) {
  const { ctx } = useApp();
  const toast = useToast();
  const [printing, setPrinting] = useState(false);

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const total = Math.max(0, subtotal - discount);

  // Receipt is rendered client-side and opened in a new window — same
  // approach as the prescription print. Avoids the server-side
  // `/bills/:id/pdf` path which depends on MinIO being up to store
  // the generated PDF, and used to 500 with a confusing "Internal
  // server error" when storage was unreachable.
  function printReceipt() {
    setPrinting(true);
    try {
      const html = renderReceiptHtml({
        bill,
        patient,
        items,
        discount,
        subtotal,
        total,
        clinicName: ctx.clinicName ?? 'Clinic',
        branchName: ctx.branchName ?? '',
        cashierName: ctx.fullName ?? '',
      });
      const w = window.open('', '_blank');
      if (!w) {
        toast('Pop-up blocked. Allow pop-ups for this site to print.', 'error');
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Receipt unavailable', 'error');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-200, rgba(34,197,94,0.3))', borderRadius: 14, padding: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--success-100, rgba(34,197,94,0.15))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="checkCircle" size={22} style={{ color: 'var(--success-text)' }} />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--success-text)' }}>Sale complete</div>
          <div style={{ fontSize: 12, color: 'var(--success-text)', opacity: 0.8, marginTop: 2 }}>
            Total collected: <strong>{formatMoney(total, bill.currency)}</strong>
            {bill.inventoryDispensedAt
              ? ' · Stock auto-deducted from inventory'
              : ''}
          </div>
        </div>
      </div>

      <PatientHeader bill={bill} patient={patient} />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Receipt summary</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((it, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text)' }}>
                {it.customName ?? 'Medicine'} <span style={{ color: 'var(--text-subtle)' }}>× {it.quantity}</span>
              </span>
              <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {formatMoney(it.quantity * it.unitPrice, bill.currency)}
              </span>
            </div>
          ))}
        </div>
        <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />
        <SummaryRow label="Subtotal" value={formatMoney(subtotal, bill.currency)} />
        {discount > 0 && <SummaryRow label="Discount" value={`− ${formatMoney(discount, bill.currency)}`} />}
        <SummaryRow label="Total" value={formatMoney(total, bill.currency)} bold large />
        {bill.billNo && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-subtle)' }}>
            Bill # <code style={{ fontFamily: 'monospace' }}>{bill.billNo}</code>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onNew}
          style={{ height: 42, padding: '0 18px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', color: 'var(--text)', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          New transaction
        </button>
        <button onClick={printReceipt} disabled={printing}
          style={{ height: 42, padding: '0 22px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: printing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          {printing ? <Spinner /> : <><Icon name="printer" size={14} /> Print receipt</>}
        </button>
      </div>
    </div>
  );
}

// ---- Void state ----------------------------------------------------------

function VoidState({ bill, onNew }: { bill: Bill; onNew: () => void }) {
  return (
    <div style={{ maxWidth: 540, margin: '0 auto', textAlign: 'center', padding: 24 }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(239,68,68,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
        <Icon name="xCircle" size={26} style={{ color: 'var(--danger-500)' }} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>This sale was voided</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
        Bill <code style={{ fontFamily: 'monospace' }}>{bill.billNo ?? bill._id.slice(-6)}</code> was cancelled. Start a new transaction to dispense for the same prescription.
      </div>
      <button onClick={onNew}
        style={{ marginTop: 18, height: 42, padding: '0 22px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
        New transaction
      </button>
    </div>
  );
}

// ---- Patient header (shared by Cart + Done) -----------------------------

function PatientHeader({ bill, patient }: { bill: Bill; patient: Patient | null }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: 100, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
        {(patient?.fullName ?? '?').slice(0, 1).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {patient?.fullName ?? `Patient #${bill.patientId.slice(-6)}`}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-subtle)', fontFamily: 'monospace' }}>
          {patient?.mrn ?? `#${bill.patientId.slice(-6).toUpperCase()}`}
          {bill.billNo ? ` · Bill ${bill.billNo}` : ''}
        </div>
      </div>
      <span style={statusPillStyle(bill.status)}>{bill.status}</span>
    </div>
  );
}

function statusPillStyle(status: BillStatus): React.CSSProperties {
  const palette: Record<BillStatus, { bg: string; fg: string; border: string }> = {
    DRAFT: { bg: 'var(--surface-muted)', fg: 'var(--text-muted)', border: 'var(--border)' },
    ISSUED: { bg: 'var(--brand-50)', fg: 'var(--brand-600)', border: 'var(--brand-100)' },
    PAID: { bg: 'var(--success-bg)', fg: 'var(--success-text)', border: 'rgba(34,197,94,0.3)' },
    VOID: { bg: 'rgba(239,68,68,0.08)', fg: 'var(--danger-500)', border: 'rgba(239,68,68,0.3)' },
  };
  const p = palette[status];
  return {
    fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 100,
    background: p.bg, color: p.fg, border: `1px solid ${p.border}`,
    textTransform: 'uppercase', letterSpacing: '0.05em',
  };
}

// ---- Stock chip ----------------------------------------------------------

function StockChip({
  status, onHand, unit, unmatched,
}: {
  status?: StockStatus;
  onHand?: number;
  unit?: string;
  unmatched?: boolean;
}) {
  if (unmatched) {
    return <span title="Not stocked at this branch" style={chipStyle('rgba(148,163,184,0.15)', 'var(--text-subtle)', 'var(--border)')}>Not stocked</span>;
  }
  if (!status) return <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>—</span>;
  const tip = onHand != null ? `${onHand}${unit ? ' ' + unit.toLowerCase() : ''} on hand` : undefined;
  if (status === 'IN_STOCK') return <span title={tip} style={chipStyle('var(--success-bg)', 'var(--success-text)', 'rgba(34,197,94,0.3)')}>In stock</span>;
  if (status === 'LOW_STOCK') return <span title={tip} style={chipStyle('var(--warning-bg)', 'var(--warning-text)', 'rgba(245,158,11,0.35)')}>Low stock</span>;
  return <span title={tip} style={chipStyle('rgba(239,68,68,0.08)', 'var(--danger-500)', 'rgba(239,68,68,0.3)')}>Out of stock</span>;
}

function chipStyle(bg: string, fg: string, border: string): React.CSSProperties {
  return {
    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 100,
    background: bg, color: fg, border: `1px solid ${border}`, whiteSpace: 'nowrap',
    display: 'inline-block',
  };
}

function SummaryRow({ label, value, bold, large }: { label: string; value: React.ReactNode; bold?: boolean; large?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: large ? 15 : 13 }}>
      <span style={{ color: bold ? 'var(--text)' : 'var(--text-muted)', fontWeight: bold ? 700 : 500 }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: bold ? 700 : 500, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

const miniInput: React.CSSProperties = {
  height: 28, padding: '0 8px',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
  fontSize: 12, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit', width: '100%',
};

// ---- Payment modal -------------------------------------------------------

function PaymentModal({
  bill, outstanding, onClose, onRecorded,
}: {
  bill: Bill;
  outstanding: number;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const { ctx } = useApp();
  const toast = useToast();

  const getConvertedOutstanding = () => {
    const { detectedCurrency, exchangeRates } = getCurrencyConversionData();
    if (detectedCurrency && detectedCurrency !== bill.currency && exchangeRates) {
      const srcRate = exchangeRates[bill.currency ?? 'INR'];
      const targetRate = exchangeRates[detectedCurrency];
      if (srcRate && targetRate) {
        return (outstanding * targetRate) / srcRate;
      }
    }
    return outstanding;
  };

  const convertedOutstanding = getConvertedOutstanding();
  const [amount, setAmount] = useState(String(Math.round(convertedOutstanding * 100) / 100));
  const [method, setMethod] = useState<string>('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter a positive amount.'); return; }

    let backendAmount = amt;
    const { detectedCurrency, exchangeRates } = getCurrencyConversionData();
    if (detectedCurrency && detectedCurrency !== bill.currency && exchangeRates) {
      const srcRate = exchangeRates[bill.currency ?? 'INR'];
      const targetRate = exchangeRates[detectedCurrency];
      if (srcRate && targetRate) {
        backendAmount = (amt * srcRate) / targetRate;
      }
    }

    if (backendAmount > outstanding + 0.01) { setError(`Amount exceeds total (${formatMoney(outstanding, bill.currency)}).`); return; }
    setBusy(true); setError(null);
    try {
      await apiPost(ctx, `/bills/${bill._id}/payments`, {
        method,
        amount: backendAmount,
        providerRef: reference.trim() || undefined,
        idempotencyKey: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      });
      onRecorded();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Collect payment</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 4 }}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={fieldLabel}>Method</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
              {PAYMENT_METHODS.map((m) => {
                const active = method === m.id;
                return (
                  <button key={m.id} type="button" onClick={() => setMethod(m.id)}
                    style={{
                      height: 36, border: `1.5px solid ${active ? 'var(--brand-500)' : 'var(--border)'}`,
                      borderRadius: 9, background: active ? 'var(--brand-50)' : 'var(--surface)',
                      color: active ? 'var(--brand-600)' : 'var(--text-muted)',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label style={fieldLabel}>Amount ({getCurrencySymbol(bill.currency)}) (total: {formatMoney(outstanding, bill.currency)})</label>
            <input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              autoFocus
              style={modalInput} />
          </div>
          <div>
            <label style={fieldLabel}>Reference (optional)</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="UPI ref, txn id, etc." style={modalInput} />
          </div>
          {error && (
            <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} disabled={busy}
              style={{ height: 38, padding: '0 16px', background: 'none', color: 'var(--text-muted)', border: '1.5px solid var(--border)', borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: busy ? 'wait' : 'pointer' }}>
              Cancel
            </button>
            <button onClick={submit} disabled={busy}
              style={{ height: 38, padding: '0 18px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {busy ? <Spinner /> : 'Record payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
};
const modalInput: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 12px',
  background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 9,
  fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};

// ---- Printable receipt (client-side HTML, no server PDF) ---------------

/**
 * Render the medicine-bill receipt as a self-contained HTML document
 * the browser can immediately print. Mirrors the approach used by the
 * prescription print: build the markup in JS, open a new window, write
 * it in. No server-side PDF generation, no MinIO dependency, prints
 * reliably even when storage is offline.
 */
function renderReceiptHtml(input: {
  bill: Bill;
  patient: Patient | null;
  items: BillItem[];
  discount: number;
  subtotal: number;
  total: number;
  clinicName: string;
  branchName: string;
  cashierName: string;
}): string {
  const { bill, patient, items, discount, subtotal, total, clinicName, branchName, cashierName } = input;
  const issuedAt = bill.inventoryDispensedAt
    ? new Date(bill.inventoryDispensedAt)
    : new Date();
  const dateStr = issuedAt.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  const timeStr = issuedAt.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  const phone = patient?.phones?.[0] ?? '';
  const age = patient?.dob ? computeAge(patient.dob) : null;
  const genderLabel = patient?.gender ? formatGender(patient.gender) : '';

  const itemRows = items.map((it, idx) => `
    <tr>
      <td class="idx">${idx + 1}</td>
      <td class="med">${escapeHtml(it.customName ?? 'Medicine')}</td>
      <td class="num">${it.quantity}</td>
      <td class="num">${escapeHtml(formatMoney(it.unitPrice, bill.currency))}</td>
      <td class="num bold">${escapeHtml(formatMoney(it.quantity * it.unitPrice, bill.currency))}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Receipt — ${escapeHtml(bill.billNo ?? bill._id.slice(-6))}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #1a1a1a;
    background: #f3f4f6;
    font-size: 13px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    max-width: 794px; /* A4 width @ 96dpi */
    margin: 24px auto;
    background: #fff;
    padding: 28px 32px 36px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  }

  /* On-screen toolbar; hidden in print */
  .toolbar {
    position: fixed; top: 12px; right: 12px;
    display: flex; gap: 6px;
    background: #fff;
    padding: 6px 8px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    z-index: 999;
  }
  .toolbar button {
    border: 1px solid #d1d5db;
    background: #fff;
    color: #374151;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .toolbar button.primary {
    background: #1a56db;
    border-color: #1a56db;
    color: #fff;
  }

  @media print {
    @page { margin: 0; size: A4; }
    body { background: #fff; }
    .page { margin: 0; padding: 14mm 16mm; max-width: none; width: 100%; box-shadow: none; }
    .toolbar { display: none; }
    .patient-strip, .stock-note, .totals .row.grand, table.items thead {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
  }

  /* ─── Header ─── */
  header.bill-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    padding-bottom: 16px;
    border-bottom: 2px solid #1a1a1a;
  }
  .brand .clinic-name {
    font-size: 24px;
    font-weight: 800;
    color: #1a1a1a;
    letter-spacing: -0.4px;
    line-height: 1.1;
  }
  .brand .clinic-addr {
    font-size: 11.5px;
    color: #6b7280;
    margin-top: 6px;
    line-height: 1.5;
  }
  .bill-meta {
    text-align: right;
    flex-shrink: 0;
  }
  .doc-type {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    background: #1a56db;
    padding: 5px 12px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 10px;
  }
  .bill-meta .bill-no {
    font-family: 'Courier New', ui-monospace, monospace;
    font-size: 14px;
    font-weight: 700;
    color: #1a1a1a;
    letter-spacing: 0.04em;
  }
  .bill-meta .bill-date {
    font-size: 11.5px;
    color: #6b7280;
    margin-top: 4px;
  }

  /* ─── Patient strip ─── */
  .patient-strip {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 18px;
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 14px 18px;
    margin: 18px 0;
  }
  .ps-field { display: flex; flex-direction: column; }
  .ps-label {
    font-size: 9.5px;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
    margin-top: 3px;
  }
  .ps-value {
    font-size: 13px;
    font-weight: 700;
    color: #1a1a1a;
  }

  /* ─── Items table ─── */
  .section-title {
    font-size: 12px;
    font-weight: 700;
    color: #1a56db;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 22px 0 10px;
    padding-bottom: 6px;
    border-bottom: 1.5px solid #e5e7eb;
  }
  table.items {
    width: 100%;
    border-collapse: collapse;
  }
  table.items thead tr { background: #f3f4f6; }
  table.items th {
    text-align: left;
    font-size: 10.5px;
    font-weight: 700;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 10px 12px;
    border-bottom: 2px solid #1a1a1a;
  }
  table.items th.num { text-align: right; }
  table.items td {
    padding: 12px;
    font-size: 12.5px;
    border-bottom: 1px solid #e5e7eb;
    vertical-align: middle;
  }
  table.items td.idx {
    color: #9ca3af;
    font-size: 11.5px;
    width: 30px;
    font-weight: 600;
  }
  table.items td.med {
    color: #1a1a1a;
    font-weight: 600;
  }
  table.items td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: #374151;
    width: 100px;
  }
  table.items td.num.bold {
    font-weight: 700;
    color: #1a1a1a;
  }
  table.items tbody tr:nth-child(even) { background: #fafbfc; }

  /* ─── Totals ─── */
  .totals-wrap {
    display: flex;
    justify-content: flex-end;
    margin-top: 20px;
  }
  .totals {
    width: 320px;
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 14px 18px;
  }
  .totals .row {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    font-size: 13px;
    color: #374151;
  }
  .totals .row.grand {
    border-top: 2px solid #1a1a1a;
    margin-top: 8px;
    padding-top: 12px;
    font-size: 17px;
    font-weight: 800;
    color: #1a1a1a;
  }
  .totals .row span.amt { font-variant-numeric: tabular-nums; }
  .payment-info {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed #d1d5db;
    font-size: 11px;
    color: #6b7280;
    text-align: right;
  }
  .payment-info strong {
    color: #1a1a1a;
    font-weight: 700;
  }

  /* ─── Stock note ─── */
  .stock-note {
    margin-top: 18px;
    padding: 10px 14px;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    border-left: 4px solid #10b981;
    border-radius: 6px;
    font-size: 12px;
    color: #065f46;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stock-note .check {
    font-size: 14px;
    font-weight: 700;
  }

  /* ─── Footer / signature ─── */
  footer.bill-footer {
    margin-top: 36px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 24px;
    padding-top: 18px;
    border-top: 1px dashed #d1d5db;
  }
  .thanks-block {
    flex: 1;
    font-size: 11px;
    color: #6b7280;
    line-height: 1.6;
  }
  .thanks-block .thanks {
    font-size: 13px;
    font-weight: 700;
    color: #1a1a1a;
    margin-bottom: 4px;
  }
  .signature-block {
    text-align: center;
    min-width: 220px;
  }
  .sig-line {
    border-bottom: 1.5px solid #1a1a1a;
    height: 40px;
    margin-bottom: 6px;
  }
  .sig-name {
    font-size: 11px;
    font-weight: 700;
    color: #1a1a1a;
  }
  .sig-role {
    font-size: 10px;
    color: #6b7280;
    margin-top: 2px;
  }

  .terms {
    margin-top: 24px;
    padding-top: 14px;
    border-top: 1px solid #e5e7eb;
    font-size: 9.5px;
    color: #9ca3af;
    line-height: 1.6;
    text-align: center;
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">Print</button>
    <button onclick="window.close()">Close</button>
  </div>

  <div class="page">

    <header class="bill-header">
      <div class="brand">
        <div class="clinic-name">${escapeHtml(clinicName)}</div>
        <div class="clinic-addr">
          ${branchName ? escapeHtml(branchName) : ''}
        </div>
      </div>
      <div class="bill-meta">
        <span class="doc-type">Pharmacy receipt</span>
        <div class="bill-no">${escapeHtml(bill.billNo ?? '#' + bill._id.slice(-6).toUpperCase())}</div>
        <div class="bill-date">${escapeHtml(dateStr)} · ${escapeHtml(timeStr)}</div>
      </div>
    </header>

    <section class="patient-strip">
      <div class="ps-field">
        <span class="ps-value">${escapeHtml(patient?.fullName ?? 'Walk-in patient')}</span>
        <span class="ps-label">Patient</span>
      </div>
      <div class="ps-field">
        <span class="ps-value">${genderLabel || '—'}${age != null ? ' · ' + age + ' yrs' : ''}</span>
        <span class="ps-label">Demographics</span>
      </div>
      <div class="ps-field">
        <span class="ps-value">${escapeHtml(phone || patient?.mrn || '—')}</span>
        <span class="ps-label">${phone ? 'Phone' : (patient?.mrn ? 'MRN' : 'Contact')}</span>
      </div>
    </section>

    <div class="section-title">Medicines dispensed</div>
    <table class="items">
      <thead>
        <tr>
          <th style="width:30px;">#</th>
          <th>Medicine</th>
          <th class="num">Qty</th>
          <th class="num">Unit price</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:20px;">No items</td></tr>'}
      </tbody>
    </table>

    <div class="totals-wrap">
      <div class="totals">
        <div class="row"><span>Subtotal</span><span class="amt">${escapeHtml(formatMoney(subtotal, bill.currency))}</span></div>
        ${discount > 0 ? `<div class="row"><span>Discount</span><span class="amt">− ${escapeHtml(formatMoney(discount, bill.currency))}</span></div>` : ''}
        <div class="row grand"><span>Total paid</span><span class="amt">${escapeHtml(formatMoney(total, bill.currency))}</span></div>
        <div class="payment-info">Paid in full · <strong>Cash / UPI</strong></div>
      </div>
    </div>

    ${bill.inventoryDispensedAt
      ? `<div class="stock-note"><span class="check">✓</span> <span>Stock auto-dispensed from inventory at ${escapeHtml(new Date(bill.inventoryDispensedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}.</span></div>`
      : ''}

    <footer class="bill-footer">
      <div class="thanks-block">
        <div class="thanks">Thank you. Get well soon.</div>
        <div>Please keep this receipt for any returns or queries within 7 days of purchase.</div>
        <div>For prescription questions, contact your prescribing doctor.</div>
      </div>
      <div class="signature-block">
        <div class="sig-line"></div>
        <div class="sig-name">${cashierName ? escapeHtml(cashierName) : 'Pharmacist'}</div>
        <div class="sig-role">Pharmacist signature</div>
      </div>
    </footer>

    <div class="terms">
      Medicines once dispensed cannot be exchanged unless defective or wrongly billed.
      This is a system-generated receipt.
    </div>

  </div>

  <script>
    // Auto-open the print dialog so the pharmacist's flow is one click,
    // not two. Wrapped in a timeout to give the layout (and webfonts) a
    // moment to settle — some browsers race window.print against the
    // document parse.
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 350);
    });
  </script>
</body>
</html>`;
}

/** Compute integer years from an ISO date-of-birth string. */
function computeAge(dob: string): number | null {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/** Title-case the BE's enum string for the receipt's demographics field. */
function formatGender(g: string): string {
  const u = (g ?? '').toUpperCase();
  if (u === 'MALE') return 'Male';
  if (u === 'FEMALE') return 'Female';
  if (u === 'OTHER') return 'Other';
  return g;
}

/**
 * Minimal HTML-escaper for the receipt template — guards every
 * user-supplied field that gets interpolated above. Local copy rather
 * than reaching into the encounter screen's helper, so the pharmacy
 * print stays self-contained.
 */
function escapeHtml(input: string | undefined | null): string {
  if (input == null) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
