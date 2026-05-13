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
}
