import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { redactPII } from '../../common/redact-pii';
import { RetentionService } from '../../common/retention/retention.service';
import { AuditAction, AuditLog } from './schemas/audit-log.schema';

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLog>,
    private readonly retention: RetentionService,
  ) {}

  async write(entry: {
    clinicId: Types.ObjectId;
    branchId?: Types.ObjectId;
    actorUserId?: Types.ObjectId;
    action: AuditAction;
    entityType: string;
    entityId: string;
    /** Human-readable identifier captured by the interceptor from the
     *  response body (patient name, bill number, etc.). Stored alongside
     *  entityId so the activity feed can show "Bill BX-000123" rather
     *  than a raw ObjectId. */
    targetLabel?: string;
    meta?: Record<string, unknown>;
  }) {
    // Redact before persist — even if today's interceptor only stores
    // {method,path}, future expansions (request body diffs, etc.) won't
    // accidentally leak passwords/tokens/phones into the audit trail.
    const safeMeta = entry.meta ? redactPII(entry.meta) : undefined;
    const expiresAt = await this.retention.expiresAt(entry.clinicId);
    await this.auditModel.create({ ...entry, meta: safeMeta, expiresAt });
  }

  async list(
    clinicId: Types.ObjectId,
    query: {
      limit?: number;
      before?: string;
      entityType?: string;
      action?: string;
      actorUserId?: string;
    },
  ) {
    const limit = Math.max(1, Math.min(200, query.limit ?? 50));
    const filter: Record<string, unknown> = { clinicId };

    if (query.entityType) filter.entityType = query.entityType;
    if (query.action) filter.action = query.action;
    if (query.actorUserId && Types.ObjectId.isValid(query.actorUserId)) {
      filter.actorUserId = new Types.ObjectId(query.actorUserId);
    }
    if (query.before) {
      const d = new Date(query.before);
      if (!isNaN(d.getTime())) filter.createdAt = { $lt: d };
    }

    const rows = await this.auditModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);

    const last = rows.length ? (rows[rows.length - 1] as { createdAt?: Date }) : undefined;
    const nextBefore =
      last?.createdAt instanceof Date ? last.createdAt.toISOString() : undefined;

    return { rows, nextBefore };
  }
}
