import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../../app/api';
import type { DevContext } from '../../app/context';
import {
  Card,
  Field,
  ListRow,
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
  SheetFrame,
  inputSurfaceClass,
} from '../components/ui';

type Service = {
  _id: string;
  name: string;
  defaultPrice: number;
};

type Bill = {
  _id: string;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  billNo?: string;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  patientId: string;
  branchId: string;
};

type Payment = {
  _id: string;
  method: string;
  amount: number;
  paidAt: string;
};

type PdfUrlResponse = { url: string; expiresInSeconds: number; documentId: string };

export function BillingScreen({ ctx }: { ctx: DevContext }) {
  const canCall = useMemo(
    () => Boolean(ctx.apiBaseUrl && ctx.clinicId && (ctx.accessToken || ctx.userId)),
    [ctx],
  );
  const [services, setServices] = useState<Service[]>([]);
  const [servicesErr, setServicesErr] = useState<string | null>(null);
  const [loadingServices, setLoadingServices] = useState(false);

  const [activeBillId, setActiveBillId] = useState('');
  const [activeBill, setActiveBill] = useState<Bill | null>(null);
  const [billErr, setBillErr] = useState<string | null>(null);

  async function loadServices() {
    if (!canCall) return;
    setLoadingServices(true);
    setServicesErr(null);
    try {
      const data = await apiGet<Service[]>(ctx, '/catalog/services');
      setServices(data);
    } catch (e) {
      setServicesErr(String(e));
    } finally {
      setLoadingServices(false);
    }
  }

  async function loadBill(id: string) {
    if (!canCall || !id.trim()) return;
    setBillErr(null);
    setActiveBill(null);
    try {
      const data = await apiGet<Bill>(ctx, `/bills/${id.trim()}`);
      setActiveBill(data);
    } catch (e) {
      setBillErr(String(e));
    }
  }

  useEffect(() => {
    void loadServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCall]);

  const [showCreateService, setShowCreateService] = useState(false);
  const [showCreateBill, setShowCreateBill] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <ScreenTitle title="Billing" subtitle="Services, bills, and payments." />
        <div className="flex shrink-0 gap-2 self-stretch sm:self-start">
          <SecondaryButton className="w-auto flex-1 px-3 py-2.5 text-xs sm:flex-none" onClick={() => setShowCreateService(true)}>
            + Service
          </SecondaryButton>
          <PrimaryButton className="w-auto flex-1 px-3 py-2.5 text-xs sm:flex-none" onClick={() => setShowCreateBill(true)}>
            New bill
          </PrimaryButton>
        </div>
      </div>

      <Card title="Service catalog">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-brand-inkMuted">
            {loadingServices ? 'Loading…' : `${services.length} services`}
          </div>
          <SecondaryButton className="w-auto shrink-0 px-3 py-2 text-xs" onClick={() => void loadServices()}>
            Refresh
          </SecondaryButton>
        </div>
        {servicesErr ? <div className="mt-2 text-xs font-medium text-rose-700">{servicesErr}</div> : null}
        <div className="mt-3 space-y-2">
          {services.slice(0, 8).map((s) => (
            <ListRow key={s._id}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-brand-ink">{s.name}</div>
                  <div className="text-xs text-brand-inkMuted">₹ {s.defaultPrice}</div>
                </div>
                <div className="font-mono text-[11px] text-brand-inkMuted">{s._id.slice(-6)}</div>
              </div>
            </ListRow>
          ))}
          {services.length > 8 ? (
            <div className="text-xs text-brand-inkMuted">Showing first 8…</div>
          ) : null}
        </div>
      </Card>

      <Card title="Bill lookup">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <input
            value={activeBillId}
            onChange={(e) => setActiveBillId(e.target.value)}
            placeholder="Paste Bill ID"
            className={inputSurfaceClass}
          />
          <SecondaryButton
            className="w-full shrink-0 py-2.5 sm:w-auto sm:min-w-[5.5rem]"
            onClick={() => void loadBill(activeBillId)}
            disabled={!canCall}
          >
            Load
          </SecondaryButton>
        </div>
        {billErr ? <div className="mt-2 text-xs font-medium text-rose-700">{billErr}</div> : null}
        {activeBill ? (
          <div className="mt-3 rounded-3xl border border-white/70 bg-white/90 p-4 shadow-card ring-1 ring-violet-50/80">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-brand-ink">{activeBill.status}</div>
              <div className="text-xs text-brand-inkMuted">{activeBill.billNo ?? '—'}</div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-brand-ink">
              <div>Subtotal: ₹ {activeBill.subtotal}</div>
              <div>Total: ₹ {activeBill.total}</div>
              <div>Discount: ₹ {activeBill.discount}</div>
              <div>Tax: ₹ {activeBill.tax}</div>
            </div>
            <div className="mt-2 font-mono text-[11px] text-brand-inkMuted">ID: {activeBill._id}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <SecondaryButton
                onClick={() => {
                  setShowPayment(true);
                }}
              >
                Add payment
              </SecondaryButton>
              <PrimaryButton
                onClick={async () => {
                  try {
                    const issued = await apiPost<Bill>(ctx, `/bills/${activeBill._id}/issue`, {});
                    setActiveBill(issued);
                  } catch (e) {
                    setBillErr(String(e));
                  }
                }}
                disabled={activeBill.status !== 'DRAFT'}
              >
                Issue
              </PrimaryButton>
            </div>

            <div className="mt-2">
              <SecondaryButton
                onClick={async () => {
                  try {
                    const pdf = await apiGet<PdfUrlResponse>(ctx, `/bills/${activeBill._id}/pdf`);
                    window.open(pdf.url, '_blank', 'noopener,noreferrer');
                  } catch (e) {
                    setBillErr(String(e));
                  }
                }}
              >
                Download PDF
              </SecondaryButton>
            </div>
          </div>
        ) : null}
      </Card>

      {!canCall ? (
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/90 p-4 text-sm font-medium text-amber-900">
          Open Home: set clinic and sign in (JWT or dev user id).
        </div>
      ) : null}

      {showCreateService ? (
        <CreateServiceSheet
          ctx={ctx}
          onClose={() => setShowCreateService(false)}
          onCreated={() => {
            setShowCreateService(false);
            void loadServices();
          }}
        />
      ) : null}

      {showCreateBill ? (
        <CreateBillSheet
          ctx={ctx}
          services={services}
          onClose={() => setShowCreateBill(false)}
          onCreated={(bill) => {
            setShowCreateBill(false);
            setActiveBillId(bill._id);
            setActiveBill(bill);
          }}
        />
      ) : null}

      {showPayment && activeBill ? (
        <AddPaymentSheet
          ctx={ctx}
          bill={activeBill}
          onClose={() => setShowPayment(false)}
          onAdded={async () => {
            setShowPayment(false);
            await loadBill(activeBill._id);
          }}
        />
      ) : null}
    </section>
  );
}

