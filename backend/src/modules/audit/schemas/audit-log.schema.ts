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

  /**
   * Per-row TTL anchor. Mongo's TTL monitor deletes the document once
   * `expiresAt < now`. Stamped at write time from the clinic's
   * `logs.retentionDays` setting so different clinics can keep different
   * retention windows on a single shared collection.
   */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index(
  { clinicId: 1, createdAt: -1 },
  { name: 'audit_clinic_createdAt_idx' },
);
// TTL: when expiresAt is reached, Mongo's background monitor (~60s cadence)
// deletes the row. Index option `expireAfterSeconds: 0` means "the doc is
// dead exactly at the timestamp stored in the field".
AuditLogSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'audit_ttl_idx' },
);
