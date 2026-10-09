import { useEffect, useMemo, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPostMultipart, apiPostQueued } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { drawNumber } from '../../offline/leases';
import { useIsMobile } from '../../app/useIsMobile';
import { Perm, usePerm } from '../../app/permissions';
import { isValidEmail } from '../../app/validators';
import { countryForTimezone, dialCodeForTimezone, isValidPhoneForTimezone, normalizePhoneForTimezone } from '../../app/phone';
import { Avatar, EmptyState, Field, Spinner, StatusPill, formatDate, formatMoney, labelStyle, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';
import { AnimatedTabs } from '../shared/AnimatedTabs';
import { Skeleton, ListItemSkeleton } from '../shared/Skeleton';
import { useShake } from '../shared/useShake';
import { FaceScanModal } from '../shared/FaceScanModal';
import { DocumentsScreen } from './DocumentsScreen';

// Readable country label from an ISO 3166-1 alpha-2 code, e.g.
// "GB" → "United Kingdom (GB)". Uses the built-in Intl.DisplayNames
// (no extra dependency); falls back to the raw code if unavailable.
function countryLabel(code?: string): string {
  if (!code) return '—';
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

export type Patient = {
  _id: string;
  // MRN is auto-minted on registration (clinic-configurable format) and is
  // the human-readable identifier the front desk should reference. The raw
  // `_id` is an implementation detail — never surface it to operators.
  mrn?: string;
  fullName: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | string;
  dob?: string;
  phones?: string[];
  // ISO 3166-1 alpha-2 (e.g. "IN", "GB") — which country the patient is from.
  countryCode?: string;
  emails?: string[];
  tags?: string[];
  notes?: string;
  createdAt?: string;
  faceConsent?: boolean;
  faceConsentAt?: string;
  faceEnrolledAt?: string;
  // Presigned S3 URL (~15 min TTL) for the patient's profile photo —
  // captured during face enrollment. Backend mints this on GET
  // /patients/:id; the list endpoint doesn't include it. The Avatar
  // component falls back to initials when this is absent.
  profileImageUrl?: string;
};

// Single source of truth for patient-ref display. Prefer the MRN; fall
// back to a short tail of `_id` only when the MRN hasn't been minted (old
// rows from before MRN auto-gen, or tests).
export function patientRef(p: { mrn?: string; _id: string }): string {
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
  return '—';
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
  const { ctx, newPatientRequested, setNewPatientRequested } = useApp();
  const { has } = usePerm();
  const isMobile = useIsMobile();
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

  // Opened from the header "+ New" button: open the registration modal,
  // then clear the one-shot flag so it doesn't reopen on revisit.
  useEffect(() => {
    if (!newPatientRequested) return;
    if (canCreatePatient) setShowNew(true);
    setNewPatientRequested(false);
  }, [newPatientRequested, canCreatePatient, setNewPatientRequested]);

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
        if (!isMobile && data.length > 0 && !selected) setSelected(data[0]);
        if (selected && !data.some((p) => p._id === selected._id)) {
          setSelected(isMobile ? null : (data[0] ?? null));
        }
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

  const visibleItems = items;

  const groups = useMemo(() => alphaGroups(visibleItems), [visibleItems]);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left list — full-width on mobile, hidden once a patient is opened */}
      <div style={isMobile
        ? { width: '100%', flexShrink: 0, display: selected ? 'none' : 'flex', flexDirection: 'column', background: 'var(--surface)' }
        : { width: 320, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
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
        <div className="scroll-y" style={{ flex: 1 }}>
          {loading ? (
            <div>
              {Array.from({ length: 10 }).map((_, i) => <ListItemSkeleton key={i} />)}
            </div>
          ) : (
            <>
              {error && <div style={{ padding: 16, color: 'var(--danger-500)', fontSize: 12 }}>{error}</div>}
              {!error && visibleItems.length === 0 && (
                <EmptyState illustration="patients" title="No patients found" hint={query ? 'Try a different search.' : 'Register a new patient to get started.'} />
              )}
              {groups.map(([letter, patients]) => (
                <div key={letter}>
                  <div style={{ padding: '6px 14px 3px', fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', position: 'sticky', top: 0, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>{letter}</div>
                  {patients.map((p) => (
                    <div key={p._id} onClick={() => setSelected(p)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: selected?._id === p._id ? 'var(--brand-50)' : 'transparent', borderLeft: selected?._id === p._id ? '3px solid var(--brand-500)' : '3px solid transparent', transition: 'background 80ms' }}>
                      <Avatar name={p.fullName} size={32} imageUrl={p.profileImageUrl} />
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

      {/* Detail — on mobile it replaces the list (with a back button) */}
      {selected ? (
        <PatientDetail key={selected._id} patient={selected} onEdit={() => setEditing(selected)} onBack={isMobile ? () => setSelected(null) : undefined} />
      ) : (
        !isMobile && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <EmptyState illustration="patients" title="No patient selected" hint="Select a patient from the list on the left to view their profile, history, and billing." />
          </div>
        )
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

function PatientDetail({ patient, onEdit, onBack }: { patient: Patient; onEdit: () => void; onBack?: () => void }) {
  const { ctx, setScreen, setSelectedPatientId } = useApp();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<'overview' | 'history' | 'documents' | 'bills'>('overview');
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  // Fetch the full patient (including presigned profileImageUrl) on
  // mount and whenever the selected patient changes. The list endpoint
  // doesn't include `profileImageUrl` (we'd be presigning every row);
  // only `GET /patients/:id` mints it. `refreshTick` bumps when the
  // EditPatientModal saves a face — re-fetch so the avatar updates.
  const [full, setFull] = useState<Patient | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    apiGet<Patient>(ctx, `/patients/${patient._id}`)
      .then(setFull)
      .catch(() => setFull(null));
  }, [ctx, patient._id, refreshTick]);
  // Prefer the full doc; fall back to the lite list row while it loads.
  const view: Patient = full ?? patient;
  const refreshDetail = () => setRefreshTick((t) => t + 1);

  // EditPatientModal dispatches `patient:face-changed` after a face
  // enroll/remove so we re-fetch the patient (and thus the fresh
  // `profileImageUrl`) without prop drilling a callback through the
  // parent's modal mount.
  useEffect(() => {
    function onFaceChanged(e: Event) {
      const ce = e as CustomEvent<{ patientId: string }>;
      if (ce.detail?.patientId === patient._id) refreshDetail();
    }
    window.addEventListener('patient:face-changed', onFaceChanged);
    return () => window.removeEventListener('patient:face-changed', onFaceChanged);
  }, [patient._id]);

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
        {onBack && (
          <button onClick={onBack}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12, background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <Icon name="chevronLeft" size={14} /> Back
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <Avatar name={view.fullName} size={52} imageUrl={view.profileImageUrl} />
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
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, width: isMobile ? '100%' : undefined }}>
            <button onClick={onEdit}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, padding: '0 16px', flex: isMobile ? 1 : undefined, background: 'var(--surface-muted)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <Icon name="edit" size={14} /> Edit
            </button>
            <button onClick={bookForPatient}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, padding: '0 16px', flex: isMobile ? 1 : undefined, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
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
              { label: 'Country', value: countryLabel(patient.countryCode), icon: 'mapPin' as const },
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
  const { ctx, features } = useApp();
  // Dial code + phone validation follow the clinic's timezone (Settings).
  const dialCode = dialCodeForTimezone(ctx.timezone);
  const { has } = usePerm();
  const toast = useToast();
  // Face enrollment step shows only when (a) the clinic has face
  // recognition enabled in settings AND (b) the actor has face:enroll.
  // Document uploads have been moved out of registration — uploaded
  // later from the patient detail screen.
  const canEnrollFace = features.faceRecognition && has(Perm.FaceEnroll);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    firstName: '', lastName: '', dob: '', gender: '', phone: '', email: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Patient | null>(null);
  // After /patients POST succeeds we move to the face-enrollment step
  // with the new patient cached. The wizard stays open until the user
  // either scans + uploads OR clicks "Skip & finish."
  const [createdPatient, setCreatedPatient] = useState<Patient | null>(null);
  const [faceConsent, setFaceConsent] = useState(false);
  const [showFaceScanner, setShowFaceScanner] = useState(false);
  const [faceEnrolled, setFaceEnrolled] = useState(false);
  const { shakeProps, shake } = useShake();
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const handlePhoneChange = (v: string) => {
    // National numbers vary by country; cap at 15 (E.164 max) instead of
    // forcing India's 10. The dial code is shown separately as a prefix.
    const digits = v.replace(/\D/g, '').slice(0, 15);
    set('phone', digits);
  };
  const isContinueDisabled =
    (step === 0 && (!form.firstName.trim() || !form.lastName.trim() || !form.dob.trim() || !form.gender)) ||
    (step === 1 && !isValidPhoneForTimezone(form.phone, ctx.timezone));
  // 3-step wizard. Tags have been removed from the product entirely;
  // Notes were dropped from registration (the operator edits notes
  // from the patient detail screen if needed). Documents now upload
  // at check-in (TriageModal in AppointmentsScreen) since most
  // patients arrive with paperwork on the visit day, not at
  // registration time. Step 3 is face enrollment only — it still needs
  // the patient ID, so submit fires at the end of step 2 (Contact) and
  // the wizard advances with the freshly-created patient cached.
  const steps = ['Identity', 'Contact', 'Face enrollment'];

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
    if (!form.firstName.trim()) { shake(); setError('First name is required.'); return; }
    if (!form.lastName.trim()) { shake(); setError('Last name is required.'); return; }
    if (!form.dob.trim()) { shake(); setError('Date of birth is required.'); return; }
    if (!form.gender) { shake(); setError('Gender is required.'); return; }
    if (!form.phone.trim()) { shake(); setError('Phone number is required.'); return; }
    const phoneNormalized = normalizePhoneForTimezone(form.phone, ctx.timezone);
    if (!phoneNormalized) { shake(); setError('Enter a valid phone number.'); return; }
    if (form.email.trim() && !isValidEmail(form.email)) { shake(); setError('Enter a valid email address.'); return; }
    setSaving(true);
    setError(null);
    try {
      // Combine first + last for the BE — the Patient schema stores
      // a single `fullName` for backward compatibility with search,
      // duplicate detection, and PDF rendering.
      const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.replace(/\s+/g, ' ').trim();
      const body: Record<string, unknown> = {
        fullName,
        gender: form.gender.toUpperCase(),
        dob: form.dob,
        phones: [phoneNormalized],
        // Record the patient's country (ISO) from the clinic's location.
        countryCode: countryForTimezone(ctx.timezone),
      };
      if (form.email.trim()) body.emails = [form.email.trim()];
      // Survives the server being unreachable: the `_id` is minted here, the
      // write goes on the queue, and replay reconciles it later.
      // `mrnSeq` is drawn only if this actually queues — a drawn number is
      // spent whether or not it gets used, so we must not burn one on a
      // request that reached the server and had an MRN minted for it anyway.
      // The server renders the final MRN from this sequence, so what the
      // front desk reads out offline is what the record ends up with.
      let drawnMrn: string | null = null;
      const { data: res, queued } = await apiPostQueued<any>(ctx, '/patients', body, {
        label: `Patient — ${fullName}`,
        enrichOnQueue: async () => {
          const drawn = await drawNumber(ctx.clinicId, 'MRN');
          if (!drawn.ok) return {};
          drawnMrn = drawn.value;
          return { mrnSeq: drawn.seq };
        },
      });

      if (queued) {
        // Offline, the response is the record we just built rather than the
        // server's `{ duplicateCandidate, created }` envelope.
        //
        // Duplicate detection genuinely cannot run here — it is a server-side
        // query — so a double registration can only be caught on sync.
        //
        // The MRN comes from this device's leased block (C2/C4). If no block
        // is available the patient is still registered; the server assigns an
        // MRN when the create replays.
        const offlinePatient = drawnMrn
          ? { ...(res as Record<string, unknown>), mrn: drawnMrn }
          : (res as Record<string, unknown>);

        // Face enrollment and document upload both need the network, so we
        // skip step 2 rather than offering buttons that will fail.
        onCreated(offlinePatient as Patient);
        toast(
          drawnMrn
            ? `Saved on this device as ${drawnMrn}. It will sync when you reconnect.`
            : 'Saved on this device. A patient number will be assigned when you reconnect.',
          'success',
        );
        onClose();
        return;
      }

      if (res.duplicateCandidate) {
        setDuplicate(res.existing?.[0] ?? null);
        setError('A similar patient already exists.');
        return;
      }
      // Always advance to step 3 with the newly created patient so
      // the operator can attach documents and/or run face enrollment.
      // The step-3 footer offers a one-click "Finish" if they want to
      // skip both.
      setCreatedPatient(res.created);
      setStep(2);
    } catch (e) {
      shake();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleFaceCapture(blob: Blob, opts?: { preDetected?: boolean }) {
    if (!createdPatient) return;
    // Two-step: PATCH consent first (BE refuses /face without it),
    // then POST the image. If anything fails, the patient is already
    // saved — the front desk can enroll later from the patient detail.
    const form = new FormData();
    form.append('image', blob, 'enroll.jpg');
    if (opts?.preDetected) form.append('pre_detected', 'true');
    try {
      if (!createdPatient.faceConsent) {
        await apiPatch(ctx, `/patients/${createdPatient._id}`, { faceConsent: true });
      }
      await apiPostMultipart(ctx, `/patients/${createdPatient._id}/face`, form);
      setShowFaceScanner(false);
      setFaceEnrolled(true);
      toast('Face enrolled', 'success');
      // If the user opens this patient's detail next, the avatar should
      // already show their photo (PatientDetail listens for this event).
      window.dispatchEvent(new CustomEvent('patient:face-changed', { detail: { patientId: createdPatient._id } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Throw so FaceScanModal renders the error inline; the modal
      // stays open and the operator can retry without re-typing
      // anything.
      throw new Error(msg);
    }
  }

  function finishWithoutFace() {
    if (createdPatient) onCreated(createdPatient);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)', animation: 'fadeIn 150ms ease-out' }} onClick={onClose}>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="First name" value={form.firstName} onChange={(v) => set('firstName', v)} placeholder="e.g. Anjali" />
                <Field label="Last name" value={form.lastName} onChange={(v) => set('lastName', v)} placeholder="e.g. Mehta" />
              </div>
              <Field label="Date of birth" value={form.dob} onChange={(v) => set('dob', v)} placeholder="Enter date of birth" type="date" />
              <div>
                <label style={labelStyle}>
                  Gender
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['MALE', 'FEMALE'].map((g) => (
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
              <Field label="Phone number" value={form.phone} onChange={handlePhoneChange} placeholder="Mobile number" prefix={dialCode} />
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
          {step === 2 && createdPatient && (
            <>
              {/* Face card — only when the clinic has face recognition
                  enabled and the actor has face:enroll. Documents have
                  moved to check-in (TriageModal in Appointments). */}
              {canEnrollFace && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 0 4px' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--brand-50)', border: '1px solid var(--brand-100)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={faceEnrolled ? 'checkCircle' : 'camera'} size={22} style={{ color: faceEnrolled ? 'var(--success-500)' : 'var(--brand-500)' }} />
                    </div>
                    <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                      {faceEnrolled ? 'Face enrolled' : 'Face recognition (optional)'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center', padding: '0 8px' }}>
                      {faceEnrolled
                        ? 'On future visits the front desk can scan instead of typing.'
                        : 'We\'ll take one photo to enable face matching at future check-ins.'}
                    </div>
                  </div>

                  {!faceEnrolled && (
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={faceConsent} onChange={(e) => setFaceConsent(e.target.checked)}
                        style={{ marginTop: 2, accentColor: 'var(--brand-500)' }} />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                        Patient consents to face enrollment for identification. The biometric template is stored for this clinic only and can be removed on request.
                      </span>
                    </label>
                  )}
                </div>
              )}
            </>
          )}
          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10 }}>
          {step === 2 ? (
            // Step 3 (index 2) footer — patient is already saved.
            // Controls gate the optional extras: docs are uploaded
            // inside the embedded DocumentsScreen card; face flow
            // shows scan / skip controls until enrolled.
            <>
              {canEnrollFace && !faceEnrolled ? (
                <>
                  <button onClick={finishWithoutFace}
                    style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
                    Skip & finish
                  </button>
                  <button onClick={() => setShowFaceScanner(true)} disabled={!faceConsent}
                    style={{
                      flex: 2, height: 42, border: 'none', borderRadius: 10,
                      background: faceConsent ? 'var(--brand-500)' : 'rgba(99,102,241,0.4)',
                      color: 'var(--brand-text)', fontSize: 14, fontWeight: 600,
                      cursor: faceConsent ? 'pointer' : 'not-allowed',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                    <Icon name="camera" size={14} strokeWidth={2.5} />
                    Scan face
                  </button>
                </>
              ) : (
                <button onClick={finishWithoutFace}
                  style={{ flex: 1, height: 42, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Icon name="check" size={14} strokeWidth={2.5} /> Finish
                </button>
              )}
            </>
          ) : (
            <>
              {step > 0 && (
                <button onClick={() => setStep((s) => s - 1)}
                  style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
                  Back
                </button>
              )}
              <button
                // Steps 0 and 1 are pre-submit. Step 0 → advance to 1.
                // Step 1 (Contact) → submit, which creates the patient
                // and advances to step 2 (Documents & Face).
                onClick={step < 1 ? () => setStep((s) => s + 1) : submit}
                disabled={saving || isContinueDisabled}
                style={{ flex: 2, height: 42, background: saving ? 'var(--brand-600)' : 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: saving ? 'wait' : (isContinueDisabled ? 'not-allowed' : 'pointer'), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: isContinueDisabled ? 0.6 : 1 }}>
                {saving ? <Spinner /> : (step < 1 ? <>Continue <Icon name="chevronRight" size={14} /></> : 'Register patient')}
              </button>
            </>
          )}
        </div>
      </div>

      {showFaceScanner && (
        <FaceScanModal
          title="Enroll face"
          hint="Look at the camera. Make sure the face is well-lit and centered."
          captureLabel="Capture & enroll"
          onCancel={() => setShowFaceScanner(false)}
          onCapture={handleFaceCapture}
        />
      )}
    </div>
  );
}
export function EditPatientModal({ patient, onClose, onUpdated }: { patient: Patient; onClose: () => void; onUpdated: (p: Patient) => void }) {
  const { ctx, features } = useApp();
  const isMobile = useIsMobile();
  // Dial code + phone validation follow the clinic's timezone (Settings).
  const dialCode = dialCodeForTimezone(ctx.timezone);
  const { has } = usePerm();
  const toast = useToast();
  const canEnrollFace = features.faceRecognition && has(Perm.FaceEnroll);
  const [form, setForm] = useState({
    fullName: patient.fullName,
    dob: patient.dob ? patient.dob.slice(0, 10) : '',
    gender: patient.gender ?? '',
    phone: patient.phones?.[0] ?? '',
    email: patient.emails?.[0] ?? '',
    notes: patient.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { shakeProps, shake } = useShake();
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const handlePhoneChange = (v: string) => {
    // National numbers vary by country; cap at 15 (E.164 max) instead of
    // forcing India's 10. The dial code is shown separately as a prefix.
    const digits = v.replace(/\D/g, '').slice(0, 15);
    set('phone', digits);
  };

  // ---- Face enrollment state (mirrors NewPatientModal) ----
  const [faceConsent, setFaceConsent] = useState(!!patient.faceConsent);
  const [showFaceScanner, setShowFaceScanner] = useState(false);
  const [faceEnrolledNow, setFaceEnrolledNow] = useState(false);
  const wasEnrolledBefore = !!patient.faceEnrolledAt;

  async function handleFaceCapture(blob: Blob, opts?: { preDetected?: boolean }) {
    const fd = new FormData();
    fd.append('image', blob, 'enroll.jpg');
    if (opts?.preDetected) fd.append('pre_detected', 'true');
    try {
      if (!patient.faceConsent && !faceConsent) {
        throw new Error('Patient consent is required before enrollment.');
      }
      if (!patient.faceConsent && faceConsent) {
        await apiPatch(ctx, `/patients/${patient._id}`, { faceConsent: true });
      }
      await apiPostMultipart(ctx, `/patients/${patient._id}/face`, fd);
      setShowFaceScanner(false);
      setFaceEnrolledNow(true);
      toast('Face enrolled', 'success');
      // Tell PatientDetail to re-fetch so the freshly-saved
      // profile image (presigned URL from GET /patients/:id) flows
      // through to the Avatar.
      window.dispatchEvent(new CustomEvent('patient:face-changed', { detail: { patientId: patient._id } }));
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  async function removeFaceEnrollment() {
    if (!window.confirm('Remove this patient\'s face enrollment? They will need to re-enroll before face scanning works again.')) return;
    try {
      await apiDelete(ctx, `/patients/${patient._id}/face`);
      setFaceEnrolledNow(false);
      toast('Face enrollment removed', 'success');
      // Patch the local patient ref so the badge reflects reality
      // without needing the parent to re-fetch.
      (patient as Patient).faceEnrolledAt = undefined;
      // Avatar in PatientDetail also needs to revert from photo to
      // initials — refresh it.
      window.dispatchEvent(new CustomEvent('patient:face-changed', { detail: { patientId: patient._id } }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  async function submit() {
    if (!form.fullName.trim()) { shake(); setError('Full name is required.'); return; }
    if (!form.phone.trim()) { shake(); setError('Phone number is required.'); return; }
    const phoneNormalized = normalizePhoneForTimezone(form.phone, ctx.timezone);
    if (!phoneNormalized) { shake(); setError('Enter a valid phone number.'); return; }
    if (form.email.trim() && !isValidEmail(form.email)) { shake(); setError('Enter a valid email address.'); return; }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { fullName: form.fullName.trim() };
      body.dob = form.dob || null;
      body.gender = form.gender ? form.gender.toUpperCase() : null;
      body.phones = [phoneNormalized];
      body.countryCode = countryForTimezone(ctx.timezone);
      body.emails = form.email.trim() ? [form.email.trim()] : [];
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)', animation: 'fadeIn 150ms ease-out' }} onClick={onClose}>
      <div {...shakeProps}
        style={{ background: 'var(--surface)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 500, maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slideUp 200ms ease-out', ...shakeProps.style }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Edit patient</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{patient.fullName} · {patientRef(patient)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ padding: isMobile ? '20px 16px 24px' : '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            <div style={{ gridColumn: isMobile ? 'auto' : 'span 2' }}>
              <Field label="Full name" value={form.fullName} onChange={(v) => set('fullName', v)} />
            </div>
            <Field label="Date of birth" value={form.dob} onChange={(v) => set('dob', v)} placeholder="Enter date of birth" type="date" optional />
            <div>
              <label style={labelStyle}>
                Gender
                <span style={{ color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 4 }}>(optional)</span>
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {['MALE', 'FEMALE'].map((g) => (
                  <button key={g} onClick={() => set('gender', g)}
                    style={{ flex: 1, height: 36, border: `1.5px solid ${form.gender === g ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 9, background: form.gender === g ? 'var(--brand-50)' : 'var(--surface-muted)', color: form.gender === g ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    {g[0] + g.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Phone number" value={form.phone} onChange={handlePhoneChange} prefix={dialCode} />
            <Field label="Email address" value={form.email} onChange={(v) => set('email', v)} />
            <div style={{ gridColumn: isMobile ? 'auto' : 'span 2' }}>
              <label style={labelStyle}>
                Notes
                <span style={{ color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 4 }}>(optional)</span>
              </label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)}
                style={{ width: '100%', minHeight: 80, padding: '10px 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Face enrollment — runs independently of the form save.
              Captures commit straight to /patients/:id/face the moment
              the operator finishes a shot. Hidden when the clinic
              hasn't enabled face recognition or the actor lacks the
              face:enroll permission. */}
          {canEnrollFace && (
            <div style={{ paddingTop: 16, marginTop: 4, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--brand-50)', border: '1px solid var(--brand-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon
                    name={(faceEnrolledNow || wasEnrolledBefore) ? 'checkCircle' : 'camera'}
                    size={18}
                    style={{ color: (faceEnrolledNow || wasEnrolledBefore) ? 'var(--success-500)' : 'var(--brand-500)' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    Face recognition
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>
                    {faceEnrolledNow
                      ? 'Re-enrolled with a fresh photo.'
                      : wasEnrolledBefore
                        ? 'Already enrolled. Re-enroll to refresh the photo (e.g. patient looks very different).'
                        : 'Not enrolled yet. Capture a photo so the front desk can scan the patient on future visits.'}
                  </div>
                </div>
                {(wasEnrolledBefore || faceEnrolledNow) && (
                  <button type="button" onClick={() => void removeFaceEnrollment()}
                    style={{ height: 30, padding: '0 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11, fontWeight: 600, color: 'var(--danger-500)', cursor: 'pointer' }}>
                    Remove
                  </button>
                )}
              </div>

              {/* Consent — only ask when not already on file */}
              {!patient.faceConsent && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={faceConsent} onChange={(e) => setFaceConsent(e.target.checked)}
                    style={{ marginTop: 2, accentColor: 'var(--brand-500)' }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                    Patient consents to face enrollment for identification. The biometric template is stored for this clinic only and can be removed on request.
                  </span>
                </label>
              )}

              <button type="button"
                onClick={() => { setError(null); setShowFaceScanner(true); }}
                disabled={!faceConsent}
                style={{
                  alignSelf: 'flex-start',
                  height: 36, padding: '0 14px', borderRadius: 8, border: 'none',
                  background: faceConsent ? 'var(--brand-500)' : 'rgba(99,102,241,0.4)',
                  color: 'var(--brand-text)', fontSize: 12, fontWeight: 600,
                  cursor: faceConsent ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                <Icon name="camera" size={13} strokeWidth={2.5} />
                {wasEnrolledBefore || faceEnrolledNow ? 'Re-enroll face' : 'Scan face'}
              </button>
            </div>
          )}

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '12px 24px 20px', display: 'flex', gap: 10, flexShrink: 0, borderTop: '1px solid var(--border)' }}>
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

      {showFaceScanner && (
        <FaceScanModal
          title={wasEnrolledBefore ? 'Re-enroll face' : 'Enroll face'}
          hint="Look at the camera. Well-lit, face centered, no mask."
          captureLabel="Capture & enroll"
          onCancel={() => setShowFaceScanner(false)}
          onCapture={handleFaceCapture}
        />
      )}
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
  const isMobile = useIsMobile();
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, position: 'relative', paddingLeft: isMobile ? 2 : 18 }}>
      {/* The vertical rail behind the dots. */}
      <div style={{ position: 'absolute', left: isMobile ? 9 : 25, top: 12, bottom: 12, width: 2, background: 'var(--border)', borderRadius: 1 }} />
      {visits.map((v) => (
        <VisitCard key={v.key} visit={v} isMobile={isMobile} />
      ))}
    </div>
  );
}

function VisitCard({ visit, isMobile }: { visit: Visit; isMobile?: boolean }) {
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
    <div style={{ display: 'flex', gap: isMobile ? 10 : 16, position: 'relative' }}>
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
  const { setScreen, setSelectedAppointmentId } = useApp();
  const isQueue = appt.type === 'QUEUE';
  const cancelled = appt.status === 'CANCELLED';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <Icon name="calendar" size={14} style={{ color: 'var(--brand-500)', marginTop: 3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              {isQueue ? `Queue token #${appt.queueNumber ?? '—'}` : 'Time appointment'}
            </span>
            <StatusPill status={appt.status.toLowerCase().replace(/_/g, '-')} small />
          </div>
          {!cancelled && (
            <button
              onClick={() => {
                setSelectedAppointmentId(appt._id);
                setScreen('encounters');
              }}
              className="press-scale"
              style={{
                height: 24, padding: '0 8px', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 6,
                color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
              }}
            >
              <Icon name="stethoscope" size={11} /> Prescribe
            </button>
          )}
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
  const { setScreen, setSelectedEncounterId } = useApp();
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Clinical encounter</span>
            <span style={{ fontSize: 10, color: 'var(--text-subtle)', fontFamily: 'monospace' }}>#{e._id.slice(-8).toUpperCase()}</span>
            <StatusPill status={isSigned ? 'signed' : 'draft'} small />
            {isSigned && e.signedAt && (
              <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>
                · signed {new Date(e.signedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
              </span>
            )}
          </div>
          <button
            onClick={() => {
              setSelectedEncounterId(e._id);
              setScreen('encounters');
            }}
            className="press-scale"
            style={{
              height: 24, padding: '0 8px', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
            }}
          >
            <Icon name="edit" size={11} /> Open
          </button>
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