function CreateServiceSheet({
  ctx,
  onClose,
  onCreated,
}: {
  ctx: DevContext;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('500');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await apiPost(ctx, '/catalog/services', { name, defaultPrice: Number(price) });
      onCreated();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetFrame title="New service" onClose={onClose}>
      <Field label="Service name" value={name} onChange={setName} placeholder="e.g. Consultation" />
      <Field label="Default price" value={price} onChange={setPrice} placeholder="e.g. 500" />
      {err ? <div className="text-xs font-medium text-rose-700">{err}</div> : null}
      <div className="grid grid-cols-2 gap-2 pt-2">
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton onClick={() => void submit()} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Create'}
        </PrimaryButton>
      </div>
    </SheetFrame>
  );
}

function CreateBillSheet({
  ctx,
  services,
  onClose,
  onCreated,
}: {
  ctx: DevContext;
  services: Service[];
  onClose: () => void;
  onCreated: (bill: Bill) => void;
}) {
  const [branchId, setBranchId] = useState(ctx.branchId ?? '');
  const [patientId, setPatientId] = useState('');
  const [serviceId, setServiceId] = useState(services[0]?._id ?? '');
  const [qty, setQty] = useState('1');
  const [unitPrice, setUnitPrice] = useState(String(services[0]?.defaultPrice ?? 500));
  const [discount, setDiscount] = useState('0');
  const [tax, setTax] = useState('0');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const s = services.find((x) => x._id === serviceId);
    if (s) setUnitPrice(String(s.defaultPrice));
  }, [serviceId, services]);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      const bill = await apiPost<Bill>(ctx, '/bills', {
        branchId,
        patientId,
        currency: 'INR',
        items: [
          {
            serviceCatalogItemId: serviceId || undefined,
            customName: serviceId ? undefined : 'Custom service',
            quantity: Number(qty),
            unitPrice: Number(unitPrice),
          },
        ],
        discount: Number(discount),
        tax: Number(tax),
      });
      onCreated(bill);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetFrame title="New bill" onClose={onClose}>
      <Field label="Branch ID" value={branchId} onChange={setBranchId} />
      <Field label="Patient ID" value={patientId} onChange={setPatientId} />

      <label className="block">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-inkMuted/90">Service</div>
        <select
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          className={['mt-1.5', inputSurfaceClass].join(' ')}
        >
          {services.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Qty" value={qty} onChange={setQty} />
        <Field label="Unit price" value={unitPrice} onChange={setUnitPrice} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Discount" value={discount} onChange={setDiscount} />
        <Field label="Tax" value={tax} onChange={setTax} />
      </div>

      {err ? <div className="text-xs font-medium text-rose-700">{err}</div> : null}
      <div className="grid grid-cols-2 gap-2 pt-2">
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton
          onClick={() => void submit()}
          disabled={saving || !branchId.trim() || !patientId.trim() || !serviceId.trim()}
        >
          {saving ? 'Saving…' : 'Create draft'}
        </PrimaryButton>
      </div>
    </SheetFrame>
  );
}

