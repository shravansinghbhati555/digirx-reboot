import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import type { AppRequest } from '../../common/types';
import { AccessLogsService } from './access-logs.service';

@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  constructor(private readonly logs: AccessLogsService) {}

  use(req: AppRequest, res: Response, next: NextFunction) {
    const start = Date.now();

    res.on('finish', () => {
      // Health is excluded at module wiring level, but keep it safe.
      if (req.path === '/health') return;
      if (!req.context) return;

      const durationMs = Date.now() - start;
      const requestId = req.header('x-request-id') ?? undefined;

      const entry = {
        clinicId: req.context.clinicId,
        branchId: req.context.branchId,
        actorUserId: req.context.actorUserId,
        method: String(req.method || '').toUpperCase(),
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
        requestId,
        userAgent: req.header('user-agent') ?? undefined,
        ip: req.ip,
      };

      // Fire-and-forget; access logging must never block requests.
      void this.logs.write(entry as any);
    });

    next();
  }
}

