import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import { AuthzService } from './authz.service';
import type { AppRequest } from '../../common/types';
import { Permission } from './permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly authz: AuthzService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    // If endpoint doesn't declare permissions, allow.
    if (!required.length) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const actor = await this.authz.getActor({
      clinicId: req.context!.clinicId,
      actorUserId: req.context!.actorUserId,
    });

    const have = new Set(actor.permissions);
    for (const p of required) {
      if (!have.has(p)) throw new ForbiddenException('Missing permission');
    }
    return true;
  }
}

