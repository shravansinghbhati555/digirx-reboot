import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../../common/public.decorator';
import { AuthzService } from './authz.service';
import type { AppRequest } from '../../common/types';
import { Permission } from './permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthzService,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

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

    // Expose the actor's role names (lowercased) so handlers can do
    // role-based authorization on top of permissions.
    req.actorRoleNames = new Set(
      (actor.roles ?? []).map((r) => (r.name ?? '').toLowerCase()),
    );

    const have = new Set(actor.permissions);
    // Expose the flattened set too. The guard reads static metadata, so a
    // handler whose required permission depends on the request body (e.g. the
    // counter a number lease is for) has to check that part itself rather
    // than re-loading the actor.
    req.actorPermissions = have;

    for (const p of required) {
      if (!have.has(p)) throw new ForbiddenException(`Missing permission: ${p}`);
    }
    return true;
  }
}
