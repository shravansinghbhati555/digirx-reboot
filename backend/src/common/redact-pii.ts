/**
 * Recursively walks an object and replaces values whose keys match the
 * sensitive list with the literal string `[REDACTED]`. Key match is
 * case-insensitive. Returns a new object — the input is not mutated.
 *
 * Defense-in-depth for audit logs: the AuditInterceptor today only stores
 * `{ method, path }`, but if a future change starts capturing request
 * bodies (e.g. for diff trails), this guard prevents passwords / OTPs /
 * raw phones from landing in `auditlogs.meta`.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'apikey',
  'otp',
  'pin',
  'phone',
  'phones',
  'phonenumber',
  'email',
  'emails',
  'mobile',
  'idempotencykey',
];

const REDACTED_VALUE = '[REDACTED]';
const MAX_DEPTH = 8;

export function redactPII<T>(input: T, depth = 0): T {
  if (input === null || input === undefined) return input;
  if (depth >= MAX_DEPTH) return input;

  if (Array.isArray(input)) {
    return input.map((v) => redactPII(v, depth + 1)) as unknown as T;
  }

  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        out[key] = REDACTED_VALUE;
      } else {
        out[key] = redactPII(value, depth + 1);
      }
    }
    return out as T;
  }

  // Primitives (string/number/boolean) pass through unchanged.
  return input;
}
