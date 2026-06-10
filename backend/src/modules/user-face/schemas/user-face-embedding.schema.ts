import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserFaceEmbeddingDocument = HydratedDocument<UserFaceEmbedding>;

/**
 * Staff face-login template. One row per enrolled user (replace on
 * re-enroll). Mirrors the patient FaceEmbedding but keyed by userId.
 * Login is pre-auth and cross-clinic, so identify scans the whole
 * collection — clinicId is carried only to resolve which clinic the
 * matched user belongs to.
 */
@Schema({ timestamps: true })
export class UserFaceEmbedding {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, ref: 'User', index: true })
  userId!: Types.ObjectId;

  // L2-normalized embedding (128-d for SFace).
  @Prop({ type: [Number], required: true })
  embedding!: number[];

  @Prop({ required: true })
  model!: string;

  @Prop({ required: true })
  detector!: string;

  @Prop({ type: Number, required: true })
  faceConfidence!: number;

  // The admin (super admin / manager) who enrolled this face.
  @Prop({ type: Types.ObjectId, ref: 'User' })
  capturedBy?: Types.ObjectId;
}

export const UserFaceEmbeddingSchema =
  SchemaFactory.createForClass(UserFaceEmbedding);

UserFaceEmbeddingSchema.index(
  { userId: 1 },
  { name: 'user_face_per_user_idx' },
);
