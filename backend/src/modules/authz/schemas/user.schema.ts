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

  @Prop()
  passwordHash?: string;

  @Prop({ type: [Types.ObjectId], default: [], index: true })
  roleIds!: Types.ObjectId[];
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
