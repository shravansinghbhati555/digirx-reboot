import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

export enum AuditAction {
  Create = 'CREATE',
  Update = 'UPDATE',
  Delete = 'DELETE',
}

@Schema({ timestamps: true })
export class AuditLog {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  branchId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  actorUserId?: Types.ObjectId;

  @Prop({ required: true, enum: AuditAction })
  action!: AuditAction;

  @Prop({ required: true, trim: true })
  entityType!: string;

  @Prop({ required: true, trim: true })
  entityId!: string;

  @Prop({ type: Object })
  meta?: Record<string, unknown>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index(
  { clinicId: 1, createdAt: -1 },
  { name: 'audit_clinic_createdAt_idx' },
);
