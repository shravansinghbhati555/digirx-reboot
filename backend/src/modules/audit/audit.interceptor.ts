import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AuditAction } from './schemas/audit-log.schema';
import { AppRequest } from '../../common/types';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<AppRequest>();

    const method = (req.method || '').toUpperCase();
    const action =
      method === 'POST'
        ? AuditAction.Create
        : method === 'PATCH' || method === 'PUT'
          ? AuditAction.Update
          : method === 'DELETE'
            ? AuditAction.Delete
            : null;

    if (!action || !req.context) {
      return next.handle();
    }

    const entityType = req.route?.path ? String(req.route.path) : req.path;
    const paramId =
      typeof req.params?.id === 'string' && req.params.id.length > 0
        ? req.params.id
        : null;

    return next.handle().pipe(
      tap({
        next: (value) => {
          // For routes with `:id` in the URL we use that as the entityId.
          // For creates (POST without :id) we look at the response body for
          // the new doc's _id — Mongoose returns hydrated documents whose
          // `_id` is on the top-level object.
          let entityId = paramId ?? 'n/a';
          if (entityId === 'n/a' && value && typeof value === 'object') {
            const v = value as Record<string, unknown>;
            const candidate =
              (v._id as { toString?: () => string } | string | undefined) ??
              (v.id as string | undefined);
            if (candidate) {
              entityId =
                typeof candidate === 'string'
                  ? candidate
                  : typeof candidate.toString === 'function'
                    ? candidate.toString()
                    : 'n/a';
            }
          }

          // Fire-and-forget; audit failures should not break API requests.
          void this.audit.write({
            clinicId: req.context!.clinicId,
            branchId: req.context!.branchId,
            actorUserId: req.context!.actorUserId,
            action,
            entityType,
            entityId,
            meta: {
              method,
              path: req.path,
            },
          });
        },
      }),
    );
  }
}
