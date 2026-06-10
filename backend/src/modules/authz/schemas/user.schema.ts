import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum UserStatus {
  Active = 'ACTIVE',
  Disabled = 'DISABLED',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], default: [], index: true })
  branchIds!: Types.ObjectId[]; // explicit access list

  @Prop({ type: Types.ObjectId })
  defaultBranchId?: Types.ObjectId;

  @Prop({ trim: true })
  email?: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, enum: UserStatus, default: UserStatus.Active })
  status!: UserStatus;

  @Prop({ select: false })
  passwordHash?: string;

  // Forgot-password flow. The raw token is delivered out-of-band (email in
  // prod, console log in dev) and only its bcrypt hash lives here, so a
  // database leak can't be replayed to take over accounts. Both fields are
  // cleared on a successful reset. `select: false` keeps them out of the
  // default projection so they never accidentally ride along on a /me payload.
  @Prop({ type: String, select: false })
  passwordResetTokenHash?: string;

  @Prop({ type: Date, select: false })
  passwordResetExpiresAt?: Date;

  @Prop({ type: [Types.ObjectId], default: [], index: true })
  roleIds!: Types.ObjectId[];

  @Prop({ trim: true })
  registrationNumber?: string;

  @Prop({ trim: true })
  qualifications?: string;

  // Set when a face template lands in the UserFaceEmbedding collection.
  // Lets the FE show a "face login enabled" badge and gate the
  // re-enroll / remove actions without a second round-trip.
  @Prop()
  faceEnrolledAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index(
  { clinicId: 1, email: 1 },
  { unique: true, sparse: true, name: 'user_unique_email_per_clinic' },
);
UserSchema.index(
  { clinicId: 1, phone: 1 },
  { unique: true, sparse: true, name: 'user_unique_phone_per_clinic' },
);
