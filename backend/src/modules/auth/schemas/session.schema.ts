import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class Session {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  refreshTokenHash!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date })
  revokedAt?: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

// Auto-cleanup expired sessions
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

