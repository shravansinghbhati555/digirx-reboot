import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Perm, usePerm } from '../../app/permissions';
import { isValidEmail, normalizeIndianMobile } from '../../app/validators';
import { Avatar, EmptyState, Field, Spinner, StatusPill, formatDate, formatMoney, labelStyle, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';
import { AnimatedTabs } from '../shared/AnimatedTabs';
import { Skeleton, ListItemSkeleton } from '../shared/Skeleton';
import { useShake } from '../shared/useShake';
import { DocumentsScreen } from './DocumentsScreen';

type Patient = {
  _id: string;
  // MRN is auto-minted on registration (clinic-configurable format) and is
  // the human-readable identifier the front desk should reference. The raw
  // `_id` is an implementation detail — never surface it to operators.
  mrn?: string;
  fullName: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | string;
  dob?: string;
  phones?: string[];
  emails?: string[];
  tags?: string[];
  notes?: string;
  createdAt?: string;
};

// Single source of truth for patient-ref display. Prefer the MRN; fall
// back to a short tail of `_id` only when the MRN hasn't been minted (old
// rows from before MRN auto-gen, or tests).
function patientRef(p: { mrn?: string; _id: string }): string {
  return p.mrn ?? `#${p._id.slice(-6)}`;
}

type Bill = {
  _id: string;
  billNo?: string;
  status: string;
  total: number;
  currency?: string;
  totalPaid?: number;
  outstanding?: number;
  createdAt?: string;
  issuedAt?: string;
  patientId: string;
  appointmentId?: string;
  branchName?: string | null;
  voidedAt?: string;
  voidReason?: string;
};

type DiagnosisItem = { code?: string; description: string; primary?: boolean };

type PrescriptionSummary = {
  _id: string;
  itemCount: number;
  createdAt?: string;
};

type Encounter = {
  _id: string;
  appointmentId?: string;
  visitedAt: string;
  chiefComplaint?: string;
  notes?: string;
  /** Legacy free-text diagnosis (pre-1.2 encounters). */
  diagnosis?: string;
  /** Typed multi-entry diagnosis (post-1.2). */
  diagnoses?: DiagnosisItem[];
  vitals?: Record<string, unknown>;
  followUpAt?: string;
  followUpNotes?: string;
  status: 'DRAFT' | 'SIGNED' | string;
  signedAt?: string;
  doctorName?: string | null;
  branchName?: string | null;
  prescriptions?: PrescriptionSummary[];
};

type Appointment = {
  _id: string;
  type?: 'TIME' | 'QUEUE' | string;
  startAt?: string;
  endAt?: string;
  queueDate?: string;
  queueNumber?: number;
  status: string;
  cancellationReason?: string;
  cancelledAt?: string;
  doctorName?: string | null;
  branchName?: string | null;
};

type HistoryResponse = {
  patientId: string;
  appointments: Appointment[];
  encounters: Encounter[];
  bills: Bill[];
};

function ageFromDob(dob?: string): string {
  if (!dob) return '—';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const years = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  return `${years}y`;
}

function genderLabel(g?: string): string {
  if (!g) return '—';
  if (g === 'MALE' || g === 'M') return 'Male';
  if (g === 'FEMALE' || g === 'F') return 'Female';
  return 'Other';
}

function alphaGroups(list: Patient[]) {
  const map = new Map<string, Patient[]>();
  list.forEach((p) => {
    const letter = (p.fullName?.[0] ?? '#').toUpperCase();
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter)!.push(p);
  });
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export function PatientsScreen() {
  const { ctx } = useApp();
  const { has } = usePerm();
  const canCreatePatient = has(Perm.PatientWrite);
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [genderFilter, setGenderFilter] = useState<'ALL' | 'MALE' | 'FEMALE' | 'OTHER'>('ALL');
  const [tagFilter, setTagFilter] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (query.trim()) qs.set('query', query.trim());
        qs.set('limit', '50');
        // Scope to the active branch so switching branches in the
        // sidebar narrows the list. The BE includes patients with no
        // primaryBranchId (legacy patients) so nothing disappears
        // unexpectedly when the field isn't set.
        if (ctx.branchId) qs.set('branchId', ctx.branchId);
        const data = await apiGet<Patient[]>(ctx, `/patients?${qs.toString()}`);
        if (cancelled) return;
        setItems(data);
        if (data.length > 0 && !selected) setSelected(data[0]);
        if (selected && !data.some((p) => p._id === selected._id)) setSelected(data[0] ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, refreshKey, ctx.branchId]);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((p) => (p.tags ?? []).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [items]);

  const visibleItems = useMemo(() => {
    return items.filter((p) => {
      if (genderFilter !== 'ALL') {
        const g = (p.gender || '').toUpperCase();
        if (g !== genderFilter && !(genderFilter === 'OTHER' && g !== 'MALE' && g !== 'FEMALE')) return false;
      }
      if (tagFilter && !(p.tags ?? []).includes(tagFilter)) return false;
      return true;
    });
  }, [items, genderFilter, tagFilter]);

  const groups = useMemo(() => alphaGroups(visibleItems), [visibleItems]);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left list */}
      <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
        <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or phone…"
              style={{ width: '100%', height: 36, paddingLeft: 32, paddingRight: 12, background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--brand-500)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
            />
          </div>
          <button onClick={() => canCreatePatient && setShowNew(true)}
            disabled={!canCreatePatient}
            title={canCreatePatient ? 'New patient' : 'You do not have permission to create patients'}
            style={{ width: 36, height: 36, background: 'var(--brand-500)', border: 'none', borderRadius: 9, cursor: canCreatePatient ? 'pointer' : 'not-allowed', color: 'var(--brand-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: canCreatePatient ? 1 : 0.5 }}>
            <Icon name="plus" size={16} strokeWidth={2.5} />
          </button>
        </div>
        {/* Filters row */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-muted)', borderRadius: 8, padding: 2 }}>
            {(['ALL', 'MALE', 'FEMALE', 'OTHER'] as const).map((g) => (
              <button key={g} onClick={() => setGenderFilter(g)} className="press-scale"
                style={{ flex: 1, padding: '4px 8px', fontSize: 11, fontWeight: genderFilter === g ? 600 : 400, color: genderFilter === g ? 'var(--text)' : 'var(--text-subtle)', background: genderFilter === g ? 'var(--surface)' : 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                {g === 'ALL' ? 'All' : g[0] + g.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          {tagOptions.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button onClick={() => setTagFilter('')} className="press-scale"
                style={{ padding: '3px 9px', fontSize: 10, fontWeight: tagFilter === '' ? 600 : 500, color: tagFilter === '' ? 'var(--brand-700)' : 'var(--text-subtle)', background: tagFilter === '' ? 'var(--brand-50)' : 'var(--surface-muted)', border: `1px solid ${tagFilter === '' ? 'var(--brand-100)' : 'var(--border)'}`, borderRadius: 100, cursor: 'pointer' }}>
                Any tag
              </button>
              {tagOptions.slice(0, 8).map((t) => (
                <button key={t} onClick={() => setTagFilter(tagFilter === t ? '' : t)} className="press-scale"
                  style={{ padding: '3px 9px', fontSize: 10, fontWeight: tagFilter === t ? 600 : 500, color: tagFilter === t ? 'var(--brand-700)' : 'var(--text-subtle)', background: tagFilter === t ? 'var(--brand-50)' : 'var(--surface-muted)', border: `1px solid ${tagFilter === t ? 'var(--brand-100)' : 'var(--border)'}`, borderRadius: 100, cursor: 'pointer' }}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="scroll-y" style={{ flex: 1 }}>
          {loading ? (
            <div>
              {Array.from({ length: 10 }).map((_, i) => <ListItemSkeleton key={i} />)}
            </div>
          ) : (
            <>
              {error && <div style={{ padding: 16, color: 'var(--danger-500)', fontSize: 12 }}>{error}</div>}
              {!error && visibleItems.length === 0 && (
                <EmptyState illustration="patients" title="No patients found" hint={query || genderFilter !== 'ALL' || tagFilter ? 'Try clearing the filters.' : 'Register a new patient to get started.'} />
              )}
              {groups.map(([letter, patients]) => (
                <div key={letter}>
                  <div style={{ padding: '6px 14px 3px', fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', position: 'sticky', top: 0, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>{letter}</div>
                  {patients.map((p) => (
                    <div key={p._id} onClick={() => setSelected(p)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: selected?._id === p._id ? 'var(--brand-50)' : 'transparent', borderLeft: selected?._id === p._id ? '3px solid var(--brand-500)' : '3px solid transparent', transition: 'background 80ms' }}>
                      <Avatar name={p.fullName} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: selected?._id === p._id ? 'var(--brand-700)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.fullName}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-subtle)', fontFamily: 'monospace', flexShrink: 0 }}>{patientRef(p)}</div>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {genderLabel(p.gender)} · {ageFromDob(p.dob)} · {p.phones?.[0] ?? '—'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Detail */}
      {selected ? (
        <PatientDetail key={selected._id} patient={selected} onEdit={() => setEditing(selected)} />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState illustration="patients" title="No patient selected" hint="Select a patient from the list on the left to view their profile, history, and billing." />
        </div>
      )}

      {showNew && (
        <NewPatientModal
          onClose={() => setShowNew(false)}
          onCreated={(created) => {
            setShowNew(false);
            toast(`${created.fullName} registered`, 'success');
            setRefreshKey((k) => k + 1);
            setSelected(created);
          }}
        />
      )}
      {editing && (
        <EditPatientModal
          patient={editing}
          onClose={() => setEditing(null)}
          onUpdated={(updated) => {
            setEditing(null);
            toast('Patient details updated', 'success');
            setRefreshKey((k) => k + 1);
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

function PatientDetail({ patient, onEdit }: { patient: Patient; onEdit: () => void }) {
  const { ctx, setScreen, setSelectedPatientId } = useApp();
  const [tab, setTab] = useState<'overview' | 'history' | 'documents' | 'bills'>('overview');
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);

  useEffect(() => {
    if (tab !== 'history' || history) return;
    apiGet<HistoryResponse>(ctx, `/patients/${patient._id}/history`).then(setHistory).catch(() => setHistory(null));
  }, [tab, ctx, patient._id, history]);

  useEffect(() => {
    if (tab !== 'bills' || bills) return;
    apiGet<{ rows: Bill[] }>(ctx, `/bills?patientId=${patient._id}`)
      .then((data) => setBills(data.rows))
      .catch(() => setBills([]));
  }, [tab, ctx, patient._id, bills]);

  function bookForPatient() {
    setSelectedPatientId(patient._id);
    setScreen('appointments');
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)' }}>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <Avatar name={patient.fullName} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{patient.fullName}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              {genderLabel(patient.gender)} · {ageFromDob(patient.dob)} · DOB {patient.dob ? formatDate(patient.dob) : '—'}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                <Icon name="phone" size={12} /> {patient.phones?.[0] ?? '—'}
              </span>
              {(patient.emails ?? []).slice(0, 1).map((e) => (
                <span key={e} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                  <Icon name="mail" size={12} /> {e}
                </span>
              ))}
              {(patient.tags ?? []).map((t) => (
                <span key={t} style={{ padding: '2px 8px', borderRadius: 100, background: 'var(--brand-50)', color: 'var(--brand-600)', fontSize: 11, fontWeight: 600, border: '1px solid var(--brand-100)' }}>{t}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={onEdit}
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', background: 'var(--surface-muted)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <Icon name="edit" size={14} /> Edit
            </button>
            <button onClick={bookForPatient}
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <Icon name="plus" size={14} strokeWidth={2.5} /> Book
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <AnimatedTabs
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'history', label: 'History' },
              { id: 'documents', label: 'Documents' },
              { id: 'bills', label: 'Bills' },
            ] as const}
            value={tab}
            onChange={setTab}
            style={{ borderBottom: 'none' }}
          />
        </div>
      </div>
      <div className="scroll-y" style={{ flex: 1, padding: '16px 20px' }}>
        {tab === 'overview' && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Registered', value: formatDate(patient.createdAt), icon: 'calendar' as const },
              { label: 'DOB', value: patient.dob ? formatDate(patient.dob) : '—', icon: 'clock' as const },
              { label: 'Primary phone', value: patient.phones?.[0] ?? '—', icon: 'phone' as const },
              { label: 'Tags', value: (patient.tags ?? []).join(', ') || '—', icon: 'tag' as const },
            ].map(({ label, value, icon }) => (
              <div key={label} style={{ flex: '1 1 200px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Icon name={icon} size={13} style={{ color: 'var(--brand-500)' }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{value}</div>
              </div>
            ))}
            {patient.notes && (
              <div style={{ flex: '1 1 100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginTop: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Notes</div>
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{patient.notes}</div>
              </div>
            )}
            <div style={{ flex: '1 1 100%', fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'monospace', marginTop: 8 }}>
              MRN: {patient.mrn ?? <span style={{ fontStyle: 'italic' }}>not assigned</span>}
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!history ? (
              <>
                <Skeleton height={20} width="40%" />
                <Skeleton height={100} />
                <Skeleton height={80} />
              </>
            ) : (
              <PatientTimeline history={history} />
            )}
          </div>
        )}

        {tab === 'documents' && (
          <div style={{ marginTop: -10 }}>
            <DocumentsScreen fixedOwnerType="PATIENT" fixedOwnerId={patient._id} />
          </div>
        )}

        {tab === 'bills' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {bills === null ? (
              <>
                <BillSkeleton />
                <BillSkeleton />
                <BillSkeleton />
              </>
            ) : (
              <>
                {bills.length === 0 && <EmptyState icon="receipt" title="No bills yet" />}
                {bills.map((b) => (
                  <div key={b._id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{b.billNo ?? b._id.slice(-6)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>{formatDate(b.createdAt)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(b.total, b.currency)}</div>
                      {(b.outstanding ?? Math.max(0, b.total - (b.totalPaid ?? 0))) > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--danger-500)' }}>
                          Balance: {formatMoney(b.outstanding ?? Math.max(0, b.total - (b.totalPaid ?? 0)), b.currency)}
                        </div>
                      )}
                    </div>
                    <StatusPill status={b.status?.toLowerCase()} small />
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NewPatientModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Patient) => void }) {
  const { ctx } = useApp();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    fullName: '', dob: '', gender: '', phone: '', email: '', tags: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Patient | null>(null);
  const { shakeProps, shake } = useShake();
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const handlePhoneChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 10);
    set('phone', digits);
  };
  const steps = ['Identity', 'Contact', 'Tags & Notes'];

  // Debounced duplicate-phone check on contact step. The `cancelled`
  // flag guards against the user typing "9876" → "98765" → "987654"
  // where the response for "98765" can arrive after "987654" and
  // overwrite the latest result. Without it, the duplicate banner
  // flickers in/out as old requests resolve.
  useEffect(() => {
    setDuplicate(null);
    if (step !== 1) return;
    const phone = form.phone.trim();
    if (!phone || phone.length < 6) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const hits = await apiGet<Patient[]>(ctx, `/patients?query=${encodeURIComponent(phone)}&limit=5`);
        if (cancelled) return;
        const match = hits.find((h) => (h.phones ?? []).some((p) => p.replace(/\s/g, '').includes(phone.replace(/\s/g, ''))));
        if (match) setDuplicate(match);
      } catch {
        // ignore
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [form.phone, step, ctx]);

  async function submit() {
    if (!form.fullName.trim()) { shake(); setError('Full name is required.'); return; }
    if (!form.phone.trim()) { shake(); setError('Phone number is required.'); return; }
    const phoneNormalized = normalizeIndianMobile(form.phone);
    if (!phoneNormalized) { shake(); setError('Enter a valid 10-digit Indian mobile number.'); return; }
    if (form.email.trim() && !isValidEmail(form.email)) { shake(); setError('Enter a valid email address.'); return; }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        fullName: form.fullName.trim(),
        // Always persist the canonical 10-digit form so duplicate
        // detection and normalisation on the BE see the same shape
        // regardless of how the operator typed it.
        phones: [phoneNormalized],
      };
      if (form.dob) body.dob = form.dob;
      if (form.gender) body.gender = form.gender.toUpperCase();
      if (form.phone.trim()) {
        const p = form.phone.trim();
        if (p.length !== 10) { shake(); setError('Phone number must be exactly 10 digits.'); setSaving(false); return; }
        body.phones = [p];
      }
      if (form.email.trim()) body.emails = [form.email.trim()];
      const tagList = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tagList.length) body.tags = tagList;
      if (form.notes.trim()) body.notes = form.notes.trim();
      const res = await apiPost<any>(ctx, '/patients', body);
      if (res.duplicateCandidate) {
        setDuplicate(res.existing?.[0] ?? null);
        setError('A similar patient already exists.');
        return;
      }
      onCreated(res.created);
    } catch (e) {
      shake();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)', animation: 'fadeIn 150ms ease-out' }} onClick={onClose}>
      <div {...shakeProps}
        style={{ background: 'var(--surface)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 480, overflow: 'visible', animation: 'slideUp 200ms ease-out', ...shakeProps.style }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>New patient</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>Step {step + 1} of {steps.length} — {steps[step]}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '12px 24px 0' }}>
          {steps.map((_, i) => <div key={i} style={{ height: 3, flex: 1, borderRadius: 2, background: i <= step ? 'var(--brand-500)' : 'var(--border)', transition: 'background 200ms' }} />)}
        </div>

        <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {step === 0 && (
            <>
              <Field label="Full name" value={form.fullName} onChange={(v) => set('fullName', v)} placeholder="e.g. Anjali Mehta" />
              <Field label="Date of birth" value={form.dob} onChange={(v) => set('dob', v)} placeholder="Enter date of birth" type="date" optional />
              <div>
                <label style={labelStyle}>
                  Gender
                  <span style={{ color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 4 }}>(optional)</span>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['MALE', 'FEMALE', 'OTHER'].map((g) => (
                    <button key={g} onClick={() => set('gender', g)}
                      style={{ flex: 1, padding: '8px 0', border: `1.5px solid ${form.gender === g ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 10, background: form.gender === g ? 'var(--brand-50)' : 'var(--surface-muted)', color: form.gender === g ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      {g[0] + g.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <Field label="Phone number" value={form.phone} onChange={handlePhoneChange} placeholder="98765 43210" prefix="+91" />
              {duplicate && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--warning-bg-soft)', border: '1px solid var(--warning-border-soft)', fontSize: 12, color: 'var(--warning-text)' }}>
                  <Icon name="alertTriangle" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>Possible duplicate</div>
                    <div style={{ marginTop: 2 }}>{duplicate.fullName} already has this phone. Open existing instead?</div>
                  </div>
                  <button onClick={() => { onCreated(duplicate); onClose(); }}
                    style={{ height: 28, padding: '0 10px', background: 'var(--surface)', border: '1px solid var(--warning-border-strong)', borderRadius: 7, fontSize: 11, fontWeight: 600, color: 'var(--warning-text)', cursor: 'pointer', flexShrink: 0 }}>
                    Open
                  </button>
                </div>
              )}
              <Field label="Email address" value={form.email} onChange={(v) => set('email', v)} placeholder="patient@email.com" optional />
            </>
          )}
          {step === 2 && (
            <>
              <Field label="Tags" value={form.tags} onChange={(v) => set('tags', v)} placeholder="Diabetic, Hypertensive (comma-separated)" optional />
              <div>
                <label style={labelStyle}>Notes <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>(optional)</span></label>
                <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Any relevant background or chief complaint…"
                  style={{ width: '100%', minHeight: 80, padding: '10px 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </>
          )}
          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10 }}>
          {step > 0 && (
            <button onClick={() => setStep((s) => s - 1)}
              style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
              Back
            </button>
          )}
          <button
            onClick={step < steps.length - 1 ? () => setStep((s) => s + 1) : submit}
            disabled={saving || (step === 0 && !form.fullName.trim())}
            style={{ flex: 2, height: 42, background: saving ? 'var(--brand-600)' : 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: (step === 0 && !form.fullName.trim()) ? 0.6 : 1 }}>
            {saving ? <Spinner /> : (step < steps.length - 1 ? <>Continue <Icon name="chevronRight" size={14} /></> : 'Register patient')}
          </button>
        </div>
      </div>
    </div>
  );
}
function EditPatientModal({ patient, onClose, onUpdated }: { patient: Patient; onClose: () => void; onUpdated: (p: Patient) => void }) {
  const { ctx } = useApp();
  const [form, setForm] = useState({
    fullName: patient.fullName,
    dob: patient.dob ? patient.dob.slice(0, 10) : '',
    gender: patient.gender ?? '',
    phone: patient.phones?.[0] ?? '',
    email: patient.emails?.[0] ?? '',
    tags: (patient.tags ?? []).join(', '),
    notes: patient.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { shakeProps, shake } = useShake();
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const handlePhoneChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 10);
    set('phone', digits);
  };

  async function submit() {
    if (!form.fullName.trim()) { shake(); setError('Full name is required.'); return; }
    if (!form.phone.trim()) { shake(); setError('Phone number is required.'); return; }
    const phoneNormalized = normalizeIndianMobile(form.phone);
    if (!phoneNormalized) { shake(); setError('Enter a valid 10-digit Indian mobile number.'); return; }
    if (form.email.trim() && !isValidEmail(form.email)) { shake(); setError('Enter a valid email address.'); return; }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { fullName: form.fullName.trim() };
      body.dob = form.dob || null;
      body.gender = form.gender ? form.gender.toUpperCase() : null;
      if (form.phone.trim()) {
        const p = form.phone.trim();
        if (p.length !== 10) { shake(); setError('Phone number must be exactly 10 digits.'); setSaving(false); return; }
        body.phones = [p];
      } else {
        body.phones = [];
      }
      body.emails = form.email.trim() ? [form.email.trim()] : [];
      body.tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
      body.notes = form.notes.trim() || null;

      const updated = await apiPatch<Patient>(ctx, `/patients/${patient._id}`, body);
      onUpdated(updated);
    } catch (e) {
      shake();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)', animation: 'fadeIn 150ms ease-out' }} onClick={onClose}>
      <div {...shakeProps}
        style={{ background: 'var(--surface)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 500, overflow: 'hidden', animation: 'slideUp 200ms ease-out', ...shakeProps.style }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Edit patient</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{patient.fullName} · {patientRef(patient)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px 280px', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '80vh', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <Field label="Full name" value={form.fullName} onChange={(v) => set('fullName', v)} />
            </div>
            <Field label="Date of birth" value={form.dob} onChange={(v) => set('dob', v)} placeholder="Enter date of birth" type="date" optional />
            <div>
              <label style={labelStyle}>
                Gender
                <span style={{ color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 4 }}>(optional)</span>
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {['MALE', 'FEMALE', 'OTHER'].map((g) => (
                  <button key={g} onClick={() => set('gender', g)}
                    style={{ flex: 1, height: 36, border: `1.5px solid ${form.gender === g ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 9, background: form.gender === g ? 'var(--brand-50)' : 'var(--surface-muted)', color: form.gender === g ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    {g[0] + g.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Phone number" value={form.phone} onChange={handlePhoneChange} prefix="+91" />
            <Field label="Email address" value={form.email} onChange={(v) => set('email', v)} />
            <div style={{ gridColumn: 'span 2' }}>
              <Field label="Tags" value={form.tags} onChange={(v) => set('tags', v)} placeholder="comma-separated" optional />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>
                Notes
                <span style={{ color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 4 }}>(optional)</span>
              </label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)}
                style={{ width: '100%', minHeight: 80, padding: '10px 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          </div>
          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10 }}>
          <button onClick={onClose}
            style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            style={{ flex: 2, height: 42, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {saving ? <Spinner /> : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
function BillSkeleton() {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton width="40%" height={12} />
        <Skeleton width="25%" height={10} />
      </div>
      <div style={{ width: 60, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <Skeleton width="100%" height={14} />
        <Skeleton width="70%" height={10} />
      </div>
      <Skeleton width={50} height={20} radius={100} />
    </div>
  );
}

/**
 * Visit-shaped timeline. Each visit is a single moment in the patient's
 * record where one or more of {appointment, encounter, bill} happened.
 *
 * Linkage rules:
 *   - Encounters link to appointments via `appointmentId`. Walk-in
 *     encounters (no appointment) get their own row.
 *   - Bills link to appointments first, then encounters, then stand alone
 *     when neither is present.
 *   - The visit's anchor date is the most clinically meaningful one we
 *     have: appointment.startAt > encounter.visitedAt > bill.issuedAt.
 */
type Visit = {
  key: string;
  date: string;
  appt?: Appointment;
  encounter?: Encounter;
  bill?: Bill;
};

function buildVisits(history: HistoryResponse): Visit[] {
  const byApptId = new Map<string, Visit>();
  const byEncounterId = new Map<string, Visit>();
  const out: Visit[] = [];

  function visitDate(v: Visit): string {
    return (
      v.appt?.startAt ??
      v.appt?.queueDate ??
      v.encounter?.visitedAt ??
      v.bill?.issuedAt ??
      v.bill?.createdAt ??
      new Date().toISOString()
    );
  }

  for (const a of history.appointments) {
    const v: Visit = { key: `appt:${a._id}`, date: a.startAt ?? a.queueDate ?? '', appt: a };
    byApptId.set(a._id, v);
    out.push(v);
  }
  for (const e of history.encounters) {
    if (e.appointmentId && byApptId.has(e.appointmentId)) {
      byApptId.get(e.appointmentId)!.encounter = e;
    } else {
      const v: Visit = { key: `enc:${e._id}`, date: e.visitedAt, encounter: e };
      byEncounterId.set(e._id, v);
      out.push(v);
    }
  }
  for (const b of history.bills) {
    let target: Visit | undefined;
    if (b.appointmentId && byApptId.has(b.appointmentId)) {
      target = byApptId.get(b.appointmentId);
    } else {
      // Try to attach to a same-day encounter if the bill has none of
      // the obvious links — common when billing is done after encounter
      // sign without storing the encounterId on the bill.
      const sameDayEncounter = history.encounters.find((e) => {
        const eDay = (e.visitedAt ?? '').slice(0, 10);
        const bDay = (b.issuedAt ?? b.createdAt ?? '').slice(0, 10);
        return eDay && bDay && eDay === bDay;
      });
      if (sameDayEncounter) {
        target = byApptId.get(sameDayEncounter.appointmentId ?? '') ?? byEncounterId.get(sameDayEncounter._id);
      }
    }
    if (target) {
      target.bill = b;
    } else {
      out.push({ key: `bill:${b._id}`, date: b.issuedAt ?? b.createdAt ?? '', bill: b });
    }
  }

  for (const v of out) v.date = visitDate(v);
  return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function PatientTimeline({ history }: { history: HistoryResponse }) {
  const visits = useMemo(() => buildVisits(history), [history]);

  if (visits.length === 0) {
    return (
      <EmptyState
        illustration="calendar"
        title="No clinical history yet"
        hint="Appointments, encounters, and bills will appear here as soon as the patient has any. Try the 'Book' button on the profile header to schedule their first visit."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, position: 'relative', paddingLeft: 18 }}>
      {/* The vertical rail behind the dots. */}
      <div style={{ position: 'absolute', left: 25, top: 12, bottom: 12, width: 2, background: 'var(--border)', borderRadius: 1 }} />
      {visits.map((v) => (
        <VisitCard key={v.key} visit={v} />
      ))}
    </div>
  );
}

function VisitCard({ visit }: { visit: Visit }) {
  const v = visit;
  const headlineDoctor = v.encounter?.doctorName ?? v.appt?.doctorName ?? null;
  const headlineBranch = v.encounter?.branchName ?? v.appt?.branchName ?? v.bill?.branchName ?? null;
  const dateObj = v.date ? new Date(v.date) : null;
  const validDate = dateObj && !Number.isNaN(dateObj.getTime()) ? dateObj : null;
  // Dot accent reflects the most-significant action that day.
  const accent = v.encounter
    ? 'var(--teal-500)'
    : v.appt
      ? 'var(--brand-500)'
      : 'var(--warning-500)';

  return (
    <div style={{ display: 'flex', gap: 16, position: 'relative' }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', background: accent, border: '4px solid var(--bg)', flexShrink: 0, marginTop: 4, zIndex: 1 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Day + time + doctor + branch — the "who/where/when" line. */}
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {validDate
            ? validDate.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
            : 'Date unknown'}
          {validDate && (
            <span style={{ fontWeight: 400, color: 'var(--text-subtle)', marginLeft: 8 }}>
              · {validDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 8 }}>
          {headlineDoctor ? <>with <b style={{ color: 'var(--text-muted)' }}>Dr. {headlineDoctor}</b></> : 'Doctor not recorded'}
          {headlineBranch && <> · {headlineBranch}</>}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {v.appt && <AppointmentRow appt={v.appt} />}
          {v.encounter && <EncounterRow encounter={v.encounter} />}
          {v.bill && <BillRow bill={v.bill} />}
          {!v.appt && !v.encounter && !v.bill && (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              Visit recorded but no detail available — check audit logs for what was deleted.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AppointmentRow({ appt }: { appt: Appointment }) {
  const isQueue = appt.type === 'QUEUE';
  const cancelled = appt.status === 'CANCELLED';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <Icon name="calendar" size={14} style={{ color: 'var(--brand-500)', marginTop: 3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            {isQueue ? `Queue token #${appt.queueNumber ?? '—'}` : 'Time appointment'}
          </span>
          <StatusPill status={appt.status.toLowerCase().replace(/_/g, '-')} small />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {appt.type === 'TIME' && appt.startAt && appt.endAt && (
            <>
              {new Date(appt.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              {' – '}
              {new Date(appt.endAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </>
          )}
          {appt.type === 'QUEUE' && appt.queueDate && <>For {appt.queueDate}</>}
        </div>
        {cancelled && appt.cancellationReason && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--danger-500)' }}>
            Cancelled — {appt.cancellationReason}
          </div>
        )}
      </div>
    </div>
  );
}

function EncounterRow({ encounter: e }: { encounter: Encounter }) {
  // Diagnosis can come from the legacy `diagnosis` string OR the typed
  // `diagnoses` array. We render whichever is present; if both are
  // there (transitional period), the typed array wins.
  const diagnosisItems: DiagnosisItem[] =
    Array.isArray(e.diagnoses) && e.diagnoses.length > 0
      ? e.diagnoses
      : e.diagnosis
        ? [{ description: e.diagnosis, primary: true }]
        : [];
  const vitalEntries = pickVitalEntries(e.vitals);
  const followUpDate = e.followUpAt ? new Date(e.followUpAt) : null;
  const isSigned = e.status === 'SIGNED';

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: 'var(--surface-muted)', borderRadius: 10, border: '1px solid var(--border)' }}>
      <Icon name="activity" size={14} style={{ color: 'var(--teal-500)', marginTop: 3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Clinical encounter</span>
          <span style={{ fontSize: 10, color: 'var(--text-subtle)', fontFamily: 'monospace' }}>#{e._id.slice(-8).toUpperCase()}</span>
          <StatusPill status={isSigned ? 'signed' : 'draft'} small />
          {isSigned && e.signedAt && (
            <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>
              · signed {new Date(e.signedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            </span>
          )}
        </div>

        {e.chiefComplaint && (
          <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 6, lineHeight: 1.5 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6 }}>Complaint</span>
            {e.chiefComplaint}
          </div>
        )}

        {diagnosisItems.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
              Diagnosis
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
              {diagnosisItems.map((d, i) => (
                <li key={i}>
                  {d.primary && <b>{d.description}</b>}
                  {!d.primary && d.description}
                  {d.code && <span style={{ color: 'var(--text-subtle)', fontFamily: 'monospace', marginLeft: 6 }}>({d.code})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {vitalEntries.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {vitalEntries.map(([label, value]) => (
              <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 100, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--text-subtle)' }}>{label}</span>
                <span style={{ color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
              </span>
            ))}
          </div>
        )}

        {followUpDate && !Number.isNaN(followUpDate.getTime()) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, fontSize: 11, color: 'var(--warning-text, var(--warning-500))', marginBottom: 6 }}>
            <Icon name="clock" size={11} />
            <span>
              Follow-up {followUpDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              {e.followUpNotes ? ` — ${e.followUpNotes}` : ''}
            </span>
          </div>
        )}

        {e.prescriptions && e.prescriptions.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            <Icon name="pill" size={11} style={{ color: 'var(--brand-500)' }} />
            {e.prescriptions.length === 1
              ? `1 prescription · ${e.prescriptions[0].itemCount} medicine${e.prescriptions[0].itemCount === 1 ? '' : 's'}`
              : `${e.prescriptions.length} prescriptions · ${e.prescriptions.reduce((s, r) => s + r.itemCount, 0)} medicines total`}
          </div>
        )}

        {e.notes && (
          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: 11, color: 'var(--text-subtle)', cursor: 'pointer' }}>Notes</summary>
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>
              {e.notes}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function BillRow({ bill }: { bill: Bill }) {
  const status = bill.status.toLowerCase();
  const isVoid = bill.status === 'VOID';
  const isPaid = bill.status === 'PAID' || (bill.outstanding === 0 && bill.totalPaid! > 0);
  const outstanding = bill.outstanding ?? Math.max(0, bill.total - (bill.totalPaid ?? 0));
  const currency = bill.currency ?? 'INR';
  const hasPayment = (bill.totalPaid ?? 0) > 0;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: `1px ${isVoid ? 'solid' : 'dashed'} ${isVoid ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`, borderRadius: 10, background: isVoid ? 'rgba(239,68,68,0.04)' : 'transparent' }}>
      <Icon name="receipt" size={14} style={{ color: isVoid ? 'var(--danger-500)' : isPaid ? 'var(--success-500)' : 'var(--warning-500)', marginTop: 3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>
            {bill.billNo ?? `#${bill._id.slice(-6)}`}
          </span>
          <StatusPill status={status} small />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)' }}>
            Total <b style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(bill.total, currency)}</b>
          </span>
          {hasPayment && (
            <span style={{ color: 'var(--success-500)' }}>
              Paid <b style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(bill.totalPaid ?? 0, currency)}</b>
            </span>
          )}
          {outstanding > 0 && !isVoid && (
            <span style={{ color: 'var(--danger-500)' }}>
              Outstanding <b style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(outstanding, currency)}</b>
            </span>
          )}
        </div>
        {isVoid && bill.voidReason && (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--danger-500)' }}>
            Voided{bill.voidedAt ? ` on ${new Date(bill.voidedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''} — {bill.voidReason}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Picks the typed-vitals entries we know how to render with units. Falls
 * back to a generic `key: value` rendering for any extra fields a clinic
 * has tucked in there. Keeps the chip strip readable rather than dumping
 * `{"bp":"120/80"}` raw.
 */
function pickVitalEntries(vitals: Record<string, unknown> | undefined): [string, string][] {
  if (!vitals || typeof vitals !== 'object') return [];
  const out: [string, string][] = [];
  const v = vitals as Record<string, unknown>;
  const num = (k: string): number | null => {
    const n = Number((v as any)[k]);
    return Number.isFinite(n) ? n : null;
  };
  // Typed shape from VitalsDto.
  const sys = num('bpSystolic');
  const dia = num('bpDiastolic');
  if (sys != null && dia != null) out.push(['BP', `${sys}/${dia}`]);
  const pulse = num('pulseBpm');
  if (pulse != null) out.push(['Pulse', `${pulse}/min`]);
  const temp = num('temperatureC');
  if (temp != null) out.push(['Temp', `${temp}°C`]);
  const spo2 = num('spo2');
  if (spo2 != null) out.push(['SpO₂', `${spo2}%`]);
  const rr = num('respiratoryRate');
  if (rr != null) out.push(['RR', `${rr}/min`]);
  const wt = num('weightKg');
  if (wt != null) out.push(['Wt', `${wt} kg`]);
  const ht = num('heightCm');
  if (ht != null) out.push(['Ht', `${ht} cm`]);
  // Legacy free-form fallback (pre-1.2 vitals object).
  if (out.length === 0) {
    for (const [k, val] of Object.entries(v)) {
      if (val == null || val === '') continue;
      out.push([k, String(val)]);
      if (out.length >= 6) break;
    }
  }
  return out;
}
