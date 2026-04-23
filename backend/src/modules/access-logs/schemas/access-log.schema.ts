import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AccessLogDocument = HydratedDocument<AccessLog>;

@Schema({ timestamps: true })
export class AccessLog {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  branchId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  actorUserId?: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  method!: string;

  @Prop({ required: true, trim: true, index: true })
  path!: string;

  @Prop({ required: true, index: true })
  statusCode!: number;

  @Prop({ required: true })
  durationMs!: number;

  @Prop({ trim: true, index: true })
  requestId?: string;

  @Prop({ trim: true })
  userAgent?: string;

  @Prop({ trim: true })
  ip?: string;
}

export const AccessLogSchema = SchemaFactory.createForClass(AccessLog);

AccessLogSchema.index(
  { clinicId: 1, createdAt: -1 },
  { name: 'accesslog_clinic_created_idx' },
);
AccessLogSchema.index(
  { clinicId: 1, path: 1, createdAt: -1 },
  { name: 'accesslog_path_created_idx' },
);
