import { useEffect, useRef, useState } from 'react';

/**
 * Animates an integer from previous → target over `duration` ms (cubic ease-out).
 * Honors prefers-reduced-motion.
 */
export function Counter({
  value,
  duration = 600,
  format,
  delay = 0,
}: {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  delay?: number;
}) {
  const [displayed, setDisplayed] = useState(value);
  const rafRef = useRef<number | null>(null);
  const lastTargetRef = useRef<number>(value);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplayed(value);
      return;
    }
    const start = lastTargetRef.current;
    const target = value;
    lastTargetRef.current = target;
    const t0 = performance.now() + delay;

    const step = (ts: number) => {
      const elapsed = ts - t0;
      if (elapsed <= 0) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      const p = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplayed(start + (target - start) * ease);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, delay]);

  return <>{format ? format(displayed) : Math.round(displayed).toLocaleString('en-IN')}</>;
}
