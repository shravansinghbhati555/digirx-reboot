import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response, NextFunction } from 'express';
import { AppRequest } from './types';
import { parseObjectId } from './request-context';
import type { JwtClaims } from '../modules/auth/auth.types';

/**
 * Temporary tenant context loader.
 *
 * Until auth is implemented, we take clinic/branch/user from headers:
 * - x-clinic-id (required)
 * - x-branch-id (optional)
 * - x-user-id (optional)
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

