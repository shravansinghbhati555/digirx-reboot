import {
  DEFAULT_CLINIC_SETTINGS,
  mergeClinicSettings,
} from './clinic-settings.types';

describe('mergeClinicSettings — portal', () => {
  it('defaults every portal switch to off for existing clinics', () => {
    const s = mergeClinicSettings({ appointments: { mode: 'TIME' } });
    expect(s.portal).toEqual(DEFAULT_CLINIC_SETTINGS.portal);
    expect(s.portal.enabled).toBe(false);
    expect(s.portal.bookingEnabled).toBe(false);
  });

  it('leaves the other settings exactly as before', () => {
    const raw = { appointments: { mode: 'QUEUE', slotMinutesDefault: 20 } };
    const { portal, ...rest } = mergeClinicSettings(raw);
    const { portal: _p, ...restDefault } = mergeClinicSettings({
      ...raw,
      portal: { enabled: true },
    });
    expect(portal.enabled).toBe(false);
    expect(rest).toEqual(restDefault);
  });

  it('coerces bad portal values back to defaults', () => {
    const s = mergeClinicSettings({
      portal: {
        enabled: 'yes',
        bookingEnabled: true,
        bookableDoctorIds: [
          '6ad1dcdb31eaa9c8af37843d',
          'nope',
          '6ad1dcdb31eaa9c8af37843d',
        ],
        maxAdvanceDays: 9999,
        cancellationLeadTimeHours: -1,
        maxActiveFutureAppointments: 2,
      },
    });
    expect(s.portal).toEqual({
      enabled: false,
      bookingEnabled: true,
      bookableDoctorIds: ['6ad1dcdb31eaa9c8af37843d'],
      maxAdvanceDays: 30,
      cancellationLeadTimeHours: 2,
      maxActiveFutureAppointments: 2,
    });
  });
});
