# Workstream 0.1 — Auth & Tenant-Context Lockdown

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commit discipline:** Per user preference, never run `git commit` without explicit approval. Each task's final step stages the files and proposes a commit message; wait for user confirmation before committing.

**Goal:** Close the four Phase-0 security holes in one workstream: (1) remove/gate the unsigned `x-clinic-id`/`x-user-id` header fallback so production cannot be tenant-bypassed, (2) flip `PermissionsGuard` to default-deny so an undecorated handler is never accidentally public, (3) fail fast at boot if production env is missing or still using dev defaults, (4) add global rate-limiting with tight per-IP caps on auth and share endpoints.

**Architecture:** Keep the existing middleware-based auth flow (too big a refactor to replace in this workstream). Introduce a `@Public()` decorator that both the guard (reads via `Reflector`) and the middleware (via explicit `.exclude()` paths in `AppModule`) honor. The guard also treats `@RequirePermissions()` with an empty argument list as "authenticated, no specific permission" — covering routes like `/me` that need a tenant context but no capability check. Add a pure `validateEnv()` function called synchronously before `NestFactory.create`. Add `@nestjs/throttler` as an `APP_GUARD` with a 120/min default and `@Throttle()` overrides for auth + share.

**Tech Stack:** NestJS 11, `@nestjs/jwt`, `@nestjs/throttler` (new dependency), Jest 30.

**Exit bar for this workstream:**
- Unauthenticated request with forged `x-clinic-id` in production → 401.
- Handler without `@RequirePermissions` or `@Public` → 403.
- Boot in `NODE_ENV=production` with default JWT secrets → process exits non-zero.
- `POST /auth/login` rate-limited to 10/min per IP.
- All new/changed code covered by unit tests; `pnpm test` green.

---

## File Structure

**Create:**
- `backend/src/common/public.decorator.ts` — `@Public()` decorator + `IS_PUBLIC_KEY` constant
- `backend/src/common/config.ts` — `validateEnv()` + `EnvValidationError`
- `backend/src/common/config.spec.ts` — unit tests for `validateEnv`
- `backend/src/common/clinic-context.middleware.spec.ts` — unit tests for the middleware
- `backend/src/modules/authz/permissions.guard.spec.ts` — unit tests for the guard
- `backend/src/common/throttler.config.ts` — throttler module configuration

**Modify:**
- `backend/src/modules/authz/permissions.guard.ts` — default-deny + `@Public()` respect
- `backend/src/common/clinic-context.middleware.ts` — env-gated dev header fallback
- `backend/src/main.ts` — call `validateEnv()` before `NestFactory.create`
- `backend/src/app.module.ts` — add share paths to middleware `.exclude()`, import throttler
- `backend/src/modules/auth/auth.controller.ts` — `@Public()` on login/refresh/logout; `@Throttle()` on login
- `backend/src/health/health.controller.ts` — `@Public()`
- `backend/src/modules/documents/documents.controller.ts` — `@Public()` on `shareDownload`; `@Throttle()` override
- `backend/src/modules/prescriptions/prescriptions.controller.ts` — `@Public()` on `getShared`; `@Throttle()` override
- `backend/src/app.controller.ts` — `@Public()` on `getHello` (Nest scaffold route)
- `backend/src/modules/authz/me.controller.ts` — `@RequirePermissions()` (empty args, = authenticated-only) on `me`
- `backend/src/modules/access-logs/access-logs.controller.ts` — `@RequirePermissions(Permission.ClinicRead)` on `list` and `export`
- `backend/src/modules/appointments/doctor-availability.controller.ts` — `@RequirePermissions(Permission.AppointmentRead)` on `availability`
- `backend/package.json` — add `@nestjs/throttler`
- `backend/.env.example` — document `ALLOW_DEV_AUTH_HEADERS`

---

## Task 1 — `@Public()` decorator + `PermissionsGuard` default-deny

**Files:**
- Create: `backend/src/common/public.decorator.ts`
- Create: `backend/src/modules/authz/permissions.guard.spec.ts`
- Modify: `backend/src/modules/authz/permissions.guard.ts`

