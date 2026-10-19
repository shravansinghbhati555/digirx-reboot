import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import type { Response } from 'express';
import { AccessLogsService } from '../access-logs/access-logs.service';
import type { PortalRequest } from './portal.context';

/**
 * Writes one access-log row per clinic whose data a portal request read or
 * changed, so each clinic can see patient-portal access in its existing
 * Access Logs screen (paths start with /portal/). Fire-and-forget, like the
 * staff access-log middleware.
 */
@Injectable()
export class PortalAccessLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PortalAccessLogInterceptor.name);

  constructor(private readonly accessLogs: AccessLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<PortalRequest>();
    const res = http.getResponse<Response>();
    const start = Date.now();
    return next.handle().pipe(
      finalize(() => {
        const ctx = req.portal;
        if (!ctx || !ctx.touched.size) return;
        for (const clinicId of ctx.touched) {
          if (!Types.ObjectId.isValid(clinicId)) continue;
          void this.accessLogs
            .write({
              clinicId: new Types.ObjectId(clinicId),
              method: String(req.method || '').toUpperCase(),
              path: req.path,
              statusCode: res.statusCode,
              durationMs: Date.now() - start,
              requestId: req.header('x-request-id') ?? undefined,
              userAgent: ctx.userAgent,
              ip: ctx.ip,
            } as any)
            .catch((e) =>
              this.logger.warn(`portal access log failed: ${e?.message ?? e}`),
            );
        }
      }),
    );
  }
}
