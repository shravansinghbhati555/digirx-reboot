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
  PharmacyRead: 'pharmacy:read',
  PharmacyWrite: 'pharmacy:write',
  EncounterRead: 'encounter:read',
  EncounterWrite: 'encounter:write',
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
  // Per-tab Settings permissions — each one independently controls
  // whether that tab appears in the Settings sidebar. They sit
  // alongside the existing data permissions (ClinicWrite, BranchWrite,
  // AuditRead, …) which still gate the tab's body content.
  SettingsClinicRead: 'settings:clinic:read',
  SettingsBranchesRead: 'settings:branches:read',
  SettingsAvailabilityRead: 'settings:availability:read',
  SettingsNotificationsRead: 'settings:notifications:read',
  SettingsAuditRead: 'settings:audit:read',
  // Face recognition. Enroll captures a face for a patient; Recognize
  // searches enrolled faces from a webcam frame. Independently granted
  // so a clinic can have front-desk scanning without giving them the
  // ability to permanently store new templates, or vice versa.
  FaceEnroll: 'face:enroll',
  FaceRecognize: 'face:recognize',
  // View each offline tablet's unlock code (forgotten-PIN recovery).
  DeviceManage: 'device:manage',
  // Sign off the day-end cash count.
  CashApprove: 'cash:approve',
} as const;

export type PermName = typeof Perm[keyof typeof Perm];

// Permissions required to access each screen. `null` = open to any signed-in user.
// "Any one suffices" semantics.
export const SCREEN_REQUIRED: Record<ScreenKey, PermName[] | null> = {
  // The Dashboard tab is shown ONLY when the role is explicitly granted
  // the Dashboard permission — clinic:write no longer implicitly surfaces
  // it (that made the Dashboard appear for roles like a doctor that had
  // clinic:write but were never given the Dashboard tab).
  dashboard: [Perm.DashboardRead],
  patients: [Perm.PatientRead],
  appointments: [Perm.AppointmentRead],
  encounters: [Perm.EncounterRead],
  billing: [Perm.BillingRead],
  documents: [Perm.DocumentRead],
  reports: [Perm.BillingRead, Perm.ReportsRead, Perm.ReportsWrite],
  notifications: [Perm.NotificationRead],
  inventory: [Perm.InventoryRead],
  pharmacy: [Perm.PharmacyRead],
  users: [Perm.UserRead],
  roles: [Perm.UserRead],
  settings: [Perm.ClinicRead],
  availability: [Perm.SettingsAvailabilityRead],
  // Own profile — available to any signed-in user.
  profile: null,
  // The approval queue is not a clinic capability, so it has no permission
  // to require. Access is decided by the `isPlatformAdmin` flag from /me in
  // App.tsx and enforced again by PlatformAdminGuard on the server.
  platform: null,
  // Same story as `platform`: gated by isPlatformAdmin, not a clinic permission.
  leads: null,
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

// Role-restricted screens.
//   ALLOWLIST → only the listed roles see it; everyone else is hidden.
//     Used for clinic-admin screens (users, roles & permissions) that
//     should stay with Super Admin + Manager even if other roles get
//     `user:read` granted.
//   BLOCKLIST → everyone EXCEPT the listed roles sees it. Used to
//     hide a generally-available screen from one specific role —
//     e.g. doctors don't get the global Documents tab; they see
//     patient docs inline in the consultation screen instead.
const ROLE_SCREEN_ALLOWLIST: Partial<Record<ScreenKey, ReadonlySet<string>>> = {
  users: new Set(['super admin', 'manager']),
  roles: new Set(['super admin', 'manager']),
  // Availability is a sidebar screen for doctors only; every other role
  // still manages availability from the Settings → Availability tab.
  availability: new Set(['doctor']),
};

const ROLE_SCREEN_BLOCKLIST: Partial<Record<ScreenKey, ReadonlySet<string>>> = {
  documents: new Set(['doctor']),
};

export function isScreenAllowedForRoles(
  roleNames: Set<string>,
  screen: ScreenKey,
): boolean {
  // Blocklist takes priority — if any of the user's roles is blocked
  // from this screen, deny.
  const blocked = ROLE_SCREEN_BLOCKLIST[screen];
  if (blocked) {
    for (const role of roleNames) {
      if (blocked.has(role)) return false;
    }
  }
  // Allowlist (if defined) restricts to its listed roles.
  const allowed = ROLE_SCREEN_ALLOWLIST[screen];
  if (!allowed) return true;
  for (const role of roleNames) {
    if (allowed.has(role)) return true;
  }
  return false;
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
