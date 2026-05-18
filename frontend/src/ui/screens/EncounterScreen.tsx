import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiGet, apiPatch, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Avatar, Spinner, StatusPill, useToast } from '../shared/primitives';
import { Icon, type IconName } from '../shared/Icon';
import { DatePickerChip } from '../shared/DatePickerChip';
import { ListItemSkeleton } from '../shared/Skeleton';
import { DocumentsScreen } from './DocumentsScreen';

type Encounter = {
  _id: string;
  patientId: string | { _id: string; fullName: string; mrn?: string };
  doctorId: string;
  branchId: string;
  status: 'DRAFT' | 'SIGNED';
  chiefComplaint?: string;
  notes?: string;
  diagnosis?: string;
  vitals?: Record<string, any>;
  followUpAt?: string;
  visitedAt: string;
  signedAt?: string;
  signedByUserId?: string;
  updatedAt?: string;
  readableId?: string;
};

type Patient = { _id: string; mrn?: string; fullName: string; gender?: string; dob?: string; phones?: string[]; tags?: string[] };

type RxStockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

/**
 * In-flight prescription row. `inventoryItemId` and `medicineCatalogItemId`
 * are set only when the doctor picks an option from the inventory-aware
 * typeahead — free-text entries leave them undefined and the medicine bill
 * flow (Slice 3) will treat them as "not stocked here, patient buys outside".
 * `stockStatus` / `onHand` are FE-only display hints, refreshed when the
 * typeahead opens; persisted rows reload without them and surface no chip.
 */
type RxItem = {
  id: number;
  med: string;
  dose: string;
  freq: string;
  dur: string;
  note: string;
  qty: string;
  inventoryItemId?: string;
  medicineCatalogItemId?: string;
  stockStatus?: RxStockStatus;
  onHand?: number;
};

type AvailabilityRow = {
  _id: string;
  name: string;
  sku?: string;
  unit: string;
  packUnit?: string;
  packSize?: number;
  medicineCatalogItemId?: string;
  onHand: number;
  reorderLevel: number;
  status: RxStockStatus;
};

