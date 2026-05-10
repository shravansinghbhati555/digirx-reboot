import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Avatar, EmptyState, Field, Spinner, formatDateTime, labelStyle, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';

type UploadResp = { documentId: string; storageKey: string; uploadUrl: string; expiresInSeconds: number };
type DownloadResp = { url: string; expiresInSeconds: number };
type ShareResp = { token: string; expiresAt: string | null; maxViews: number | null };

const OWNER_TYPES = ['PATIENT', 'APPOINTMENT', 'ENCOUNTER', 'BILL', 'PRESCRIPTION'] as const;
type OwnerType = typeof OWNER_TYPES[number];

const DOCUMENT_CATEGORIES = [
  { value: 'LAB_REPORT', label: 'Lab Report', icon: 'activity' },
  { value: 'IMAGING', label: 'Imaging (X-Ray/MRI)', icon: 'eye' },
  { value: 'PRESCRIPTION', label: 'Prescription', icon: 'pill' },
  { value: 'CONSENT_FORM', label: 'Consent Form', icon: 'fileText' },
  { value: 'IDENTITY_PROOF', label: 'Identity Proof', icon: 'user' },
  { value: 'OTHER', label: 'Other', icon: 'folder' },
] as const;
type DocumentCategory = typeof DOCUMENT_CATEGORIES[number]['value'];

type ServerDoc = {
  _id: string;
  fileName: string;
  ownerType: OwnerType;
  ownerId: string;
  ownerName?: string;
  category: DocumentCategory;
  mimeType: string;
  access: 'INTERNAL_ONLY' | 'SHAREABLE_WITH_TOKEN';
  createdAt: string;
};

type Patient = { _id: string; fullName: string; gender?: string; dob?: string; phones?: string[] };

