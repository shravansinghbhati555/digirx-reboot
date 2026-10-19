export type AppointmentMode = 'TIME' | 'QUEUE' | 'BOTH';

export type ClinicBranding = {
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  upiId: string | null;
  upiQrUrl: string | null;
};

export type NotificationChannelToggles = {
  sms: { enabled: boolean };
  whatsapp: { enabled: boolean };
};

export type QuietHours = {
  /**
   * `null` on either side = no quiet window. Both fields together carve a
   * daily window during which messages don't go out (e.g. start: '21:00',
   * end: '08:00'). Crosses midnight when start > end. Times are in clinic
   * timezone, HH:MM 24-hour.
   */
  start: string | null;
  end: string | null;
};

export type PatientSettings = {
  /**
   * Format string used to mint MRNs on patient registration. Tokens:
   *   {seq}        — zero-padded sequential number (default width 6)
   *   {seq:N}      — same, with explicit width N (e.g. {seq:8})
   *   {YYYY}       — 4-digit calendar year at the moment of mint (UTC)
   *   {YY}         — 2-digit year
   *   {clinicCode} — first 4 hex chars of the clinic's _id (cheap stable code)
   */
  mrnFormat: string;
};

export type LogsSettings = {
  /**
   * How long audit + access logs are retained before Mongo's TTL cleanup
   * removes them. Default 365 days. Min 7 (a meaningful debugging window),
   * max 3650 (10 years — beyond that, regulatory floors apply).
   */
  retentionDays: number;
};

export type BillingSettings = {
  /**
   * Format string used to mint bill numbers on issue. Tokens:
   *   {seq} / {seq:N}  — sequential number (per branch + fiscal year)
   *   {fiscalYear}     — e.g. "2026-27" (or "2026" when fiscalYearStartMonth === 1)
   *   {YYYY} / {YY}    — calendar year of `issuedAt` (clinic TZ)
   *   {branchCode}     — Branch.code, falling back to first 4 alphanumerics of name
   *   {clinicCode}     — first 4 hex chars of clinic's _id
   */
  billNoFormat: string;
  /**
   * Month (1-12) the fiscal year starts in. India's standard FY runs Apr-Mar
   * so the default is 4. Set to 1 for clinics that follow the calendar year.
   */
  fiscalYearStartMonth: number;
  /**
   * Same token grammar as billNoFormat, used for credit-note numbers in
   * Phase 1.5.4. Defined here so the credit-note module can be added later
   * without re-touching settings shape.
   */
  creditNoteNoFormat: string;
};

/**
 * Patient portal (patient.digirx.com) controls. Everything is OFF by default:
 * a clinic only appears in the portal, shares a patient's own records with
 * them, or accepts self-service bookings after it opts in. Existing clinics
 * are therefore unaffected until they change these.
 */
export type PortalSettings = {
  /** Clinic is visible in portal discovery and its records reach linked patients. */
  enabled: boolean;
  /** Patients may book, reschedule and cancel TIME appointments themselves. */
  bookingEnabled: boolean;
  /**
   * Doctors (user ids) patients may book. Empty = every active doctor of the
   * clinic who has weekly availability rules.
   */
  bookableDoctorIds: string[];
  /** How far ahead a patient may book, in days. */
  maxAdvanceDays: number;
  /** Minimum notice for a patient to cancel or reschedule, in hours. */
  cancellationLeadTimeHours: number;
  /** Cap on a single patient's upcoming portal-visible appointments at this clinic. */
  maxActiveFutureAppointments: number;
};

export type ClinicSettingsV1 = {
  appointments: {
    mode: AppointmentMode;
    slotMinutesDefault: number;
    /**
     * Lets anyone who can book appointments (appointment:write — the Doctor
     * role by default) take the consultation fee, online or offline, without
     * full billing:write. On by default: offline a doctor often works alone
     * on one device and is the only one there to collect.
     */
    doctorsCanCollectPayment: boolean;
  };
  patients: PatientSettings;
  billing: BillingSettings;
  logs: LogsSettings;
  modules: {
    inventory: { enabled: boolean };
    notifications: NotificationChannelToggles & {
      quietHours: QuietHours;
    };
    // Off by default — face recognition requires a running face-svc
    // sidecar and explicit patient biometric consent, so a fresh clinic
    // never silently has it active.
    faceRecognition: { enabled: boolean };
  };
  branding: ClinicBranding;
  portal: PortalSettings;
};

