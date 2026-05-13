import { useApp } from './AppContext';
import type { ScreenKey } from './AppContext';

export const Perm = {
  ClinicRead: 'clinic:read',
  ClinicWrite: 'clinic:write',
  BranchRead: 'branch:read',
  BranchWrite: 'branch:write',
  UserRead: 'user:read',
  UserWrite: 'user:write',
  PatientRead: 'patient:read',
  PatientWrite: 'patient:write',
  AppointmentRead: 'appointment:read',
  AppointmentWrite: 'appointment:write',
  BillingRead: 'billing:read',
  BillingWrite: 'billing:write',
  DocumentRead: 'document:read',
  DocumentWrite: 'document:write',
  NotificationRead: 'notification:read',
  NotificationWrite: 'notification:write',
  AuditRead: 'audit:read',
  AccessLogRead: 'accesslog:read',
  InventoryRead: 'inventory:read',
  InventoryWrite: 'inventory:write',
  // Reports permissions are additive: the Reports tab is granted by
  // ReportsRead/Write OR by BillingRead (unchanged) so today's roles
  // that see Reports keep seeing them. BE /reports/* routes remain
  // gated to BillingRead / AppointmentRead, so granting only Reports
  // without underlying read perms opens the screen but the widgets
  // won't fetch.
  ReportsRead: 'reports:read',
  ReportsWrite: 'reports:write',
  // Dashboard tab — gates the home screen. Individual tiles on that
  // screen are gated by their data permissions (ReportsRead for
  // revenue, BillingRead for bills/pending, ClinicWrite for today's
  // appointments), so granting only DashboardRead opens the page but
  // shows just the tiles whose data the role can actually fetch.
  DashboardRead: 'dashboard:read',
} as const;

export type PermName = typeof Perm[keyof typeof Perm];

// Permissions required to access each screen. `null` = open to any signed-in user.
// "Any one suffices" semantics.
export const SCREEN_REQUIRED: Record<ScreenKey, PermName[] | null> = {
  dashboard:     [Perm.ClinicWrite, Perm.DashboardRead],
  patients:      [Perm.PatientRead],
  appointments:  [Perm.AppointmentRead],
  encounters:    [Perm.PatientRead],
  billing:       [Perm.BillingRead],
  documents:     [Perm.DocumentRead],
  reports:       [Perm.BillingRead, Perm.ReportsRead, Perm.ReportsWrite],
  notifications: [Perm.NotificationRead],
  inventory:     [Perm.InventoryRead],
  pharmacy:      [Perm.BillingRead],
  users:         [Perm.UserRead],
  roles:         [Perm.UserRead],
  settings:      [Perm.ClinicRead],
};

export function hasPerm(set: Set<string>, perm: PermName): boolean {
  return set.has(perm);
}

export function hasAnyPerm(set: Set<string>, perms: PermName[]): boolean {
  return perms.some((p) => set.has(p));
}

export function canAccessScreen(set: Set<string>, screen: ScreenKey): boolean {
  const req = SCREEN_REQUIRED[screen];
  if (!req) return true;
  return hasAnyPerm(set, req);
}

/**
 * Hook for components: returns helpers bound to the current user's permissions.
 *   const { has, canAccess } = usePerm();
 *   if (!has(Perm.PatientWrite)) ...
 */
export function usePerm() {
  const { permissions } = useApp();
  return {
    permissions,
    has: (perm: PermName) => permissions.has(perm),
    hasAny: (perms: PermName[]) => perms.some((p) => permissions.has(p)),
    canAccess: (screen: ScreenKey) => canAccessScreen(permissions, screen),
  };
}
