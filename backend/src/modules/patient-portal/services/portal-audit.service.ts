import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../audit/schemas/audit-log.schema';
import type { PortalCtx } from '../portal.context';

/**
 * Audit rows for changes a patient makes through the portal. They land in
 * the clinic's existing audit log with no staff actor and
 * `meta.actorType = 'PATIENT_PORTAL'`, so clinic staff can see them.
 */
@Injectable()
export class PortalAuditService {
  private readonly logger = new Logger(PortalAuditService.name);

  constructor(private readonly audit: AuditService) {}

  record(
    ctx: PortalCtx,
    entry: {
      clinicId: Types.ObjectId;
      branchId?: Types.ObjectId;
      action: AuditAction;
      entityType: string;
      entityId: string;
      targetLabel?: string;
      subjectAccountId?: Types.ObjectId;
      meta?: Record<string, unknown>;
    },
  ): void {
    void this.audit
      .write({
        clinicId: entry.clinicId,
        branchId: entry.branchId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        targetLabel: entry.targetLabel,
        meta: {
          ...entry.meta,
          actorType: 'PATIENT_PORTAL',
          patientAccountId: ctx.accountId.toHexString(),
          ...(entry.subjectAccountId &&
          !entry.subjectAccountId.equals(ctx.accountId)
            ? { onBehalfOfAccountId: entry.subjectAccountId.toHexString() }
            : {}),
        },
      })
      .catch((e) =>
        this.logger.warn(`portal audit failed: ${e?.message ?? e}`),
      );
  }
}
