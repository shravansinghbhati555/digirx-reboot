import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiGet, apiPatch, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Avatar, Spinner, StatusPill, useToast } from '../shared/primitives';
import { Icon, type IconName } from '../shared/Icon';

type Encounter = {
  _id: string;
  patientId: string | { _id: string; fullName: string; mrn?: string };
  doctorId: string;
  branchId: string;
  status: 'DRAFT' | 'SIGNED';
  chiefComplaint?: string;
  notes?: string;
  diagnosis?: string;
  vitals?: Record<string, string>;
  followUpAt?: string;
  visitedAt: string;
  signedAt?: string;
  signedByUserId?: string;
  updatedAt?: string;
  readableId?: string;
};

type Patient = { _id: string; mrn?: string; fullName: string; gender?: string; dob?: string; phones?: string[]; tags?: string[] };

type RxItem = { id: number; med: string; dose: string; freq: string; dur: string; note: string };

const VITAL_FIELDS: { key: string; label: string; unit: string }[] = [
  { key: 'bp',     label: 'BP',     unit: 'mmHg' },
  { key: 'spo2',   label: 'SpO2',   unit: '%' },
  { key: 'temp',   label: 'Temp',   unit: '°F' },
  { key: 'pulse',  label: 'Pulse',  unit: 'bpm' },
  { key: 'rr',     label: 'RR',     unit: '/min' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
];

function getAge(dob?: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const md = now.getMonth() - d.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function genderWord(g?: string): string {
  const u = (g ?? '').toUpperCase();
  if (u === 'MALE') return 'Male';
  if (u === 'FEMALE') return 'Female';
  if (u === 'OTHER') return 'Other';
  return '';
}

export function EncounterScreen() {
  const { ctx, selectedAppointmentId, setSelectedAppointmentId, setScreen } = useApp();
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState(ctx.userId);
  const [encounterId, setEncounterId] = useState<string | undefined>();
  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [recent, setRecent] = useState<(Encounter & { patientId: { fullName: string; mrn?: string } })[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [recentQuery, setRecentQuery] = useState('');

  // Patient search (only used while no patient is selected)
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);

  // Doctor display (locked to current user — backend has no /users list endpoint yet)
  const doctorName = (ctx.fullName ?? '').toLowerCase().startsWith('dr.') ? ctx.fullName : (ctx.fullName ? `Dr. ${ctx.fullName}` : 'Doctor');
  const doctorSubtitle = ctx.email ?? `User #${doctorId.slice(-8).toUpperCase()}`;

  // If we arrived from an appointment, pre-load the appointment to get patient/doctor
  useEffect(() => {
    if (!selectedAppointmentId) return;
    apiGet<{ patientId: string; doctorId: string }>(ctx, `/appointments/${selectedAppointmentId}`)
      .then((appt) => {
        setPatientId(appt.patientId);
        setDoctorId(appt.doctorId);
      })
      .catch(() => undefined);

    // Also check if an encounter already exists for this appointment
    apiGet<Encounter | null>(ctx, `/encounters/by-appointment/${selectedAppointmentId}`)
      .then((enc) => {
        if (enc) {
          setEncounter(enc);
          setEncounterId(enc._id);
          const pid = typeof enc.patientId === 'object' ? enc.patientId._id : enc.patientId;
          setPatientId(pid);
        }
      })
      .catch(() => undefined);
  }, [selectedAppointmentId, ctx]);

  useEffect(() => {
    if (encounter) return;
    setLoadingRecent(true);
    apiGet<(Encounter & { patientId: { fullName: string; mrn?: string } })[]>(ctx, '/encounters?limit=50')
      .then(setRecent)
      .catch(() => setRecent([]))
      .finally(() => setLoadingRecent(false));
  }, [encounter, ctx]);

  useEffect(() => {
    if (!patientId.trim()) { setPatient(null); return; }
    apiGet<Patient>(ctx, `/patients/${patientId.trim()}`).then(setPatient).catch(() => setPatient(null));
  }, [patientId, ctx]);

  // Debounced search
  useEffect(() => {
    if (patient) { setPatientResults([]); return; } // already chosen
    if (!patientQuery.trim()) { setPatientResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ query: patientQuery.trim(), limit: '10' });
      apiGet<Patient[]>(ctx, `/patients?${qs.toString()}`)
        .then(setPatientResults)
        .catch(() => setPatientResults([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(t);
  }, [patientQuery, patient, ctx]);

  function pickPatient(p: Patient) {
    setPatientId(p._id);
    setPatient(p);
    setPatientQuery('');
    setPatientResults([]);
  }

  function clearPatient() {
    setPatientId('');
    setPatient(null);
  }

  async function loadEncounter(id: string) {
    setError(null);
    try {
      const enc = await apiGet<Encounter>(ctx, `/encounters/${id}`);
      setEncounter(enc);
      setEncounterId(enc._id);
      const pid = typeof enc.patientId === 'object' ? enc.patientId._id : enc.patientId;
      setPatientId(pid);
      setDoctorId(enc.doctorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function startEncounter() {
    if (!ctx.branchId) { setError('Sign in to a branch first.'); return; }
    if (!patientId.trim() || !doctorId.trim()) { setError('Patient and doctor are required.'); return; }
    setCreating(true);
    setError(null);
    try {
      const created = await apiPost<Encounter>(ctx, '/encounters', {
        branchId: ctx.branchId,
        doctorId: doctorId.trim(),
        patientId: patientId.trim(),
        appointmentId: selectedAppointmentId || undefined,
        visitedAt: new Date().toISOString(),
      });
      setEncounter(created);
      setEncounterId(created._id);
      const pid = typeof created.patientId === 'object' ? created.patientId._id : created.patientId;
      setPatientId(pid);
      setSelectedAppointmentId(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  if (!encounter) {
    const age = getAge(patient?.dob);
    const gw = genderWord(patient?.gender);
    const phone = patient?.phones?.[0];
    const meta = [gw, age != null ? `${age}y` : null, phone].filter(Boolean).join(' · ');

    const filteredRecent = recent.filter(r => {
      const q = recentQuery.toLowerCase().trim();
      if (!q) return true;
      const rId = (r.readableId ?? `#${r._id.slice(-8).toUpperCase()}`).toLowerCase();
      const patientName = typeof r.patientId === 'object' ? r.patientId.fullName : '';
      return (
        rId.includes(q) ||
        patientName.toLowerCase().includes(q) ||
        (typeof r.patientId === 'object' && (r.patientId.mrn ?? '').toLowerCase().includes(q)) ||
        r.status.toLowerCase().includes(q)
      );
    });

    return (
      <div style={{ padding: '32px 32px', maxWidth: 1080, height: '100%', overflowY: 'auto' }}>
        <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>Encounter</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Start a new clinical session or continue a recent one.</p>

        <div style={{ display: 'flex', gap: 32, marginTop: 24, alignItems: 'flex-start' }}>
          {/* Left Side: Start New */}
          <div style={{ flex: 1, minWidth: 380, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: -4 }}>Start session</div>
            
            {/* Patient picker */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Patient</label>
              {patient ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--brand-50)', border: '1.5px solid var(--brand-100)', borderRadius: 12 }}>
                  <Avatar name={patient.fullName} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand-700)' }}>{patient.fullName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{meta || 'No details on file'}</div>
                  </div>
                  <button onClick={clearPatient}
                    style={{ background: 'none', border: 'none', color: 'var(--brand-600)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '4px 8px' }}>
                    Change
                  </button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'relative' }}>
                    <Icon name="search" size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                    <input value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)}
                      placeholder="Search by name or phone…"
                      style={{
                        width: '100%', height: 44, padding: '0 14px 0 40px',
                        background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 12,
                        fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  {patientQuery.trim() && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 6, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)', boxShadow: 'var(--e3)', maxHeight: 280, overflowY: 'auto' }}>
                      {searching && <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--text-subtle)' }}>Searching…</div>}
                      {!searching && patientResults.length === 0 && <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--text-subtle)' }}>No patients match.</div>}
                      {patientResults.map((p) => (
                        <button key={p._id} onClick={() => pickPatient(p)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                          <Avatar name={p.fullName} size={32} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.fullName}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{p.mrn ?? `#${p._id.slice(-6)}`}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Doctor */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Doctor</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 12 }}>
                <Avatar name={doctorName} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{doctorName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{doctorSubtitle}</div>
                </div>
              </div>
            </div>

            {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button onClick={startEncounter} disabled={creating || !patient}
                style={{
                  flex: 2, height: 44, border: 'none', borderRadius: 12,
                  background: (creating || !patient) ? 'rgba(99,102,241,0.4)' : 'var(--brand-500)',
                  color: 'var(--brand-text)', fontSize: 14, fontWeight: 600,
                  cursor: creating ? 'wait' : (!patient ? 'not-allowed' : 'pointer'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                {creating ? <Spinner /> : <><Icon name="plus" size={16} strokeWidth={2.5} /> Start encounter</>}
              </button>
              <button onClick={() => setScreen('appointments')}
                style={{ flex: 1, height: 44, background: 'none', border: '1.5px solid var(--border)', borderRadius: 12, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
                Back
              </button>
            </div>
          </div>

          {/* Right Side: Recent/Search */}
          <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, display: 'flex', flexDirection: 'column', height: 500 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Recent encounters</div>
                <div style={{ position: 'relative', width: 220 }}>
                  <Icon name="search" size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                  <input value={recentQuery} onChange={(e) => setRecentQuery(e.target.value)}
                    placeholder="Search recent…"
                    style={{
                      width: '100%', height: 32, padding: '0 10px 0 30px',
                      background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8,
                      fontSize: 12, color: 'var(--text)', outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                {loadingRecent ? (
                  <div style={{ padding: 40, textAlign: 'center' }}><Spinner /></div>
                ) : filteredRecent.length === 0 ? (
                  <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
                    {recentQuery ? 'No matching encounters found.' : 'No recent encounters yet.'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {filteredRecent.map((r) => (
                      <button key={r._id} onClick={() => loadEncounter(r._id)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                          textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 10,
                          transition: 'background 100ms'
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-muted)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                          <Avatar name={typeof r.patientId === 'object' ? r.patientId.fullName : '?'} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                              {typeof r.patientId === 'object' ? r.patientId.fullName : (typeof r.patientId === 'string' ? `#${r.patientId.slice(-6)}` : '—')}
                            </span>
                            <StatusPill status={r.status.toLowerCase()} small />
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                            <code style={{ fontFamily: 'monospace', color: 'var(--brand-600)' }}>
                              {r.readableId ?? `#${r._id.slice(-8).toUpperCase()}`}
                            </code>
                            {' · '}
                            {new Date(r.visitedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <Icon name="chevronRight" size={14} style={{ color: 'var(--text-subtle)' }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            <div style={{ padding: '0 8px', fontSize: 11, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="info" size={12} />
              Showing up to 50 most recent sessions from all branches.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <EncounterEditor encounter={encounter} patient={patient} onChanged={setEncounter} onClose={() => { setEncounter(null); setEncounterId(undefined); }} />;
}

function EncounterEditor({
  encounter, patient, onChanged, onClose,
}: {
  encounter: Encounter; patient: Patient | null; onChanged: (e: Encounter) => void; onClose: () => void;
}) {
  const { ctx } = useApp();
  const toast = useToast();
  const signed = encounter.status === 'SIGNED';

  const [vitals, setVitals] = useState<Record<string, string>>(() => ({
    bp: '', spo2: '', temp: '', pulse: '', rr: '', weight: '',
    ...(encounter.vitals as Record<string, string> | undefined),
  }));
  const [complaint, setComplaint] = useState(encounter.chiefComplaint ?? '');
  const [diagnosis, setDiagnosis] = useState(encounter.diagnosis ?? '');
  const [notes, setNotes] = useState(encounter.notes ?? '');
  const [followUp, setFollowUp] = useState(encounter.followUpAt ? encounter.followUpAt.slice(0, 10) : '');
  const [diagInput, setDiagInput] = useState('');
  const diags = diagnosis.split('|').map((s) => s.trim()).filter(Boolean);
  const [rx, setRx] = useState<RxItem[]>([{ id: 1, med: '', dose: '', freq: '', dur: '', note: '' }]);
  const nextRxId = useRef(2);
  const [savingDraft, setSavingDraft] = useState(false);
  const [showSign, setShowSign] = useState(false);
  const [signing, setSigning] = useState(false);
  const [justSigned, setJustSigned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingRx, setLoadingRx] = useState(false);

  useEffect(() => {
    if (!encounter._id) return;
    setLoadingRx(true);
    apiGet<any[]>(ctx, `/encounters/${encounter._id}/prescriptions`)
      .then((data) => {
        if (data && data.length > 0) {
          const firstRx = data[0];
          if (firstRx.items && firstRx.items.length > 0) {
            const mapped = firstRx.items.map((it: any, i: number) => ({
              id: i + 1,
              med: it.customName || it.medicineCatalogItemId || 'Medicine',
              dose: it.dosage || '',
              freq: it.frequency || '',
              dur: it.duration || '',
              note: it.instructions || '',
            }));
            setRx(mapped);
            nextRxId.current = mapped.length + 1;
          }
        }
      })
      .catch(() => undefined)
      .finally(() => setLoadingRx(false));
  }, [encounter._id, ctx]);

  function addDiag() {
    const v = diagInput.trim();
    if (!v) return;
    setDiagnosis((d) => (d ? d + ' | ' + v : v));
    setDiagInput('');
  }

  function removeDiag(idx: number) {
    setDiagnosis(diags.filter((_, i) => i !== idx).join(' | '));
  }

  async function saveDraft() {
    if (signed) return;
    setSavingDraft(true); setError(null);
    try {
      const cleanVitals: Record<string, string> = {};
      Object.entries(vitals).forEach(([k, v]) => { if (v) cleanVitals[k] = v; });
      const updated = await apiPatch<Encounter>(ctx, `/encounters/${encounter._id}`, {
        chiefComplaint: complaint || undefined,
        diagnosis: diagnosis || undefined,
        notes: notes || undefined,
        vitals: Object.keys(cleanVitals).length ? cleanVitals : undefined,
        followUpAt: followUp ? new Date(followUp).toISOString() : undefined,
      });
      onChanged(updated);
      toast('Draft saved', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDraft(false);
    }
  }

  async function sign() {
    setSigning(true); setError(null);
    try {
      // Save first, then sign
      await saveDraft();
      // Save Rx items as a prescription if any are filled
      const filled = rx.filter((r) => r.med.trim());
      if (filled.length > 0) {
        await apiPost(ctx, `/encounters/${encounter._id}/prescriptions`, {
          items: filled.map((r) => ({
            customName: r.med,
            dosage: r.dose || undefined,
            frequency: r.freq || undefined,
            duration: r.dur || undefined,
            instructions: r.note || undefined,
          })),
        });
      }
      const signedEnc = await apiPost<Encounter>(ctx, `/encounters/${encounter._id}/sign`, {});
      onChanged(signedEnc);
      setShowSign(false);
      setJustSigned(true);
      setTimeout(() => setJustSigned(false), 1200);
      toast('Encounter signed', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSigning(false);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="chevronLeft" size={14} />
          </button>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Encounter</div>
          <div style={{ marginLeft: 'auto' }}><StatusPill status={signed ? 'signed' : 'draft'} small /></div>
        </div>

        <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Avatar name={patient?.fullName ?? '?'} size={40} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{patient?.fullName ?? 'Patient'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{patient?.phones?.[0] ?? '—'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(patient?.tags ?? []).map((t) => (
              <span key={t} style={{ padding: '2px 8px', borderRadius: 100, background: 'var(--brand-50)', color: 'var(--brand-600)', fontSize: 11, fontWeight: 600, border: '1px solid var(--brand-100)' }}>{t}</span>
            ))}
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current vitals</div>
            <span style={{ fontSize: 9, color: 'var(--text-subtle)', background: 'var(--surface-muted)', padding: '2px 6px', borderRadius: 6, fontWeight: 600 }}>READ-ONLY</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              { l: 'BP', v: vitals.bp, u: 'mmHg' },
              { l: 'SpO2', v: vitals.spo2, u: '%' },
              { l: 'Temp', v: vitals.temp, u: '°F' },
              { l: 'Pulse', v: vitals.pulse, u: 'bpm' },
            ].map((row) => (
              <div key={row.l} style={{ background: 'var(--surface-muted)', borderRadius: 8, padding: '7px 9px' }}>
                <div style={{ fontSize: 9, color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 700 }}>{row.l}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                  {row.v || '—'} <span style={{ fontSize: 9, color: 'var(--text-subtle)', fontWeight: 400 }}>{row.u}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Prescription items</div>
          {rx.filter((r) => r.med.trim()).length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>None added yet.</div>
          ) : rx.filter((r) => r.med.trim()).slice(0, 5).map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginBottom: 7 }}>
              <Icon name="pill" size={12} style={{ color: 'var(--brand-500)', marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {r.med}{r.freq ? ` · ${r.freq}` : ''}{r.dur ? ` · ${r.dur}` : ''}
              </span>
            </div>
          ))}
        </div>

        <div style={{ padding: 16, fontSize: 11, color: 'var(--text-subtle)', marginTop: 'auto' }}>
          <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Encounter ID</div>
          <code style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--brand-600)', background: 'var(--brand-50)', padding: '2px 6px', borderRadius: 6 }}>
            {encounter.readableId ?? `#${encounter._id.slice(-8).toUpperCase()}`}
          </code>
          <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 14, marginBottom: 6 }}>Visited</div>
          <div style={{ color: 'var(--text-muted)' }}>{new Date(encounter.visitedAt).toLocaleString('en-IN')}</div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, transition: 'filter 600ms var(--ease-out)', filter: signed && justSigned ? 'saturate(0.6)' : 'saturate(1)' }}>
        {signed && (
          <div style={{
            padding: '12px 24px',
            background: 'var(--success-bg)',
            borderBottom: '1px solid var(--success-200)',
            display: 'flex', alignItems: 'center', gap: 12,
            animation: justSigned ? 'successHalo 1000ms var(--ease-out)' : undefined,
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: 'var(--success-100)', color: 'var(--success-text)' }}>
              {justSigned ? (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" strokeDasharray="24" strokeDashoffset="24" style={{ animation: 'pathDraw 280ms var(--ease-out) forwards', ['--draw-len' as never]: 24 }} />
                </svg>
              ) : (
                <Icon name="checkCircle" size={15} />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: 'var(--success-text)', fontWeight: 700 }}>Record Signed & Locked</div>
              <div style={{ fontSize: 11, color: 'var(--success-text)', opacity: 0.8, marginTop: 1 }}>
                By {signerLabel(encounter, ctx.fullName ?? ctx.email)} · {formatSignedAt(encounter.signedAt ?? encounter.updatedAt)}
              </div>
            </div>
            <StatusPill status="signed" small />
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 60px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {(!signed || Object.values(vitals).some(v => !!v)) && (
            <Section title="Vitals" icon="activity" defaultOpen={!signed}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                gap: 12
              }}>
                {VITAL_FIELDS.map((f) => (
                  <VitalInput key={f.key} label={f.label} unit={f.unit}
                    value={vitals[f.key] ?? ''}
                    onChange={(v) => setVitals((x) => ({ ...x, [f.key]: v }))}
                    disabled={signed} />
                ))}
              </div>
            </Section>
          )}

          {(!signed || complaint.trim()) && (
            <Section title="Chief complaint" icon="stethoscope" defaultOpen={!signed}>
              <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} disabled={signed}
                placeholder="Describe the patient's presenting complaint…"
                style={{ width: '100%', minHeight: 72, padding: '10px 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', opacity: signed ? 0.7 : 1 }} />
            </Section>
          )}

          {(!signed || diagnosis.trim()) && (
            <Section title="Diagnosis" icon="fileText" defaultOpen={!signed}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {diags.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No diagnoses yet.</div>}
                {diags.map((d, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 100, background: 'var(--brand-50)', border: '1px solid var(--brand-100)', color: 'var(--brand-700)', fontSize: 12, fontWeight: 500 }}>
                    {d}
                    {!signed && (
                      <button onClick={() => removeDiag(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand-500)', display: 'flex', padding: 0 }}>
                        <Icon name="x" size={11} strokeWidth={2.5} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {!signed && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={diagInput} onChange={(e) => setDiagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDiag())}
                    placeholder="Add ICD-10 code or diagnosis…"
                    style={{ flex: 1, height: 36, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 9, fontSize: 13, color: 'var(--text)', outline: 'none' }} />
                  <button onClick={addDiag} style={{ height: 36, padding: '0 14px', background: 'var(--brand-50)', border: '1px solid var(--brand-100)', borderRadius: 9, color: 'var(--brand-600)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add</button>
                </div>
              )}
            </Section>
          )}

          {(!signed || rx.some(r => r.med.trim())) && (
            <Section title="Prescription" icon="pill" defaultOpen={!signed || rx.some(r => r.med.trim())}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rx.some(r => r.med.trim()) && (
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'minmax(200px, 2fr) 100px 100px 100px minmax(200px, 2.5fr) 40px', 
                    gap: 12, 
                    padding: '0 12px 4px', 
                    fontSize: 10, 
                    fontWeight: 700, 
                    color: 'var(--text-subtle)', 
                    textTransform: 'uppercase', 
                    letterSpacing: '0.06em' 
                  }}>
                    <span>Medicine</span>
                    <span>Dose</span>
                    <span>Freq</span>
                    <span>Duration</span>
                    <span>Instructions</span>
                    <span />
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rx.filter(r => !signed || r.med.trim()).map((item) => (
                    <div key={item.id} style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'minmax(200px, 2fr) 100px 100px 100px minmax(200px, 2.5fr) 40px', 
                      gap: 12, 
                      padding: '8px 12px', 
                      background: 'var(--surface-muted)', 
                      borderRadius: 12, 
                      border: '1px solid var(--border)', 
                      alignItems: 'center' 
                    }}>
                      <input value={item.med} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, med: e.target.value } : x))} disabled={signed} placeholder="Medicine name" style={rxInputStyle} />
                      <input value={item.dose} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, dose: e.target.value } : x))} disabled={signed} placeholder="1 tab" style={rxInputStyle} />
                      <select value={item.freq} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, freq: e.target.value } : x))} disabled={signed} style={{ ...rxInputStyle, cursor: 'pointer' }}>
                        <option value="">Freq</option>
                        <option>OD</option><option>BD</option><option>TDS</option><option>QID</option><option>SOS</option>
                      </select>
                      <input value={item.dur} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, dur: e.target.value } : x))} disabled={signed} placeholder="7 days" style={rxInputStyle} />
                      <input value={item.note} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, note: e.target.value } : x))} disabled={signed} placeholder="Special instructions" style={rxInputStyle} />
                      
                      {!signed ? (
                        <button onClick={() => setRx((r) => r.filter((x) => x.id !== item.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-500)', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="trash" size={15} />
                        </button>
                      ) : <span />}
                    </div>
                  ))}
                </div>

                {!signed && (
                  <button onClick={() => setRx((r) => [...r, { id: nextRxId.current++, med: '', dose: '', freq: '', dur: '', note: '' }])}
                    style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 16px', background: 'var(--surface)', border: '1.5px dashed var(--border)', borderRadius: 10, color: 'var(--brand-600)', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
                    <Icon name="plus" size={14} strokeWidth={2.5} /> Add medicine
                  </button>
                )}
              </div>
            </Section>
          )}

          {(!signed || followUp) && (
            <Section title="Follow-up" icon="calendar" defaultOpen={!!followUp}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} disabled={signed}
                  style={{ height: 38, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 9, fontSize: 13, color: 'var(--text)', outline: 'none' }} />
                {!signed && <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Leave blank if no follow-up needed.</span>}
              </div>
            </Section>
          )}

          {(!signed || notes.trim()) && (
            <Section title="Notes" icon="fileText" defaultOpen={!!notes.trim()}>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={signed}
                placeholder="Clinical notes, observations, or special instructions…"
                style={{ width: '100%', minHeight: 80, padding: '10px 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', opacity: signed ? 0.7 : 1 }} />
            </Section>
          )}

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--text-subtle)' }}>{patient?.fullName} · {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          <button onClick={() => printPrescription({
            clinic: { name: ctx.clinicName ?? 'Clinic', branchName: ctx.branchName },
            doctor: { name: ctx.fullName, email: ctx.email },
            patient,
            vitals,
            complaint,
            diagnosis,
            rx,
            notes,
            followUp,
            encounter,
          })}
            style={{ height: 40, padding: '0 18px', background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="printer" size={14} /> Print prescription
          </button>
          {!signed && (
            <>
              <button onClick={saveDraft} disabled={savingDraft}
                style={{ height: 40, padding: '0 20px', background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 13, fontWeight: 500, cursor: savingDraft ? 'wait' : 'pointer' }}>
                {savingDraft ? 'Saving…' : 'Save draft'}
              </button>
              <button onClick={() => setShowSign(true)}
                style={{ height: 40, padding: '0 24px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="lock" size={14} /> Sign encounter
              </button>
            </>
          )}
        </div>
      </div>

      {showSign && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={() => setShowSign(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: 18, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: 380, padding: 28, animation: 'slideUp 200ms ease-out' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(59,130,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Icon name="lock" size={20} style={{ color: 'var(--brand-500)' }} />
            </div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Sign encounter?</div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 24 }}>
              Once signed, the record will be locked and cannot be edited. This action confirms the clinical details are accurate.
            </p>
            {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)', marginBottom: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowSign(false)}
                style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={sign} disabled={signing}
                style={{ flex: 2, height: 42, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: signing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {signing ? <Spinner /> : <><Icon name="lock" size={14} /> Sign encounter</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const rxInputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 7, fontSize: 12, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
};

function Section({ title, icon, children, defaultOpen }: { title: string; icon: IconName; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  // flexShrink: 0 — without this, when many sections live in the column-flex
  // parent at line 578 their total intrinsic height exceeds the container
  // and flex squashes each child to fit instead of letting the parent scroll.
  // Combined with the wrapper's overflow:hidden (kept here so rounded corners
  // clip the inner border) that produced the "section title with empty body"
  // bug. Holding our natural height makes the parent's overflowY:auto kick in.
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', flexShrink: 0 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--brand-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={icon} size={14} style={{ color: 'var(--brand-500)' }} />
        </div>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} style={{ color: 'var(--text-subtle)' }} />
      </button>
      {open && <div style={{ padding: '14px 16px 16px', borderTop: '1px solid var(--border)' }}>{children}</div>}
    </div>
  );
}

function signerLabel(enc: Encounter, fallback?: string): string {
  if (fallback) return `Dr. ${fallback}`;
  if (enc.signedByUserId) return `User #${enc.signedByUserId.slice(-8).toUpperCase()}`;
  return 'this user';
}

function formatSignedAt(iso: string | undefined): string {
  if (!iso) return new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function VitalInput({ label, unit, value, onChange, disabled }: { label: string; unit: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="—"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            width: '100%', height: 40,
            padding: '0 32px 0 12px',
            background: isFocused ? 'var(--surface)' : 'var(--surface-muted)',
            border: `1.5px solid ${disabled ? 'transparent' : (isFocused ? 'var(--brand-500)' : 'var(--border)')}`,
            borderRadius: 10,
            fontSize: 14, fontWeight: 600,
            color: 'var(--text)',
            outline: 'none',
            boxSizing: 'border-box',
            textAlign: 'left', // Switched to left for better cursor visibility
            fontVariantNumeric: 'tabular-nums',
            cursor: disabled ? 'not-allowed' : 'text',
            transition: 'all 0.2s ease',
            boxShadow: isFocused ? '0 0 0 3px rgba(99,102,241,0.1)' : 'none',
          }}
        />
        <span style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)',
          pointerEvents: 'none', opacity: 0.8
        }}>
          {unit}
        </span>
      </div>
    </div>
  );
}

// ---------- Print prescription ----------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function printPrescription(input: {
  clinic: { name: string; branchName?: string };
  doctor: { name?: string; email?: string };
  patient: Patient | null;
  vitals: Record<string, string>;
  complaint: string;
  diagnosis: string;
  rx: RxItem[];
  notes: string;
  followUp: string;
  encounter: Encounter;
}) {
  const { clinic, doctor, patient, vitals, complaint, diagnosis, rx, notes, followUp, encounter } = input;
  const signed = encounter.status === 'SIGNED';

  const age = patient?.dob ? getAge(patient.dob) : null;
  const gender = patient ? genderWord(patient.gender) : '';
  const phone = patient?.phones?.[0] ?? '';

  const dateStr = new Date(encounter.visitedAt || Date.now()).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const signedAtStr = signed
    ? new Date(encounter.signedAt ?? encounter.updatedAt ?? Date.now()).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

  const filledVitals = Object.entries(vitals).filter(([, v]) => !!v && v.trim());
  const diagnosisList = diagnosis.split('|').map((s) => s.trim()).filter(Boolean);
  const filledRx = rx.filter((r) => r.med.trim());

  const vitalsHtml = filledVitals.length
    ? `<section class="block">
         <h2>Vitals</h2>
         <div class="vitals-grid">
           ${filledVitals
             .map(([k, v]) => {
               const meta = VITAL_FIELDS.find((f) => f.key === k);
               return `<div class="vital">
                         <div class="label">${escapeHtml(meta?.label ?? k.toUpperCase())}</div>
                         <div class="value">${escapeHtml(v)} <span class="unit">${escapeHtml(meta?.unit ?? '')}</span></div>
                       </div>`;
             })
             .join('')}
         </div>
       </section>`
    : '';

  const complaintHtml = complaint.trim()
    ? `<section class="block">
         <h2>Chief complaint</h2>
         <p>${escapeHtml(complaint.trim())}</p>
       </section>`
    : '';

  const diagnosisHtml = diagnosisList.length
    ? `<section class="block">
         <h2>Diagnosis</h2>
         <div class="chips">
           ${diagnosisList.map((d) => `<span class="chip">${escapeHtml(d)}</span>`).join('')}
         </div>
       </section>`
    : '';

  const rxHtml = filledRx.length
    ? `<section class="block rx-section">
         <h2>℞ Prescription</h2>
         <table class="rx-table">
           <thead>
             <tr>
               <th style="width:8%;">#</th>
               <th style="width:30%;">Medicine</th>
               <th style="width:15%;">Dose</th>
               <th style="width:12%;">Frequency</th>
               <th style="width:12%;">Duration</th>
               <th>Instructions</th>
             </tr>
           </thead>
           <tbody>
             ${filledRx
               .map(
                 (r, i) => `<tr>
                   <td class="num">${i + 1}</td>
                   <td class="med">${escapeHtml(r.med)}</td>
                   <td>${escapeHtml(r.dose || '—')}</td>
                   <td>${escapeHtml(r.freq || '—')}</td>
                   <td>${escapeHtml(r.dur || '—')}</td>
                   <td>${escapeHtml(r.note || '—')}</td>
                 </tr>`,
               )
               .join('')}
           </tbody>
         </table>
       </section>`
    : `<section class="block">
         <h2>℞ Prescription</h2>
         <p class="empty">No medicines prescribed.</p>
       </section>`;

  const followUpHtml = followUp
    ? `<section class="block">
         <h2>Follow-up</h2>
         <p>${escapeHtml(new Date(followUp).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }))}</p>
       </section>`
    : '';

  const notesHtml = notes.trim()
    ? `<section class="block">
         <h2>Notes</h2>
         <p class="notes">${escapeHtml(notes.trim())}</p>
       </section>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Prescription — ${escapeHtml(patient?.fullName ?? 'Patient')}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #111827;
    background: #f8fafc;
    font-size: 13px;
    line-height: 1.5;
  }
  .page {
    max-width: 820px;
    margin: 0 auto;
    background: #ffffff;
    padding: 36px 40px 28px;
    box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
  }
  /* ---------- Header ---------- */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 18px;
    border-bottom: 3px solid #6366F1;
    margin-bottom: 24px;
  }
  .clinic { display: flex; align-items: center; gap: 12px; }
  .clinic .logo {
    width: 48px; height: 48px; border-radius: 10px;
    background: linear-gradient(135deg, #6366F1 0%, #818cf8 100%);
    display: flex; align-items: center; justify-content: center;
    color: #ffffff; font-weight: 800; font-size: 22px;
    font-family: 'Manrope', sans-serif;
    box-shadow: 0 6px 18px rgba(99, 102, 241, 0.25);
  }
  .clinic .name {
    font-family: 'Manrope', sans-serif;
    font-size: 22px;
    font-weight: 800;
    color: #111827;
    letter-spacing: -0.5px;
    line-height: 1.1;
  }
  .clinic .branch {
    font-size: 12px;
    color: #6b7280;
    margin-top: 2px;
  }
  .doctor-info {
    text-align: right;
    font-size: 12px;
    color: #6b7280;
  }
  .doctor-info .name {
    color: #111827;
    font-weight: 700;
    font-size: 14px;
    display: block;
    margin-bottom: 2px;
  }
  .doctor-info .creds { font-size: 11px; }

  /* ---------- Patient strip ---------- */
  .patient-strip {
    display: grid;
    grid-template-columns: 2.5fr 1fr 1.4fr 1fr;
    gap: 14px;
    background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%);
    border: 1px solid #c7d2fe;
    border-radius: 10px;
    padding: 14px 18px;
    margin-bottom: 22px;
  }
  .patient-strip .field { display: flex; flex-direction: column; }
  .patient-strip .label {
    font-size: 9.5px;
    font-weight: 700;
    color: #6366F1;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 3px;
  }
  .patient-strip .value {
    font-size: 14px;
    font-weight: 600;
    color: #111827;
  }

  /* ---------- Sections ---------- */
  .block { margin-bottom: 18px; }
  .block h2 {
    font-size: 11px;
    font-weight: 700;
    color: #6366F1;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 8px 0;
    padding-bottom: 6px;
    border-bottom: 1px solid #e5e7eb;
  }
  .block p {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: #1f2937;
  }
  .block p.empty { color: #9ca3af; font-style: italic; }
  .block p.notes { white-space: pre-wrap; }

  /* ---------- Vitals ---------- */
  .vitals-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
  }
  .vital {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 10px 6px;
    text-align: center;
  }
  .vital .label {
    font-size: 9px;
    font-weight: 700;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 4px;
  }
  .vital .value {
    font-size: 14px;
    font-weight: 700;
    color: #111827;
    font-variant-numeric: tabular-nums;
  }
  .vital .unit { font-size: 9px; color: #6b7280; font-weight: 500; }

  /* ---------- Diagnosis chips ---------- */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-block;
    padding: 4px 11px;
    border-radius: 100px;
    background: #eef2ff;
    border: 1px solid #c7d2fe;
    color: #4338ca;
    font-size: 12px;
    font-weight: 500;
  }

  /* ---------- Rx table ---------- */
  .rx-section h2 { color: #6366F1; font-size: 13px; }
  .rx-table {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
  }
  .rx-table thead { background: linear-gradient(135deg, #6366F1 0%, #818cf8 100%); }
  .rx-table th {
    color: #ffffff;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 9px 12px;
    text-align: left;
  }
  .rx-table td {
    padding: 11px 12px;
    border-top: 1px solid #f1f5f9;
    font-size: 12.5px;
    color: #1f2937;
    vertical-align: top;
  }
  .rx-table tbody tr:nth-child(even) { background: #fafafa; }
  .rx-table .num {
    color: #6366F1;
    font-weight: 700;
    text-align: center;
  }
  .rx-table .med { font-weight: 600; color: #111827; }

  /* ---------- Footer ---------- */
  .foot {
    margin-top: 28px;
    padding-top: 18px;
    border-top: 2px solid #6366F1;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .foot .meta { font-size: 11px; color: #6b7280; }
  .badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 100px;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .badge.signed { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
  .badge.draft  { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
  .signature { text-align: right; }
  .signature .line {
    border-bottom: 1.5px solid #111827;
    margin-bottom: 6px;
    padding-bottom: 24px;
    min-width: 220px;
  }
  .signature .who {
    font-size: 12px;
    font-weight: 700;
    color: #111827;
  }
  .signature .when {
    font-size: 10.5px;
    color: #6b7280;
    margin-top: 2px;
  }

  .toolbar {
    position: fixed; top: 12px; right: 12px;
    display: flex; gap: 8px;
    background: #ffffff;
    padding: 8px 10px;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08);
  }
  .toolbar button {
    border: 1px solid #e5e7eb;
    background: #ffffff;
    color: #374151;
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .toolbar button.primary {
    background: #6366F1;
    border-color: #6366F1;
    color: #ffffff;
  }
  @media print {
    body { background: #ffffff; }
    .page { box-shadow: none; padding: 12mm; max-width: none; }
    .toolbar { display: none; }
    .rx-table thead { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .rx-table tbody tr:nth-child(even) { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .patient-strip, .vital, .chip { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">Print</button>
    <button onclick="window.close()">Close</button>
  </div>
  <main class="page">
    <header class="header">
      <div class="clinic">
        <div class="logo">${escapeHtml((clinic.name || 'C').slice(0, 1).toUpperCase())}</div>
        <div>
          <div class="name">${escapeHtml(clinic.name || 'Clinic')}</div>
          ${clinic.branchName ? `<div class="branch">${escapeHtml(clinic.branchName)}</div>` : ''}
        </div>
      </div>
      <div class="doctor-info">
        <span class="name">${escapeHtml(doctor.name ? `Dr. ${doctor.name}` : 'Doctor')}</span>
        ${doctor.email ? `<div class="creds">${escapeHtml(doctor.email)}</div>` : ''}
      </div>
    </header>

    <section class="patient-strip">
      <div class="field">
        <span class="label">Patient</span>
        <span class="value">${escapeHtml(patient?.fullName ?? '—')}</span>
      </div>
      <div class="field">
        <span class="label">Age / Sex</span>
        <span class="value">${age != null ? `${age}y` : '—'} ${gender ? '· ' + escapeHtml(gender) : ''}</span>
      </div>
      <div class="field">
        <span class="label">Phone</span>
        <span class="value">${escapeHtml(phone || '—')}</span>
      </div>
      <div class="field">
        <span class="label">Date</span>
        <span class="value">${escapeHtml(dateStr)}</span>
      </div>
    </section>

    ${vitalsHtml}
    ${complaintHtml}
    ${diagnosisHtml}
    ${rxHtml}
    ${followUpHtml}
    ${notesHtml}

    <footer class="foot">
      <div class="meta">
        ${signed
          ? `<span class="badge signed">Signed</span> &nbsp; ${escapeHtml(signedAtStr)}`
          : `<span class="badge draft">Draft</span> &nbsp; not yet signed`}
        <div style="margin-top:4px;">Encounter ID: <code style="font-family:monospace;font-size:10.5px;color:#6b7280;">${escapeHtml(encounter._id)}</code></div>
      </div>
      <div class="signature">
        <div class="line"></div>
        <div class="who">${escapeHtml(doctor.name ? `Dr. ${doctor.name}` : 'Doctor')}</div>
        <div class="when">Signature${signed ? ` · ${escapeHtml(signedAtStr)}` : ''}</div>
      </div>
    </footer>
  </main>
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 200);
    });
  </script>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) {
    alert('Could not open print window. Please allow pop-ups for this site.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
