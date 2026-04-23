import type { ReactNode } from 'react';

export type TabKey = 'home' | 'patients' | 'appointments' | 'billing' | 'reports' | 'me';

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: '⌂' },
  { key: 'patients', label: 'Patients', icon: '◎' },
  { key: 'appointments', label: 'Appts', icon: '◷' },
  { key: 'billing', label: 'Billing', icon: '₹' },
  { key: 'reports', label: 'Reports', icon: '▤' },
  { key: 'me', label: 'Me', icon: '☺' },
];

export function MobileShell({
  active,
  onChange,
  children,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  children: ReactNode;
}) {
  const title = tabs.find((t) => t.key === active)?.label ?? 'DigiRx';

  return (
    <div className="flex min-h-dvh flex-col text-brand-ink">
      <header className="sticky top-0 z-20 border-b border-white/40 bg-white/55 px-4 py-3 backdrop-blur-xl motion-safe:transition-shadow motion-safe:duration-300 supports-[backdrop-filter]:bg-white/40">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-inkMuted">DigiRx</p>
            <h1 className="truncate text-lg font-bold tracking-tight text-brand-ink">{title}</h1>
          </div>
          <div
            className="h-9 w-9 shrink-0 rounded-2xl bg-gradient-to-br from-fuchsia-400/25 via-amber-200/30 to-sky-300/25 shadow-inner ring-1 ring-white/60"
            aria-hidden
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-4">
        <div key={active} className="screen-enter">
          {children}
        </div>
      </main>

      <nav className="sticky bottom-0 z-20 border-t border-white/50 bg-white/60 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl supports-[backdrop-filter]:bg-white/45">
        <div className="mx-auto flex max-w-md items-stretch justify-between gap-1 rounded-3xl bg-white/35 p-1 shadow-nav ring-1 ring-white/50">
          {tabs.map((t) => {
            const isActive = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onChange(t.key)}
                className={[
                  'tap-scale flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2 text-[10px] font-semibold motion-safe:transition-all motion-safe:duration-200',
                  isActive
                    ? 'bg-white/90 text-fuchsia-700 shadow-card ring-1 ring-fuchsia-100/80'
                    : 'text-brand-inkMuted hover:text-brand-ink',
                ].join(' ')}
              >
                <span className={isActive ? 'text-base' : 'text-[15px] opacity-75'}>{t.icon}</span>
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
