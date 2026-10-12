import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AppRequest } from '../../common/types';
import { parseDeviceId, parseObjectId } from '../../common/request-context';
import type { JwtClaims } from './auth.types';

@Injectable()
export class JwtContextGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
