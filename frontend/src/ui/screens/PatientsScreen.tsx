import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../../app/api';
import type { DevContext } from '../../app/context';
import { Card, Field, ListRow, PrimaryButton, ScreenTitle, SecondaryButton, SheetFrame } from '../components/ui';
import { PatientDocumentsScreen } from './PatientDocumentsScreen';
import { ConsultationSheet } from './ConsultationSheet';

type Patient = {
  _id: string;
  fullName: string;
  phones: string[];
  createdAt?: string;
};

export function PatientsScreen({ ctx }: { ctx: DevContext }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canCall = useMemo(
    () => Boolean(ctx.apiBaseUrl && ctx.clinicId && (ctx.accessToken || ctx.userId)),
    [ctx],
  );

  async function load() {
    if (!canCall) return;
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (query.trim()) qs.set('query', query.trim());
      qs.set('limit', '25');
      const data = await apiGet<Patient[]>(ctx, `/patients?${qs.toString()}`);
      setItems(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCall]);

  const [showCreate, setShowCreate] = useState(false);
  const [docPatientId, setDocPatientId] = useState<string | null>(null);
  const [consultPatientId, setConsultPatientId] = useState<string | null>(null);

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <ScreenTitle title="Patients" subtitle="Search, consult, and documents." />
        <PrimaryButton className="w-auto shrink-0 self-start px-4 py-2.5 text-xs" onClick={() => setShowCreate(true)}>
          New
        </PrimaryButton>
      </div>

      <Card>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="Search" value={query} onChange={setQuery} placeholder="Name or phone" />
          </div>
          <SecondaryButton
            className="w-full shrink-0 py-2.5 sm:w-auto sm:min-w-[5.5rem]"
            onClick={() => void load()}
            disabled={!canCall || loading}
          >
            {loading ? '…' : 'Search'}
          </SecondaryButton>
        </div>
        {!canCall ? (
          <div className="mt-2 text-xs font-medium text-amber-800/90">
            Open Home: set clinic and sign in (JWT or dev user id).
          </div>
        ) : null}
        {err ? <div className="mt-2 text-xs font-medium text-rose-700">{err}</div> : null}
      </Card>

      <div className="space-y-2">
        {loading ? <div className="text-sm text-brand-inkMuted">Loading…</div> : null}
        {items.map((p) => (
          <ListRow key={p._id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-brand-ink">{p.fullName}</div>
                <div className="mt-1 text-xs text-brand-inkMuted">{p.phones?.[0] ?? '—'}</div>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <PrimaryButton className="w-auto px-3 py-2 text-xs" onClick={() => setConsultPatientId(p._id)}>
                  Consult
                </PrimaryButton>
                <SecondaryButton className="w-auto px-3 py-2 text-xs" onClick={() => setDocPatientId(p._id)}>
                  Add doc
                </SecondaryButton>
              </div>
            </div>
            <div className="mt-2 font-mono text-[11px] text-brand-inkMuted/80">ID: {p._id}</div>
          </ListRow>
        ))}
        {!loading && items.length === 0 ? (
          <div className="text-sm text-brand-inkMuted">No patients found.</div>
        ) : null}
      </div>

      {showCreate ? (
        <CreatePatientSheet
          ctx={ctx}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      ) : null}

      {docPatientId ? (
        <PatientDocumentsScreen ctx={ctx} patientId={docPatientId} onClose={() => setDocPatientId(null)} />
      ) : null}

      {consultPatientId ? (
        <ConsultationSheet ctx={ctx} patientId={consultPatientId} onClose={() => setConsultPatientId(null)} />
      ) : null}
    </section>
  );
}

function CreatePatientSheet({
  ctx,
  onClose,
  onCreated,
}: {
  ctx: DevContext;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await apiPost(ctx, '/patients', { fullName, phones: phone.trim() ? [phone.trim()] : [] });
      onCreated();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetFrame title="New patient" onClose={onClose}>
      <Field label="Full name" value={fullName} onChange={setFullName} placeholder="e.g. Rahul Sharma" />
      <Field label="Phone" value={phone} onChange={setPhone} placeholder="e.g. 9876543210" />
      {err ? <div className="text-xs font-medium text-rose-700">{err}</div> : null}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton onClick={() => void submit()} disabled={saving || !fullName.trim()}>
          {saving ? 'Saving…' : 'Create'}
        </PrimaryButton>
      </div>
    </SheetFrame>
  );
}

