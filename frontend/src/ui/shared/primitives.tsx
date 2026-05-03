import { createContext, useCallback, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { EmptyIllustration } from './EmptyIllustration';

// Fixed JS palette consumed by Avatar's name-hash. CSS variables don't fit
// here — JS would have to read computed styles to pick a swatch.
const AVATAR_COLORS = ['#3B82F6','#14B8A6','#8B5CF6','#EC4899','#F59E0B','#10B981','#6366F1','#EF4444'];

export function Avatar({ name = '?', size = 36, style }: { name?: string; size?: number; style?: CSSProperties }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color + '22', border: `1.5px solid ${color}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      color, fontFamily: "'Manrope',sans-serif", fontSize: Math.round(size * 0.35), fontWeight: 700,
      ...style,
    }}>
      {initials}
    </div>
  );
}

type StatusKey =
  | 'draft' | 'issued' | 'paid' | 'void' | 'booked' | 'checked-in' | 'in-progress'
  | 'done' | 'cancelled' | 'no-show' | 'signed' | 'pending' | 'sent' | 'failed' | 'queued';

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; icon: IconName }> = {
  draft:        { label: 'Draft',       bg: 'var(--warning-bg)', color: 'var(--warning-text)',      icon: 'edit' },
  issued:       { label: 'Issued',      bg: 'var(--info-bg)',    color: 'var(--info-text)',         icon: 'fileText' },
  paid:         { label: 'Paid',        bg: 'var(--success-bg)', color: 'var(--success-text)',      icon: 'checkCircle' },
  void:         { label: 'Void',        bg: 'var(--neutral-bg)', color: 'var(--neutral-text)',      icon: 'xCircle' },
  booked:       { label: 'Booked',      bg: 'var(--brand-bg-soft)', color: 'var(--brand-text-strong)', icon: 'calendar' },
  'checked-in': { label: 'Checked in',  bg: 'var(--teal-bg)',    color: 'var(--teal-text)',         icon: 'checkCircle' },
  'in-progress':{ label: 'In progress', bg: 'var(--info-bg)',    color: 'var(--info-text)',         icon: 'activity' },
  done:         { label: 'Done',        bg: 'var(--success-bg)', color: 'var(--success-text)',      icon: 'check' },
  cancelled:    { label: 'Cancelled',   bg: 'var(--danger-bg)',  color: 'var(--danger-text)',       icon: 'x' },
  'no-show':    { label: 'No show',     bg: 'var(--warning-bg)', color: 'var(--warning-text)',      icon: 'alertTriangle' },
  signed:       { label: 'Signed',      bg: 'var(--success-bg)', color: 'var(--success-text)',      icon: 'lock' },
  pending:      { label: 'Pending',     bg: 'var(--warning-bg)', color: 'var(--warning-text)',      icon: 'clock' },
  sent:         { label: 'Sent',        bg: 'var(--success-bg)', color: 'var(--success-text)',      icon: 'checkCircle' },
  failed:       { label: 'Failed',      bg: 'var(--danger-bg)',  color: 'var(--danger-text)',       icon: 'xCircle' },
  queued:       { label: 'Queued',      bg: 'var(--neutral-bg)', color: 'var(--neutral-text)',      icon: 'clock' },
};

export function StatusPill({ status, small }: { status: string; small?: boolean }) {
  const key = status?.toLowerCase() as StatusKey;
  const cfg = STATUS_CONFIG[key] ?? { label: status || '—', bg: 'var(--surface-muted)', color: 'var(--text-muted)', icon: 'info' as IconName };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: small ? '2px 8px' : '3px 10px', borderRadius: 100,
      fontSize: small ? 11 : 12, fontWeight: 600, whiteSpace: 'nowrap',
      transition: 'background 180ms var(--ease-out), color 180ms var(--ease-out)',
      background: cfg.bg, color: cfg.color,
    }}>
      <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, animation: 'pathFadeIn 180ms var(--ease-out)' }}>
        <Icon name={cfg.icon} size={small ? 10 : 12} strokeWidth={2} />
        {cfg.label}
      </span>
    </span>
  );
}

export function Sparkline({
  data, color = 'var(--brand-500)', height = 32, width = 88,
}: {
  data: number[]; color?: string; height?: number; width?: number;
}) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 4 - ((v - min) / range) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPath = `M ${pts[0]} ` + pts.slice(1).map((pt) => `L ${pt}`).join(' ') + ` L ${width},${height} L 0,${height} Z`;
  const linePath = `M ${pts[0]} ` + pts.slice(1).map((pt) => `L ${pt}`).join(' ');
  const last = pts[pts.length - 1].split(',');
  const gid = `sg-${color.replace(/[^a-z]/gi, '')}`;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1].split(',').map(Number);
    const [x1, y1] = pts[i].split(',').map(Number);
    len += Math.hypot(x1 - x0, y1 - y0);
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gid})`} style={{ animation: 'pathFadeIn 800ms var(--ease-out) both' }} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        style={{
          strokeDasharray: len.toFixed(1),
          strokeDashoffset: len.toFixed(1),
          animation: 'pathDraw 800ms var(--ease-out) forwards',
          ['--draw-len' as never]: len.toFixed(1),
        }} />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color}
        style={{ opacity: 0, animation: 'pathFadeIn 200ms var(--ease-out) 760ms forwards' }} />
    </svg>
  );
}