- [ ] **Step 1.1: Create the `@Public()` decorator**

Create `backend/src/common/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 1.2: Write the failing guard spec**

Create `backend/src/modules/authz/permissions.guard.spec.ts`:

```ts
import { Reflector } from '@nestjs/core';
import { Controller, ExecutionContext, ForbiddenException, Get } from '@nestjs/common';
import { Types } from 'mongoose';
import { PermissionsGuard } from './permissions.guard';
import { AuthzService } from './authz.service';
import { RequirePermissions } from './require-permissions.decorator';
import { Permission } from './permissions';
import { Public } from '../../common/public.decorator';

@Controller('public-test')
class PublicTestController {
  @Get()
  @Public()
  publicHandler() {}
}

@Controller('perm-test')
class PermTestController {
  @Get()
  @RequirePermissions(Permission.PatientRead)
  permHandler() {}
}

@Controller('auth-test')
class AuthenticatedTestController {
  @Get()
  @RequirePermissions()
  authOnlyHandler() {}
}

@Controller('bare-test')
class BareTestController {
  @Get()
  bareHandler() {}
}

function makeContext(target: any, methodName: string, request: any = {}): ExecutionContext {
  return {
    getHandler: () => target.prototype[methodName],
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let authz: jest.Mocked<AuthzService>;

  beforeEach(() => {
    authz = { getActor: jest.fn() } as unknown as jest.Mocked<AuthzService>;
    guard = new PermissionsGuard(new Reflector(), authz);
  });

  it('allows @Public() routes without calling authz', async () => {
    const ctx = makeContext(PublicTestController, 'publicHandler');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authz.getActor).not.toHaveBeenCalled();
  });

  it('denies handlers with no decorators (default-deny)', async () => {
    const ctx = makeContext(BareTestController, 'bareHandler');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(authz.getActor).not.toHaveBeenCalled();
  });

  it('allows when actor has the required permission', async () => {
    authz.getActor.mockResolvedValue({
      user: {} as any,
      roles: [],
      permissions: [Permission.PatientRead],
    });
    const ctx = makeContext(PermTestController, 'permHandler', {
      context: { clinicId: new Types.ObjectId(), actorUserId: new Types.ObjectId() },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('denies when actor lacks the required permission', async () => {
    authz.getActor.mockResolvedValue({
      user: {} as any,
      roles: [],
      permissions: [Permission.BillingRead],
    });
    const ctx = makeContext(PermTestController, 'permHandler', {
      context: { clinicId: new Types.ObjectId(), actorUserId: new Types.ObjectId() },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies @RequirePermissions route when req.context is missing', async () => {
    const ctx = makeContext(PermTestController, 'permHandler', {});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(authz.getActor).not.toHaveBeenCalled();
  });

  it('allows @RequirePermissions() (empty args) when req.context is present', async () => {
    const ctx = makeContext(AuthenticatedTestController, 'authOnlyHandler', {
      context: { clinicId: new Types.ObjectId(), actorUserId: new Types.ObjectId() },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authz.getActor).not.toHaveBeenCalled();
  });

  it('denies @RequirePermissions() (empty args) when req.context is missing', async () => {
    const ctx = makeContext(AuthenticatedTestController, 'authOnlyHandler', {});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 1.3: Run the spec — expect failures**

Run from `backend/`: `pnpm test -- permissions.guard.spec.ts`

Expected: the "denies handlers with no decorators" test fails — the current guard returns `true` on undecorated handlers. The "allows @Public()" test also fails — the guard knows nothing about `@Public()` yet. Other tests may pass or fail depending on current behavior; don't move on until the failures match these reasons.

- [ ] **Step 1.4: Update the guard to default-deny and respect `@Public()`**

Replace the full contents of `backend/src/modules/authz/permissions.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../../common/public.decorator';
import { AuthzService } from './authz.service';
import type { AppRequest } from '../../common/types';
import { Permission } from './permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly authz: AuthzService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required === undefined) {
      throw new ForbiddenException('Endpoint has no permission declaration');
    }

    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.context) {
      throw new ForbiddenException('Missing authentication context');
    }

    // Empty @RequirePermissions() means "authenticated, any permission".
    if (required.length === 0) return true;

    const actor = await this.authz.getActor({
      clinicId: req.context.clinicId,
      actorUserId: req.context.actorUserId,
    });

    const have = new Set(actor.permissions);
    for (const p of required) {
      if (!have.has(p)) throw new ForbiddenException('Missing permission');
    }
    return true;
  }
}
```

- [ ] **Step 1.5: Run the spec — expect pass**

Run: `pnpm test -- permissions.guard.spec.ts`

Expected: all 5 tests pass.

- [ ] **Step 1.6: Stage for commit (await approval)**

Stage:
```bash
git add backend/src/common/public.decorator.ts backend/src/modules/authz/permissions.guard.ts backend/src/modules/authz/permissions.guard.spec.ts
```

Proposed commit message:
```
feat(authz): default-deny permissions guard + @Public() decorator

Previously a handler without @RequirePermissions() was silently allowed.
Guard now throws Forbidden unless the handler is @Public() or declares
at least one permission. Callers that were implicitly public must now
opt in explicitly.
```

**DO NOT run `git commit` without explicit user confirmation.**

---

## Task 2 — Apply `@Public()` to the actually-public routes

**Files:**
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/src/health/health.controller.ts`
- Modify: `backend/src/modules/documents/documents.controller.ts`
- Modify: `backend/src/modules/prescriptions/prescriptions.controller.ts`

- [ ] **Step 2.1: Apply `@Public()` in `AuthController`**

In `backend/src/modules/auth/auth.controller.ts`, add the import and decorate all three handlers (`login`, `refresh`, `logout`):

Add import at top (merge with existing imports):
```ts
import { Public } from '../../common/public.decorator';
```

Decorate each `@Post(...)` handler by inserting `@Public()` on its own line directly below the `@Post(...)` decorator. Example for `login`:
```ts
@Post('login')
@Public()
async login(
  @Body() body: { clinicId: string; email: string; password: string; branchId?: string },
  @Res({ passthrough: true }) res: Response,
) { /* unchanged */ }
```

Repeat for `refresh` and `logout`.

- [ ] **Step 2.2: Apply `@Public()` in `HealthController`**

Replace the full contents of `backend/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/public.decorator';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  health() {
    return { ok: true };
  }
}
```

- [ ] **Step 2.3: Apply `@Public()` in `DocumentsController`**

In `backend/src/modules/documents/documents.controller.ts`, add the import:
```ts
import { Public } from '../../common/public.decorator';
```

Decorate the `shareDownload` handler (currently at `documents.controller.ts:78`) — insert `@Public()` on its own line directly below `@Get('share/:token')`:
```ts
@Get('share/:token')
@Public()
async shareDownload(@Param('token') token: string, @Query('inline') inline?: string) {
  /* unchanged body */
}
```

- [ ] **Step 2.4: Apply `@Public()` in `PrescriptionsController`**

In `backend/src/modules/prescriptions/prescriptions.controller.ts`, add the import:
```ts
import { Public } from '../../common/public.decorator';
```

Decorate the `getShared` handler (currently at `prescriptions.controller.ts:39`):
```ts
@Get('share/prescriptions/:token')
@Public()
async getShared(@Param('token') token: string) {
  return await this.prescriptions.getByShareToken(token);
}
```

- [ ] **Step 2.5: Decorate `AppController.getHello` as `@Public()`**

Replace the full contents of `backend/src/app.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  getHello(): string {
    return this.appService.getHello();
  }
}
```

- [ ] **Step 2.6: Mark `MeController.me` as authenticated-only**

Replace the full contents of `backend/src/modules/authz/me.controller.ts`:

```ts
import { Controller, Get, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { AuthzService } from './authz.service';
import { RequirePermissions } from './require-permissions.decorator';

@Controller()
export class MeController {
  constructor(private readonly authz: AuthzService) {}

  @Get('me')
  @RequirePermissions()
  async me(@Req() req: AppRequest) {
    const actor = await this.authz.getActor({
      clinicId: req.context!.clinicId,
      actorUserId: req.context!.actorUserId,
    });

    return {
      clinicId: req.context!.clinicId,
      branchId: req.context!.branchId,
      user: actor.user,
      roles: actor.roles,
      permissions: actor.permissions,
    };
  }
}
```

- [ ] **Step 2.7: Decorate `AccessLogsController`**

In `backend/src/modules/access-logs/access-logs.controller.ts`, add imports:
```ts
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
```

Add `@RequirePermissions(Permission.ClinicRead)` on both handlers:
```ts
@Get()
@RequirePermissions(Permission.ClinicRead)
async list(...) { /* unchanged */ }

@Get('export')
@RequirePermissions(Permission.ClinicRead)
async export(...) { /* unchanged */ }
```

Note: a dedicated `Permission.AuditRead` is planned in workstream 2.4; swap over then.

- [ ] **Step 2.8: Decorate `DoctorAvailabilityController.availability`**

In `backend/src/modules/appointments/doctor-availability.controller.ts`, add imports:
```ts
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
```

Decorate the handler:
```ts
@Get('availability')
@RequirePermissions(Permission.AppointmentRead)
async availability(...) { /* unchanged */ }
```

- [ ] **Step 2.9: Run the full test suite — expect no regressions**

Run from `backend/`: `pnpm test`

Expected: all existing tests plus the new guard spec pass. If a controller test fails with 403, the handler still lacks `@RequirePermissions(...)` or `@Public()` — add the correct decorator; do not relax default-deny.

- [ ] **Step 2.10: Stage for commit (await approval)**

Stage:
```bash
git add backend/src/modules/auth/auth.controller.ts backend/src/health/health.controller.ts backend/src/modules/documents/documents.controller.ts backend/src/modules/prescriptions/prescriptions.controller.ts backend/src/app.controller.ts backend/src/modules/authz/me.controller.ts backend/src/modules/access-logs/access-logs.controller.ts backend/src/modules/appointments/doctor-availability.controller.ts
```

Proposed commit message:
```
feat: decorate every controller handler for default-deny guard

Auth, health, share, and the Nest hello-world route are @Public().
/me is @RequirePermissions() (empty = authenticated-only). Access-logs
and doctor-availability get explicit permissions. No handler is now
implicitly allowed.
```

---

## Task 3 — Env-gate dev auth headers + expand middleware exclude list

**Files:**
- Create: `backend/src/common/clinic-context.middleware.spec.ts`
- Modify: `backend/src/common/clinic-context.middleware.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/.env.example`

- [ ] **Step 3.1: Write the failing middleware spec**

Create `backend/src/common/clinic-context.middleware.spec.ts`:

```ts
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { ClinicContextMiddleware } from './clinic-context.middleware';
import type { AppRequest } from './types';

describe('ClinicContextMiddleware', () => {
  let jwt: jest.Mocked<JwtService>;
  let middleware: ClinicContextMiddleware;

  beforeEach(() => {
    jwt = { verify: jest.fn() } as unknown as jest.Mocked<JwtService>;
    middleware = new ClinicContextMiddleware(jwt);
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_DEV_AUTH_HEADERS;
  });

  function mockRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
  }

  function mockReq(headers: Record<string, string>): AppRequest {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      header: (name: string) => lower[name.toLowerCase()],
      headers: lower,
    } as unknown as AppRequest;
  }

  it('accepts a valid Bearer token', () => {
    const clinicId = new Types.ObjectId().toHexString();
    const userId = new Types.ObjectId().toHexString();
    jwt.verify.mockReturnValue({ clinicId, sub: userId } as any);

    const req = mockReq({ authorization: 'Bearer good-token' });
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.context?.clinicId.toHexString()).toBe(clinicId);
    expect(req.context?.actorUserId?.toHexString()).toBe(userId);
  });

  it('rejects missing Bearer in production even with x-clinic-id header', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_AUTH_HEADERS = 'true';

    const req = mockReq({ 'x-clinic-id': new Types.ObjectId().toHexString() });
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects dev-header fallback when ALLOW_DEV_AUTH_HEADERS is unset', () => {
    process.env.NODE_ENV = 'development';

    const req = mockReq({ 'x-clinic-id': new Types.ObjectId().toHexString() });
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts dev headers when NODE_ENV=development and ALLOW_DEV_AUTH_HEADERS=true', () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_AUTH_HEADERS = 'true';

    const clinicId = new Types.ObjectId().toHexString();
    const req = mockReq({ 'x-clinic-id': clinicId });
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.context?.clinicId.toHexString()).toBe(clinicId);
  });

  it('returns 400 on an invalid Bearer token', () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const req = mockReq({ authorization: 'Bearer bad' });
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3.2: Run the spec — expect failures**

Run: `pnpm test -- clinic-context.middleware.spec.ts`

Expected: "rejects dev-header fallback when ALLOW_DEV_AUTH_HEADERS is unset" fails — the current middleware accepts `x-clinic-id` in any environment. The production test may also fail.

- [ ] **Step 3.3: Update the middleware to env-gate dev headers**

Replace the full contents of `backend/src/common/clinic-context.middleware.ts`:

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response, NextFunction } from 'express';
import { AppRequest } from './types';
import { parseObjectId } from './request-context';
import type { JwtClaims } from '../modules/auth/auth.types';

/**
 * Populates req.context from a Bearer JWT.
 *
 * In non-production environments, if ALLOW_DEV_AUTH_HEADERS=true, it also
 * accepts x-clinic-id / x-branch-id / x-user-id headers as an auth fallback.
 * In production this fallback is unconditionally disabled.
 */
@Injectable()
export class ClinicContextMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}

  use(req: AppRequest, res: Response, next: NextFunction) {
    try {
      const auth = req.header('authorization') ?? req.header('Authorization');
      if (auth && auth.toLowerCase().startsWith('bearer ')) {
        const token = auth.slice(7).trim();
        const claims = this.jwt.verify<JwtClaims>(token, {
          secret: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_change_me',
        });

        req.context = {
          clinicId: parseObjectId(claims.clinicId, 'clinicId'),
          branchId: claims.branchId ? parseObjectId(claims.branchId, 'branchId') : undefined,
          actorUserId: parseObjectId(claims.sub, 'sub'),
        };

        next();
        return;
      }

      const allowDevHeaders =
        process.env.NODE_ENV !== 'production' &&
        process.env.ALLOW_DEV_AUTH_HEADERS === 'true';

      if (!allowDevHeaders) {
        res.status(401).json({ message: 'Missing Bearer token' });
        return;
      }

      const clinicIdHeader = req.header('x-clinic-id');
      if (!clinicIdHeader) {
        res.status(401).json({ message: 'Missing auth context (Bearer token or x-clinic-id)' });
        return;
      }

      const branchIdHeader = req.header('x-branch-id');
      const userIdHeader = req.header('x-user-id');

      req.context = {
        clinicId: parseObjectId(clinicIdHeader, 'x-clinic-id'),
        branchId: branchIdHeader ? parseObjectId(branchIdHeader, 'x-branch-id') : undefined,
        actorUserId: userIdHeader ? parseObjectId(userIdHeader, 'x-user-id') : undefined,
      };

      next();
    } catch (e) {
      res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid tenant context' });
    }
  }
}
```

- [ ] **Step 3.4: Run the middleware spec — expect pass**

Run: `pnpm test -- clinic-context.middleware.spec.ts`

Expected: all 5 tests pass.

- [ ] **Step 3.5: Expand middleware `.exclude()` list in `AppModule`**

In `backend/src/app.module.ts`, replace the `configure(consumer: MiddlewareConsumer)` method body with:

```ts
configure(consumer: MiddlewareConsumer) {
  consumer
    .apply(ClinicContextMiddleware)
    .exclude(
      'health',
      { path: 'auth/(.*)', method: RequestMethod.ALL },
      { path: 'auth', method: RequestMethod.ALL },
      { path: 'share/(.*)', method: RequestMethod.ALL },
    )
    .forRoutes('*');
}
```

The added entry `share/(.*)` covers both `GET /share/:token` (documents) and `GET /share/prescriptions/:token`.

- [ ] **Step 3.6: Update `.env.example` to document `ALLOW_DEV_AUTH_HEADERS`**

In `backend/.env.example`, insert the following lines after the existing `NODE_ENV=development` line:

```
# Dev-only: allow unsigned x-clinic-id/x-user-id/x-branch-id headers as an
# auth fallback. Must be "true" AND NODE_ENV must not be "production" for
# the fallback to activate. Never enable in production.
ALLOW_DEV_AUTH_HEADERS=true
```

- [ ] **Step 3.7: Run the full test suite — expect green**

Run: `pnpm test`

Expected: all tests pass, including existing ones. If a controller test that used `x-clinic-id` headers now fails, the test setup needs `ALLOW_DEV_AUTH_HEADERS=true` in its env.

- [ ] **Step 3.8: Stage for commit (await approval)**

Stage:
```bash
git add backend/src/common/clinic-context.middleware.ts backend/src/common/clinic-context.middleware.spec.ts backend/src/app.module.ts backend/.env.example
```

Proposed commit message:
```
feat(auth): env-gate dev-header auth fallback; exclude /share/* from middleware

x-clinic-id / x-user-id are now only accepted when NODE_ENV != production
AND ALLOW_DEV_AUTH_HEADERS=true. Production cannot be tenant-bypassed by
forging headers. /share/* is now excluded from the tenant-context middleware
so token-based public endpoints no longer require an auth header.
```

---

## Task 4 — `validateEnv()` + boot-time invocation

**Files:**
- Create: `backend/src/common/config.ts`
- Create: `backend/src/common/config.spec.ts`
- Modify: `backend/src/main.ts`

- [ ] **Step 4.1: Write the failing config spec**

Create `backend/src/common/config.spec.ts`:

```ts
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
```

- [ ] **Step 4.2: Run the spec — expect failures**

Run: `pnpm test -- config.spec.ts`

Expected: every test fails because `backend/src/common/config.ts` does not exist yet.

- [ ] **Step 4.3: Create `validateEnv()`**

Create `backend/src/common/config.ts`:

```ts
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
    if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET === DEFAULT_JWT_ACCESS) {
      errors.push('JWT_ACCESS_SECRET must be overridden in production');
    }
    if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET === DEFAULT_JWT_REFRESH) {
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
  }

  if (errors.length > 0) {
    throw new EnvValidationError(errors);
  }
}
```

- [ ] **Step 4.4: Run the spec — expect pass**

Run: `pnpm test -- config.spec.ts`

Expected: all 8 tests pass.

- [ ] **Step 4.5: Wire `validateEnv()` into `main.ts`**

Replace the contents of `backend/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { validateEnv } from './common/config';

async function bootstrap() {
  dotenv.config();
  validateEnv();

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  const allowedOrigins = new Set<string>([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  if (process.env.FRONTEND_ORIGIN) allowedOrigins.add(process.env.FRONTEND_ORIGIN);
  if (process.env.CORS_ORIGINS) {
    for (const o of process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)) {
      allowedOrigins.add(o);
    }
  }

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  });

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
```

- [ ] **Step 4.6: Manual verification — boot with production + defaults fails fast**

Run from `backend/`:
```bash
NODE_ENV=production JWT_ACCESS_SECRET=dev_access_secret_change_me JWT_REFRESH_SECRET=dev_refresh_secret_change_me MONGODB_URI=mongodb://localhost:27017/x node dist/main 2>&1 | head -10
```

(If `dist/` is stale, run `pnpm build` first.)

Expected: process exits non-zero, stderr contains `EnvValidationError` with three bullet points (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, MONGODB_URI).

- [ ] **Step 4.7: Stage for commit (await approval)**

Stage:
```bash
git add backend/src/common/config.ts backend/src/common/config.spec.ts backend/src/main.ts
```

Proposed commit message:
```
feat: fail fast in production on default JWT secrets / localhost Mongo

validateEnv() throws EnvValidationError at boot when NODE_ENV=production
and any of JWT_ACCESS_SECRET, JWT_REFRESH_SECRET are still set to their
dev defaults, or MONGODB_URI still targets localhost, or ALLOW_DEV_AUTH_HEADERS=true.
```

---

## Task 5 — Global rate limiting + tight caps on auth / share

**Files:**
- Modify: `backend/package.json` (add `@nestjs/throttler`)
- Create: `backend/src/common/throttler.config.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/src/modules/documents/documents.controller.ts`
- Modify: `backend/src/modules/prescriptions/prescriptions.controller.ts`

- [ ] **Step 5.1: Install `@nestjs/throttler`**

Run from `backend/`:
```bash
pnpm add @nestjs/throttler@^6
```

Expected: `package.json` gets a new dependency, `pnpm-lock.yaml` updates.

- [ ] **Step 5.2: Create throttler configuration module**

Create `backend/src/common/throttler.config.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

export const THROTTLE_AUTH = 'auth' as const;
export const THROTTLE_SHARE = 'share' as const;

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
      { name: THROTTLE_AUTH, ttl: 60_000, limit: 10 },
      { name: THROTTLE_SHARE, ttl: 60_000, limit: 10 },
    ]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppThrottlerModule {}
```

Two named throttlers (`auth`, `share`) are declared so controllers can override the default limit via `@Throttle()` for just those routes.

- [ ] **Step 5.3: Register the throttler module in `AppModule`**

In `backend/src/app.module.ts`, add the import:
```ts
import { AppThrottlerModule } from './common/throttler.config';
```

Then add `AppThrottlerModule` as the **first** entry in the `imports: [...]` array of `@Module({...})` (the order is load-order — putting throttler first means its guard registers before any handler executes).

- [ ] **Step 5.4: Apply tight limit to `POST /auth/login`**

In `backend/src/modules/auth/auth.controller.ts`, add imports:
```ts
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_AUTH } from '../../common/throttler.config';
```

Decorate `login` only (not refresh/logout — those have other abuse shapes):
```ts
@Post('login')
@Public()
@Throttle({ [THROTTLE_AUTH]: { limit: 10, ttl: 60_000 } })
async login(...) { /* unchanged */ }
```

- [ ] **Step 5.5: Apply tight limit to share endpoints**

In `backend/src/modules/documents/documents.controller.ts`:

Add imports:
```ts
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_SHARE } from '../../common/throttler.config';
```

Decorate `shareDownload`:
```ts
@Get('share/:token')
@Public()
@Throttle({ [THROTTLE_SHARE]: { limit: 10, ttl: 60_000 } })
async shareDownload(@Param('token') token: string, @Query('inline') inline?: string) {
  /* unchanged */
}
```

In `backend/src/modules/prescriptions/prescriptions.controller.ts`:

Add imports:
```ts
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_SHARE } from '../../common/throttler.config';
```

Decorate `getShared`:
```ts
@Get('share/prescriptions/:token')
@Public()
@Throttle({ [THROTTLE_SHARE]: { limit: 10, ttl: 60_000 } })
async getShared(@Param('token') token: string) {
  return await this.prescriptions.getByShareToken(token);
}
```

- [ ] **Step 5.6: Run the full test suite — expect green**

Run: `pnpm test`

Expected: all tests pass. The throttler guard is a no-op during unit tests (no HTTP bursts).

- [ ] **Step 5.7: Manual verification — login returns 429 after 10 requests**

Start the backend (`pnpm start:dev`) and run:
```bash
for i in (seq 1 12); curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"clinicId":"000000000000000000000000","email":"x@x","password":"x"}'; end
```

Expected: first 10 return 401 (bad creds), attempts 11 and 12 return 429.

- [ ] **Step 5.8: Stage for commit (await approval)**

Stage:
```bash
git add backend/package.json backend/pnpm-lock.yaml backend/src/common/throttler.config.ts backend/src/app.module.ts backend/src/modules/auth/auth.controller.ts backend/src/modules/documents/documents.controller.ts backend/src/modules/prescriptions/prescriptions.controller.ts
```

Proposed commit message:
```
feat: global rate limiting (120/min) + 10/min on auth and share

