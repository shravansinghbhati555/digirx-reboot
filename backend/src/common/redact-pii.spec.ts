import { redactPII } from './redact-pii';

describe('redactPII', () => {
  it('returns primitives unchanged', () => {
    expect(redactPII('hello')).toBe('hello');
    expect(redactPII(42)).toBe(42);
    expect(redactPII(null as any)).toBeNull();
    expect(redactPII(undefined as any)).toBeUndefined();
  });

  it('redacts top-level sensitive keys', () => {
    const out = redactPII({
      password: 'hunter2',
      email: 'a@b.com',
      ok: 'visible',
    });
    expect(out.password).toBe('[REDACTED]');
    expect(out.email).toBe('[REDACTED]');
    expect(out.ok).toBe('visible');
  });

  it('matches keys case-insensitively', () => {
    expect(redactPII({ PASSWORD: 'x' }).PASSWORD).toBe('[REDACTED]');
    expect(redactPII({ Phone: '+91…' }).Phone).toBe('[REDACTED]');
  });

  it('redacts deeply nested fields', () => {
    const out = redactPII({
      level1: {
        level2: {
          newPassword: 'secret',
          name: 'Saloni',
        },
      },
    });
    expect((out.level1.level2 as any).newPassword).toBe('[REDACTED]');
    expect((out.level1.level2 as any).name).toBe('Saloni');
  });

  it('walks into arrays of objects', () => {
    const out = redactPII({
      users: [
        { email: 'a@b.com', name: 'A' },
        { email: 'c@d.com', name: 'B' },
      ],
    });
    expect(out.users[0].email).toBe('[REDACTED]');
    expect(out.users[0].name).toBe('A');
    expect(out.users[1].email).toBe('[REDACTED]');
  });

  it('does not mutate the input', () => {
    const input = { password: 'leak' };
    const out = redactPII(input);
    expect(input.password).toBe('leak');
    expect(out.password).toBe('[REDACTED]');
  });

  it('caps recursion at MAX_DEPTH so a circular blob does not stack-overflow', () => {
    const a: any = { name: 'a' };
    const b: any = { name: 'b', child: a };
    a.child = b;
    expect(() => redactPII(a)).not.toThrow();
  });
});
