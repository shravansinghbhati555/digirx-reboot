import { useEffect, useState } from 'react';

// Width below which the desktop chrome (permanent sidebar + side-by-side
// master/detail panels + fixed-width drawers) stops fitting and the UI
// switches to a stacked, single-column mobile layout.
//
// The whole app is styled with inline `style={{}}` objects, which cannot
// carry CSS media queries — so screens branch their layout on this hook
// instead of on `@media` rules.
export const MOBILE_MAX_WIDTH = 768;

/**
 * True when the viewport is at or below `maxWidth` (default 768px). Updates
 * live on resize / orientation change via matchMedia. SSR-safe (returns
 * false when there's no window).
 */
export function useIsMobile(maxWidth: number = MOBILE_MAX_WIDTH): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return isMobile;
}
