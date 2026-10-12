export enum Permission {
  ClinicRead = 'clinic:read',
  ClinicWrite = 'clinic:write',

  BranchRead = 'branch:read',
  BranchWrite = 'branch:write',

  UserRead = 'user:read',
  UserWrite = 'user:write',

  PatientRead = 'patient:read',
  PatientWrite = 'patient:write',

  AppointmentRead = 'appointment:read',
  AppointmentWrite = 'appointment:write',

  BillingRead = 'billing:read',
  BillingWrite = 'billing:write',

  DocumentRead = 'document:read',
  DocumentWrite = 'document:write',

  NotificationRead = 'notification:read',
  NotificationWrite = 'notification:write',

  // Read-only access to immutable trails — separated from clinic:* so
  // operators can grant audit visibility without granting clinic-config write.
  AuditRead = 'audit:read',
  AccessLogRead = 'accesslog:read',

  // Inventory module — gated behind `modules.inventory.enabled` clinic
  // setting at the controller level, so the permission alone isn't enough
  // for clinics that haven't opted in.
  InventoryRead = 'inventory:read',
  InventoryWrite = 'inventory:write',

  // Pharmacy tab — its own permission pair so the Roles & Permissions
  // matrix can toggle the Pharmacy screen independently of BillingRead
  // (which previously double-gated it). FE-only tab gate today; backend
  // pharmacy endpoints are reused billing/inventory routes that keep
  // their own existing perm gates.
  PharmacyRead = 'pharmacy:read',
  PharmacyWrite = 'pharmacy:write',

  // Consultations (a.k.a. Encounters) tab — own permission pair so the
  // Roles matrix toggles the tab independently of PatientRead. FE-only
  // tab gate today; existing encounter endpoints on the backend still
  // use PatientRead/PatientWrite as before.
  EncounterRead = 'encounter:read',
  EncounterWrite = 'encounter:write',

  // Reports — added so a Super Admin can grant the Reports tab as its
  // own toggle in the Roles matrix. The existing /reports/* API routes
  // are still gated to BillingRead / AppointmentRead (unchanged), and
  // those permissions still open the Reports screen too — Reports
  // permissions are additive, not a replacement.
  ReportsRead = 'reports:read',
  ReportsWrite = 'reports:write',

  // Dashboard tab — gates access to the home Dashboard screen and its
  // KPI tiles. Individual tiles (Revenue / Bills / Pending /
  // Appointments) are gated by their underlying data permissions
  // (ReportsRead, BillingRead, ClinicWrite respectively) so a role
  // that has DashboardRead but no BillingRead sees only the tiles it
  // can actually fetch data for.
  DashboardRead = 'dashboard:read',

  // Settings tabs — each is independently togglable from the Roles
  // matrix so the Super Admin can hand out (or revoke) one tab at a
  // time without rippling into the underlying data permissions
  // (ClinicWrite, BranchWrite, AuditRead, …) which are still used by
  // their respective screens. A role needs the matching settings:* to
  // see the tab; the tab body still respects the data-level read/write
  // gates inside it.
  SettingsClinicRead = 'settings:clinic:read',
  SettingsBranchesRead = 'settings:branches:read',
  SettingsAvailabilityRead = 'settings:availability:read',
  SettingsNotificationsRead = 'settings:notifications:read',
  SettingsAuditRead = 'settings:audit:read',

  // Face recognition. Enroll = "capture a patient's face and store the
  // embedding"; Recognize = "scan a face and look up which patient it
  // is". Both are independently granted because the recognition surface
  // is the front desk's daily tool while enrollment is a registration-
  // time gesture; some clinics will want one without the other.
  FaceEnroll = 'face:enroll',
  FaceRecognize = 'face:recognize',

  // Offline devices. Viewing a tablet's unlock code is what lets an admin
  // talk a doctor through a forgotten PIN during an outage, and it opens
  // that tablet's encrypted cache — so it is its own grant, not clinic:write.
  DeviceManage = 'device:manage',

  // Day-end cash. Counting the drawer rides on billing:write (whoever takes
  // the cash counts it); signing a day off — and accepting a mismatch — is a
  // separate grant held by the Super Admin and Manager.
  CashApprove = 'cash:approve',
}
