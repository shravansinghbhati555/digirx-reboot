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

          // Try to extract a human-readable label for the activity feed 
          // (e.g. Patient Name, Bill No). We look at the response body.
          let targetLabel: string | undefined;
          if (value && typeof value === 'object') {
            const v = value as Record<string, any>;
            
            // Priority 1: Top-level standard fields
            targetLabel = v.fullName || v.name || v.label || v.billNo || v.prescriptionNo || v.mrn;
            
            // Priority 2: Standard nested wrappers (created patient, etc)
            if (!targetLabel && v.created && typeof v.created === 'object') {
              targetLabel = v.created.fullName || v.created.name || v.created.label;
            }
            if (!targetLabel && v.patient && typeof v.patient === 'object') {
              targetLabel = v.patient.fullName || v.patient.name;
            }
            if (!targetLabel && v.patientId && typeof v.patientId === 'object') {
              targetLabel = v.patientId.fullName || v.patientId.name;
            }

            // Priority 3: Specific entity fields if it's a simple string
            if (!targetLabel && typeof v.billNo === 'string') targetLabel = v.billNo;
            if (!targetLabel && typeof v.prescriptionNo === 'string') targetLabel = v.prescriptionNo;
          }

          // Fire-and-forget; audit failures should not break API requests.
          void this.audit.write({
            clinicId: req.context!.clinicId,
            branchId: req.context!.branchId,
            actorUserId: req.context!.actorUserId,
            action,
            entityType,
            entityId,
            targetLabel,
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
