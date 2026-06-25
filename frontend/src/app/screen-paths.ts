import type { ScreenKey } from './AppContext';

/**
 * Source of truth for top-level URL ↔ ScreenKey mapping. Keeping it in one
 * file means AppShell tab buttons, the Router, and any deep-link handling
 * all stay in lockstep.
 *
 * Dashboard lives at `/` so the post-login landing page is the home URL.
 */
export const SCREEN_PATHS: Record<ScreenKey, string> = {
  dashboard: '/',
  patients: '/patients',
  appointments: '/appointments',
  encounters: '/encounters',
  billing: '/billing',
  documents: '/documents',
  reports: '/reports',
  notifications: '/notifications',
  inventory: '/inventory',
  pharmacy: '/pharmacy',
  users: '/users',
  roles: '/roles',
  settings: '/settings',
  availability: '/availability',
  profile: '/profile',
};

const PATH_PREFIX_TO_SCREEN: Array<[string, ScreenKey]> = (
  Object.entries(SCREEN_PATHS) as Array<[ScreenKey, string]>
).map(([screen, path]) => [path, screen]);

/**
 * Returns the ScreenKey that owns `pathname`. We prefer the longest matching
 * prefix so `/patients/abc123` routes to `patients`, not `dashboard` (which
 * would otherwise match `/`).
 */
export function pathToScreen(pathname: string): ScreenKey {
  let best: ScreenKey = 'dashboard';
  let bestLen = 0;
  for (const [path, screen] of PATH_PREFIX_TO_SCREEN) {
    if (path === '/') continue;
    if (
      (pathname === path || pathname.startsWith(path + '/')) &&
      path.length > bestLen
    ) {
      best = screen;
      bestLen = path.length;
    }
  }
  return best;
}
