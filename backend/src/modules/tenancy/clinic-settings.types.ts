export type AppointmentMode = 'TIME' | 'QUEUE' | 'BOTH';

export type ClinicSettingsV1 = {
  appointments: {
    mode: AppointmentMode;
    slotMinutesDefault: number;
  };
  modules: {
    inventory: { enabled: boolean };
  };
};

export const DEFAULT_CLINIC_SETTINGS: ClinicSettingsV1 = {
  appointments: { mode: 'BOTH', slotMinutesDefault: 15 },
  modules: { inventory: { enabled: false } },
};

export function mergeClinicSettings(raw: unknown): ClinicSettingsV1 {
  const obj = (raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}) as Record<string, any>;
  const appts = (obj.appointments && typeof obj.appointments === 'object' ? obj.appointments : {}) as Record<string, any>;
  const modules = (obj.modules && typeof obj.modules === 'object' ? obj.modules : {}) as Record<string, any>;
  const inventory = (modules.inventory && typeof modules.inventory === 'object' ? modules.inventory : {}) as Record<
    string,
    any
  >;

  const mode = appts.mode;
  const slot = appts.slotMinutesDefault;
  const invEnabled = inventory.enabled;

  return {
    appointments: {
      mode: mode === 'TIME' || mode === 'QUEUE' || mode === 'BOTH' ? mode : DEFAULT_CLINIC_SETTINGS.appointments.mode,
      slotMinutesDefault:
        typeof slot === 'number' && Number.isFinite(slot) && slot >= 5 && slot <= 180
          ? Math.round(slot)
          : DEFAULT_CLINIC_SETTINGS.appointments.slotMinutesDefault,
    },
    modules: {
      inventory: {
        enabled: typeof invEnabled === 'boolean' ? invEnabled : DEFAULT_CLINIC_SETTINGS.modules.inventory.enabled,
      },
    },
  };
}

