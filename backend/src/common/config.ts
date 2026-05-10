const DEFAULT_JWT_ACCESS = 'dev_access_secret_change_me';
const DEFAULT_JWT_REFRESH = 'dev_refresh_secret_change_me';

export class EnvValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Environment validation failed:\n  - ${errors.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = [];
  const isProd = env.NODE_ENV === 'production';

  if (isProd) {
    if (
      !env.JWT_ACCESS_SECRET ||
      env.JWT_ACCESS_SECRET === DEFAULT_JWT_ACCESS
    ) {
      errors.push('JWT_ACCESS_SECRET must be overridden in production');
    }
    if (
      !env.JWT_REFRESH_SECRET ||
      env.JWT_REFRESH_SECRET === DEFAULT_JWT_REFRESH
    ) {
      errors.push('JWT_REFRESH_SECRET must be overridden in production');
    }

    const mongo = env.MONGODB_URI ?? '';
    if (!mongo) {
      errors.push('MONGODB_URI must be set in production');
    } else if (/localhost|127\.0\.0\.1/.test(mongo)) {
      errors.push('MONGODB_URI must not target localhost in production');
    }

    if (env.ALLOW_DEV_AUTH_HEADERS === 'true') {
      errors.push('ALLOW_DEV_AUTH_HEADERS=true is not permitted in production');
    }

    // The refresh cookie is `Secure: true` in production, so http://
    // origins would silently fail to receive it on cross-origin login.
    // Catch this at boot rather than at the first failed login.
    const fe = env.FRONTEND_ORIGIN;
    if (fe && /^http:\/\//i.test(fe)) {
      errors.push(
        'FRONTEND_ORIGIN must use https:// in production (refresh cookie is Secure)',
      );
    }
    const cors = env.CORS_ORIGINS;
    if (cors) {
      for (const origin of cors.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (/^http:\/\//i.test(origin)) {
          errors.push(
            `CORS_ORIGINS contains http:// origin "${origin}" — must be https:// in production`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new EnvValidationError(errors);
  }
}
