export type AppointmentMode = 'TIME' | 'QUEUE' | 'BOTH';

export type ClinicBranding = {
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
};

export type NotificationChannelToggles = {
  sms: { enabled: boolean };
  whatsapp: { enabled: boolean };
};

export type ClinicSettingsV1 = {
  appointments: {
    mode: AppointmentMode;
    slotMinutesDefault: number;
  };
  modules: {
    inventory: { enabled: boolean };
    notifications: NotificationChannelToggles;
  };
  branding: ClinicBranding;
};

export const DEFAULT_CLINIC_SETTINGS: ClinicSettingsV1 = {
  appointments: { mode: 'BOTH', slotMinutesDefault: 15 },
  modules: {
    inventory: { enabled: false },
    notifications: {
      sms: { enabled: true },
      whatsapp: { enabled: true },
    },
  },
  branding: { displayName: null, logoUrl: null, primaryColor: null },
};

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
  const branding = (
    obj.branding && typeof obj.branding === 'object' ? obj.branding : {}
  ) as Record<string, any>;

  const mode = appts.mode;
  const slot = appts.slotMinutesDefault;
  const invEnabled = inventory.enabled;
  const smsEnabled = notifSms.enabled;
  const waEnabled = notifWa.enabled;

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
    },
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
      },
    },
    branding: {
      displayName: coerceString(branding.displayName, 120),
      logoUrl: coerceUrl(branding.logoUrl),
      primaryColor: coerceHex(branding.primaryColor),
    },
  };
}