const VITAL_FIELDS: { key: string; label: string; unit: string }[] = [
  { key: 'bp', label: 'BP', unit: 'mmHg' },
  { key: 'spo2', label: 'SpO2', unit: '%' },
  { key: 'temp', label: 'Temp', unit: '°F' },
  { key: 'pulse', label: 'Pulse', unit: 'bpm' },
  { key: 'rr', label: 'RR', unit: '/min' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'height', label: 'Height', unit: 'cm' },
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

function mapVitalsToUi(v: any): Record<string, string> {
  const out = { bp: '', spo2: '', temp: '', pulse: '', rr: '', weight: '', height: '' };
  if (!v || typeof v !== 'object') return out;
  if (v.bpSystolic != null && v.bpDiastolic != null) {
    out.bp = `${v.bpSystolic}/${v.bpDiastolic}`;
  } else if (v.bpSystolic != null) {
    out.bp = String(v.bpSystolic);
  } else if (v.bp) {
    out.bp = String(v.bp);
  }
  if (v.spo2 != null) out.spo2 = String(v.spo2);
  if (v.temperatureC != null) {
    const f = (Number(v.temperatureC) * 9 / 5) + 32;
    out.temp = f % 1 === 0 ? String(f) : f.toFixed(1);
  } else if (v.temp) {
    out.temp = String(v.temp);
  }
  if (v.pulseBpm != null) out.pulse = String(v.pulseBpm);
  else if (v.pulse) out.pulse = String(v.pulse);
  if (v.respiratoryRate != null) out.rr = String(v.respiratoryRate);
  else if (v.rr) out.rr = String(v.rr);
  if (v.weightKg != null) out.weight = String(v.weightKg);
  else if (v.weight) out.weight = String(v.weight);
  if (v.heightCm != null) out.height = String(v.heightCm);
  else if (v.height) out.height = String(v.height);
  return out;
}

function mapVitalsToBe(v: Record<string, string>): Record<string, any> {
  const out: Record<string, any> = {};
  if (v.bp) {
    const parts = v.bp.split('/');
    const sys = parseInt(parts[0]?.trim());
    const dia = parseInt(parts[1]?.trim());
    if (!isNaN(sys)) out.bpSystolic = sys;
    if (!isNaN(dia)) out.bpDiastolic = dia;
  }
  if (v.spo2) {
    const val = parseInt(v.spo2);
    if (!isNaN(val)) out.spo2 = val;
  }
  if (v.temp) {
    const val = parseFloat(v.temp);
    if (!isNaN(val)) {
      out.temperatureC = parseFloat(((val - 32) * 5 / 9).toFixed(1));
    }
  }
  if (v.pulse) {
    const val = parseInt(v.pulse);
    if (!isNaN(val)) out.pulseBpm = val;
  }
  if (v.rr) {
    const val = parseInt(v.rr);
    if (!isNaN(val)) out.respiratoryRate = val;
  }
  if (v.weight) {
    const val = parseFloat(v.weight);
    if (!isNaN(val)) out.weightKg = val;
  }
  if (v.height) {
    const val = parseFloat(v.height);
    if (!isNaN(val)) out.heightCm = val;
  }
  return out;
}

function statusToken(s: string): string {
  return (s || '').toLowerCase().replace(/_/g, '-');
}

function isoToTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function isoToRange(start: string | undefined, end: string | undefined): string {
  if (!start) return '—';
  const st = isoToTime(start);
  if (!end) return st;
  const et = isoToTime(end);
  return `${st} - ${et}`;
}

export function EncounterScreen() {
  const { ctx, selectedAppointmentId, setSelectedAppointmentId, selectedEncounterId, setSelectedEncounterId, selectedDate } = useApp();
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
  const [queue, setQueue] = useState<any[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);

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
          // Clear it so we don't jump back here if we navigate away and return
          setSelectedAppointmentId(undefined);
        }
      })
      .catch(() => undefined);
  }, [selectedAppointmentId, ctx, setSelectedAppointmentId]);

  useEffect(() => {
    if (!selectedEncounterId) return;
    loadEncounter(selectedEncounterId);
    setSelectedEncounterId(undefined);
  }, [selectedEncounterId, setSelectedEncounterId]);

  useEffect(() => {
    if (encounter) return;
    setLoadingRecent(true);
    const qs = new URLSearchParams({ limit: '50' });
    if (selectedDate) qs.set('date', selectedDate);
    // Scope recent encounters to the active branch so switching branches
    // in the sidebar narrows the list to that branch's bookings.
    if (ctx.branchId) qs.set('branchId', ctx.branchId);
    apiGet<(Encounter & { patientId: { fullName: string; mrn?: string } })[]>(ctx, `/encounters?${qs.toString()}`)
      .then(setRecent)
      .catch(() => setRecent([]))
      .finally(() => setLoadingRecent(false));
  }, [encounter, ctx, selectedDate, ctx.branchId]);

  useEffect(() => {
    if (encounter) return;
    setLoadingQueue(true);
    // Use the clinic's timezone to calculate "Today"
    const tz = ctx.timezone || 'Asia/Kolkata';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

    const qs = new URLSearchParams({
      branchId: ctx.branchId || '',
      date: today,
    });
    apiGet<any[]>(ctx, `/appointments?${qs.toString()}`)
      .then((appts) => {
        // Show both waiting (CHECKED_IN) and active (IN_PROGRESS) patients
        setQueue(appts.filter(a => a.status === 'CHECKED_IN' || a.status === 'IN_PROGRESS'));
      })
      .catch(() => setQueue([]))
      .finally(() => setLoadingQueue(false));
  }, [encounter, ctx.branchId]);

  useEffect(() => {
    if (!patientId.trim()) { setPatient(null); return; }
    apiGet<Patient>(ctx, `/patients/${patientId.trim()}`).then(setPatient).catch(() => setPatient(null));
  }, [patientId, ctx]);

  // Debounced search. `cancelled` keeps an in-flight response for an
  // outdated query from overwriting the results of the latest one.
  useEffect(() => {
    if (patient) { setPatientResults([]); return; } // already chosen
    if (!patientQuery.trim()) { setPatientResults([]); return; }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ query: patientQuery.trim(), limit: '10' });
      apiGet<Patient[]>(ctx, `/patients?${qs.toString()}`)
        .then((r) => { if (!cancelled) setPatientResults(r); })
        .catch(() => { if (!cancelled) setPatientResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
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

  async function startFromQueue(appt: any) {
    setError(null);
    try {
      // 1. Look for existing draft encounter for this appointment
      const existing = await apiGet<any>(ctx, `/encounters/by-appointment/${appt._id}`);
      if (existing) {
        await loadEncounter(existing._id);
        return;
      }

      // 2. If no draft exists (fallback), start a new one
      setPatientId(appt.patientId._id || appt.patientId);
      setDoctorId(appt.doctorId);
      setSelectedAppointmentId(appt._id);
      await startEncounter();
    } catch (e) {
      setPatientId(appt.patientId._id || appt.patientId);
      setDoctorId(appt.doctorId);
      setSelectedAppointmentId(appt._id);
      await startEncounter();
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
      <div style={{ padding: '20px 32px', width: '100%', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, boxSizing: 'border-box' }}>
        <div>
          <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px' }}>Clinical Encounter</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Manage your active queue and start new patient sessions.</p>
        </div>

        {/* Top Section: Start Session (Horizontal Bar) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', paddingLeft: 2 }}>Start New Session</div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 20, boxShadow: '0 2px 8px rgba(15,23,42,0.03)' }}>
            {/* Patient Picker */}
            <div style={{ flex: 1.5, minWidth: 260 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Patient</label>
              {patient ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'var(--brand-50)', border: '1.5px solid var(--brand-100)', borderRadius: 8 }}>
                  <Avatar name={patient.fullName} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand-700)' }}>{patient.fullName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{meta || 'No details on file'}</div>
                  </div>
                  <button onClick={clearPatient}
                    style={{ background: 'var(--surface)', border: '1px solid var(--brand-200)', color: 'var(--brand-600)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '5px 10px', borderRadius: 6, transition: 'all 0.2s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--brand-100)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface)')}>
                    Change
                  </button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <Icon name="search" size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                  <input value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)}
                    placeholder="Search by name or phone…"
                    style={{
                      width: '100%', height: 38, padding: '0 12px 0 36px',
                      background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 8,
                      fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                      transition: 'border-color 0.2s'
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--brand-400)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                  />
                  {patientQuery.trim() && (
                    <div style={{ position: 'absolute', top: '110%', left: 0, right: 0, zIndex: 100, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)', boxShadow: '0 12px 32px rgba(15,23,42,0.12)', maxHeight: 280, overflowY: 'auto' }}>
                      {searching && <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--text-subtle)' }}>Searching patients…</div>}
                      {!searching && patientResults.length === 0 && <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--text-subtle)' }}>No matches found.</div>}
                      {patientResults.map((p) => (
                        <button key={p._id} onClick={() => pickPatient(p)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-muted)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
                          <Avatar name={p.fullName} size={36} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{p.fullName}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{p.mrn ?? `#${p._id.slice(-6).toUpperCase()}`}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Doctor Info */}
            <div style={{ flex: 1, minWidth: 180, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Doctor</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={doctorName} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{doctorName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{doctorSubtitle}</div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end', borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
              {/* <button onClick={() => setScreen('appointments')}
                style={{ padding: '0 20px', height: 48, background: 'none', border: '1.5px solid var(--border)', borderRadius: 14, fontSize: 14, fontWeight: 600, color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-muted)'; e.currentTarget.style.borderColor = 'var(--text-subtle)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
                <Icon name="calendar" size={16} /> Book
              </button> */}
              <button onClick={startEncounter} disabled={creating || !patient}
                style={{
                  padding: '0 18px', height: 38, borderRadius: 8,
                  background: (creating || !patient) ? 'var(--surface-muted)' : 'var(--brand-600)',
                  color: (creating || !patient) ? 'var(--text-muted)' : 'white',
                  fontSize: 13, fontWeight: 700,
                  cursor: creating ? 'wait' : (!patient ? 'not-allowed' : 'pointer'),
                  display: 'flex', alignItems: 'center', gap: 8,
                  boxShadow: (creating || !patient) ? 'none' : '0 2px 6px rgba(79,70,229,0.18)',
                  transition: 'all 0.2s',
                  border: (creating || !patient) ? '1px solid var(--border)' : 'none'
                }}
                onMouseEnter={(e) => { if (!creating && patient) e.currentTarget.style.background = 'var(--brand-700)'; }}
                onMouseLeave={(e) => { if (!creating && patient) e.currentTarget.style.background = 'var(--brand-600)'; }}>
                {creating ? <Spinner color="var(--text-subtle)" /> : <><Icon name="play" size={14} strokeWidth={2.5} /> Start session</>}
              </button>
            </div>
          </div>
        </div>

        {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--danger-600)', fontWeight: 500 }}>{error}</div>}

        {/* Bottom Section: Side-by-Side Lists.
            No `flex: 1` on the row — these cards size to their content
            (plus a sensible min/max) instead of stretching to fill the
            viewport. That kills the empty-middle look when the queue
            is empty. */}
        <div style={{ display: 'flex', gap: 16, height: 460 }}>
          {/* Patients Waiting */}
          <div style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.02)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-muted)' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>Patients waiting</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>{queue.length} in current queue</div>
              </div>
              <div style={{ padding: '4px 10px', background: 'var(--brand-100)', color: 'var(--brand-700)', borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Live Queue</div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {loadingQueue ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {Array.from({ length: 4 }).map((_, i) => <ListItemSkeleton key={i} />)}
                </div>
              ) : queue.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
                    <Icon name="users" size={16} color="var(--text-subtle)" />
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>No patients in the queue.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {queue.map((a) => (
                    <button key={a._id} onClick={() => startFromQueue(a)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                        textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', borderRadius: 8,
                        transition: 'all 0.2s', position: 'relative', overflow: 'hidden'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--brand-300)';
                        e.currentTarget.style.background = 'var(--brand-50)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,23,42,0.04)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.background = 'var(--surface)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}>
                      <Avatar name={a.patientId?.fullName || '?'} size={40} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                            {a.patientId?.fullName || '—'}
                          </span>
                          <StatusPill status={statusToken(a.status)} small />
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Icon name="clock" size={12} />
                          {a.type === 'QUEUE' ? `Token #${a.queueNumber}` : isoToRange(a.startAt, a.endAt)}
                          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--border)' }} />
                          <span style={{ color: a.status === 'IN_PROGRESS' ? 'var(--info-700)' : 'var(--success-700)', fontWeight: 600 }}>
                            {a.status === 'IN_PROGRESS' ? 'Consulting' : 'Ready'}
                          </span>
                        </div>
                      </div>
                      <Icon name="chevronRight" size={16} style={{ color: 'var(--text-subtle)' }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Encounters */}
          <div style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.02)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-muted)', gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>Recent encounters</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>Sessions from last 30 days</div>
              </div>
              <div style={{ position: 'relative', width: 170 }}>
                <Icon name="search" size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                <input value={recentQuery} onChange={(e) => setRecentQuery(e.target.value)}
                  placeholder="Filter sessions…"
                  style={{
                    width: '100%', height: 30, padding: '0 10px 0 30px',
                    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
                    fontSize: 12, color: 'var(--text)', outline: 'none', transition: 'all 0.2s'
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--brand-400)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {loadingRecent ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {Array.from({ length: 6 }).map((_, i) => <ListItemSkeleton key={i} />)}
                </div>
              ) : filteredRecent.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
                  {recentQuery ? 'No sessions match your search.' : 'No recent clinical sessions.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {filteredRecent.map((r) => (
                    <button key={r._id} onClick={() => loadEncounter(r._id)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                        textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8,
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-muted)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      <Avatar name={typeof r.patientId === 'object' ? r.patientId.fullName : '?'} size={38} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                            {typeof r.patientId === 'object' ? r.patientId.fullName : (typeof r.patientId === 'string' ? `#${r.patientId.slice(-6)}` : '—')}
                          </span>
                          <StatusPill status={r.status.toLowerCase()} small />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--brand-600)', background: 'var(--brand-50)', padding: '1px 4px', borderRadius: 4 }}>
                            {r.readableId ?? `#${r._id.slice(-6).toUpperCase()}`}
                          </span>
                          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--border)' }} />
                          {new Date(r.visitedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <Icon name="chevronRight" size={16} style={{ color: 'var(--text-subtle)' }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: '0 8px', fontSize: 12, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
          <Icon name="info" size={14} />
          Your session data is automatically synced across all branch clinics.
        </div>
      </div>
    );
  }

  return (
    <EncounterEditor
      encounter={encounter}
      patient={patient}
      onChanged={setEncounter}
      onClose={() => {
        setEncounter(null);
        setEncounterId(undefined);
        setSelectedAppointmentId(undefined);
        setSelectedEncounterId(undefined);
      }}
    />
  );
}

function EncounterEditor({
  encounter, patient, onChanged, onClose,
}: {
  encounter: Encounter; patient: Patient | null; onChanged: (e: Encounter) => void; onClose: () => void;
}) {
  const { ctx } = useApp();
  const toast = useToast();
  const signed = encounter.status === 'SIGNED';
  // Billing is no longer initiated from the encounter — the consultation
  // bill is auto-issued at booking time (BookSheet → /appointments) and
  // collected before check-in. Any medicine bill flow lives in Pharmacy.

  const [vitals, setVitals] = useState<Record<string, string>>(() => mapVitalsToUi(encounter.vitals));
  const [complaint, setComplaint] = useState(encounter.chiefComplaint ?? '');
  const [diagnosis, setDiagnosis] = useState(encounter.diagnosis ?? '');
  const [notes, setNotes] = useState(encounter.notes ?? '');
  const [followUp, setFollowUp] = useState(encounter.followUpAt ? encounter.followUpAt.slice(0, 10) : '');
  const [diagInput, setDiagInput] = useState('');
  const diags = diagnosis.split('|').map((s) => s.trim()).filter(Boolean);
  const [rx, setRx] = useState<RxItem[]>([{ id: 1, med: '', dose: '', freq: '', dur: '', note: '', qty: '' }]);
  const nextRxId = useRef(2);
  const [rxLoaded, setRxLoaded] = useState(false);
  const [branchInfo, setBranchInfo] = useState<any>(null);
  const [doctorInfo, setDoctorInfo] = useState<any>(null);

  useEffect(() => {
    const promises = [];
    if (ctx.branchId) {
      promises.push(
        apiGet<any>(ctx, `/clinics/${ctx.clinicId}/branches/${ctx.branchId}`)
          .then(data => {
            console.log("BRANCH FETCHED", data);
            setBranchInfo(data);
          })
      );
    }
    promises.push(
      apiGet<any>(ctx, '/me')
        .then(data => {
          console.log("DOCTOR FETCHED", data);
          setDoctorInfo(data);
        })
    );

    Promise.all(promises).catch(err => console.error("FETCH ERROR", err));
  }, [ctx.clinicId, ctx.branchId]);

  const [prescriptionId, setPrescriptionId] = useState<string | null>(null);
  // Human-readable number ("RX-000123") minted on the BE at first save.
  // Printed prominently on the slip so the pharmacist can type it into
  // the Pharmacy tab to load the medicines.
  const [prescriptionNo, setPrescriptionNo] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
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
              qty: it.quantity != null ? String(it.quantity) : '',
              inventoryItemId: it.inventoryItemId,
              medicineCatalogItemId: it.medicineCatalogItemId,
            }));
            setRx(mapped);
            nextRxId.current = mapped.length + 1;
          }
        }
      })
      .catch(() => undefined)
      .finally(() => setLoadingRx(false));
  }, [encounter._id, ctx]);

  // Load existing prescription items when the encounter opens
  useEffect(() => {
    let cancelled = false;
    apiGet<{
      _id: string;
      prescriptionNo?: string;
      items: Array<{
        customName?: string;
        dosage?: string;
        frequency?: string;
        duration?: string;
        instructions?: string;
        quantity?: number;
        inventoryItemId?: string;
        medicineCatalogItemId?: string;
      }>;
    } | null>(ctx, `/encounters/${encounter._id}/prescriptions`).then((res) => {
      if (cancelled) return;
      if (res) {
        setPrescriptionId(res._id);
        setPrescriptionNo(res.prescriptionNo ?? null);
        if (Array.isArray(res.items) && res.items.length > 0) {
          const loaded: RxItem[] = res.items.map((it, i) => ({
            id: i + 1,
            med: it.customName ?? '',
            dose: it.dosage ?? '',
            freq: it.frequency ?? '',
            dur: it.duration ?? '',
            note: it.instructions ?? '',
            qty: it.quantity != null ? String(it.quantity) : '',
            inventoryItemId: it.inventoryItemId,
            medicineCatalogItemId: it.medicineCatalogItemId,
          }));
          nextRxId.current = loaded.length + 1;
          setRx(loaded);
        }
      }
      setRxLoaded(true);
    }).catch(() => setRxLoaded(true));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter._id]);

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
      const [updated] = await Promise.all([
        apiPatch<Encounter>(ctx, `/encounters/${encounter._id}`, {
          chiefComplaint: complaint || undefined,
          diagnosis: diagnosis || undefined,
          notes: notes || undefined,
          vitals: Object.keys(vitals).some(k => !!vitals[k]) ? mapVitalsToBe(vitals) : undefined,
          followUpAt: followUp ? new Date(followUp).toISOString() : undefined,
        }),
        // Persist medicine rows on every draft save so they survive navigation
        (async () => {
          const filled = rx.filter((r) => r.med.trim());
          if (filled.length > 0) {
            const res = await apiPatch<{ _id: string; prescriptionNo?: string }>(
              ctx,
              `/encounters/${encounter._id}/prescriptions`,
              {
                items: filled.map((r) => ({
                  // Prefer the medicineCatalogItemId when the doctor picked an
                  // inventory option — the medicine bill drafter (Slice 3)
                  // resolves stock through it. Free-text rows persist only the
                  // customName.
                  medicineCatalogItemId: r.medicineCatalogItemId || undefined,
                  customName: r.med,
                  dosage: r.dose || undefined,
                  frequency: r.freq || undefined,
                  duration: r.dur || undefined,
                  instructions: r.note || undefined,
                  quantity: r.qty.trim() ? Number(r.qty) || undefined : undefined,
                })),
              });
            if (res?._id) setPrescriptionId(res._id);
            if (res?.prescriptionNo) setPrescriptionNo(res.prescriptionNo);
          }
        })(),
      ]);
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
        const res = await apiPost<{ _id: string; prescriptionNo?: string }>(ctx, `/encounters/${encounter._id}/prescriptions`, {
          items: filled.map((r) => ({
            medicineCatalogItemId: r.medicineCatalogItemId || undefined,
            customName: r.med,
            dosage: r.dose || undefined,
            frequency: r.freq || undefined,
            duration: r.dur || undefined,
            instructions: r.note || undefined,
            quantity: r.qty.trim() ? Number(r.qty) || undefined : undefined,
          })),
        });
        setPrescriptionId(res._id);
        if (res.prescriptionNo) setPrescriptionNo(res.prescriptionNo);
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

  async function shareOnWhatsApp() {
    if (!prescriptionId) return;
    setSharing(true);
    try {
      const { shareToken } = await apiPost<{ shareToken: string }>(ctx, `/prescriptions/${prescriptionId}/share`, {
        expiresInSeconds: 7 * 24 * 60 * 60, // 7 days
      });
      const shareUrl = `${ctx.apiBaseUrl}/share/prescriptions/${shareToken}/pdf`;
      const text = encodeURIComponent(`Hi ${patient?.fullName ?? 'Patient'}, your prescription is ready. You can view it here: ${shareUrl}`);
      window.open(`https://wa.me/${patient?.phones?.[0]?.replace(/\D/g, '') || ''}?text=${text}`, '_blank');
    } catch (e) {
      toast('Could not generate sharing link', 'error');
    } finally {
      setSharing(false);
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                disabled={!branchInfo || !doctorInfo}
                onClick={() => printPrescription({
                  clinic: {
                    name: ctx.clinicName ?? 'Clinic',
                    displayName: ctx.branding?.displayName ?? undefined,
                    logoUrl: resolveLogoSrc(ctx.branding?.logoUrl, ctx.clinicId, ctx.apiBaseUrl),
                    primaryColor: ctx.branding?.primaryColor ?? undefined,
                    branchName: branchInfo?.name ?? ctx.branchName,
                    address: branchInfo?.addressLine,
                    fullAddress: branchInfo?.addressLine,
                    phone: branchInfo?.phone,
                    doctorQuals: doctorInfo?.user?.qualifications,
                    doctorReg: doctorInfo?.user?.registrationNumber,
                  },
                  doctor: { name: ctx.fullName, email: ctx.email },
                  patient,
                  vitals,
                  complaint,
                  diagnosis: diags.join(' | '),
                  rx,
                  notes,
                  followUp,
                  encounter,
                  prescriptionNo,
                })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  height: 32, padding: '0 14px',
                  background: 'var(--brand-500)',
                  border: '1.5px solid var(--brand-500)',
                  borderRadius: 8,
                  color: '#ffffff',
                  fontSize: 12, fontWeight: 600,
                  cursor: (!branchInfo || !doctorInfo) ? 'wait' : 'pointer',
                  opacity: (!branchInfo || !doctorInfo) ? 0.6 : 1
                }}>
                {(!branchInfo || !doctorInfo) ? <><Spinner size={12} /> Loading...</> : <><Icon name="printer" size={13} /> Print</>}
              </button>
              <button
                onClick={shareOnWhatsApp}
                disabled={sharing || !prescriptionId}
                style={{
                  height: 32, width: 36, padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(37,211,102,0.1)',
                  border: '1.5px solid rgba(37,211,102,0.3)',
                  borderRadius: 8,
                  color: '#25D366',
                  fontSize: 12, fontWeight: 600,
                  cursor: 'pointer',
                  opacity: (sharing || !prescriptionId) ? 0.6 : 1
                }}>
                {sharing ? <Spinner size={13} /> : <Icon name="share" size={13} />}
              </button>
              <StatusPill status="signed" small />
            </div>
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
                    gridTemplateColumns: 'minmax(180px, 2fr) 80px 80px 80px minmax(140px, 1.6fr) 40px',
                    gap: 10,
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
                      gridTemplateColumns: 'minmax(180px, 2fr) 80px 80px 80px minmax(140px, 1.6fr) 40px',
                      gap: 10,
                      padding: '8px 12px',
                      background: 'var(--surface-muted)',
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                      alignItems: 'center'
                    }}>
                      <MedicineTypeahead
                        ctx={ctx}
                        branchId={ctx.branchId}
                        value={item.med}
                        onChange={(patch) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, ...patch } : x))}
                        disabled={signed}
                        stockStatus={item.stockStatus}
                        onHand={item.onHand}
                      />
                      <input value={item.dose} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, dose: e.target.value } : x))} disabled={signed} placeholder="1 tab" style={rxInputStyle} />
                      <select value={item.freq} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, freq: e.target.value } : x))} disabled={signed} style={{ ...rxInputStyle, cursor: 'pointer' }}>
                        <option value="">Freq</option>
                        <option>OD</option><option>BD</option><option>TDS</option><option>QID</option><option>SOS</option>
                      </select>
                      <input value={item.dur} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, dur: e.target.value } : x))} disabled={signed} placeholder="7 days" style={rxInputStyle} />
                      <input value={item.note} onChange={(e) => setRx((r) => r.map((x) => x.id === item.id ? { ...x, note: e.target.value } : x))} disabled={signed} placeholder="Instructions" style={rxInputStyle} />

                      {!signed ? (
                        <button onClick={() => setRx((r) => r.filter((x) => x.id !== item.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-500)', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="trash" size={15} />
                        </button>
                      ) : <span />}
                    </div>
                  ))}
                </div>

                {!signed && (
                  <button onClick={() => setRx((r) => [...r, { id: nextRxId.current++, med: '', dose: '', freq: '', dur: '', note: '', qty: '' }])}
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
                <DatePickerChip
                  value={followUp}
                  onChange={setFollowUp}
                  disabled={signed}
                  placeholder="No follow-up scheduled"
                  allowClear
                />
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

          <Section title="Documents" icon="folder">
            {encounter ? (
              <DocumentsScreen fixedOwnerType="ENCOUNTER" fixedOwnerId={encounter._id} />
            ) : (
              <div style={{ padding: '10px 14px', background: 'var(--surface-muted)', border: '1px dotted var(--border)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="info" size={14} style={{ color: 'var(--brand-500)' }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Save a draft first to enable document uploads for this record.</span>
              </div>
            )}
          </Section>

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--text-subtle)' }}>{patient?.fullName} · {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          <button
            disabled={!branchInfo || !doctorInfo}
            onClick={() => printPrescription({
              clinic: {
                name: ctx.clinicName ?? 'Clinic',
                displayName: ctx.branding?.displayName ?? undefined,
                logoUrl: resolveLogoSrc(ctx.branding?.logoUrl, ctx.clinicId, ctx.apiBaseUrl),
                primaryColor: ctx.branding?.primaryColor ?? undefined,
                branchName: branchInfo?.name ?? ctx.branchName,
                address: branchInfo?.addressLine,
                fullAddress: branchInfo?.addressLine,
                phone: branchInfo?.phone,
                doctorQuals: doctorInfo?.user?.qualifications,
                doctorReg: doctorInfo?.user?.registrationNumber,
              },
              doctor: { name: ctx.fullName, email: ctx.email },
              patient,
              vitals,
              complaint,
              diagnosis: diags.join(' | '),
              rx,
              notes,
              followUp,
              encounter,
              prescriptionId,
              prescriptionNo,
            })}
            style={{
              height: 40, padding: '0 18px', background: 'none',
              border: '1.5px solid var(--border)', borderRadius: 10,
              color: 'var(--text-muted)', fontSize: 13, fontWeight: 500,
              cursor: (!branchInfo || !doctorInfo) ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: (!branchInfo || !doctorInfo) ? 0.6 : 1
            }}>
            {(!branchInfo || !doctorInfo) ? <><Spinner size={14} /> Loading details...</> : <><Icon name="printer" size={14} /> Print</>}
          </button>
          {signed && (
            <button
              onClick={shareOnWhatsApp}
              disabled={sharing || !prescriptionId}
              style={{
                height: 40, width: 44, padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(37,211,102,0.1)',
                border: '1.5px solid rgba(37,211,102,0.3)',
                borderRadius: 10,
                color: '#25D366',
                fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
                opacity: (sharing || !prescriptionId) ? 0.6 : 1
              }}>
              {sharing ? <Spinner size={14} /> : <Icon name="share" size={14} />}
            </button>
          )}
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

/**
 * Medicine input + dropdown for the prescription form. Hits
 * /inventory/availability for the doctor's branch and shows a stock chip
 * per result. Two paths:
 *   - Doctor picks an option → row gets `inventoryItemId` +
 *     `medicineCatalogItemId` so the medicine bill can resolve stock later.
 *   - Doctor types a name without picking → row stays free-text;
 *     medicine bill flow will treat it as "not stocked here."
 *
 * Stock chip is only rendered on rows that have a current `stockStatus`
 * (i.e. just picked); previously-saved rows reload without it on purpose
 * to avoid a stale "in stock" claim if levels changed.
 */
function MedicineTypeahead({
  ctx, branchId, value, onChange, disabled, stockStatus, onHand,
}: {
  ctx: any;
  branchId?: string;
  value: string;
  onChange: (patch: Partial<RxItem>) => void;
  disabled?: boolean;
  stockStatus?: RxStockStatus;
  onHand?: number;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<AvailabilityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click. Mousedown rather than click so a click on a
  // result fires before this listener strips the dropdown.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // Debounced fetch on value change. Only when input is focused/open and
  // a branch is set — without branchId the BE returns 400.
  useEffect(() => {
    if (!open || !branchId) return;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ branchId, query: value, limit: '20' });
      setLoading(true);
      apiGet<AvailabilityRow[]>(ctx, `/inventory/availability?${qs.toString()}`)
        .then((rows) => setResults(Array.isArray(rows) ? rows : []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [open, value, branchId, ctx]);

  function pick(row: AvailabilityRow) {
    onChange({
      med: row.name,
      inventoryItemId: row._id,
      medicineCatalogItemId: row.medicineCatalogItemId,
      stockStatus: row.status,
      onHand: row.onHand,
    });
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          value={value}
          onChange={(e) => onChange({
            med: e.target.value,
            // Typing breaks the inventory link until the doctor picks again
            // — without this a free-text edit would still claim the old
            // catalog ID at save time.
            inventoryItemId: undefined,
            medicineCatalogItemId: undefined,
            stockStatus: undefined,
            onHand: undefined,
          })}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          disabled={disabled}
          placeholder="Medicine name"
          style={{
            ...rxInputStyle,
            paddingRight: stockStatus ? 28 : rxInputStyle.padding,
          }}
        />
        {stockStatus && (
          <span
            title={onHand != null ? `${onHand} on hand` : undefined}
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 100,
              background: chipPalette(stockStatus).bg,
              color: chipPalette(stockStatus).fg,
              border: `1px solid ${chipPalette(stockStatus).border}`,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}>
            {stockStatus === 'IN_STOCK' ? 'IN' : stockStatus === 'LOW_STOCK' ? 'LOW' : 'OUT'}
          </span>
        )}
      </div>
      {open && !disabled && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: 'var(--e3, 0 8px 24px rgba(15,23,42,0.12))',
          maxHeight: 260, overflowY: 'auto',
        }}>
          {!branchId && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-subtle)' }}>
              Set a branch in your context to see stock availability.
            </div>
          )}
          {branchId && loading && results.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-subtle)' }}>Searching…</div>
          )}
          {branchId && !loading && results.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-subtle)' }}>
              {value.trim()
                ? 'No stocked match — your typed name will still be saved as a free-text item.'
                : 'Start typing to search inventory.'}
            </div>
          )}
          {results.map((row) => {
            const palette = chipPalette(row.status);
            return (
              <button
                key={row._id}
                type="button"
                onClick={() => pick(row)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', textAlign: 'left',
                  background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>
                    {row.sku ? row.sku + ' · ' : ''}
                    {row.onHand} {row.unit.toLowerCase()}{row.onHand === 1 ? '' : 's'} on hand
                  </div>
                </div>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 100,
                  background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}`,
                  whiteSpace: 'nowrap',
                }}>
                  {row.status === 'IN_STOCK' ? 'In stock' : row.status === 'LOW_STOCK' ? 'Low stock' : 'Out of stock'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function chipPalette(status: RxStockStatus): { bg: string; fg: string; border: string } {
  if (status === 'IN_STOCK') {
    return { bg: 'var(--success-bg)', fg: 'var(--success-text)', border: 'var(--success-200, rgba(34,197,94,0.3))' };
  }
  if (status === 'LOW_STOCK') {
    return { bg: 'var(--warning-bg)', fg: 'var(--warning-text)', border: 'rgba(245,158,11,0.35)' };
  }
  return { bg: 'rgba(239,68,68,0.08)', fg: 'var(--danger-500)', border: 'rgba(239,68,68,0.3)' };
}

function Section({ title, icon, children, defaultOpen }: { title: string; icon: IconName; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  // flexShrink: 0 — without this, when many sections live in the column-flex
  // parent at line 578 their total intrinsic height exceeds the container
  // and flex squashes each child to fit instead of letting the parent scroll.
  // Combined with the wrapper's overflow:hidden (kept here so rounded corners
  // clip the inner border) that produced the "section title with empty body"
  // bug. Holding our natural height makes the parent's overflowY:auto kick in.
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'visible', flexShrink: 0, position: 'relative' }}>
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

// Resolve a brand-logo value (S3 key OR full http URL) into something an
// <img src> in a new-window print template can fetch. S3 keys are
// rewritten to hit the BE's public /clinics/:id/logo passthrough.
function resolveLogoSrc(
  raw: string | null | undefined,
  clinicId: string,
  apiBaseUrl: string,
): string | undefined {
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!clinicId) return undefined;
  return `${apiBaseUrl}/clinics/${encodeURIComponent(clinicId)}/logo`;
}

function printPrescription(input: {
  clinic: {
    name: string;
    displayName?: string;
    logoUrl?: string;
    primaryColor?: string;
    branchName?: string;
    address?: string;
    fullAddress?: string;
    phone?: string;
    doctorQuals?: string;
    doctorReg?: string;
  };
  doctor: { name?: string; email?: string };
  patient: Patient | null;
  vitals: Record<string, string>;
  complaint: string;
  diagnosis: string;
  rx: RxItem[];
  notes: string;
  followUp: string;
  encounter: Encounter;
  prescriptionId?: string | null;
  /** Human-readable Rx number minted on first save (e.g. "RX-000123"). */
  prescriptionNo?: string | null;
}) {
  console.log("PRINT DATA", input);
  const { clinic, doctor, patient, vitals, complaint, diagnosis, rx, notes, followUp, encounter } = input;
  const signed = encounter.status === 'SIGNED';

  const doctorName = doctor.name
    ? doctor.name.toLowerCase().startsWith('dr.')
      ? doctor.name
      : `Dr. ${doctor.name}`
    : 'Doctor';

  const age = patient?.dob ? getAge(patient.dob) : null;
  const gender = patient ? genderWord(patient.gender) : '';
  const phone = patient?.phones?.[0] ?? '';

  const dateStr = new Date(encounter.visitedAt || Date.now()).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const filledVitals = Object.entries(vitals).filter(([, v]) => !!v && v.trim());
  const diagnosisList = diagnosis
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const filledRx = rx.filter((r) => r.med.trim());

  // Resolve branding inputs once. The default blue matches what the
  // template used before the branding feature shipped — clinics that
  // never set a color keep the historical look.
  const brandColor = (clinic.primaryColor || '').trim() || '${brandColor}';
  const headerName = (clinic.displayName || '').trim() || clinic.name || 'Clinic';

  const vitalsHtml = filledVitals.length
    ? `<section class="block">
         <h2>Vitals</h2>
         <div class="vitals-grid">
           ${filledVitals
      .map(([k, v]) => {
        const meta = VITAL_FIELDS.find((f) => f.key === k);
        return `<div class="vital">
                         <div class="label">${escapeHtml(meta?.label ?? k.toUpperCase())}</div>
                         <div class="value">${escapeHtml(v)}</div>
                         <div class="unit">${escapeHtml(meta?.unit ?? '')}</div>
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
         <h2 style="color:#6366F1; font-size: 15px; margin-bottom: 16px;">℞ Prescription</h2>
         <table class="rx-table">
           <thead>
             <tr>
               <th>#</th>
               <th>Medicine</th>
               <th>Dose</th>
               <th>Frequency</th>
               <th>Duration</th>
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
                   <td style="font-size: 12px; color: #64748b;">${escapeHtml(r.note || '—')}</td>
                 </tr>`,
      )
      .join('')}
           </tbody>
         </table>
       </section>`
    : `<section class="block">
         <h2>Prescription (℞)</h2>
         <p class="empty">No medicines prescribed.</p>
       </section>`;

  const followUpHtml = followUp
    ? `<section class="block">
         <h2>Follow-up</h2>
         <p>${escapeHtml(
      new Date(followUp).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }),
    )}</p>
       </section>`
    : '';

  const notesHtml = notes.trim()
    ? `<section class="block">
         <h2>Notes</h2>
         <p style="white-space: pre-wrap;">${escapeHtml(notes.trim())}</p>
       </section>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Prescription — ${escapeHtml(patient?.fullName ?? 'Patient')}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #1a1a1a;
    background: #fff;
    font-size: 13px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    max-width: 794px;
    margin: 0 auto;
    background: #fff;
    padding: 28px 28px 36px;
  }

  /* ── TOOLBAR ─────────────────────────────── */
  .toolbar {
    position: fixed; top: 10px; right: 10px;
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
    background: ${brandColor};
    border-color: ${brandColor};
    color: #fff;
  }
  @media print {
    @page { margin: 0; }
    body { background: #fff; }
    .page { padding: 14mm 16mm; max-width: none; width: 100%; }
    .toolbar { display: none; }
    .patient-strip, .vital-box, .chip { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .rx-table thead { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }

  /* ── HEADER ──────────────────────────────── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 14px;
    border-bottom: 2px solid ${brandColor};
    margin-bottom: 20px;
  }
  .clinic-name {
    font-size: 28px;
    font-weight: 700;
    color: ${brandColor};
    line-height: 1.1;
    margin-bottom: 6px;
  }
  .clinic-addr {
    font-size: 12px;
    color: #6b7280;
    font-weight: 400;
    line-height: 1.7;
  }
  .doctor-block {
    text-align: right;
  }
  .doctor-block .dr-name {
    font-size: 14px;
    font-weight: 700;
    color: #1a1a1a;
    display: block;
    margin-bottom: 2px;
  }
  .doctor-block .dr-cred {
    font-size: 11.5px;
    color: #6b7280;
    font-weight: 400;
    display: block;
    line-height: 1.6;
  }
  .doctor-block .dr-date {
    font-size: 12px;
    font-weight: 700;
    color: ${brandColor};
    display: block;
    margin-top: 4px;
  }
  .rx-no-top {
    font-size: 11px;
    font-weight: 800;
    color: #1e293b;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  /* ── PATIENT STRIP ───────────────────────── */
  .rx-id-strip {
    display: flex; align-items: center; gap: 12px;
    margin: 14px 0 10px;
    padding: 10px 14px;
    background: #f0f7ff;
    border: 1px solid #c7dffd;
    border-left: 4px solid ${brandColor};
    border-radius: 6px;
  }
  .rx-id-label {
    font-size: 11px; font-weight: 700;
    color: ${brandColor};
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .rx-id-value {
    font-family: 'Courier New', ui-monospace, monospace;
    font-size: 18px;
    font-weight: 700;
    color: #1a1a1a;
    letter-spacing: 0.04em;
  }
  .rx-id-hint {
    margin-left: auto;
    font-size: 10px;
    color: #6b7280;
    font-style: italic;
  }
  .patient-strip {
    display: grid;
    grid-template-columns: 1.4fr 1.2fr 0.7fr 1.2fr;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 12px 20px;
    margin-bottom: 22px;
    gap: 0;
  }
  .ps-field {
    padding: 4px 12px 4px 0;
  }
  .ps-field:first-child { padding-left: 0; }
  .ps-value {
    font-size: 14px;
    font-weight: 700;
    color: #1a1a1a;
    display: block;
    margin-bottom: 2px;
  }
  .ps-label {
    font-size: 11px;
    color: #9ca3af;
    font-weight: 400;
    display: block;
  }

  /* ── SECTION HEADING ─────────────────────── */
  .section-title {
    font-size: 11px;
    font-weight: 700;
    color: ${brandColor};
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0 0 10px 0;
  }
  .section { margin-bottom: 20px; }

  /* ── VITALS ──────────────────────────────── */
  .vitals-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
  }
  .vital-box {
    background: #f9fafb;
    border: 1px solid #e9ebee;
    border-radius: 6px;
    padding: 10px 6px;
    text-align: center;
  }
  .vital-lbl {
    font-size: 9.5px;
    font-weight: 600;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: block;
    margin-bottom: 5px;
  }
  .vital-val {
    font-size: 17px;
    font-weight: 700;
    color: #1a1a1a;
    line-height: 1;
  }

  /* ── DIAGNOSIS ───────────────────────────── */
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip {
    padding: 5px 14px;
    border-radius: 20px;
    background: #e8eefb;
    border: 1px solid #c3d2f5;
    color: ${brandColor};
    font-size: 12px;
    font-weight: 500;
  }

  /* ── RX TABLE ────────────────────────────── */
  .rx-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .rx-table thead tr {
    background: #f3f4f6;
  }
  .rx-table th {
    font-size: 11px;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 9px 12px;
    text-align: left;
    border-bottom: 1px solid #e5e7eb;
  }
  .rx-table td {
    padding: 12px 12px;
    border-bottom: 1px solid #f0f0f0;
    color: #1a1a1a;
    font-size: 13px;
    vertical-align: top;
  }
  .rx-table td.med-name {
    font-weight: 600;
    color: #1a1a1a;
  }

  /* ── NOTES ───────────────────────────────── */
  .notes-text {
    font-size: 13px;
    color: #374151;
    white-space: pre-wrap;
    line-height: 1.6;
  }

  /* ── FOOTER ──────────────────────────────── */
  .foot {
    margin-top: 48px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .foot-meta {
    font-size: 10px;
    color: #9ca3af;
    line-height: 1.7;
  }
  .signature-block {
    text-align: right;
    min-width: 200px;
  }
  .sig-line {
    border-bottom: 1.5px solid #1a1a1a;
    margin-bottom: 6px;
    padding-bottom: 0;
    height: 1px;
    width: 100%;
  }
  .sig-name {
    font-size: 13px;
    font-weight: 700;
    color: #1a1a1a;
    text-align: right;
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
      <div style="display:flex; align-items:center; gap:14px;">
        ${clinic.logoUrl ? `<img src="${escapeHtml(clinic.logoUrl)}" alt="" style="max-height:60px; max-width:120px; object-fit:contain;" onerror="this.style.display='none'" />` : ''}
        <div>
          <div class="clinic-name">${escapeHtml(headerName)}</div>
          <div class="clinic-addr">
            ${escapeHtml(clinic.branchName || 'Main Branch')}<br>
            ${clinic.fullAddress || clinic.address || ''} ${clinic.phone ? ' · ' + escapeHtml(clinic.phone) : ''}
          </div>
        </div>
      </div>
      <div class="doctor-block">
        <div class="rx-no-top">Rx No: ${escapeHtml(`#${(input.prescriptionNo || input.prescriptionId || encounter._id || '').slice(-6).toUpperCase()}`)}</div>
        <span class="dr-name">${escapeHtml(doctorName)}</span>
        <span class="dr-cred">${escapeHtml(clinic.doctorQuals || '')}</span>
        <span class="dr-cred">${clinic.doctorReg ? 'Reg No: ' + escapeHtml(clinic.doctorReg) : ''}</span>
        <span class="dr-date">${escapeHtml(dateStr)}</span>
      </div>
    </header>



    <!-- PATIENT STRIP -->
    <section class="patient-strip">
      <div class="ps-field">
        <span class="ps-value">${escapeHtml(patient?.fullName ?? '—')}</span>
        <span class="ps-label">Patient</span>
      </div>
      <div class="ps-field">
        <span class="ps-value">${gender ? escapeHtml(gender) : '—'} · ${age != null ? `${age} yrs` : '—'}</span>
        <span class="ps-label">Demographics</span>
      </div>
      <div class="ps-field">
        <span class="ps-value">B+</span>
        <span class="ps-label">Blood group</span>
      </div>
      <div class="ps-field">
        <span class="ps-value">${escapeHtml(phone || '—')}</span>
        <span class="ps-label">Phone</span>
      </div>
    </section>

    <!-- VITALS -->
    ${filledVitals.length ? `
    <section class="section">
      <div class="section-title">Vitals</div>
      <div class="vitals-grid">
        ${filledVitals.map(([k, v]) => {
    const meta = VITAL_FIELDS.find((f) => f.key === k);
    return `<div class="vital-box">
            <span class="vital-lbl">${escapeHtml(meta?.label ?? k.toUpperCase())}</span>
            <span class="vital-val">${escapeHtml(v)}${meta?.unit ? `<span style="font-size:11px;font-weight:500;color:#6b7280;">${escapeHtml(meta.unit)}</span>` : ''}</span>
          </div>`;
  }).join('')}
      </div>
    </section>` : ''}

    <!-- CHIEF COMPLAINT -->
    ${complaint.trim() ? `
    <section class="section">
      <div class="section-title">Chief Complaint</div>
      <p style="font-size:13px;color:#374151;">${escapeHtml(complaint.trim())}</p>
    </section>` : ''}

    <!-- DIAGNOSIS -->
    ${diagnosisList.length ? `
    <section class="section">
      <div class="section-title">Diagnosis</div>
      <div class="chips">${diagnosisList.map((d) => `<span class="chip">${escapeHtml(d)}</span>`).join('')}</div>
    </section>` : ''}

    <!-- PRESCRIPTION -->
    ${filledRx.length ? `
    <section class="section">
      <div class="section-title">Prescription (&#8478;)</div>
      <table class="rx-table">
        <thead>
          <tr>
            <th style="width:32%;">Medicine</th>
            <th style="width:14%;">Dose</th>
            <th style="width:16%;">Frequency</th>
            <th style="width:16%;">Duration</th>
            <th>Instructions</th>
          </tr>
        </thead>
        <tbody>
          ${filledRx.map((r) => `
          <tr>
            <td class="med-name">${escapeHtml(r.med)}</td>
            <td>${escapeHtml(r.dose || '—')}</td>
            <td>${escapeHtml(r.freq || '—')}</td>
            <td>${escapeHtml(r.dur || '—')}</td>
            <td style="color:#374151;">${escapeHtml(r.note || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </section>` : ''}

    <!-- FOLLOW-UP -->
    ${followUp ? `
    <section class="section">
      <div class="section-title">Follow-up</div>
      <p style="font-size:13px;color:#374151;">${escapeHtml(new Date(followUp).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }))}</p>
    </section>` : ''}

    <!-- NOTES -->
    ${notes.trim() ? `
    <section class="section">
      <div class="section-title">Notes</div>
      <p class="notes-text">${escapeHtml(notes.trim())}</p>
    </section>` : ''}

    <!-- FOOTER -->
    <footer class="foot">
      <div class="foot-meta">
        Generated by DigiRx · digirx.in<br>
        This prescription is valid for 30 days from the date of issue.

      </div>
      <div class="signature">
        <div class="line" style="border-bottom: 2px solid #0f172a; min-width: 180px; margin-bottom: 6px;"></div>
        <div class="who" style="font-weight: 700; color: #0f172a;">${escapeHtml(doctorName)}</div>
        <div style="font-size: 10px; color: #64748b; margin-top: 2px;">
          ${escapeHtml(clinic.doctorQuals || '')}
          ${clinic.doctorReg ? '<br>Reg No: ' + escapeHtml(clinic.doctorReg) : ''}
        </div>
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
