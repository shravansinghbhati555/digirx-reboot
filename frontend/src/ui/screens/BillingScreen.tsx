import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Perm, usePerm } from '../../app/permissions';
import { Avatar, EmptyState, Spinner, StatusPill, formatMoney, labelStyle, useToast } from '../shared/primitives';

// Common currencies surfaced in the create-bill sheet. The backend accepts
// any 3-letter ISO 4217 code; this is just an opinionated FE shortcut.
const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'] as const;
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
  // Slice 1 added kind. Defaults to SERVICE on the BE so legacy bills
  // load with the same shape they always had.
  kind?: 'SERVICE' | 'MEDICINE';
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
  encounterId?: string;
  appointmentId?: string;
  notes?: string;
  inventoryDispensedAt?: string;
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

type CreditNote = {
  _id: string;
  creditNoteNo?: string;
  amount: number;
  reason: string;
  status: 'ISSUED' | 'REFUNDED' | 'CANCELLED';
  refundedAt?: string;
  refundedVia?: string;
  refundProviderRef?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  createdAt?: string;
};

type BillRow = Bill & { totalPaid: number; outstanding: number; patientName?: string };
type BillList = { branchId: string | null; count: number; rows: BillRow[] };

/**
 * Service chip rendered on each bill row. The billing screen filters
 * out MEDICINE bills (those live in /pharmacy) so every row here is a
 * SERVICE bill — rendered with the brand palette and the label
 * "Consultation" which matches how front-desk staff describe these
 * charges to patients. The MEDICINE branch stays in place as a safety
 * net for any legacy/edge row that slips past the filter.
 */
function KindChip({ kind }: { kind?: 'SERVICE' | 'MEDICINE' }) {
  const isMedicine = kind === 'MEDICINE';
  const fg = isMedicine ? 'var(--success-text)' : 'var(--brand-600)';
  const bg = isMedicine ? 'var(--success-bg)' : 'var(--brand-50)';
  const border = isMedicine ? 'rgba(34,197,94,0.3)' : 'var(--brand-100)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
      background: bg, color: fg, border: `1px solid ${border}`,
      whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {isMedicine ? 'Medicine' : 'Consultation'}
    </span>
  );
}

const PAYMENT_METHODS: { id: string; label: string; icon: IconName }[] = [
  { id: 'CASH', label: 'Cash', icon: 'banknote' },
  { id: 'UPI', label: 'UPI', icon: 'smartphone' },
  { id: 'CARD', label: 'Card', icon: 'creditCard' },
  { id: 'ONLINE', label: 'Online', icon: 'send' },
  { id: 'BANK_TRANSFER', label: 'Bank', icon: 'arrowUp' },
];

