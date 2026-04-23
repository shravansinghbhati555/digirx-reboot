import { computeClinicDayRange } from './clinic-time';

describe('computeClinicDayRange', () => {
  it('computes UTC bounds for an Asia/Kolkata day', () => {
    const { startUtc, endUtc } = computeClinicDayRange('2026-05-02', 'Asia/Kolkata');
    expect(startUtc.toISOString()).toBe('2026-05-01T18:30:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-05-02T18:29:59.999Z');
  });

  it('computes UTC bounds for a UTC day', () => {
    const { startUtc, endUtc } = computeClinicDayRange('2026-05-02', 'UTC');
    expect(startUtc.toISOString()).toBe('2026-05-02T00:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-05-02T23:59:59.999Z');
  });

  it('computes UTC bounds for America/New_York (EDT -04:00 on this date)', () => {
    const { startUtc, endUtc } = computeClinicDayRange('2026-05-02', 'America/New_York');
    expect(startUtc.toISOString()).toBe('2026-05-02T04:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-05-03T03:59:59.999Z');
  });

  it('places an instant in the correct local day', () => {
    // 2026-05-01T19:30:00Z is 2026-05-02 01:00 IST — should fall in the 05-02 IST range.
    const { startUtc, endUtc } = computeClinicDayRange('2026-05-02', 'Asia/Kolkata');
    const instant = new Date('2026-05-01T19:30:00.000Z');
    expect(instant >= startUtc).toBe(true);
    expect(instant <= endUtc).toBe(true);
  });

  it('throws on malformed date', () => {
    expect(() => computeClinicDayRange('05/02/2026', 'UTC')).toThrow(/Invalid/);
    expect(() => computeClinicDayRange('2026-13-02', 'UTC')).toThrow(/Invalid/);
  });

  it('throws on unknown timezone', () => {
    expect(() => computeClinicDayRange('2026-05-02', 'Middle/Earth')).toThrow(/Invalid/);
  });
});
