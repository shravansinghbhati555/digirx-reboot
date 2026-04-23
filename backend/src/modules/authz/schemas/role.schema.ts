import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Permission } from '../permissions';

export type RoleDocument = HydratedDocument<Role>;

@Schema({ timestamps: true })
export class Role {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: [String], enum: Permission, default: [] })
  permissions!: Permission[];
}

export const RoleSchema = SchemaFactory.createForClass(Role);

RoleSchema.index(
  { clinicId: 1, name: 1 },
  { unique: true, name: 'role_unique_name_per_clinic' },
);
