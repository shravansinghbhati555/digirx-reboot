import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditAction, AuditLog } from './schemas/audit-log.schema';

@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLog>) {}

  async write(entry: {
    clinicId: Types.ObjectId;
    branchId?: Types.ObjectId;
    actorUserId?: Types.ObjectId;
    action: AuditAction;
    entityType: string;
    entityId: string;
    meta?: Record<string, unknown>;
  }) {
    await this.auditModel.create(entry);
  }
}

