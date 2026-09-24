import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response, NextFunction } from 'express';
import { TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';
import { AppRequest } from './types';
import { parseDeviceId, parseObjectId } from './request-context';
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
    // Skip middleware for root, health checks, and OPTIONS preflights
    if (req.method === 'OPTIONS' || req.url === '/' || req.url === '' || req.url === '/health') {
      return next();
    }

    try {
      const auth = req.header('authorization') ?? req.header('Authorization');
      if (auth && auth.toLowerCase().startsWith('bearer ')) {
        const token = auth.slice(7).trim();
        const claims = this.jwt.verify<JwtClaims>(token, {
          secret:
            process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_change_me',
        });

        req.context = {
          clinicId: parseObjectId(claims.clinicId, 'clinicId'),
          branchId: claims.branchId
            ? parseObjectId(claims.branchId, 'branchId')
            : undefined,
          actorUserId: parseObjectId(claims.sub, 'sub'),
          deviceId: parseDeviceId(req.header('x-device-id')),
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
        res.status(401).json({
          message: 'Missing auth context (Bearer token or x-clinic-id)',
        });
        return;
      }

      const branchIdHeader = req.header('x-branch-id');
      const userIdHeader = req.header('x-user-id');

      req.context = {
        clinicId: parseObjectId(clinicIdHeader, 'x-clinic-id'),
        branchId: branchIdHeader
          ? parseObjectId(branchIdHeader, 'x-branch-id')
          : undefined,
        actorUserId: userIdHeader
          ? parseObjectId(userIdHeader, 'x-user-id')
          : undefined,
        deviceId: parseDeviceId(req.header('x-device-id')),
      };

      next();
    } catch (e) {
      if (e instanceof TokenExpiredError || e instanceof JsonWebTokenError) {
        res.status(401).json({ message: e.message });
        return;
      }
      res.status(400).json({
        message: e instanceof Error ? e.message : 'Invalid tenant context',
      });
    }
  }
}
