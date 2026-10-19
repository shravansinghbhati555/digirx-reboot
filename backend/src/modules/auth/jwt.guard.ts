import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { AppRequest } from '../../common/types';
import { parseDeviceId, parseObjectId } from '../../common/request-context';
import type { JwtClaims } from './auth.types';
import { IS_PORTAL_ROUTE_KEY } from '../../common/portal-route.decorator';

@Injectable()
export class JwtContextGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    // Always injected by Nest; optional only so hand-built instances in
    // unit tests keep working.
    private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Patient-portal routes carry a portal token, verified by the portal's
    // own guard. Skip them here; nothing else is affected.
    const isPortal = this.reflector?.getAllAndOverride<boolean>(IS_PORTAL_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPortal) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const auth = req.header('authorization') ?? req.header('Authorization');
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) return true; // allow fallback headers

    const token = auth.slice(7).trim();
    try {
      const claims = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_change_me',
      });

      req.context = {
        clinicId: parseObjectId(claims.clinicId, 'clinicId'),
        branchId: claims.branchId
          ? parseObjectId(claims.branchId, 'branchId')
          : undefined,
        actorUserId: parseObjectId(claims.sub, 'sub'),
        // Rebuilt from the token, so carry the device id over too. Dropping
        // it here left every token-authenticated request without one: number
        // leases and unlock-code uploads were refused with "Send x-device-id"
        // and offline writes synced with no device attribution.
        deviceId: parseDeviceId(req.header('x-device-id')),
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
