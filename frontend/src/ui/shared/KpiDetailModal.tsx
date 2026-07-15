import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * Modal shell used by Dashboard KPI tiles for their detail/chart views.
 * Matches the existing modal language in the app: blurred overlay,
 * slideUp card, var(--surface) chrome — no theme-fork.
 *
 * Closes on overlay click and Esc. The header carries an optional live
 * indicator (pulsing dot) so detail panels that poll can advertise that
 * their numbers are refreshing in real-time.
 */
export function KpiDetailModal({
  title, subtitle, icon, accentColor, onClose, live, children, footer,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  accentColor: string;
  onClose: () => void;
  /** When true a small pulsing dot is shown next to the title. */
  live?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        background: 'rgba(15,23,42,0.45)',
        backdropFilter: 'blur(6px)',
        animation: 'fadeIn 150ms ease-out',
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 880, maxHeight: '90vh',
          background: 'var(--surface)', borderRadius: 18,
          border: '1px solid var(--border)',
          boxShadow: '0 24px 64px rgba(15,23,42,0.22)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          animation: 'slideUp 220ms var(--ease-out)',
        }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: `${accentColor}1A`, color: accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name={icon} size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.2px' }}>
                {title}
              </span>
              {live && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 100, background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)', fontSize: 10, fontWeight: 600, color: 'var(--success-500)', letterSpacing: '0.04em' }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: 'var(--success-500)',
                    boxShadow: '0 0 0 0 rgba(16,185,129,0.6)',
                    animation: 'pulseRing 1600ms ease-out infinite',
                  }} />
                  LIVE
                </span>
              )}
            </div>
            {subtitle && (
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="press-scale"
            style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface-muted)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 24px' }}>
          {children}
        </div>

        {footer && (
          <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface-muted)', display: 'flex', alignItems: 'center', gap: 10 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Polling helper ─────────────────────────────────────────── */

/**
 * Polls `fetcher` every `intervalMs` while the document is visible and the
 * hook is mounted. Returns `{ data, error, refreshing, refetch }`. Used by
 * KPI detail panels to keep their charts fresh without a websocket.
 *
 * Pauses when the tab is backgrounded — the next visibilitychange triggers
 * an immediate refresh so a returning user sees current data rather than
 * stale numbers.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: ReadonlyArray<unknown> = [],
): { data: T | null; error: string | null; refreshing: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Holds the latest fetcher in a ref so the interval callback always calls
  // the freshest closure without resetting the timer on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function run() {
      setRefreshing(true);
      try {
        const v = await fetcherRef.current();
        if (!cancelled) {
          setData(v);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }

    function start() {
      run();
      timer = setInterval(run, intervalMs);
    }
    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    function onVis() {
      if (document.visibilityState === 'visible') start();
      else stop();
    }

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  return { data, error, refreshing, refetch: () => fetcherRef.current().then(setData).catch((e) => setError(String(e))) };
}

/* ── Layout helpers (stat grid + bar chart) ──────────────────── */

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, accent }: {
  label: string; value: ReactNode; sub?: ReactNode; accent?: string;
}) {
  return (
    <div style={{
      background: 'var(--surface-muted)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 20, fontWeight: 700, color: accent ?? 'var(--text)', letterSpacing: '-0.4px', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{value}</div>
      {sub != null && <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{sub}</div>}
    </div>
  );
}

export function SectionHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</span>
      {right}
    </div>
  );
}

/**
 * Horizontal bar chart for "top N" style breakdowns (top patients by
 * outstanding balance, breakdown by status, etc.). Each row is a label +
 * a filled bar whose width is proportional to value / max.
 */
export function HBarChart({
  rows, color = 'var(--brand-500)', formatValue,
}: {
  /** Per-row `color` overrides the fallback `color` prop — used to render
   *  semantic palettes (e.g. status pills each in their own theme token). */
  rows: { label: string; value: number; sub?: string; color?: string }[];
  color?: string;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const fmt = formatValue ?? ((v) => String(v));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r, i) => {
        const pct = (r.value / max) * 100;
        const barColor = r.color ?? color;
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: barColor, flexShrink: 0 }} />
                {r.label}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(r.value)}
                {r.sub && <span style={{ marginLeft: 8, color: 'var(--text-subtle)', fontWeight: 400 }}>{r.sub}</span>}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 5, background: 'var(--surface-muted)', overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%', background: barColor, borderRadius: 5,
                transition: 'width 500ms var(--ease-out)',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Vertical bar chart for hourly distributions. Renders one bar per slot
 * (e.g. 24 hours), tick labels every Nth slot, and a max-height baseline
 * so a tall outlier doesn't squash the rest.
 */
export function VBarChart({
  bars, color = 'var(--brand-500)', height = 160,
}: {
  /** Per-bar `color` overrides the fallback `color` prop. */
  bars: { label: string; value: number; color?: string }[];
  color?: string;
  height?: number;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const step = Math.max(1, Math.floor(bars.length / 8));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height, padding: '0 4px 22px 4px', position: 'relative' }}>
      {bars.map((b, i) => {
        const h = (b.value / max) * (height - 24);
        const showLabel = i % step === 0 || i === bars.length - 1;
        const barColor = b.color ?? color;
        return (
          <div key={i} title={`${b.label}: ${b.value}`} style={{ flex: 1, minWidth: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative', height: '100%', justifyContent: 'flex-end' }}>
            <div style={{
              width: '100%', maxWidth: 24,
              height: Math.max(h, b.value > 0 ? 3 : 0),
              background: barColor, borderRadius: 4,
              opacity: b.value > 0 ? 0.9 : 0.15,
              transition: 'height 500ms var(--ease-out)',
            }} />
            {showLabel && (
              <span style={{ position: 'absolute', bottom: -20, fontSize: 9, color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>{b.label}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