export function DocumentsScreen({ fixedOwnerType, fixedOwnerId }: { fixedOwnerType?: OwnerType; fixedOwnerId?: string }) {
  const { ctx, setScreen } = useApp();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [ownerType, setOwnerType] = useState<OwnerType>(fixedOwnerType || 'PATIENT');
  const [ownerId, setOwnerId] = useState(fixedOwnerId || '');
  const [ownerName, setOwnerName] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('OTHER');
  const [access, setAccess] = useState<'INTERNAL_ONLY' | 'SHAREABLE_WITH_TOKEN'>('INTERNAL_ONLY');
  
  const [documents, setDocuments] = useState<ServerDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ServerDoc | null>(null);
  const [previewing, setPreviewing] = useState<ServerDoc | null>(null);

  const isEmbedded = !!fixedOwnerId;

  async function fetchDocuments() {
    setLoadingDocs(true);
    try {
      const qs = new URLSearchParams();
      if (fixedOwnerId) {
        qs.set('ownerType', fixedOwnerType || 'PATIENT');
        qs.set('ownerId', fixedOwnerId);
      }
      if (searchQuery.trim()) {
        qs.set('query', searchQuery.trim());
      }
      const docs = await apiGet<ServerDoc[]>(ctx, `/documents?${qs.toString()}`);
      setDocuments(docs || []);
    } catch (e) {
      toast('Failed to load documents', 'error');
    } finally {
      setLoadingDocs(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void fetchDocuments();
    }, searchQuery ? 500 : 0);
    return () => clearTimeout(t);
  }, [ctx, fixedOwnerId, fixedOwnerType, searchQuery]);

  async function handleFile(file: File) {
    if (!ownerId.trim()) { setError('Please select a patient first.'); return; }
    setError(null);
    setProgress(0);
    try {
      const res = await apiPost<UploadResp>(ctx, '/documents/upload-url', {
        ownerType,
        ownerId: ownerId.trim(),
        ownerName: ownerName || undefined,
        category,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        access,
      });

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
      
      await apiPost(ctx, `/documents/${res.documentId}/confirm`, {});
      toast(`${file.name} uploaded`, 'success');
      void fetchDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  async function downloadDoc(doc: ServerDoc) {
    try {
      const res = await apiGet<DownloadResp>(ctx, `/documents/${doc._id}/download`);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Download failed', 'error');
    }
  }

  async function deleteDoc(doc: ServerDoc) {
    if (!confirm(`Are you sure you want to delete ${doc.fileName}?`)) return;
    try {
      await apiDelete(ctx, `/documents/${doc._id}`);
      toast('Document deleted', 'success');
      setDocuments(docs => docs.filter(d => d._id !== doc._id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  }

  return (
    <div style={{ padding: isEmbedded ? 0 : '24px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {!isEmbedded && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 24, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px' }}>Document Center</h1>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>Manage and archive clinical records across all patients.</p>
          </div>
        </div>
      )}

      {/* Uploader Section */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          {!isEmbedded && (
            <div style={{ flex: '1 1 300px' }}>
              <label style={labelStyle}>Assign to Patient</label>
              <PatientSearch onSelect={(p) => { setOwnerId(p._id); setOwnerName(p.fullName); setOwnerType('PATIENT'); }} selectedName={ownerName} onClear={() => { setOwnerId(''); setOwnerName(''); }} />
            </div>
          )}
          <div style={{ flex: '1 1 200px' }}>
            <label style={labelStyle}>Document Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}
              style={{ width: '100%', height: 42, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', cursor: 'pointer' }}>
              {DOCUMENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={labelStyle}>Access Level</label>
            <select value={access} onChange={(e) => setAccess(e.target.value as any)}
              style={{ width: '100%', height: 42, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', cursor: 'pointer' }}>
              <option value="INTERNAL_ONLY">Internal Clinic Use</option>
              <option value="SHAREABLE_WITH_TOKEN">Patient Shareable</option>
            </select>
          </div>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f); }}
          onClick={() => progress === null && fileInputRef.current?.click()}
          style={{ 
            border: `2px dashed ${progress !== null ? 'var(--border)' : 'var(--brand-300)'}`, 
            borderRadius: 14, padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, 
            cursor: progress !== null ? 'default' : 'pointer', background: 'var(--surface-muted)', transition: 'all 0.2s ease',
            opacity: (!ownerId && !isEmbedded) ? 0.6 : 1,
            pointerEvents: (!ownerId && !isEmbedded) ? 'none' : 'auto'
          }}>
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
          {progress === null ? (
            <>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <Icon name="upload" size={20} style={{ color: 'var(--brand-500)' }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                  {!ownerId && !isEmbedded ? 'Select a patient to start upload' : 'Click to upload or drag & drop'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>PDF, JPEG, PNG, or DICOM. Max 50MB.</div>
              </div>
            </>
          ) : (
            <div style={{ width: '100%', maxWidth: 400 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-600)' }}>Uploading...</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-600)' }}>{progress}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 100, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'var(--brand-500)', transition: 'width 150ms ease-out' }} />
              </div>
            </div>
          )}
        </div>
        {error && <div style={{ marginTop: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--danger-600)', fontWeight: 500 }}>{error}</div>}
      </div>

      {/* List Section */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            {isEmbedded ? 'Recent Files' : 'All Documents'}
            {loadingDocs && <Spinner size={16} />}
          </div>
          {!isEmbedded && (
            <div style={{ position: 'relative', width: 260 }}>
              <Icon name="search" size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search files or patients..."
                style={{ width: '100%', height: 38, padding: '0 12px 0 34px', background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, outline: 'none', transition: 'border-color 0.2s' }}
                onFocus={(e) => e.currentTarget.style.borderColor = 'var(--brand-500)'}
                onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
              />
              {loadingDocs && <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}><Spinner size={14} /></div>}
            </div>
          )}
        </div>

        {!loadingDocs && documents.length === 0 ? (
          <EmptyState illustration="documents" title="No documents found" hint={searchQuery ? "Try a different search term." : "Upload clinical records to see them here."} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {documents.map((doc, i) => (
              <DocCard key={doc._id} doc={doc} onPreview={() => setPreviewing(doc)} onDownload={() => downloadDoc(doc)} onShare={() => setSharing(doc)} onDelete={() => deleteDoc(doc)} showOwner={!isEmbedded} />
            ))}
          </div>
        )}
      </div>

      {sharing && <ShareDialog doc={sharing} onClose={() => setSharing(null)} />}
      {previewing && <DocumentViewer doc={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
}

function DocCard({ doc, onPreview, onDownload, onShare, onDelete, showOwner }: { doc: ServerDoc; onPreview: () => void; onDownload: () => void; onShare: () => void; onDelete: () => void; showOwner?: boolean }) {
  const cat = DOCUMENT_CATEGORIES.find(c => c.value === doc.category) || DOCUMENT_CATEGORIES[5];

  return (
    <div 
      onClick={onPreview}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, display: 'flex', gap: 14, position: 'relative', transition: 'all 0.2s ease', boxShadow: 'var(--shadow-sm)', cursor: 'pointer' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--brand-400)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--surface-muted)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={cat.icon as any} size={22} style={{ color: 'var(--brand-500)' }} />
      </div>
      
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.fileName}>{doc.fileName}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--brand-600)', background: 'var(--brand-50)', padding: '2px 8px', borderRadius: 100 }}>{cat.label}</span>
          {doc.access === 'SHAREABLE_WITH_TOKEN' && <Icon name="share" size={10} style={{ color: 'var(--success-500)' }} />}
        </div>
        {showOwner && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon name="user" size={12} /> {doc.ownerName || 'Unknown Patient'}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>{formatDateTime(doc.createdAt)}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} onClick={e => e.stopPropagation()}>
        <button onClick={onDownload} style={actionButtonStyle} title="Download"><Icon name="download" size={14} /></button>
        {doc.access !== 'INTERNAL_ONLY' && <button onClick={onShare} style={actionButtonStyle} title="Share"><Icon name="send" size={14} /></button>}
        <button onClick={onDelete} style={{ ...actionButtonStyle, color: 'var(--danger-500)' }} title="Delete"><Icon name="trash" size={14} /></button>
      </div>
    </div>
  );
}

function DocumentViewer({ doc, onClose }: { doc: ServerDoc; onClose: () => void }) {
  const { ctx } = useApp();
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<DownloadResp>(ctx, `/documents/${doc._id}/download`)
      .then(res => setUrl(res.url))
      .catch(() => toast('Failed to load preview', 'error'))
      .finally(() => setLoading(false));
  }, [doc, ctx]);

  const isPdf = (doc.mimeType || '').includes('pdf') || doc.fileName.toLowerCase().endsWith('.pdf');
  const isImage = (doc.mimeType || '').includes('image');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.8)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div style={{ position: 'relative', width: '90vw', height: '90vh', background: 'var(--surface)', borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-2xl)', animation: 'slideUp 0.3s ease-out' }} onClick={e => e.stopPropagation()}>
        <div style={{ height: 64, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="fileText" size={18} style={{ color: 'var(--brand-500)' }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{doc.fileName}</div>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{doc.ownerName} · {formatDateTime(doc.createdAt)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => window.open(url!, '_blank')} style={{ height: 40, padding: '0 16px', borderRadius: 10, background: 'var(--brand-500)', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="externalLink" size={16} /> Open in New Tab
            </button>
            <button onClick={onClose} style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface-muted)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <Icon name="x" size={20} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {loading && <Spinner size={40} color="#fff" />}
          {!loading && url && (
            isPdf ? (
              <iframe src={`${url}#toolbar=0`} style={{ width: '100%', height: '100%', border: 'none' }} title="PDF Preview" />
            ) : isImage ? (
              <img src={url} alt={doc.fileName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : (
              <div style={{ textAlign: 'center', color: '#fff' }}>
                <Icon name="eyeOff" size={48} style={{ opacity: 0.5, marginBottom: 16 }} />
                <div style={{ fontSize: 16, fontWeight: 600 }}>Preview not available for this file type</div>
                <div style={{ fontSize: 14, opacity: 0.7, marginTop: 8 }}>Please download the file to view it.</div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

const actionButtonStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, background: 'var(--surface-muted)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', transition: 'all 0.1s'
};

function PatientSearch({ onSelect, selectedName, onClear }: { onSelect: (p: Patient) => void; selectedName?: string; onClear: () => void }) {
  const { ctx } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      apiGet<Patient[]>(ctx, `/patients?query=${encodeURIComponent(query.trim())}&limit=5`)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 500); // Debounce patient search
    return () => clearTimeout(t);
  }, [query, ctx]);

  if (selectedName) {
    return (
      <div style={{ height: 42, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', background: 'var(--brand-50)', border: '1.5px solid var(--brand-200)', borderRadius: 10 }}>
        <Avatar name={selectedName} size={28} />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--brand-700)' }}>{selectedName}</span>
        <button onClick={onClear} style={{ background: 'none', border: 'none', color: 'var(--brand-500)', cursor: 'pointer', padding: 4 }}><Icon name="x" size={16} /></button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <Icon name="search" size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
      <input value={query} onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }} placeholder="Search patient name..."
        style={{ width: '100%', height: 42, padding: '0 12px 0 40px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, outline: 'none' }} />
      
      {isOpen && query.trim() && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginTop: 8, boxShadow: 'var(--shadow-lg)', maxHeight: 300, overflowY: 'auto' }}>
          {searching && <div style={{ padding: 24, textAlign: 'center' }}><Spinner size={20} /></div>}
          {!searching && results.length === 0 && <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--text-subtle)' }}>No patients found</div>}
          {results.map(p => (
            <button key={p._id} onClick={() => { onSelect(p); setIsOpen(false); setQuery(''); }}
              style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left' }}>
              <Avatar name={p.fullName} size={32} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{p.fullName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{p.phones?.[0] || 'No phone'}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShareDialog({ doc, onClose }: { doc: ServerDoc; onClose: () => void }) {
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
      const res = await apiPost<ShareResp>(ctx, `/documents/${doc._id}/share`, body);
      setShare(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function revoke() {
    try {
      await apiPost(ctx, `/documents/${doc._id}/share/revoke`, {});
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
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Share Document</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label style={labelStyle}>Link Validity</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['1d', '7d', '30d', 'never'] as const).map((v) => (
                <button key={v} onClick={() => setExpiry(v)}
                  style={{ flex: 1, padding: '8px 0', border: `1.5px solid ${expiry === v ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 10, background: expiry === v ? 'var(--brand-50)' : 'var(--surface-muted)', color: expiry === v ? 'var(--brand-700)' : 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {v === '1d' ? '1 Day' : v === '7d' ? '7 Days' : v === '30d' ? '30 Days' : 'Never'}
                </button>
              ))}
            </div>
          </div>

          {!share ? (
            <button onClick={generate} disabled={generating}
              style={{ height: 44, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: generating ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {generating ? <Spinner /> : <><Icon name="send" size={16} /> Create Link</>}
            </button>
          ) : (
            <div>
              <label style={labelStyle}>Public Link</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, height: 42, padding: '0 12px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace' }}>{link}</span>
                </div>
                <button onClick={copy}
                  style={{ height: 42, padding: '0 16px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  Copy
                </button>
              </div>
              <button onClick={revoke}
                style={{ marginTop: 16, height: 38, padding: '0 16px', background: 'none', border: '1.5px solid var(--danger-500)', color: 'var(--danger-500)', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Revoke Link
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
