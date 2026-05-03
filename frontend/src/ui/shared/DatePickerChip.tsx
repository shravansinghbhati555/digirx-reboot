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

export function DatePickerChip({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = isoToDate(value);
  const [viewing, setViewing] = useState<Date>(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // When the bound value changes (e.g. parent reset), realign the viewing month
  useEffect(() => {
    setViewing(new Date(selected.getFullYear(), selected.getMonth(), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const y = viewing.getFullYear();
  const m = viewing.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const start = new Date(y, m, 1).getDay();
  const todayIso = dateToIso(new Date());

  const prevMonth = () => setViewing(new Date(y, m - 1, 1));
  const nextMonth = () => setViewing(new Date(y, m + 1, 1));

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px',
          background: open ? 'var(--brand-50)' : 'var(--surface-muted)',
          border: `1px solid ${open ? 'var(--brand-500)' : 'var(--border)'}`,
          borderRadius: 10, fontSize: 13,
          color: open ? 'var(--brand-600)' : 'var(--text-muted)',
          cursor: 'pointer', transition: 'all 120ms', fontWeight: open ? 600 : 400,
        }}>
        <Icon name="calendar" size={14} style={{ color: 'var(--brand-500)' }} />
        <span>{fmtChip(selected)}</span>
        <Icon name="chevronDown" size={12} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
          boxShadow: '0 12px 32px rgba(15,23,42,0.12)', width: 272, zIndex: 300, overflow: 'hidden',
          animation: 'slideUp 150ms ease-out',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <button onClick={prevMonth}
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-muted)' }}>
              <Icon name="chevronLeft" size={14} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Manrope',sans-serif" }}>{MONTHS[m]} {y}</span>
            <button onClick={nextMonth}
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-muted)' }}>
              <Icon name="chevronRight" size={14} />
            </button>
          </div>

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
