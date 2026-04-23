import { useMemo, useState } from 'react';
import type { DevContext } from '../../app/context';
import { apiGet, apiPost } from '../../app/api';
import { Card, Field, PrimaryButton, SecondaryButton, SheetFrame } from '../components/ui';

type Encounter = { _id: string };
type Prescription = { _id: string };
type PdfUrlResponse = { url: string; expiresInSeconds: number; documentId: string };

export function ConsultationSheet({
  ctx,
  patientId,
  onClose,
}: {
  ctx: DevContext;
  patientId: string;
  onClose: () => void;
}) {
  const canCall = useMemo(
    () => Boolean(ctx.apiBaseUrl && ctx.clinicId && (ctx.accessToken || ctx.userId) && ctx.branchId),
    [ctx],
  );

  const [doctorId, setDoctorId] = useState(ctx.userId); // default: current user
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [encounterId, setEncounterId] = useState<string>('');

  const [medName, setMedName] = useState('');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState('');
  const [duration, setDuration] = useState('');
  const [instructions, setInstructions] = useState('');
  const [prescriptionId, setPrescriptionId] = useState<string>('');

  const [status, setStatus] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  async function startEncounter() {
    if (!canCall) return;
    setErr(null);
    setStatus('Creating encounter…');
    try {
      const enc = await apiPost<Encounter>(ctx, '/encounters', {
        branchId: ctx.branchId,
        doctorId,
        patientId,
        visitedAt: new Date().toISOString(),
        chiefComplaint: chiefComplaint.trim() || undefined,
      });
      setEncounterId(enc._id);
      setStatus(`Encounter created: ${enc._id}`);
    } catch (e) {
      setErr(String(e));
      setStatus('');
    }
  }

  async function createPrescription() {
    if (!canCall || !encounterId) return;
    setErr(null);
    setStatus('Creating prescription…');
    try {
      const rx = await apiPost<Prescription>(ctx, `/encounters/${encounterId}/prescriptions`, {
        items: [
          {
            customName: medName.trim(),
            dosage: dosage.trim() || undefined,
            frequency: frequency.trim() || undefined,
            duration: duration.trim() || undefined,
            instructions: instructions.trim() || undefined,
          },
        ],
      });
      setPrescriptionId(rx._id);
      setStatus(`Prescription created: ${rx._id}`);
    } catch (e) {
      setErr(String(e));
      setStatus('');
    }
  }

  async function downloadPdf() {
    if (!canCall || !prescriptionId) return;
    setErr(null);
    setStatus('Generating PDF…');
    try {
      const pdf = await apiGet<PdfUrlResponse>(ctx, `/prescriptions/${prescriptionId}/pdf`);
      window.open(pdf.url, '_blank', 'noopener,noreferrer');
      setStatus('Opened PDF in new tab.');
    } catch (e) {
      setErr(String(e));
      setStatus('');
    }
  }

  return (
    <SheetFrame title="Consultation" onClose={onClose}>
      {!canCall ? (
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/90 p-3 text-xs font-medium text-amber-900">
          Open Home: set clinic, branch, and sign in.
        </div>
      ) : null}

      <Card title="Encounter">
        <Field label="Doctor ID" value={doctorId} onChange={setDoctorId} />
        <Field label="Chief complaint" value={chiefComplaint} onChange={setChiefComplaint} placeholder="Optional" />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => void startEncounter()} disabled={!canCall || !doctorId.trim()}>
            {encounterId ? 'Recreate' : 'Start'}
          </PrimaryButton>
        </div>
        {encounterId ? (
          <div className="mt-2 font-mono text-[11px] text-brand-inkMuted">Encounter ID: {encounterId}</div>
        ) : null}
      </Card>

      <Card title="Prescription">
        <Field label="Medicine (custom)" value={medName} onChange={setMedName} placeholder="e.g. Paracetamol 650mg" />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Dosage" value={dosage} onChange={setDosage} placeholder="1 tab" />
          <Field label="Frequency" value={frequency} onChange={setFrequency} placeholder="BD" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Duration" value={duration} onChange={setDuration} placeholder="5 days" />
          <Field label="Instructions" value={instructions} onChange={setInstructions} placeholder="After food" />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <SecondaryButton onClick={() => void downloadPdf()} type="button">
            PDF
          </SecondaryButton>
          <PrimaryButton onClick={() => void createPrescription()} disabled={!canCall || !encounterId || !medName.trim()}>
            Create Rx
          </PrimaryButton>
        </div>

        {prescriptionId ? (
          <div className="mt-2 font-mono text-[11px] text-brand-inkMuted">Prescription ID: {prescriptionId}</div>
        ) : null}
      </Card>

      {err ? <div className="text-xs font-medium text-rose-700">{err}</div> : null}
      {status ? <div className="text-xs text-brand-inkMuted">{status}</div> : null}
    </SheetFrame>
  );
}

