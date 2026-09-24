import { parseDeviceId } from './request-context';

describe('parseDeviceId', () => {
  const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  it('accepts the UUID the client mints', () => {
    expect(parseDeviceId(uuid)).toBe(uuid);
  });

  it('accepts the hex fallback id used on non-secure origins', () => {
    const hex = 'a'.repeat(32);
    expect(parseDeviceId(hex)).toBe(hex);
  });

  it('trims surrounding whitespace', () => {
    expect(parseDeviceId(`  ${uuid}  `)).toBe(uuid);
  });

  it('returns undefined when the header is absent', () => {
    expect(parseDeviceId(undefined)).toBeUndefined();
    expect(parseDeviceId('')).toBeUndefined();
  });

  it('drops a value with characters outside hex and dashes', () => {
    // The value lands in audit rows, so anything unexpected is discarded
    // rather than stored.
    expect(parseDeviceId('<script>alert(1)</script>')).toBeUndefined();
    expect(parseDeviceId('device/../../etc')).toBeUndefined();
    expect(parseDeviceId('zzzzzzzzzzzzzzzz')).toBeUndefined();
  });

  it('drops values that are too short or too long', () => {
    expect(parseDeviceId('abc123')).toBeUndefined();
    expect(parseDeviceId('a'.repeat(65))).toBeUndefined();
  });
});