export function BillingScreen() {
  const { ctx, selectedAppointmentId, setSelectedAppointmentId, selectedEncounterId, setSelectedEncounterId, selectedBillId, setSelectedBillId, selectedDate } = useApp();
  const { has } = usePerm();
  const canCreateBill = has(Perm.BillingWrite);
  const [bills, setBills] = useState<BillRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'draft' | 'issued' | 'paid' | 'void'>('all');
  const [selected, setSelected] = useState<BillRow | null>(null);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [lookupId, setLookupId] = useState('');
  // Pagination — initial load grabs 500 (the BE's hard cap). When the
  // response actually hits 500, we surface a "Load older" button that
  // doubles the page size, up to 2000. For most clinics 500 is more
  // than the lifetime bill count; this keeps the simple case simple
  // and the busy-clinic case workable without a full cursor pager.
  const PAGE_INITIAL = 500;
  const [pageSize, setPageSize] = useState<number>(PAGE_INITIAL);

  async function loadBills(limit: number = pageSize) {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (ctx.branchId) qs.set('branchId', ctx.branchId);
      if (filter !== 'all') qs.set('status', filter);
      // This screen only lists service (consultation) bills; pharmacy /
      // medicine bills have their own screen at /pharmacy. Hard-coding
      // the BE filter keeps medicine bills out of every list response,
      // so there's no flicker on filter changes.
      qs.set('kind', 'SERVICE');
      if (selectedDate) qs.set('date', selectedDate);
      const data = await apiGet<BillList>(ctx, `/bills?${qs.toString()}`);
      setBills(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Reset page size when filters change so a "Load older" expansion
  // doesn't carry across to a different filter slice.
  useEffect(() => {
    setPageSize(PAGE_INITIAL);
    void loadBills(PAGE_INITIAL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.clinicId, ctx.branchId, filter, selectedDate]);

  useEffect(() => {
    if (selectedBillId) {
      loadBill(selectedBillId);
      setSelectedBillId(undefined);
      setSelectedAppointmentId(undefined);
      setSelectedEncounterId(undefined);
    } else if (selectedAppointmentId || selectedEncounterId) {
      setShowCreate(true);
      // We don't clear them here immediately because CreateBillSheet reads them 
      // from context when mounting. They get cleared when CreateBillSheet closes.
    }
  }, [selectedAppointmentId, selectedEncounterId, selectedBillId]);

  // Accepts either a 24-char Mongo ObjectId (the legacy lookup) or a
  // human-readable bill no (e.g. "MAIN/2026-27/000005"). The latter is
  // what staff actually see on the row and on the printed receipt, so
  // typing that should Just Work. We route to the appropriate endpoint
  // by shape; bill no values typically contain slashes which can't sit
  // in a path segment, hence the dedicated /bills/by-no?billNo=…
  // endpoint on the BE.
  async function loadBill(idOrBillNo: string) {
    const value = idOrBillNo.trim();
    if (!value) return;
    setError(null);
    const isObjectId = /^[a-f0-9]{24}$/i.test(value);
    try {
      const bill = isObjectId
        ? await apiGet<BillRow>(ctx, `/bills/${value}`)
        : await apiGet<BillRow>(ctx, `/bills/by-no?billNo=${encodeURIComponent(value)}`);
      setSelected(bill);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Live lookup. As the operator types in the lookup box we fire a
  // /bills/by-no (or /bills/:id) request once the value "looks
  // complete" — a 24-char ObjectId or a billNo containing a slash
  // (e.g. MAIN/2026-27/000005). The debounce + cancelled flag pattern
  // matches the other search inputs across the app and prevents a
  // slow response for an earlier keystroke from overwriting a later
  // one's result. 404s are silently swallowed mid-type so the operator
  // doesn't see a "Bill not found" banner flicker on every character;
  // other errors still surface to the banner.
  useEffect(() => {
    const value = lookupId.trim();
    if (!value) { setError(null); return; }
    const isObjectId = /^[a-f0-9]{24}$/i.test(value);
    const looksLikeBillNo = value.includes('/') && value.length >= 6;
    if (!isObjectId && !looksLikeBillNo) return;

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const bill = isObjectId
          ? await apiGet<BillRow>(ctx, `/bills/${value}`)
          : await apiGet<BillRow>(ctx, `/bills/by-no?billNo=${encodeURIComponent(value)}`);
        if (!cancelled) {
          setSelected(bill);
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // Hide the inevitable "not found" while the operator is still
        // typing; surface anything else (network, 401, etc.).
        if (/not found/i.test(msg)) return;
        setError(msg);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [lookupId, ctx]);

  const filtered = useMemo(() => bills ?? [], [bills]);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ width: selected ? 520 : '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: selected ? '1px solid var(--border)' : 'none', transition: 'width 240ms ease-out' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-muted)', borderRadius: 100, padding: 4, border: '1px solid var(--border)' }}>
            {(['all', 'draft', 'issued', 'paid', 'void'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ padding: '6px 14px', borderRadius: 100, border: 'none', background: filter === f ? 'var(--brand-100)' : 'transparent', color: filter === f ? 'var(--text)' : 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.2s' }}>
                {f}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Bill no lookup (e.g. MAIN/2026-27/000005)"
              style={{ height: 36, padding: '0 16px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--text)', outline: 'none', minWidth: 280, fontFamily: 'monospace' }} />
          </div>
          <button onClick={() => canCreateBill && setShowCreate(true)}
            disabled={!canCreateBill}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 18px', background: 'var(--brand-600)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: canCreateBill ? 'pointer' : 'not-allowed', opacity: canCreateBill ? 1 : 0.5, boxShadow: '0 4px 12px rgba(37,99,235,0.2)' }}>
            <Icon name="plus" size={14} strokeWidth={3} /> New bill
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
                  {['Bill no', 'Service', 'Patient', 'Total', 'Outstanding', 'Status'].map((h, i) => (
                    <th key={h} style={{ padding: '12px 20px', textAlign: i >= 3 && i <= 4 ? 'right' : 'left', fontSize: 10, fontWeight: 800, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b._id} onClick={() => loadBill(b._id)}
                    className="row-hover"
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected?._id === b._id ? 'var(--brand-50)' : 'transparent' }}>
                    <td style={{ padding: '14px 20px', fontSize: 12, color: 'var(--text-subtle)', fontFamily: 'monospace', fontWeight: 600 }}>{b.billNo ?? b._id.slice(-6).toUpperCase()}</td>
                    <td style={{ padding: '14px 20px' }}>
                      <KindChip kind={b.kind} />
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={b.patientName ?? '?'} size={28} />
                        <span style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>
                          {b.patientName ?? <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Unknown patient</span>}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px', fontSize: 14, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatMoney(b.total, b.currency)}</td>
                    <td style={{ padding: '14px 20px', fontSize: 14, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: b.outstanding > 0 ? 'var(--danger-500)' : 'var(--success-500)' }}>
                      {b.outstanding > 0 ? formatMoney(b.outstanding, b.currency) : '—'}
                    </td>
                    <td style={{ padding: '14px 20px' }}><StatusPill status={b.status?.toLowerCase()} small /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* "Load older" appears only when the response actually filled
              the current page — implies more bills exist beyond it. Each
              click doubles the page size up to the BE cap of 2000. */}
          {!loading && !error && filtered.length > 0 && filtered.length >= pageSize && pageSize < 2000 && (
            <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'center', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
              <button
                onClick={() => {
                  const next = Math.min(2000, pageSize * 2);
                  setPageSize(next);
                  void loadBills(next);
                }}
                style={{
                  height: 36, padding: '0 18px',
                  background: 'var(--surface-muted)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 9,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                Load older bills · showing {filtered.length}
              </button>
            </div>
          )}
          {!loading && !error && filtered.length >= 2000 && (
            <div style={{ padding: '12px 16px', textAlign: 'center', fontSize: 11, color: 'var(--text-subtle)' }}>
              Showing the most recent 2000 bills. Use the status filter above to narrow further.
            </div>
          )}
        </div>
      </div>

      {selected && (
        <BillDetail
          bill={selected as any}
          onClose={() => setSelected(null)}
          onChanged={(b) => {
            setSelected(b as BillRow);
            void loadBills();
          }}
          onEdit={(b) => {
            setEditingBill(b);
            setShowCreate(true);
          }}
        />
      )}

      {showCreate && (
        <CreateBillSheet
          onClose={() => {
            setShowCreate(false);
            setEditingBill(null);
            setSelectedAppointmentId(undefined);
            setSelectedEncounterId(undefined);
          }}
          onCreated={(b) => {
            setShowCreate(false);
            setEditingBill(null);
            setSelectedAppointmentId(undefined);
            setSelectedEncounterId(undefined);
            setSelected(b as BillRow);
            void loadBills();
          }}
          initialEncounterId={selectedEncounterId}
          initialAppointmentId={selectedAppointmentId}
          initialBill={editingBill ?? undefined}
        />
      )}
    </div>
  );
}

function BillDetail({
  bill,
  onClose,
  onChanged,
  onEdit,
}: {
  bill: Bill;
  onClose: () => void;
  onChanged: (b: Bill) => void;
  onEdit: (b: Bill) => void;
}) {
  const { ctx } = useApp();
  const toast = useToast();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [creditNotes, setCreditNotes] = useState<CreditNote[] | null>(null);
  const [patientName, setPatientName] = useState<string | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [showCreateCn, setShowCreateCn] = useState(false);
  const [refundingCn, setRefundingCn] = useState<CreditNote | null>(null);
  const [cancellingCn, setCancellingCn] = useState<CreditNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [billNoFreshKey, setBillNoFreshKey] = useState(0);
  const [latestPaymentId, setLatestPaymentId] = useState<string | null>(null);
  const prevBillNoRef = useRef<string | undefined>(bill.billNo);

  useEffect(() => {
    let cancelled = false;
    const pid = typeof bill.patientId === 'object' ? (bill.patientId as any)._id : bill.patientId;
    apiGet<{ fullName?: string }>(ctx, `/patients/${pid}`)
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

  async function loadCreditNotes() {
    try {
      const data = await apiGet<CreditNote[]>(ctx, `/bills/${bill._id}/credit-notes`);
      setCreditNotes(data);
    } catch {
      setCreditNotes([]);
    }
  }
  useEffect(() => { void loadCreditNotes(); }, [bill._id]);

  const paid = (payments ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
  const balance = Math.max(0, bill.total - paid);
  // Active CNs (ISSUED + REFUNDED) count toward the credited ceiling.
  // CANCELLED don't — they were issued in error and freed up the room.
  const creditedActive = (creditNotes ?? [])
    .filter((c) => c.status !== 'CANCELLED')
    .reduce((s, c) => s + c.amount, 0);
  const refundedTotal = (creditNotes ?? [])
    .filter((c) => c.status === 'REFUNDED')
    .reduce((s, c) => s + c.amount, 0);
  const creditableRoom = Math.max(0, bill.total - creditedActive);
  const isDraft = bill.status === 'DRAFT';
  const isIssued = bill.status === 'ISSUED';
  const isPaid = bill.status === 'PAID';
  const isVoid = bill.status === 'VOID';
  const canVoid = (isIssued || isPaid) && creditedActive === 0;
  const canRefund = (isIssued || isPaid) && creditableRoom > 0;

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
    setDownloadingPdf(true);
    try {
      const res = await apiGet<{ url: string }>(ctx, `/bills/${bill._id}/pdf`);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'PDF unavailable', 'error');
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function reloadAll() {
    await Promise.all([loadCreditNotes(), loadPayments()]);
    try {
      const fresh = await apiGet<Bill>(ctx, `/bills/${bill._id}`);
      onChanged(fresh);
    } catch { /* ignore */ }
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
        <StatusPill status={bill.status?.toLowerCase()} />
        <div style={{ display: 'flex', gap: 8 }}>
          {isDraft && (
            <button
              onClick={() => onEdit(bill)}
              style={{ height: 36, padding: '0 16px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Edit draft
            </button>
          )}
          {isDraft && (
            <button onClick={issue} disabled={busy} style={{ height: 36, padding: '0 16px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
              Issue bill
            </button>
          )}
          {isIssued && balance > 0 && (
            <button onClick={() => setShowPay(true)} style={{ height: 36, padding: '0 16px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Record payment
            </button>
          )}
          {canRefund && (
            <button onClick={() => setShowCreateCn(true)}
              title={`Issue a credit note (room: ${formatMoney(creditableRoom, bill.currency)})`}
              style={{ height: 36, padding: '0 14px', background: 'none', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="receipt" size={13} /> Issue refund
            </button>
          )}
          {(isIssued || isPaid) && (
            <button onClick={() => canVoid && setShowVoid(true)}
              disabled={!canVoid}
              title={canVoid ? 'Void this bill' : 'Refund or cancel credit notes first'}
              style={{ height: 36, padding: '0 14px', background: 'none', color: canVoid ? 'var(--danger-500)' : 'var(--text-subtle)', border: `1px solid ${canVoid ? 'var(--danger-500)' : 'var(--border)'}`, borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: canVoid ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6, opacity: canVoid ? 1 : 0.6 }}>
              <Icon name="xCircle" size={13} /> Void
            </button>
          )}
          <button onClick={downloadPdf} disabled={downloadingPdf} title="PDF" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 9, cursor: downloadingPdf ? 'wait' : 'pointer', color: 'var(--text-muted)', opacity: downloadingPdf ? 0.6 : 1 }}>
            {downloadingPdf ? <Spinner size={14} /> : <Icon name="download" size={14} />}
          </button>
        </div>
      </div>
      
      {isVoid && (
        <div style={{ padding: '10px 24px', background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--danger-500)', fontWeight: 600 }}>
          <Icon name="xCircle" size={14} />
          <span>VOIDED{(bill as any).voidedAt ? ` on ${new Date((bill as any).voidedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}{(bill as any).voidReason ? ` — ${(bill as any).voidReason}` : ''}</span>
        </div>
      )}

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
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(item.unitPrice, bill.currency)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatMoney(item.amount ?? item.quantity * item.unitPrice, bill.currency)}</td>
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
              ['Subtotal', formatMoney(bill.subtotal, bill.currency)],
              ['Discount', formatMoney(bill.discount, bill.currency)],
              ['Tax', formatMoney(bill.tax, bill.currency)],
              ['Total', formatMoney(bill.total, bill.currency)],
              ['Paid', formatMoney(paid, bill.currency)],
              ...(refundedTotal > 0
                ? ([['Refunded', `− ${formatMoney(refundedTotal, bill.currency)}`]] as [string, string][])
                : []),
            ] as [string, string][]).map(([l, v], i) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: i === 3 ? '10px 0 8px' : '4px 0', borderTop: i === 3 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 12, color: i === 3 ? 'var(--text)' : l === 'Refunded' ? 'var(--danger-500)' : 'var(--text-muted)', fontWeight: i === 3 ? 700 : 400 }}>{l}</span>
                <span style={{ fontSize: 12, color: i === 3 ? 'var(--text)' : l === 'Refunded' ? 'var(--danger-500)' : 'var(--text-muted)', fontWeight: i === 3 ? 700 : 500, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            ))}
            {balance > 0 ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--danger-500)', fontWeight: 700 }}>Balance due</span>
                <span style={{ fontSize: 13, color: 'var(--danger-500)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(balance, bill.currency)}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '8px', background: 'rgba(16,185,129,0.08)', borderRadius: 8 }}>
                <span style={{ color: 'var(--success-500)' }}><Icon name="checkCircle" size={14} /></span>
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
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(p.amount, bill.currency)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{p.method} · {new Date(p.paidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {creditNotes && creditNotes.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Credit notes</div>
              {creditNotes.map((cn) => {
                const isRefunded = cn.status === 'REFUNDED';
                const isCancelled = cn.status === 'CANCELLED';
                const accent = isRefunded
                  ? { bg: 'rgba(239,68,68,0.1)', fg: 'var(--danger-500)' }
                  : isCancelled
                    ? { bg: 'rgba(148,163,184,0.1)', fg: 'var(--text-subtle)' }
                    : { bg: 'rgba(245,158,11,0.1)', fg: 'var(--warning-500)' };
                return (
                  <div key={cn._id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: accent.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name={isCancelled ? 'x' : isRefunded ? 'check' : 'receipt'} size={13} style={{ color: accent.fg }} strokeWidth={2.5} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-subtle)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {cn.creditNoteNo ?? `#${cn._id.slice(-6)}`}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: accent.fg, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                          {isRefunded || cn.status === 'ISSUED' ? `− ${formatMoney(cn.amount, bill.currency)}` : formatMoney(cn.amount, bill.currency)}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                        <StatusPill status={cn.status?.toLowerCase()} small /> · {cn.reason}
                      </div>
                      {cn.status === 'ISSUED' && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          <button onClick={() => setRefundingCn(cn)}
                            style={{ height: 26, padding: '0 10px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                            Mark refunded
                          </button>
                          <button onClick={() => setCancellingCn(cn)}
                            style={{ height: 26, padding: '0 10px', background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
                            Cancel
                          </button>
                        </div>
                      )}
                      {isRefunded && cn.refundedAt && (
                        <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 4 }}>
                          Refunded via {cn.refundedVia} on {new Date(cn.refundedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                          {cn.refundProviderRef ? ` · ref ${cn.refundProviderRef}` : ''}
                        </div>
                      )}
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
      {showVoid && (
        <VoidBillSheet bill={bill}
          onClose={() => setShowVoid(false)}
          onSuccess={async () => { setShowVoid(false); await reloadAll(); toast('Bill voided', 'success'); }}
        />
      )}
      {showCreateCn && (
        <CreateCreditNoteSheet bill={bill} creditableRoom={creditableRoom}
          onClose={() => setShowCreateCn(false)}
          onSuccess={async () => { setShowCreateCn(false); await reloadAll(); toast('Credit note issued', 'success'); }}
        />
      )}
      {refundingCn && (
        <RefundCnSheet cn={refundingCn} currency={bill.currency}
          onClose={() => setRefundingCn(null)}
          onSuccess={async () => { setRefundingCn(null); await reloadAll(); toast('Refund recorded', 'success'); }}
        />
      )}
      {cancellingCn && (
        <CancelCnPrompt cn={cancellingCn}
          onClose={() => setCancellingCn(null)}
          onSuccess={async () => { setCancellingCn(null); await reloadAll(); toast('Credit note cancelled', 'success'); }}
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
      toast(`Payment of ${formatMoney(Number(amount), bill.currency)} recorded`, 'success');
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
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>{bill.billNo ?? bill._id.slice(-6)} · Balance {formatMoney(balance, bill.currency)}</div>
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
            <label style={labelStyle}>Amount <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>({bill.currency})</span></label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Manrope',sans-serif", fontWeight: 700 }}>{bill.currency}</span>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                style={{ width: '100%', height: 52, padding: '0 14px 0 34px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 12, fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: "'Manrope',sans-serif", outline: 'none', boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums' }} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[balance, Math.round(balance / 2), 500, 1000].filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 4).map((v) => (
                <button key={v} onClick={() => setAmount(String(v))}
                  style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-muted)', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(v, bill.currency)}
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
            {loading ? <Spinner /> : <><Icon name="check" size={16} strokeWidth={2.5} />Record {formatMoney(Number(amount) || 0, bill.currency)}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

type PatientHit = { _id: string; mrn?: string; fullName: string; phones?: string[]; gender?: string; dob?: string };

type DraftItem = { name: string; serviceId?: string; qty: number; price: number };

function CreateBillSheet({
  onClose,
  onCreated,
  initialEncounterId,
  initialAppointmentId,
  initialBill,
}: {
  onClose: () => void;
  onCreated: (b: Bill) => void;
  initialEncounterId?: string;
  initialAppointmentId?: string;
  initialBill?: Bill;
}) {
  const { ctx } = useApp();
  const toast = useToast();
  const [services, setServices] = useState<Service[]>([]);

  // Patient picker
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientHits, setPatientHits] = useState<PatientHit[]>([]);
  const [patientFocused, setPatientFocused] = useState(false);

  const [items, setItems] = useState<DraftItem[]>([]);
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  // Default to the clinic's currency (loaded from /me); fall back to INR
  // for first-render flicker before /me resolves.
  const [currency, setCurrency] = useState<string>(ctx.currency || 'INR');
  const [savingDraft, setSavingDraft] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { shakeProps, shake } = useShake();

  useEffect(() => {
    if (initialBill) {
      setItems(initialBill.items.map((it) => ({
        name: it.customName || '',
        serviceId: it.serviceCatalogItemId,
        qty: it.quantity,
        price: it.unitPrice,
      })));
      setDiscount(String(initialBill.discount || '0'));
      setNotes(initialBill.notes || '');
      apiGet<PatientHit>(ctx, `/patients/${initialBill.patientId}`).then(setPatient).catch(() => undefined);
    } else {
      setItems([{ name: 'Consultation', qty: 1, price: 800 }]);
      setDiscount('0');
      setNotes('');
      setPatient(null);
    }
  }, [initialBill, ctx]);

  const subtitle = [ctx.clinicName, formatHeaderDate(new Date())].filter(Boolean).join(' · ');

  useEffect(() => {
    apiGet<Service[]>(ctx, '/catalog/services').then(setServices).catch(() => setServices([]));
  }, [ctx]);

  // Pre-load patient if encounter/appointment provided
  useEffect(() => {
    if (initialEncounterId) {
      apiGet<any>(ctx, `/encounters/${initialEncounterId}`).then((enc) => {
        const pid = typeof enc.patientId === 'object' ? enc.patientId._id : enc.patientId;
        apiGet<PatientHit>(ctx, `/patients/${pid}`).then(setPatient);
      }).catch(() => undefined);
    } else if (initialAppointmentId) {
      apiGet<any>(ctx, `/appointments/${initialAppointmentId}`).then((appt) => {
        const pid = typeof appt.patientId === 'object' ? appt.patientId._id : appt.patientId;
        apiGet<PatientHit>(ctx, `/patients/${pid}`).then(setPatient);
      }).catch(() => undefined);
    }
  }, [initialEncounterId, initialAppointmentId, ctx]);

  // Patient search. `cancelled` prevents a stale response from a
  // previous query from clobbering the current one's results.
  useEffect(() => {
    if (patient) { setPatientHits([]); return; }
    if (!patientQuery.trim()) { setPatientHits([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ query: patientQuery.trim(), limit: '10' });
      apiGet<PatientHit[]>(ctx, `/patients?${qs.toString()}`)
        .then((r) => { if (!cancelled) setPatientHits(r); })
        .catch(() => { if (!cancelled) setPatientHits([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
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
      currency,
      items: items.map((i) => ({
        serviceCatalogItemId: i.serviceId,
        customName: i.serviceId ? undefined : i.name,
        quantity: i.qty,
        unitPrice: i.price,
      })),
      discount: discountNum,
      tax: 0,
      notes: notes.trim() || undefined,
      encounterId: initialEncounterId || initialBill?.encounterId,
      appointmentId: initialAppointmentId || initialBill?.appointmentId,
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
              <span style={{ textAlign: 'right' }}>Rate ({ctx.currency || 'INR'})</span>
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
              <span>Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                style={{ height: 32, padding: '0 8px', background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text)', outline: 'none', fontWeight: 600, cursor: 'pointer' }}>
                {CURRENCY_OPTIONS.includes(currency as typeof CURRENCY_OPTIONS[number])
                  ? null
                  : <option value={currency}>{currency}</option>}
                {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13, color: 'var(--text-muted)' }}>
              <span>Subtotal</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text)' }}>
                <Counter value={subtotal} duration={280} format={(n) => formatMoney(n, currency)} />
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13, color: 'var(--text-muted)' }}>
              <span>Discount <span style={{ color: 'var(--text-subtle)' }}>({currency})</span></span>
              <input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)}
                style={{ width: 96, height: 32, padding: '0 10px', background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text)', outline: 'none', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0 4px', borderTop: '1px solid var(--border)', marginTop: 4, fontSize: 14, fontWeight: 700 }}>
              <span style={{ color: 'var(--text)' }}>Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--brand-600)' }}>
                <Counter value={total} duration={280} format={(n) => formatMoney(n, currency)} />
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

// --- Phase 1.5 sheets / modals --------------------------------------------


/**
 * Sheet that issues a credit note against the bill. Operator picks which
 * line items to credit (or all of them) and confirms an amount that the
 * client gates client-side at `<= creditableRoom`. Backend re-checks.
 */
function CreateCreditNoteSheet({ bill, creditableRoom, onClose, onSuccess }: { bill: Bill; creditableRoom: number; onClose: () => void; onSuccess: () => void }) {
  const { ctx } = useApp();
  const toast = useToast();
  // Default: credit every line item, full amount = creditable room.
  const [selected, setSelected] = useState<Set<number>>(() => new Set(bill.items.map((_, i) => i)));
  const [amount, setAmount] = useState(String(creditableRoom));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { shakeProps, shake } = useShake();

  function toggleItem(i: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function submit() {
    const num = Number(amount);
    if (!num || isNaN(num) || num <= 0) { setError('Enter a valid amount'); shake(); return; }
    if (num > creditableRoom + 0.001) {
      setError(`Amount exceeds creditable room (${formatMoney(creditableRoom, bill.currency)})`); shake(); return;
    }
    if (selected.size === 0) { setError('Select at least one item'); shake(); return; }
    if (reason.trim().length < 2) { setError('Reason is required'); shake(); return; }

    setBusy(true); setError(null);
    try {
      const items = bill.items
        .map((it, i) => ({ it, i }))
        .filter(({ i }) => selected.has(i))
        .map(({ it }) => ({
          serviceCatalogItemId: it.serviceCatalogItemId,
          customName: it.customName ?? it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
        }));
      await apiPost(ctx, `/bills/${bill._id}/credit-notes`, {
        items, amount: num, reason: reason.trim(),
      });
      onSuccess();
    } catch (e) {
      shake();
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', background: 'rgba(15,23,42,0.3)', backdropFilter: 'blur(2px)' }} onClick={onClose}>
      <div {...shakeProps}
        style={{ width: 480, height: '100%', background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: '-8px 0 32px rgba(15,23,42,0.12)', display: 'flex', flexDirection: 'column', animation: 'slideInRight 240ms ease-out', ...shakeProps.style }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Issue credit note</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>
              {bill.billNo ?? bill._id.slice(-6)} · Room: {formatMoney(creditableRoom, bill.currency)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}><Icon name="x" size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={labelStyle}>Items to credit</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
              {bill.items.map((it, i) => {
                const checked = selected.has(i);
                return (
                  <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', background: checked ? 'var(--surface)' : 'transparent', border: `1px solid ${checked ? 'var(--brand-100)' : 'transparent'}` }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleItem(i)} style={{ accentColor: 'var(--brand-500)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{it.description ?? it.customName ?? '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                        {it.quantity} × {formatMoney(it.unitPrice, bill.currency)}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(it.amount ?? it.quantity * it.unitPrice, bill.currency)}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Amount to credit <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>({bill.currency})</span></label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Manrope',sans-serif", fontWeight: 700 }}>{bill.currency}</span>
              <input type="number" min={0} max={creditableRoom} value={amount} onChange={(e) => setAmount(e.target.value)}
                style={{ width: '100%', height: 52, padding: '0 14px 0 52px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 12, fontSize: 22, fontWeight: 700, color: 'var(--text)', outline: 'none', boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
              The amount can be less than the items' total (partial credit). Maximum: {formatMoney(creditableRoom, bill.currency)}.
            </div>
          </div>

          <div>
            <label style={labelStyle}>Reason</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Service not delivered, Patient overcharged"
              style={{ width: '100%', minHeight: 64, padding: '10px 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
          </div>

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
          <button onClick={submit} disabled={busy}
            style={{ width: '100%', height: 46, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: busy ? 0.8 : 1 }}>
            {busy ? <Spinner /> : <><Icon name="receipt" size={16} strokeWidth={2.5} /> Issue credit note</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Records the actual cash going out for a credit note. Generates a fresh
 * UUIDv4 idempotency key per click — same pattern as PaymentSheet — so a
 * retry doesn't double-stamp the refund.
 */
function RefundCnSheet({ cn, currency, onClose, onSuccess }: { cn: CreditNote; currency: string; onClose: () => void; onSuccess: () => void }) {
  const { ctx } = useApp();
  const toast = useToast();
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const { shakeProps, shake } = useShake();

  async function submit() {
    setBusy(true); setError(null);
    try {
      await apiPost(ctx, `/credit-notes/${cn._id}/refund`, {
        method, providerRef: reference.trim() || undefined, idempotencyKey,
      });
      onSuccess();
    } catch (e) {
      shake();
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)', animation: 'fadeIn 150ms ease-out' }} onClick={onClose}>
      <div {...shakeProps}
        style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 420, overflow: 'hidden', animation: 'slideUp 200ms ease-out', ...shakeProps.style }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Mark refunded</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>
              {cn.creditNoteNo ?? `#${cn._id.slice(-6)}`} · {formatMoney(cn.amount, currency)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}><Icon name="x" size={18} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Refund method</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PAYMENT_METHODS.map((m) => (
                <button key={m.id} onClick={() => setMethod(m.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: `1.5px solid ${method === m.id ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 9, background: method === m.id ? 'var(--brand-50)' : 'var(--surface-muted)', color: method === m.id ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  <Icon name={m.icon} size={12} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Reference <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>(optional)</span></label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI ref, cheque no., etc."
              style={{ width: '100%', height: 38, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }} />
          </div>

          <div style={{ background: 'var(--surface-muted)', borderRadius: 10, padding: '8px 12px', border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-subtle)' }}>
            Idempotency key: <code style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{idempotencyKey.slice(0, 8)}…</code>
          </div>

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={busy}
            style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: busy ? 'wait' : 'pointer' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy}
            style={{ flex: 1.5, height: 42, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {busy ? <Spinner /> : <><Icon name="check" size={14} strokeWidth={2.5} /> Confirm refund</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Marks a credit note as ISSUED-by-mistake. Frees up creditable room on the
 * underlying bill so the operator can re-issue or void.
 */
function CancelCnPrompt({ cn, onClose, onSuccess }: { cn: CreditNote; onClose: () => void; onSuccess: () => void }) {
  const { ctx } = useApp();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { shakeProps, shake } = useShake();

  async function submit() {
    if (reason.trim().length < 2) { setError('Reason is required'); shake(); return; }
    setBusy(true); setError(null);
    try {
      await apiPost(ctx, `/credit-notes/${cn._id}/cancel`, { reason: reason.trim() });
      onSuccess();
    } catch (e) {
      shake();
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)', animation: 'fadeIn 150ms ease-out' }} onClick={onClose}>
      <div {...shakeProps}
        style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 380, overflow: 'hidden', animation: 'slideUp 200ms ease-out', ...shakeProps.style }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Cancel credit note</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>{cn.creditNoteNo ?? `#${cn._id.slice(-6)}`}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}><Icon name="x" size={18} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Cancelling marks this CN as issued in error. The amount frees up so you can issue a different CN or void the bill.
          </div>
          <div>
            <label style={labelStyle}>Reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong amount, wrong patient"
              autoFocus
              style={{ width: '100%', height: 40, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={busy}
            style={{ flex: 1, height: 40, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: busy ? 'wait' : 'pointer' }}>
            Keep
          </button>
          <button onClick={submit} disabled={busy}
            style={{ flex: 1, height: 40, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {busy ? <Spinner /> : 'Cancel CN'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VoidBillSheet({ bill, onClose, onSuccess }: { bill: Bill; onClose: () => void; onSuccess: () => void }) {
  const { ctx } = useApp();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { shakeProps, shake } = useShake();

  async function submit() {
    if (reason.trim().length < 4) {
      setError('Please provide a descriptive reason (min 4 chars)'); shake(); return;
    }
    setBusy(true); setError(null);
    try {
      await apiPost(ctx, `/bills/${bill._id}/void`, { reason: reason.trim() });
      onSuccess();
    } catch (e) {
      shake();
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div {...shakeProps}
        style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 400, overflow: 'hidden', animation: 'slideUp 200ms ease-out', ...shakeProps.style }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Void Bill</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>{bill.billNo ?? bill._id.slice(-6)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}><Icon name="x" size={18} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, padding: 12, background: 'rgba(239,68,68,0.05)', borderRadius: 10, border: '1px solid rgba(239,68,68,0.1)' }}>
            <Icon name="alertTriangle" size={18} style={{ color: 'var(--danger-500)', flexShrink: 0 }} />
            <div style={{ fontSize: 12, color: 'var(--danger-600)', lineHeight: 1.5 }}>
              Voiding a bill is permanent. It will cancel all remaining balances. Payment history will be preserved but the bill will no longer be active.
            </div>
          </div>

          <div>
            <label style={labelStyle}>Reason for voiding</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Billing error, patient request, duplicate bill..."
              autoFocus
              style={{ width: '100%', minHeight: 80, padding: '10px 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none', resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
          </div>

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, background: 'var(--surface-muted)' }}>
          <button onClick={onClose} disabled={busy}
            style={{ flex: 1, height: 42, background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: busy ? 'wait' : 'pointer' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy}
            style={{ flex: 1.5, height: 42, background: 'var(--danger-500)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {busy ? <Spinner /> : <><Icon name="xCircle" size={14} strokeWidth={2.5} /> Void Permanently</>}
          </button>
        </div>
      </div>
    </div>
  );
}
