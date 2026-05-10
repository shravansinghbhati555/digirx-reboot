import { isWithinQuietHours, quietWindowEndsAt } from './quiet-hours';

const TZ = 'Asia/Kolkata';

function ist(local: string): Date {
  // local is "YYYY-MM-DDTHH:mm". IST is UTC+5:30 with no DST.
  // Build a Date by interpreting the local string in IST and converting.
  const [date, time] = local.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  // IST offset 330 minutes; subtract to get UTC.
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - 330 * 60_000);
}

describe('isWithinQuietHours', () => {
  it('returns false when either endpoint is null', () => {
    expect(isWithinQuietHours(ist('2026-05-01T22:00'), TZ, { start: null, end: null })).toBe(false);
    expect(isWithinQuietHours(ist('2026-05-01T22:00'), TZ, { start: '21:00', end: null })).toBe(false);
    expect(isWithinQuietHours(ist('2026-05-01T22:00'), TZ, { start: null, end: '08:00' })).toBe(false);
  });

  describe('same-day window (13:00–14:00 lunch)', () => {
    const qh = { start: '13:00', end: '14:00' };
    it('quiet at 13:30 IST', () => {
      expect(isWithinQuietHours(ist('2026-05-01T13:30'), TZ, qh)).toBe(true);
    });
    it('not quiet at 12:59 IST (just before)', () => {
      expect(isWithinQuietHours(ist('2026-05-01T12:59'), TZ, qh)).toBe(false);
    });
    it('not quiet at 14:00 IST (end is exclusive)', () => {
      expect(isWithinQuietHours(ist('2026-05-01T14:00'), TZ, qh)).toBe(false);
    });
  });

  describe('overnight window (21:00–08:00)', () => {
    const qh = { start: '21:00', end: '08:00' };
    it('quiet at 22:30 IST (after start, before midnight)', () => {
      expect(isWithinQuietHours(ist('2026-05-01T22:30'), TZ, qh)).toBe(true);
    });
    it('quiet at 03:00 IST (after midnight, before end)', () => {
      expect(isWithinQuietHours(ist('2026-05-02T03:00'), TZ, qh)).toBe(true);
    });
    it('not quiet at 09:00 IST', () => {
      expect(isWithinQuietHours(ist('2026-05-02T09:00'), TZ, qh)).toBe(false);
    });
    it('not quiet at 20:59 IST', () => {
      expect(isWithinQuietHours(ist('2026-05-01T20:59'), TZ, qh)).toBe(false);
    });
  });

  it('zero-width window is never quiet', () => {
    expect(
      isWithinQuietHours(ist('2026-05-01T22:00'), TZ, { start: '22:00', end: '22:00' }),
    ).toBe(false);
  });
});

describe('quietWindowEndsAt', () => {
  it('returns now when not inside the window', () => {
    const now = ist('2026-05-01T09:00');
    const out = quietWindowEndsAt(now, TZ, { start: '21:00', end: '08:00' });
    expect(out.getTime()).toBe(now.getTime());
  });

  it('same-day window: returns end time today', () => {
    const out = quietWindowEndsAt(ist('2026-05-01T13:30'), TZ, { start: '13:00', end: '14:00' });
    expect(out.toISOString()).toBe(ist('2026-05-01T14:00').toISOString());
  });

  it('overnight window, currently in the late-evening half: end fires tomorrow', () => {
    const out = quietWindowEndsAt(ist('2026-05-01T22:30'), TZ, { start: '21:00', end: '08:00' });
    expect(out.toISOString()).toBe(ist('2026-05-02T08:00').toISOString());
  });

  it('overnight window, currently in the early-morning half: end fires today', () => {
    const out = quietWindowEndsAt(ist('2026-05-01T03:00'), TZ, { start: '21:00', end: '08:00' });
    expect(out.toISOString()).toBe(ist('2026-05-01T08:00').toISOString());
  });
});
