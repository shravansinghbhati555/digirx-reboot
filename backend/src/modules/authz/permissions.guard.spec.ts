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