export const DEFAULT_CLINIC_SETTINGS: ClinicSettingsV1 = {
  appointments: { mode: 'BOTH', slotMinutesDefault: 15, doctorsCanCollectPayment: true },
  patients: { mrnFormat: 'MRN-{seq:06}' },
  billing: {
    billNoFormat: '{branchCode}/{fiscalYear}/{seq:06}',
    fiscalYearStartMonth: 4,
    creditNoteNoFormat: 'CN/{fiscalYear}/{seq:06}',
  },
  logs: { retentionDays: 365 },
  modules: {
    inventory: { enabled: false },
    notifications: {
      sms: { enabled: true },
      whatsapp: { enabled: true },
      quietHours: { start: null, end: null },
    },
    // Face recognition is on by default — patient face scan + staff
    // face login work out of the box without flipping a settings toggle.
    faceRecognition: { enabled: true },
  },
  branding: { displayName: null, logoUrl: null, primaryColor: null, upiId: null, upiQrUrl: null },
  portal: {
    enabled: false,
    bookingEnabled: false,
    bookableDoctorIds: [],
    maxAdvanceDays: 30,
    cancellationLeadTimeHours: 2,
    maxActiveFutureAppointments: 3,
  },
};

function coerceIntInRange(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function mergePortalSettings(raw: unknown): PortalSettings {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const d = DEFAULT_CLINIC_SETTINGS.portal;
  const ids = Array.isArray(p.bookableDoctorIds)
    ? Array.from(
        new Set(
          p.bookableDoctorIds
            .map((x: unknown) => String(x))
            .filter((x: string) => /^[0-9a-fA-F]{24}$/.test(x)),
        ),
      )
    : d.bookableDoctorIds;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : d.enabled,
    bookingEnabled:
      typeof p.bookingEnabled === 'boolean' ? p.bookingEnabled : d.bookingEnabled,
    bookableDoctorIds: ids as string[],
    maxAdvanceDays: coerceIntInRange(p.maxAdvanceDays, 1, 365, d.maxAdvanceDays),
    cancellationLeadTimeHours: coerceIntInRange(
      p.cancellationLeadTimeHours,
      0,
      168,
      d.cancellationLeadTimeHours,
    ),
    maxActiveFutureAppointments: coerceIntInRange(
      p.maxActiveFutureAppointments,
      1,
      20,
      d.maxActiveFutureAppointments,
    ),
  };
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function coerceString(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function coerceUrl(v: unknown): string | null {
  const s = coerceString(v, 1000);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

/**
 * Logo reference can be either an http(s) URL (legacy, copied in from
 * an external host) or an S3 object key from our own bucket (the path
 * `clinics/<24hex>/logo`, produced by the upload endpoint). Both are
 * safe to round-trip; the PdfService + FE preview each know how to
 * dereference whichever form they receive.
 */
function coerceLogoRef(v: unknown): string | null {
  const s = coerceString(v, 1000);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^clinics\/[0-9a-fA-F]{24}\/logo$/.test(s)) return s;
  return null;
}

function coerceUpiQrRef(v: unknown): string | null {
  const s = coerceString(v, 1000);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^clinics\/[0-9a-fA-F]{24}\/upi-qr$/.test(s)) return s;
  return null;
}

function coerceHex(v: unknown): string | null {
  const s = coerceString(v, 7);
  if (!s) return null;
  return HEX_RE.test(s) ? s : null;
}

export function mergeClinicSettings(raw: unknown): ClinicSettingsV1 {
  const obj =
    raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const appts = (
    obj.appointments && typeof obj.appointments === 'object'
      ? obj.appointments
      : {}
  ) as Record<string, any>;
  const modules = (
    obj.modules && typeof obj.modules === 'object' ? obj.modules : {}
  ) as Record<string, any>;
  const inventory = (
    modules.inventory && typeof modules.inventory === 'object'
      ? modules.inventory
      : {}
  ) as Record<string, any>;
  const faceRecognition = (
    modules.faceRecognition && typeof modules.faceRecognition === 'object'
      ? modules.faceRecognition
      : {}
  ) as Record<string, any>;
  const notifications = (
    modules.notifications && typeof modules.notifications === 'object'
      ? modules.notifications
      : {}
  ) as Record<string, any>;
  const notifSms = (
    notifications.sms && typeof notifications.sms === 'object'
      ? notifications.sms
      : {}
  ) as Record<string, any>;
  const notifWa = (
    notifications.whatsapp && typeof notifications.whatsapp === 'object'
      ? notifications.whatsapp
      : {}
  ) as Record<string, any>;
  const notifQuiet = (
    notifications.quietHours && typeof notifications.quietHours === 'object'
      ? notifications.quietHours
      : {}
  ) as Record<string, any>;
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const quietStart =
    typeof notifQuiet.start === 'string' && HHMM.test(notifQuiet.start)
      ? notifQuiet.start
      : null;
  const quietEnd =
    typeof notifQuiet.end === 'string' && HHMM.test(notifQuiet.end)
      ? notifQuiet.end
      : null;
  // Both fields must be present for the window to be active; otherwise
  // treat as off (start: null, end: null).
  const quietHours = quietStart && quietEnd
    ? { start: quietStart, end: quietEnd }
    : { start: null, end: null };
  const branding = (
    obj.branding && typeof obj.branding === 'object' ? obj.branding : {}
  ) as Record<string, any>;

  const mode = appts.mode;
  const slot = appts.slotMinutesDefault;
  const invEnabled = inventory.enabled;
  const faceEnabled = faceRecognition.enabled;
  const smsEnabled = notifSms.enabled;
  const waEnabled = notifWa.enabled;

  const patientsRaw = (
    obj.patients && typeof obj.patients === 'object' ? obj.patients : {}
  ) as Record<string, any>;
  const mrnFormat = coerceString(patientsRaw.mrnFormat, 120);

  const billingRaw = (
    obj.billing && typeof obj.billing === 'object' ? obj.billing : {}
  ) as Record<string, any>;
  const billNoFormat = coerceString(billingRaw.billNoFormat, 120);
  const creditNoteNoFormat = coerceString(billingRaw.creditNoteNoFormat, 120);
  const fyStartRaw = billingRaw.fiscalYearStartMonth;
  const fiscalYearStartMonth =
    typeof fyStartRaw === 'number' &&
    Number.isInteger(fyStartRaw) &&
    fyStartRaw >= 1 &&
    fyStartRaw <= 12
      ? fyStartRaw
      : DEFAULT_CLINIC_SETTINGS.billing.fiscalYearStartMonth;

  const logsRaw = (
    obj.logs && typeof obj.logs === 'object' ? obj.logs : {}
  ) as Record<string, any>;
  const retentionRaw = logsRaw.retentionDays;
  const retentionDays =
    typeof retentionRaw === 'number' &&
    Number.isInteger(retentionRaw) &&
    retentionRaw >= 7 &&
    retentionRaw <= 3650
      ? retentionRaw
      : DEFAULT_CLINIC_SETTINGS.logs.retentionDays;

  return {
    appointments: {
      mode:
        mode === 'TIME' || mode === 'QUEUE' || mode === 'BOTH'
          ? mode
          : DEFAULT_CLINIC_SETTINGS.appointments.mode,
      slotMinutesDefault:
        typeof slot === 'number' &&
        Number.isFinite(slot) &&
        slot >= 5 &&
        slot <= 180
          ? Math.round(slot)
          : DEFAULT_CLINIC_SETTINGS.appointments.slotMinutesDefault,
      doctorsCanCollectPayment:
        typeof appts.doctorsCanCollectPayment === 'boolean'
          ? appts.doctorsCanCollectPayment
          : DEFAULT_CLINIC_SETTINGS.appointments.doctorsCanCollectPayment,
    },
    patients: {
      mrnFormat: mrnFormat ?? DEFAULT_CLINIC_SETTINGS.patients.mrnFormat,
    },
    billing: {
      billNoFormat:
        billNoFormat ?? DEFAULT_CLINIC_SETTINGS.billing.billNoFormat,
      fiscalYearStartMonth,
      creditNoteNoFormat:
        creditNoteNoFormat ??
        DEFAULT_CLINIC_SETTINGS.billing.creditNoteNoFormat,
    },
    logs: { retentionDays },
    modules: {
      inventory: {
        enabled:
          typeof invEnabled === 'boolean'
            ? invEnabled
            : DEFAULT_CLINIC_SETTINGS.modules.inventory.enabled,
      },
      notifications: {
        sms: {
          enabled:
            typeof smsEnabled === 'boolean'
              ? smsEnabled
              : DEFAULT_CLINIC_SETTINGS.modules.notifications.sms.enabled,
        },
        whatsapp: {
          enabled:
            typeof waEnabled === 'boolean'
              ? waEnabled
              : DEFAULT_CLINIC_SETTINGS.modules.notifications.whatsapp.enabled,
        },
        quietHours,
      },
      faceRecognition: {
        enabled:
          typeof faceEnabled === 'boolean'
            ? faceEnabled
            : DEFAULT_CLINIC_SETTINGS.modules.faceRecognition.enabled,
      },
    },
    branding: {
      displayName: coerceString(branding.displayName, 120),
      logoUrl: coerceLogoRef(branding.logoUrl),
      primaryColor: coerceHex(branding.primaryColor),
      upiId: coerceString(branding.upiId, 120),
      upiQrUrl: coerceUpiQrRef(branding.upiQrUrl),
    },
    portal: mergePortalSettings(obj.portal),
  };
}
