import { useEffect, useRef, useState, type CSSProperties } from 'react';

export type TabSpec<T extends string> = { id: T; label: string };

export function AnimatedTabs<T extends string>({
  tabs, value, onChange, style,
}: {
  tabs: readonly TabSpec<T>[];
  value: T;
  onChange: (id: T) => void;
  style?: CSSProperties;
}) {
  const refs = useRef<Map<T, HTMLButtonElement | null>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const btn = refs.current.get(value);
    const container = containerRef.current;
    if (!btn || !container) return;
    const r = btn.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    setPill({ left: r.left - cr.left, width: r.width });
  }, [value, tabs]);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', ...style }}>
      {tabs.map((t) => (
        <button key={t.id} ref={(el) => { refs.current.set(t.id, el); }}
          onClick={() => onChange(t.id)}
          style={{
            padding: '8px 18px', background: 'none', border: 'none',
            color: value === t.id ? 'var(--brand-500)' : 'var(--text-muted)',
            fontSize: 13, fontWeight: value === t.id ? 600 : 400,
            cursor: 'pointer', position: 'relative', zIndex: 1,
            transition: 'color 200ms var(--ease-out)',
          }}>
          {t.label}
        </button>
      ))}
      {pill && (
        <div aria-hidden
          style={{
            position: 'absolute', bottom: -1, height: 2,
            background: 'var(--brand-500)', borderRadius: 2,
            left: pill.left, width: pill.width,
            transition: 'left 220ms var(--ease-out), width 220ms var(--ease-out)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
