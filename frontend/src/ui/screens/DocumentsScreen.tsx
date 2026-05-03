import { useRef, useState } from 'react';
import { apiGet, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { EmptyState, Field, Spinner, formatDateTime, labelStyle, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';

type UploadResp = { documentId: string; storageKey: string; uploadUrl: string; expiresInSeconds: number };
type DownloadResp = { url: string; expiresInSeconds: number };
type ShareResp = { token: string; expiresAt: string | null; maxViews: number | null };

const OWNER_TYPES = ['PATIENT', 'APPOINTMENT', 'ENCOUNTER', 'BILL', 'PRESCRIPTION'] as const;
type OwnerType = typeof OWNER_TYPES[number];

type LocalDoc = {
  documentId: string;
  fileName: string;
  ownerType: OwnerType;
  ownerId: string;
  mimeType: string;
  uploadedAt: string;
};

const LOCAL_KEY = 'digirx.docs.recent.v1';
function loadRecent(): LocalDoc[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as LocalDoc[]; } catch { return []; }
}
function saveRecent(list: LocalDoc[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, 50)));
}

export function DocumentsScreen() {
  const { ctx } = useApp();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [ownerType, setOwnerType] = useState<OwnerType>('PATIENT');
  const [ownerId, setOwnerId] = useState('');
  const [recent, setRecent] = useState<LocalDoc[]>(() => loadRecent());
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<LocalDoc | null>(null);

  async function handleFile(file: File) {
    if (!ownerId.trim()) { setError('Set an Owner ID (e.g. patient ObjectId) first.'); return; }
    setError(null);
    setProgress(0);
    try {
      const res = await apiPost<UploadResp>(ctx, '/documents/upload-url', {
        ownerType,
        ownerId: ownerId.trim(),
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        access: 'INTERNAL_ONLY',
      });
      // Upload file directly to presigned URL
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', res.uploadUrl, true);
        if (file.type) xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(file);
      });
      const local: LocalDoc = {
        documentId: res.documentId,
        fileName: file.name,
        ownerType, ownerId: ownerId.trim(),
        mimeType: file.type || 'application/octet-stream',
        uploadedAt: new Date().toISOString(),
      };
      const next = [local, ...recent.filter((d) => d.documentId !== local.documentId)];
      setRecent(next);
      saveRecent(next);
      toast(`${file.name} uploaded`, 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  async function downloadDoc(doc: LocalDoc) {
    try {
      const res = await apiGet<DownloadResp>(ctx, `/documents/${doc.documentId}/download`);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Download failed', 'error');
    }
  }

  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>Documents</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Upload, share, and revoke. Recent uploads are tracked in this browser.</p>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Owner type</label>
            <select value={ownerType} onChange={(e) => setOwnerType(e.target.value as OwnerType)}
              style={{ width: '100%', height: 40, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none', cursor: 'pointer' }}>
              {OWNER_TYPES.map((t) => <option key={t} value={t}>{t[0] + t.slice(1).toLowerCase()}</option>)}
            </select>
          </div>
          <div style={{ flex: 2 }}>
            <Field label="Owner ID (e.g. Patient ObjectId)" value={ownerId} onChange={setOwnerId} placeholder="ObjectId" />
          </div>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f); }}
          onClick={() => progress === null && fileInputRef.current?.click()}
          style={{ border: `2px dashed var(--border)`, borderRadius: 14, padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: progress !== null ? 'default' : 'pointer', background: 'var(--surface-muted)', minHeight: 140 }}>
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
          {progress === null ? (
            <>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="upload" size={18} style={{ color: 'var(--brand-500)' }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Drop a file here or <span style={{ color: 'var(--brand-500)' }}>browse</span></div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 3 }}>Files are uploaded to the configured object store.</div>
              </div>
            </>
          ) : (
            <div style={{ width: '100%', maxWidth: 360 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8, textAlign: 'center' }}>Uploading… {progress}%</div>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'var(--brand-500)', borderRadius: 2, transition: 'width 120ms' }} />
              </div>
            </div>
          )}
        </div>
        {error && <div style={{ marginTop: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Recent uploads</div>
        {recent.length === 0 ? (
          <EmptyState illustration="documents" title="No documents tracked yet" hint="Uploaded documents from this device will show up here." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            {recent.map((doc, i) => (
              <div key={doc.documentId} style={{ animation: `slideUp 150ms ease-out ${i * 20}ms both` }}>
                <DocCard doc={doc} onDownload={() => downloadDoc(doc)} onShare={() => setSharing(doc)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {sharing && <ShareDialog doc={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}

function DocCard({ doc, onDownload, onShare }: { doc: LocalDoc; onDownload: () => void; onShare: () => void }) {
  const isPdf = (doc.mimeType || '').includes('pdf') || doc.fileName.toLowerCase().endsWith('.pdf');
  return (
    <div
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
        overflow: 'hidden', position: 'relative', transition: 'box-shadow 120ms, border-color 120ms',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--e2)';
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-strong)';
        const overlay = e.currentTarget.querySelector<HTMLDivElement>('[data-doc-overlay]');
        if (overlay) overlay.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
        const overlay = e.currentTarget.querySelector<HTMLDivElement>('[data-doc-overlay]');
        if (overlay) overlay.style.opacity = '0';
      }}
    >
      <div style={{ padding: 12, paddingBottom: 8 }}>
        <div style={{
          width: '100%', aspectRatio: '4/3',
          background: isPdf ? 'rgba(59,130,246,0.06)' : 'rgba(20,184,166,0.06)',
          border: `1.5px solid ${isPdf ? 'rgba(59,130,246,0.15)' : 'rgba(20,184,166,0.15)'}`,
          borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, position: 'relative',
        }}>
          <Icon name={isPdf ? 'fileText' : 'eye'} size={28}
            style={{ color: isPdf ? 'var(--brand-500)' : 'var(--accent-500)', position: 'relative' }} />
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
            color: isPdf ? 'var(--brand-500)' : 'var(--accent-500)', position: 'relative' }}>
            {isPdf ? 'PDF' : 'IMG'}
          </span>
        </div>
      </div>
      <div style={{ padding: '0 12px 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.fileName}>{doc.fileName}</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 6 }}>{doc.ownerType} · {doc.mimeType.split('/')[0]}</div>
        <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{formatDateTime(doc.uploadedAt)}</div>
      </div>

      <div data-doc-overlay
        style={{
          position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          borderRadius: 14, opacity: 0, transition: 'opacity 120ms ease-out', pointerEvents: 'auto',
        }}>
        <button onClick={onShare}
          style={{ height: 34, padding: '0 14px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name="send" size={12} /> Share
        </button>
        <button onClick={onDownload}
          style={{ height: 34, padding: '0 12px', background: 'var(--on-brand-soft-bg)', color: 'var(--brand-text)', border: '1px solid var(--on-brand-soft-border)', borderRadius: 9, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name="download" size={12} />
        </button>
      </div>
    </div>
  );
}

function ShareDialog({ doc, onClose }: { doc: LocalDoc; onClose: () => void }) {
  const { ctx } = useApp();
  const toast = useToast();
  const [expiry, setExpiry] = useState<'1d' | '7d' | '30d' | 'never'>('7d');
  const [maxViews, setMaxViews] = useState<'off' | '1' | '3' | '5'>('off');
  const [generating, setGenerating] = useState(false);
  const [share, setShare] = useState<ShareResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true); setError(null);
    try {
      const expiresInSeconds = expiry === '1d' ? 86400 : expiry === '7d' ? 86400 * 7 : expiry === '30d' ? 86400 * 30 : undefined;
      const body: Record<string, unknown> = {};
      if (expiresInSeconds) body.expiresInSeconds = expiresInSeconds;
      if (maxViews !== 'off') body.maxViews = Number(maxViews);
      const res = await apiPost<ShareResp>(ctx, `/documents/${doc.documentId}/share`, body);
      setShare(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function revoke() {
    try {
      await apiPost(ctx, `/documents/${doc.documentId}/share/revoke`, {});
      toast('Link revoked', 'error');
      setShare(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const link = share ? `${ctx.apiBaseUrl}/share/${share.token}` : '';

  function copy() {
    if (!link) return;
    navigator.clipboard?.writeText(link).then(() => toast('Link copied', 'success')).catch(() => undefined);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 18, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: 460, animation: 'slideUp 200ms ease-out', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Share document</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Link expires after</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['1d', '7d', '30d', 'never'] as const).map((v) => (
                <button key={v} onClick={() => setExpiry(v)}
                  style={{ flex: 1, padding: '7px 0', border: `1.5px solid ${expiry === v ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 9, background: expiry === v ? 'var(--brand-50)' : 'var(--surface-muted)', color: expiry === v ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 12, fontWeight: expiry === v ? 600 : 400, cursor: 'pointer' }}>
                  {v === '1d' ? '1 day' : v === '7d' ? '7 days' : v === '30d' ? '30 days' : 'Never'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Max views</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['off', 'Unlimited'], ['1', '1 view'], ['3', '3 views'], ['5', '5 views']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setMaxViews(v)}
                  style={{ flex: 1, padding: '7px 0', border: `1.5px solid ${maxViews === v ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 9, background: maxViews === v ? 'var(--brand-50)' : 'var(--surface-muted)', color: maxViews === v ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 12, fontWeight: maxViews === v ? 600 : 400, cursor: 'pointer' }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

          {!share ? (
            <button onClick={generate} disabled={generating}
              style={{ height: 40, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: generating ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {generating ? <Spinner /> : <><Icon name="send" size={14} /> Generate share link</>}
            </button>
          ) : (
            <div>
              <label style={labelStyle}>Shareable link</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, height: 38, padding: '0 12px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 9, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace' }}>{link}</span>
                </div>
                <button onClick={copy}
                  style={{ height: 38, padding: '0 16px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <Icon name="send" size={13} /> Copy
                </button>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-subtle)' }}>
                {share.expiresAt ? `Expires ${formatDateTime(share.expiresAt)}` : 'No expiry'}
                {share.maxViews ? ` · ${share.maxViews} views max` : ''}
              </div>
              <button onClick={revoke}
                style={{ marginTop: 12, height: 36, padding: '0 14px', background: 'none', border: '1.5px solid var(--danger-500)', color: 'var(--danger-500)', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Revoke link
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
