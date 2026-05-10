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
}
