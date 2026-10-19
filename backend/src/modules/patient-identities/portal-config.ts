/**
 * Patient-portal runtime configuration, read from the environment.
 *
 * The portal is OFF unless PATIENT_PORTAL_ENABLED=true, so deploying this
 * code changes nothing for the clinic app until it is switched on.
 */

export const DEFAULT_PORTAL_JWT_SECRET = 'dev_portal_secret_change_me';

/** Audience claim on portal tokens. Staff tokens never carry it. */
export const PORTAL_JWT_AUDIENCE = 'digirx-portal';
export const PORTAL_TOKEN_SCOPE = 'portal:patient';
export const PORTAL_REFRESH_COOKIE = 'digirx_portal_refresh';
export const PORTAL_REFRESH_COOKIE_PATH = '/portal/auth';

export type PortalJwtClaims = {
  sub: string; // PatientAccount id — not a staff user id
  scope: typeof PORTAL_TOKEN_SCOPE;
};

export function isPortalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PATIENT_PORTAL_ENABLED ?? '').toLowerCase() === 'true';
}

export function portalJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.JWT_PORTAL_SECRET || DEFAULT_PORTAL_JWT_SECRET;
}

export function portalAccessTtl(env: NodeJS.ProcessEnv = process.env): string {
  return env.PORTAL_ACCESS_TTL || '30m';
}

export function portalRefreshDays(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(env.PORTAL_REFRESH_DAYS ?? 30);
  return Number.isFinite(n) && n >= 1 && n <= 90 ? Math.floor(n) : 30;
}

/** Dial code used for SMS when an account has none recorded. */
export function defaultDialCode(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PORTAL_DEFAULT_DIAL_CODE || '91').replace(/\D/g, '') || '91';
}

/**
 * Problems with the portal configuration that must stop a production boot.
 * Returns nothing when the portal is disabled.
 */
export function portalEnvErrors(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (!isPortalEnabled(env) || env.NODE_ENV !== 'production') return [];
  const errors: string[] = [];
  const secret = env.JWT_PORTAL_SECRET;
  if (!secret || secret === DEFAULT_PORTAL_JWT_SECRET) {
    errors.push(
      'JWT_PORTAL_SECRET must be set when PATIENT_PORTAL_ENABLED=true in production',
    );
  } else if (
    secret === env.JWT_ACCESS_SECRET ||
    secret === env.JWT_REFRESH_SECRET
  ) {
    errors.push('JWT_PORTAL_SECRET must differ from the staff JWT secrets');
  } else if (secret.length < 32) {
    errors.push('JWT_PORTAL_SECRET must be at least 32 characters');
  }
  return errors;
}
