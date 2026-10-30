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
  start: string | null;
  end: string | null;
};

export type PatientSettings = {
  mrnFormat: string;
};

export type LogsSettings = {
  retentionDays: number;
};

export type BillingSettings = {
  billNoFormat: string;
  fiscalYearStartMonth: number;
  creditNoteNoFormat: string;
};

export type PortalSettings = {
  enabled: boolean;
  bookingEnabled: boolean;
  bookableDoctorIds: string[];
  maxAdvanceDays: number;
  cancellationLeadTimeHours: number;
  maxActiveFutureAppointments: number;
};

export type ClinicSettingsV1 = {
  appointments: {
    mode: AppointmentMode;
    slotMinutesDefault: number;
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
    faceRecognition: { enabled: boolean };
  };
  branding: ClinicBranding;
  portal: PortalSettings;
};

export const DEFAULT_CLINIC_SETTINGS: ClinicSettingsV1 = {
  appointments: {
    mode: 'BOTH',
    slotMinutesDefault: 15,
    doctorsCanCollectPayment: true,
  },
  patients: {
    mrnFormat: 'MRN-{seq:06}',
  },
  billing: {
    billNoFormat: '{branchCode}/{fiscalYear}/{seq:06}',
    fiscalYearStartMonth: 4,
    creditNoteNoFormat: 'CN/{fiscalYear}/{seq:06}',
  },
  logs: {
    retentionDays: 365,
  },
  modules: {
    inventory: {
      enabled: false,
    },
    notifications: {
      sms: { enabled: true },
      whatsapp: { enabled: true },
      quietHours: {
        start: null,
        end: null,
      },
    },
    faceRecognition: {
      enabled: true,
    },
  },
  branding: {
    displayName: null,
    logoUrl: null,
    primaryColor: null,
    upiId: null,
    upiQrUrl: null,
  },
  portal: {
    enabled: true,
    bookingEnabled: true,
    bookableDoctorIds: [],
    maxAdvanceDays: 30,
    cancellationLeadTimeHours: 2,
    maxActiveFutureAppointments: 3,
  },
};

function coerceIntInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function mergePortalSettings(raw: unknown): PortalSettings {
  const portal =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const defaults = DEFAULT_CLINIC_SETTINGS.portal;

  const bookableDoctorIds = Array.isArray(portal.bookableDoctorIds)
    ? Array.from(
        new Set(
          portal.bookableDoctorIds
            .filter((id): id is string => typeof id === 'string')
            .filter((id) => /^[0-9a-fA-F]{24}$/.test(id)),
        ),
      )
    : defaults.bookableDoctorIds;

  return {
    // Explicit false values are intentionally preserved.
    enabled:
      typeof portal.enabled === 'boolean' ? portal.enabled : defaults.enabled,

    bookingEnabled:
      typeof portal.bookingEnabled === 'boolean'
        ? portal.bookingEnabled
        : defaults.bookingEnabled,

    bookableDoctorIds,

    maxAdvanceDays: coerceIntInRange(
      portal.maxAdvanceDays,
      1,
      365,
      defaults.maxAdvanceDays,
    ),

    cancellationLeadTimeHours: coerceIntInRange(
      portal.cancellationLeadTimeHours,
      0,
      168,
      defaults.cancellationLeadTimeHours,
    ),

    maxActiveFutureAppointments: coerceIntInRange(
      portal.maxActiveFutureAppointments,
      1,
      20,
      defaults.maxActiveFutureAppointments,
    ),
  };
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function coerceString(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (!trimmed) return null;

  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function coerceLogoRef(value: unknown): string | null {
  const valueString = coerceString(value, 1000);

  if (!valueString) return null;

  if (/^https?:\/\//i.test(valueString)) {
    return valueString;
  }

  if (/^clinics\/[0-9a-fA-F]{24}\/logo$/.test(valueString)) {
    return valueString;
  }

  return null;
}

function coerceUpiQrRef(value: unknown): string | null {
  const valueString = coerceString(value, 1000);

  if (!valueString) return null;

  if (/^https?:\/\//i.test(valueString)) {
    return valueString;
  }

  if (/^clinics\/[0-9a-fA-F]{24}\/upi-qr$/.test(valueString)) {
    return valueString;
  }

  return null;
}

function coerceHex(value: unknown): string | null {
  const color = coerceString(value, 7);

  if (!color) return null;

  return HEX_RE.test(color) ? color : null;
}

export function mergeClinicSettings(raw: unknown): ClinicSettingsV1 {
  const obj =
    raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};

  const appts =
    obj.appointments && typeof obj.appointments === 'object'
      ? obj.appointments
      : {};

  const patientsRaw =
    obj.patients && typeof obj.patients === 'object' ? obj.patients : {};

  const billingRaw =
    obj.billing && typeof obj.billing === 'object' ? obj.billing : {};

  const logsRaw = obj.logs && typeof obj.logs === 'object' ? obj.logs : {};

  const modules =
    obj.modules && typeof obj.modules === 'object' ? obj.modules : {};

  const inventory =
    modules.inventory && typeof modules.inventory === 'object'
      ? modules.inventory
      : {};

  const notifications =
    modules.notifications && typeof modules.notifications === 'object'
      ? modules.notifications
      : {};

  const notifSms =
    notifications.sms && typeof notifications.sms === 'object'
      ? notifications.sms
      : {};

  const notifWa =
    notifications.whatsapp && typeof notifications.whatsapp === 'object'
      ? notifications.whatsapp
      : {};

  const notifQuiet =
    notifications.quietHours && typeof notifications.quietHours === 'object'
      ? notifications.quietHours
      : {};

  const faceRecognition =
    modules.faceRecognition && typeof modules.faceRecognition === 'object'
      ? modules.faceRecognition
      : {};

  const branding =
    obj.branding && typeof obj.branding === 'object' ? obj.branding : {};

  const mode = appts.mode;
  const slot = appts.slotMinutesDefault;

  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

  const quietStart =
    typeof notifQuiet.start === 'string' && HHMM.test(notifQuiet.start)
      ? notifQuiet.start
      : null;

  const quietEnd =
    typeof notifQuiet.end === 'string' && HHMM.test(notifQuiet.end)
      ? notifQuiet.end
      : null;

  const quietHours =
    quietStart && quietEnd
      ? { start: quietStart, end: quietEnd }
      : { start: null, end: null };

  const mrnFormat = coerceString(patientsRaw.mrnFormat, 120);
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

    logs: {
      retentionDays,
    },

    modules: {
      inventory: {
        enabled:
          typeof inventory.enabled === 'boolean'
            ? inventory.enabled
            : DEFAULT_CLINIC_SETTINGS.modules.inventory.enabled,
      },

      notifications: {
        sms: {
          enabled:
            typeof notifSms.enabled === 'boolean'
              ? notifSms.enabled
              : DEFAULT_CLINIC_SETTINGS.modules.notifications.sms.enabled,
        },

        whatsapp: {
          enabled:
            typeof notifWa.enabled === 'boolean'
              ? notifWa.enabled
              : DEFAULT_CLINIC_SETTINGS.modules.notifications.whatsapp.enabled,
        },

        quietHours,
      },

      faceRecognition: {
        enabled:
          typeof faceRecognition.enabled === 'boolean'
            ? faceRecognition.enabled
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
