import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

const DAYS_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtChip(d: Date): string {
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

export function DatePickerChip({
  value,
  onChange,
  disabled,
  placeholder = 'Pick a date',
  size = 'md',
  fullWidth,
  allowClear,
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** 'md' = 36px chip (default, matches header). 'sm' = 32px to fit a Field-style input row. */
  size?: 'sm' | 'md';
  /** Stretch the chip to the parent's width — for form fields where it sits in a column. */
  fullWidth?: boolean;
  /** Show a clear (×) action on the chip when value is set. Useful for optional dates like follow-up. */
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(false);
  const todayIso = dateToIso(new Date());
  // Empty value is permitted (optional date fields like follow-up). We
  // still need a valid "viewing month" so the calendar grid renders —
  // fall back to today.
  const hasValue = !!value;
  const selected = hasValue ? isoToDate(value) : new Date();
  const [viewing, setViewing] = useState<Date>(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowYearPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Viewport check: If opening downwards would go off-screen, open upwards.
  useEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const calendarH = 340; // Approx height with year picker
    setOpenUpwards(spaceBelow < calendarH && rect.top > calendarH);
  }, [open]);

  // When the bound value changes (e.g. parent reset), realign the viewing month
  useEffect(() => {
    setViewing(new Date(selected.getFullYear(), selected.getMonth(), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const y = viewing.getFullYear();
  const m = viewing.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const start = new Date(y, m, 1).getDay();

  const prevMonth = () => setViewing(new Date(y, m - 1, 1));
  const nextMonth = () => setViewing(new Date(y, m + 1, 1));

  const triggerH = size === 'sm' ? 32 : 36;
  const fontSize = size === 'sm' ? 12 : 13;

  return (
    <div style={{ position: 'relative', width: fullWidth ? '100%' : undefined, display: fullWidth ? 'block' : 'inline-block' }} ref={ref}>
      <button onClick={() => !disabled && setOpen((o) => !o)} disabled={disabled} type="button"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, height: triggerH, padding: '0 12px',
          width: fullWidth ? '100%' : undefined,
          background: open ? 'var(--brand-50)' : 'var(--surface-muted)',
          border: `1px solid ${open ? 'var(--brand-500)' : 'var(--border)'}`,
          borderRadius: 10, fontSize,
          color: hasValue ? (open ? 'var(--brand-600)' : 'var(--text-muted)') : 'var(--text-subtle)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          transition: 'all 120ms', fontWeight: open || hasValue ? 600 : 400,
        }}>
        <Icon name="calendar" size={14} style={{ color: hasValue ? 'var(--brand-500)' : 'var(--text-subtle)', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {hasValue ? fmtChip(selected) : placeholder}
        </span>
        {allowClear && hasValue && !disabled && (
          <span
            role="button"
            aria-label="Clear date"
            title="Clear"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 4, color: 'var(--text-subtle)' }}
          >
            <Icon name="x" size={11} />
          </span>
        )}
        <Icon name="chevronDown" size={12} style={{ opacity: 0.6, flexShrink: 0, transition: 'transform var(--dur-fast) var(--ease-out)', transform: open ? 'rotate(180deg)' : 'rotate(0)' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          [openUpwards ? 'bottom' : 'top']: 'calc(100% + 8px)',
          left: 0,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
          boxShadow: '0 12px 32px rgba(15,23,42,0.12)', width: 272, zIndex: 300, overflow: 'hidden',
          animation: openUpwards ? 'slideDown 150ms ease-out' : 'slideUp 150ms ease-out',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <button onClick={(e) => { e.stopPropagation(); prevMonth(); }}
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-muted)' }}>
              <Icon name="chevronLeft" size={14} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowYearPicker(!showYearPicker); }}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: showYearPicker ? 'var(--brand-50)' : 'none', border: 'none', borderRadius: 6, cursor: 'pointer', transition: 'all 0.2s' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: showYearPicker ? 'var(--brand-600)' : 'var(--text)', fontFamily: "'Manrope',sans-serif" }}>
                {MONTHS[m]} {y}
              </span>
              <Icon name="chevronDown" size={10} style={{ color: 'var(--text-subtle)', transform: showYearPicker ? 'rotate(180deg)' : 'none' }} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); nextMonth(); }}
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-muted)' }}>
              <Icon name="chevronRight" size={14} />
            </button>
          </div>

          <div style={{ position: 'relative', height: 260 }}>
            {showYearPicker ? (
              <div style={{ position: 'absolute', inset: 0, background: 'var(--surface)', zIndex: 10, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, padding: 12 }}>
                {Array.from({ length: 121 }).map((_, i) => {
                  const year = new Date().getFullYear() - 100 + i;
                  const isSel = year === y;
                  return (
                    <button key={year} onClick={() => { setViewing(new Date(year, m, 1)); setShowYearPicker(false); }}
                      style={{
                        padding: '8px 0', border: 'none', borderRadius: 8,
                        background: isSel ? 'var(--brand-500)' : 'transparent',
                        color: isSel ? 'var(--brand-text)' : 'var(--text)',
                        fontSize: 12, fontWeight: isSel ? 700 : 500, cursor: 'pointer',
                      }}>
                      {year}
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '8px 12px 4px' }}>
                  {DAYS_SHORT.map((d) => (
                    <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', padding: '4px 0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{d}</div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '0 12px 12px', gap: 2 }}>
                  {Array.from({ length: start }).map((_, i) => <div key={`e${i}`} />)}
                  {Array.from({ length: days }).map((_, i) => {
                    const day = i + 1;
                    const date = new Date(y, m, day);
                    const dayIso = dateToIso(date);
                    const isSelected = dayIso === value;
                    const isToday = dayIso === todayIso;
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    return (
                      <button key={day} onClick={() => { onChange(dayIso); setOpen(false); }}
                        style={{
                          width: '100%', aspectRatio: '1',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12,
                          fontWeight: isSelected || isToday ? 700 : 400,
                          background: isSelected ? 'var(--brand-500)' : isToday ? 'var(--brand-50)' : 'transparent',
                          color: isSelected ? 'var(--brand-text)' : isToday ? 'var(--brand-600)' : isWeekend ? 'var(--text-subtle)' : 'var(--text)',
                          transition: 'background 80ms',
                        }}
                        onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-muted)'; }}
                        onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = isToday ? 'var(--brand-50)' : 'transparent'; }}>
                        {day}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
            <button onClick={() => { onChange(todayIso); setOpen(false); }}
              style={{ width: '100%', height: 32, background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer' }}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