function AddPaymentSheet({
  ctx,
  bill,
  onClose,
  onAdded,
}: {
  ctx: DevContext;
  bill: Bill;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState(String(bill.total));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    apiGet<Payment[]>(ctx, `/bills/${bill._id}/payments`)
      .then(setPayments)
      .catch(() => setPayments(null));
  }, [bill._id, ctx]);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await apiPost(ctx, `/bills/${bill._id}/payments`, {
        method,
        amount: Number(amount),
        idempotencyKey,
      });
      onAdded();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetFrame title="Add payment" onClose={onClose}>
      <label className="block">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-inkMuted/90">Method</div>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className={['mt-1.5', inputSurfaceClass].join(' ')}
        >
          {['CASH', 'UPI', 'CARD', 'ONLINE', 'BANK_TRANSFER'].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <Field label="Amount" value={amount} onChange={setAmount} />
      {err ? <div className="text-xs font-medium text-rose-700">{err}</div> : null}
      <div className="grid grid-cols-2 gap-2 pt-2">
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton onClick={() => void submit()} disabled={saving || bill.status !== 'ISSUED'}>
          {saving ? 'Saving…' : 'Add'}
        </PrimaryButton>
      </div>
      {bill.status !== 'ISSUED' ? (
        <div className="mt-2 text-xs text-amber-700">Issue the bill before adding payments.</div>
      ) : null}
      {payments ? (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold text-brand-ink">Recent payments</div>
          {payments.slice(0, 5).map((p) => (
            <ListRow key={p._id}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-brand-inkMuted">{p.method}</div>
                <div className="text-xs font-semibold text-brand-ink">₹ {p.amount}</div>
              </div>
            </ListRow>
          ))}
        </div>
      ) : null}
    </SheetFrame>
  );
}