Adds @nestjs/throttler as an APP_GUARD with a 120/min global default.
POST /auth/login, GET /share/:token, and GET /share/prescriptions/:token
are capped at 10/min per IP to blunt credential stuffing and share-token
enumeration.
```

---

## Task 6 — Final verification

- [ ] **Step 6.1: Run the entire backend test suite**

Run from `backend/`: `pnpm test`

Expected: all tests pass, including the three new spec files (`permissions.guard.spec.ts`, `clinic-context.middleware.spec.ts`, `config.spec.ts`) and any existing tests.

- [ ] **Step 6.2: Lint and type-check**

Run: `pnpm lint && pnpm build`

Expected: exit 0 on both.

- [ ] **Step 6.3: Manual end-to-end smoke — default-deny works**

Start the backend with dev defaults. Create a temporary test route to verify default-deny, or hit any existing decorated endpoint — then temporarily remove its `@RequirePermissions(...)` on a branch to confirm it 403s, then restore.

If you prefer an existing surface: `GET /me` is explicitly allowed for authenticated users with no permission requirement. Confirm it still works with a valid token, and confirm that hitting it without auth returns 401 (from the middleware) rather than slipping through.

- [ ] **Step 6.4: Update the CLAUDE.md note about auth**

Open `/mnt/Dev/Vidhema/DigiRx/CLAUDE.md` and update the "Multi-tenant request context (backend)" section to replace the line:

> 2. Dev fallback headers: `x-clinic-id` (required), `x-branch-id`, `x-user-id`.

with:

> 2. Dev fallback headers: `x-clinic-id` (required), `x-branch-id`, `x-user-id` — **only** when `NODE_ENV !== 'production'` AND `ALLOW_DEV_AUTH_HEADERS=true`.

Also update the "AuthZ" section's guard description to replace:

> **If a handler has no decorator, it is allowed** (guard returns true). Always add `@RequirePermissions(...)` to any new endpoint that touches tenant data.

with:

> Guard is **default-deny**: a handler without `@RequirePermissions(...)` or `@Public()` returns 403. Use `@RequirePermissions()` (empty args) for routes that need a tenant context but no specific capability (`/me`). Use `@Public()` only for truly unauthenticated routes (`/auth/*`, `/health`, `/share/*`).

- [ ] **Step 6.5: Stage the CLAUDE.md update (await approval)**

Stage:
```bash
git add CLAUDE.md
```

Proposed commit message:
```
docs: update CLAUDE.md for default-deny guard + env-gated dev headers
```

- [ ] **Step 6.6: Workstream checklist**

Confirm all exit-bar items from the roadmap §Phase 0.1 are met:

- [ ] `x-clinic-id` / `x-user-id` header fallback only active when `NODE_ENV !== 'production'` AND `ALLOW_DEV_AUTH_HEADERS=true`.
- [ ] `main.ts` throws and exits non-zero at boot if `NODE_ENV=production` and defaults are still in place.
- [ ] `PermissionsGuard` is default-deny for non-auth, non-health routes.
- [ ] `@Public()` decorator created and applied to `/auth/login`, `/auth/refresh`, `/auth/logout`, `/health`, `GET /share/:token`, `GET /share/prescriptions/:token`.
- [ ] `@nestjs/throttler` registered globally (120 req/min default); 10/min override on `/auth/login` and both `/share/*` routes.
- [ ] Tests: forged `x-clinic-id` header in production → 401 (covered by `clinic-context.middleware.spec.ts`). Handler without `@RequirePermissions` or `@Public` → 403 (covered by `permissions.guard.spec.ts`).

---

## Notes for the executing engineer

- **Do not skip the failing-test step.** If a test passes before you write the implementation, it is not testing what you think it is testing.
- **Do not refactor adjacent code** while doing this workstream. Every file modification should be traceable to a step above. Leave the other `// placeholder` comments for their own workstreams.
- **Do not touch the frontend.** The frontend already sends `Authorization: Bearer <token>` when available; once it's required in production, the remaining dev-header path on `MeScreen` will simply stop working in prod deployments — that's intentional.
- **`@Throttle()` storage is in-memory by default.** This is fine for a single-instance deployment; when the app runs on multiple replicas in Phase 3, swap in `@nest-lab/throttler-storage-redis` using the existing `REDIS_URL`. Leave that to Phase 3.1.