type Toast = { id: number; msg: string; type: 'success' | 'error' | 'info' };
type ToastFn = (msg: string, type?: Toast['type']) => void;

const ToastContext = createContext<ToastFn | null>(null);
export const useToast = (): ToastFn => useContext(ToastContext) ?? (() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add: ToastFn = useCallback((msg, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const remove = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  return (
    <ToastContext.Provider value={add}>
      {children}
      <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
            minWidth: 280, maxWidth: 360, animation: 'toastIn 200ms ease-out', fontSize: 14,
          }}>
            <Icon name={t.type === 'success' ? 'checkCircle' : t.type === 'error' ? 'xCircle' : 'info'}
              size={16}
              style={{ color: t.type === 'success' ? 'var(--success-500)' : t.type === 'error' ? 'var(--danger-500)' : 'var(--brand-500)', flexShrink: 0 }} />
            <span style={{ flex: 1, color: 'var(--text)' }}>{t.msg}</span>
            <button onClick={() => remove(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 2 }}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const formatINR = (n: number | null | undefined) => {
  if (n === undefined || n === null || isNaN(Number(n))) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

export const formatDate = (str: string | Date | null | undefined) => {
  if (!str) return '—';
  const d = new Date(str);
  if (isNaN(d.getTime())) return String(str);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatDateTime = (str: string | Date | null | undefined) => {
  if (!str) return '—';
  const d = new Date(str);
  if (isNaN(d.getTime())) return String(str);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const labelStyle: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 };

export function Field({
  label, value, onChange, placeholder, prefix, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; prefix?: string; type?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        {prefix && (
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-subtle)', userSelect: 'none' }}>{prefix}</span>
        )}
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type}
          style={{
            width: '100%', height: 40, padding: prefix ? '0 12px 0 44px' : '0 12px',
            background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
            fontSize: 13, color: 'var(--text)', fontFamily: "'Inter',sans-serif",
            outline: 'none', boxSizing: 'border-box', transition: 'border-color 120ms',
          }}
          onFocus={(e) => (e.target.style.borderColor = 'var(--brand-500)')}
          onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
        />
      </div>
    </div>
  );
}

export function PrimaryButton({
  children, onClick, disabled, type = 'button',
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit';
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className="press-scale"
      style={{
        height: 40, padding: '0 20px',
        background: disabled ? 'var(--border)' : 'var(--brand-500)',
        color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: "'Inter',sans-serif",
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        transition: 'background 120ms, transform 120ms var(--ease-out)', opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children, onClick, disabled, type = 'button',
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit';
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className="press-scale"
      style={{
        height: 40, padding: '0 18px',
        background: 'none', color: 'var(--text-muted)',
        border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: "'Inter',sans-serif",
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        opacity: disabled ? 0.5 : 1, transition: 'transform 120ms var(--ease-out)',
      }}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size,
      border: '2px solid var(--on-brand-spinner-track)', borderTopColor: 'var(--brand-text)',
      borderRadius: '50%', animation: 'spin 600ms linear infinite',
    }} />
  );
}

export function EmptyState({
  illustration, icon = 'folder', title, hint, cta,
}: {
  illustration?: 'folder' | 'patients' | 'calendar' | 'receipt' | 'documents' | 'bell';
  icon?: IconName;
  title: string;
  hint?: string;
  cta?: ReactNode;
}) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-subtle)' }}>
      {illustration ? (
        <div style={{ marginBottom: 12 }}>
          <EmptyIllustration kind={illustration} size={120} />
        </div>
      ) : (
        <Icon name={icon} size={36} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
      )}
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-muted)' }}>{title}</div>
      {hint && <div style={{ fontSize: 12, marginTop: 4 }}>{hint}</div>}
      {cta && <div style={{ marginTop: 16 }}>{cta}</div>}
    </div>
  );
}
