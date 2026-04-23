import { EnvValidationError, validateEnv } from './config';

const prodBase: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'real-access-secret-xyz',
  JWT_REFRESH_SECRET: 'real-refresh-secret-xyz',
  MONGODB_URI: 'mongodb://prod.internal:27017/digirx',
} as NodeJS.ProcessEnv;

function expectValidationError(env: NodeJS.ProcessEnv, predicate: (errs: string[]) => boolean) {
  let thrown: EnvValidationError | undefined;
  try {
    validateEnv(env);
  } catch (e) {
    if (e instanceof EnvValidationError) thrown = e;
  }
  expect(thrown).toBeInstanceOf(EnvValidationError);
  expect(predicate(thrown!.errors)).toBe(true);
}

describe('validateEnv', () => {
  it('passes in development with minimal config', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('passes in production with all overrides', () => {
    expect(() => validateEnv(prodBase)).not.toThrow();
  });

  it('throws in production with default JWT_ACCESS_SECRET', () => {
    expectValidationError(
      { ...prodBase, JWT_ACCESS_SECRET: 'dev_access_secret_change_me' },
      (errs) => errs.some((e) => e.includes('JWT_ACCESS_SECRET')),
    );
  });

  it('throws in production with default JWT_REFRESH_SECRET', () => {
    expectValidationError(
      { ...prodBase, JWT_REFRESH_SECRET: 'dev_refresh_secret_change_me' },
      (errs) => errs.some((e) => e.includes('JWT_REFRESH_SECRET')),
    );
  });

  it('throws in production with localhost MONGODB_URI', () => {
    expectValidationError(
      { ...prodBase, MONGODB_URI: 'mongodb://localhost:27017/x' },
      (errs) => errs.some((e) => e.includes('MONGODB_URI')),
    );
  });

  it('throws in production with 127.0.0.1 MONGODB_URI', () => {
    expectValidationError(
      { ...prodBase, MONGODB_URI: 'mongodb://127.0.0.1:27017/x' },
      (errs) => errs.some((e) => e.includes('MONGODB_URI')),
    );
  });

  it('throws in production when ALLOW_DEV_AUTH_HEADERS=true', () => {
    expectValidationError(
      { ...prodBase, ALLOW_DEV_AUTH_HEADERS: 'true' },
      (errs) => errs.some((e) => e.includes('ALLOW_DEV_AUTH_HEADERS')),
    );
  });

  it('aggregates multiple errors', () => {
    expectValidationError(
      {
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'dev_access_secret_change_me',
        JWT_REFRESH_SECRET: 'dev_refresh_secret_change_me',
        MONGODB_URI: 'mongodb://localhost/x',
      } as NodeJS.ProcessEnv,
      (errs) => errs.length >= 3,
    );
  });
});
