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
    const entityId =
      typeof req.params?.id === 'string' && req.params.id.length > 0
        ? req.params.id
        : 'n/a';

    return next.handle().pipe(
      tap({
        next: () => {
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
