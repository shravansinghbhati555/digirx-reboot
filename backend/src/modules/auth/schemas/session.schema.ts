import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class Session {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  // Active branch on the session, mirrored from the access-token JWT
  // so /auth/refresh can mint a new JWT that preserves the branch the
  // user is operating against. Without this the JWT's branchId is lost
  // on every refresh and the BE silently falls back to "no branch".
  // Updated when the user calls /auth/switch-branch.
  @Prop({ type: Types.ObjectId })
  branchId?: Types.ObjectId;

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
