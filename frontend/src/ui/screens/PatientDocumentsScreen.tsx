import { useMemo, useState } from 'react';
import type { DevContext } from '../../app/context';
import { apiGet, apiPost } from '../../app/api';
import { Card, PrimaryButton, SecondaryButton, SheetFrame } from '../components/ui';

type UploadUrlResponse = {
  documentId: string;
  storageKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
};

type DownloadUrlResponse = { url: string; expiresInSeconds: number };
type ShareResponse = { token: string; expiresAt: string };

export function PatientDocumentsScreen({
  ctx,
  patientId,
  onClose,
}: {
  ctx: DevContext;
  patientId: string;
  onClose: () => void;
}) {
  const canCall = useMemo(
    () => Boolean(ctx.apiBaseUrl && ctx.clinicId && (ctx.accessToken || ctx.userId)),
    [ctx],
  );
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [shareToken, setShareToken] = useState<string>('');

  async function upload() {
    if (!canCall || !file) return;
    setErr(null);
    setStatus('Requesting upload URL…');
    setDownloadUrl('');
    setShareToken('');

    try {
      const up = await apiPost<UploadUrlResponse>(ctx, '/documents/upload-url', {
        ownerType: 'PATIENT',
        ownerId: patientId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        access: 'INTERNAL_ONLY',
      });

      setStatus('Uploading to storage…');
      const putRes = await fetch(up.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);

      setStatus('Fetching download URL…');
      const dl = await apiGet<DownloadUrlResponse>(ctx, `/documents/${up.documentId}/download`);
      setDownloadUrl(dl.url);
      setStatus(`Uploaded. Document ID: ${up.documentId}`);
    } catch (e) {
      setErr(String(e));
      setStatus('');
    }
  }

  async function shareLatest() {
    setErr(null);
    setStatus('Sharing…');
    try {
      const docIdMatch = status.match(/Document ID: ([a-f0-9]{24})/i);
      const documentId = docIdMatch?.[1];
      if (!documentId) throw new Error('Upload a document first');
      const share = await apiPost<ShareResponse>(ctx, `/documents/${documentId}/share`, { expiresInSeconds: 7 * 24 * 3600 });
      setShareToken(share.token);
      setStatus(`Shared (expires: ${share.expiresAt})`);
    } catch (e) {
      setErr(String(e));
      setStatus('');
    }
  }

  return (
    <SheetFrame title="Patient document" onClose={onClose}>
      <Card title="Upload">
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-brand-ink file:mr-3 file:rounded-xl file:border-0 file:bg-violet-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand-ink hover:file:bg-fuchsia-50"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => void upload()} disabled={!file || !canCall}>
            Upload
          </PrimaryButton>
        </div>
        {err ? <div className="mt-2 text-xs font-medium text-rose-700">{err}</div> : null}
        {status ? <div className="mt-2 text-xs text-brand-inkMuted">{status}</div> : null}
      </Card>

      {downloadUrl ? (
        <Card title="Download">
          <a
            className="break-all text-xs font-semibold text-fuchsia-700 underline decoration-fuchsia-300/60 underline-offset-2 hover:text-fuchsia-800"
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open signed download URL
          </a>
          <div className="mt-2">
            <PrimaryButton onClick={() => void shareLatest()}>Create share link</PrimaryButton>
          </div>
        </Card>
      ) : null}

      {shareToken ? (
        <Card title="Share token link">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-inkMuted/90">Public endpoint</div>
          <div className="mt-1 break-all font-mono text-xs text-brand-ink">{ctx.apiBaseUrl}/share/{shareToken}</div>
        </Card>
      ) : null}
    </SheetFrame>
  );
}

