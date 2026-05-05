import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiGet, apiPatch, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Avatar, Spinner, StatusPill, useToast } from '../shared/primitives';
import { Icon, type IconName } from '../shared/Icon';

type Encounter = {
  _id: string;
  patientId: string;
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
};

type Patient = { _id: string; fullName: string; gender?: string; dob?: string; phones?: string[]; tags?: string[] };

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

  // Patient search (only used while no patient is selected)
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);

  // Doctor display (locked to current user — backend has no /users list endpoint yet)
  const doctorName = ctx.fullName ? `Dr. ${ctx.fullName}` : 'Doctor';
  const doctorSubtitle = ctx.email ?? `User ${doctorId.slice(-6)}`;

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
        }
      })
      .catch(() => undefined);
  }, [selectedAppointmentId, ctx]);

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
      setPatientId(enc.patientId);
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

    return (
      <div style={{ padding: '32px 32px', maxWidth: 720 }}>
        <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>Encounter</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Start a new encounter or load one by ID.</p>

        <div style={{ marginTop: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Patient picker */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Patient</label>

            {patient ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--brand-50)', border: '1.5px solid var(--brand-100)', borderRadius: 12 }}>
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
                      width: '100%', height: 42, padding: '0 14px 0 40px',
                      background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
                      fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--brand-500)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                  />
                </div>
                {patientQuery.trim() && (
                  <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)', maxHeight: 280, overflowY: 'auto' }}>
                    {searching && patientResults.length === 0 && (
                      <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--text-subtle)' }}>Searching…</div>
                    )}
                    {!searching && patientResults.length === 0 && (
                      <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--text-subtle)' }}>No patients match.</div>
                    )}
                    {patientResults.map((p) => {
                      const a = getAge(p.dob);
                      const gword = genderWord(p.gender);
                      const ph = p.phones?.[0];
                      return (
                        <button key={p._id} onClick={() => pickPatient(p)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                          <Avatar name={p.fullName} size={32} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.fullName}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                              {[gword, a != null ? `${a}y` : null, ph].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                          <Icon name="chevronRight" size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Doctor (locked) */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Doctor</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 12 }}>
              <Avatar name={doctorName} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{doctorName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{doctorSubtitle}</div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-subtle)', padding: '3px 9px', borderRadius: 100, background: 'var(--surface)', border: '1px solid var(--border)' }}>You</span>
            </div>
          </div>

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={startEncounter} disabled={creating || !patient}
              style={{
                flex: 1, height: 42, border: 'none', borderRadius: 10,
                background: (creating || !patient) ? 'rgba(99,102,241,0.4)' : 'var(--brand-500)',
                color: 'var(--brand-text)', fontSize: 14, fontWeight: 600,
                cursor: creating ? 'wait' : (!patient ? 'not-allowed' : 'pointer'),
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              {creating ? <Spinner /> : <><Icon name="plus" size={14} strokeWidth={2.5} /> Start encounter</>}
            </button>
            <button onClick={() => setScreen('appointments')}
              style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
              Back to Appointments
            </button>
          </div>
        </div>

        <div style={{ marginTop: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Load existing encounter</div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 10 }}>Paste an encounter ID to reopen it.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={encounterId ?? ''} onChange={(e) => setEncounterId(e.target.value)} placeholder="Encounter ID"
              style={{ flex: 1, height: 38, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'monospace' }} />
            <button onClick={() => encounterId && loadEncounter(encounterId)}
              style={{ height: 38, padding: '0 16px', background: 'none', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              Load
            </button>
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

        <div style={{ padding: 16, fontSize: 11, color: 'var(--text-subtle)' }}>
          <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Encounter ID</div>
          <code style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{encounter._id}</code>
          <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 14, marginBottom: 6 }}>Visited</div>
          <div style={{ color: 'var(--text-muted)' }}>{new Date(encounter.visitedAt).toLocaleString('en-IN')}</div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, transition: 'filter 600ms var(--ease-out)', filter: signed && justSigned ? 'saturate(0.6)' : 'saturate(1)' }}>
        {signed && (
          <div style={{
            padding: '10px 20px',
            background: 'rgba(16,185,129,0.08)',
            borderBottom: '1px solid rgba(16,185,129,0.2)',
            display: 'flex', alignItems: 'center', gap: 10,
            animation: justSigned ? 'successHalo 1000ms var(--ease-out)' : undefined,
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'rgba(16,185,129,0.18)' }}>
              {justSigned ? (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--success-500)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" strokeDasharray="24" strokeDashoffset="24" style={{ animation: 'pathDraw 280ms var(--ease-out) forwards', ['--draw-len' as never]: 24 }} />
                </svg>
              ) : (
                <Icon name="checkCircle" size={14} style={{ color: 'var(--success-500)' }} />
              )}
            </span>
            <span style={{ fontSize: 13, color: 'var(--success-500)', fontWeight: 600 }}>
              Signed by {signerLabel(encounter, ctx.fullName ?? ctx.email)} · {formatSignedAt(encounter.signedAt ?? encounter.updatedAt)}
            </span>
            <span style={{ marginLeft: 'auto' }}><StatusPill status="signed" small /></span>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Section title="Vitals" icon="activity" defaultOpen>
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

          <Section title="Chief complaint" icon="stethoscope" defaultOpen>
            <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} disabled={signed}
              placeholder="Describe the patient's presenting complaint…"
              style={{ width: '100%', minHeight: 72, padding: '10px 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', opacity: signed ? 0.7 : 1 }} />
          </Section>

          <Section title="Diagnosis" icon="fileText" defaultOpen>
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

          <Section title="Prescription" icon="pill" defaultOpen>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, padding: '0 12px 6px', fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <span style={{ flex: '0 0 30%' }}>Medicine</span>
                <span style={{ flex: '0 0 16%' }}>Dose</span>
                <span style={{ flex: '0 0 14%' }}>Freq</span>
                <span style={{ flex: '0 0 14%' }}>Duration</span>
                <span style={{ flex: 1 }}>Instructions</span>
              </div>
              {rx.map((item) => (
                <div key={item.id} style={{ display: 'flex', gap: 8, padding: '10px 12px', background: 'var(--surface-muted)', borderRadius: 10, border: '1px solid var(--border)', alignItems: 'flex-start' }}>
                  <div style={{ flex: '0 0 30%' }}>
                    <input value={item.med} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, med: e.target.value } : x))} disabled={signed} placeholder="Medicine name" style={rxInputStyle} />
                  </div>
                  <div style={{ flex: '0 0 16%' }}>
                    <input value={item.dose} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, dose: e.target.value } : x))} disabled={signed} placeholder="1 tab" style={rxInputStyle} />
                  </div>
                  <div style={{ flex: '0 0 14%' }}>
                    <select value={item.freq} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, freq: e.target.value } : x))} disabled={signed} style={{ ...rxInputStyle, cursor: 'pointer' }}>
                      <option value="">Freq</option>
                      <option>OD</option><option>BD</option><option>TDS</option><option>QID</option><option>SOS</option>
                    </select>
                  </div>
                  <div style={{ flex: '0 0 14%' }}>
                    <input value={item.dur} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, dur: e.target.value } : x))} disabled={signed} placeholder="7 days" style={rxInputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <input value={item.note} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, note: e.target.value } : x))} disabled={signed} placeholder="Instructions" style={rxInputStyle} />
                  </div>
                  {!signed && (
                    <button onClick={() => setRx((r) => r.filter((x) => x.id !== item.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-500)', padding: '6px 4px', display: 'flex', marginTop: 1 }}>
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              ))}
              {!signed && (
                <button onClick={() => setRx((r) => [...r, { id: nextRxId.current++, med: '', dose: '', freq: '', dur: '', note: '' }])}
                  style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', background: 'none', border: '1.5px dashed var(--border)', borderRadius: 9, color: 'var(--text-subtle)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                  <Icon name="plus" size={13} strokeWidth={2.5} /> Add medicine
                </button>
              )}
            </div>
          </Section>

          <Section title="Follow-up" icon="calendar">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} disabled={signed}
                style={{ height: 38, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 9, fontSize: 13, color: 'var(--text)', outline: 'none' }} />
              <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Leave blank if no follow-up needed.</span>
            </div>
          </Section>

          <Section title="Notes" icon="fileText">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={signed}
              placeholder="Clinical notes, observations, or special instructions…"
              style={{ width: '100%', minHeight: 80, padding: '10px 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', opacity: signed ? 0.7 : 1 }} />
          </Section>

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        {!signed && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--text-subtle)' }}>{patient?.fullName} · {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            <button onClick={saveDraft} disabled={savingDraft}
              style={{ height: 40, padding: '0 20px', background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 13, fontWeight: 500, cursor: savingDraft ? 'wait' : 'pointer' }}>
              {savingDraft ? 'Saving…' : 'Save draft'}
            </button>
            <button onClick={() => setShowSign(true)}
              style={{ height: 40, padding: '0 24px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="lock" size={14} /> Sign encounter
            </button>
          </div>
        )}
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
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
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
  if (enc.signedByUserId) return `User ${enc.signedByUserId.slice(-6)}`;
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
