import type { ReactNode } from 'react';

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/60 bg-white/80 p-4 shadow-card backdrop-blur-md ring-1 ring-fuchsia-100/50">
      {title ? (
        <div className="mb-3 text-sm font-semibold tracking-tight text-brand-ink">{title}</div>
      ) : null}
      {children}
    </section>
  );
}

export function ScreenTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-1">
      <h1 className="text-2xl font-bold tracking-tight text-brand-ink">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-brand-inkMuted">{subtitle}</p> : null}
    </div>
  );
}

/** Standalone inputs / selects — matches {@link Field} control styling */
export const inputSurfaceClass =
  'w-full rounded-2xl border border-violet-100/90 bg-white/95 px-4 py-3 text-sm text-brand-ink shadow-inner placeholder:text-stone-400 outline-none transition-shadow duration-200 focus:border-fuchsia-200 focus:ring-2 focus:ring-fuchsia-300/35';

/** Scrollable hit list shell; pair with e.g. `max-h-40` or `max-h-32` */
export const pickerListShellClass =
  'overflow-auto rounded-2xl border border-violet-100/70 bg-white/90 py-1 shadow-inner ring-1 ring-fuchsia-100/35';

export function SheetFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/25 p-4 backdrop-blur-[2px] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
    >
      <div className="mb-8 w-full max-w-md max-h-[min(85vh,640px)] overflow-y-auto rounded-3xl border border-white/70 bg-white/95 p-5 shadow-soft ring-1 ring-fuchsia-100/60 sm:mb-0 motion-safe:animate-scale-in">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="sheet-title" className="text-base font-bold tracking-tight text-brand-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="tap-scale shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-brand-inkMuted hover:bg-violet-50/90 hover:text-brand-ink"
          >
            Close
          </button>
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[
        'tap-scale rounded-2xl bg-btn-primary px-4 py-3 text-sm font-semibold text-white shadow-soft',
        'w-full hover:bg-btn-primary-hover disabled:pointer-events-none disabled:opacity-45',
        'motion-safe:transition-[transform,box-shadow,filter] motion-safe:duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60 focus-visible:ring-offset-2',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[
        'tap-scale rounded-2xl border border-violet-100/80 bg-white/90 px-4 py-3 text-sm font-semibold text-brand-ink shadow-sm',
        'w-full hover:border-fuchsia-200/80 hover:bg-white disabled:pointer-events-none disabled:opacity-45',
        'motion-safe:transition-colors motion-safe:duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/50 focus-visible:ring-offset-2',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'password' | 'email' | 'url';
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-semibold uppercase tracking-wide text-brand-inkMuted/90">{label}</div>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={['mt-1.5', inputSurfaceClass].join(' ')}
      />
    </label>
  );
}

/** List row for tappable content (patients, appointments, etc.) */
export function ListRow({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  const shell = [
    'w-full rounded-3xl border border-white/70 bg-white/85 p-4 text-left shadow-card backdrop-blur-sm ring-1 ring-violet-50/80',
    onClick ? 'tap-scale hover:border-fuchsia-100/90 hover:shadow-soft' : '',
  ].join(' ');

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={shell}>
        {children}
      </button>
    );
  }
  return <div className={shell}>{children}</div>;
}
