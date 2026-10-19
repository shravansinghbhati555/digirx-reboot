import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FamilyGrantDocument = HydratedDocument<FamilyGrant>;

export type FamilyCapability = 'book' | 'rx' | 'reports' | 'bills';
export const FAMILY_CAPABILITIES: FamilyCapability[] = [
  'book',
  'rx',
  'reports',
  'bills',
];

/**
 * What `granter` lets `grantee` do on the granter's behalf. One-directional:
 * the reverse needs its own row. Every capability defaults to false.
 */
@Schema({ timestamps: true })
export class FamilyGrant {
  @Prop({ type: Types.ObjectId, required: true })
  granterId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  granteeId!: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  book!: boolean;

  @Prop({ type: Boolean, default: false })
  rx!: boolean;

  @Prop({ type: Boolean, default: false })
  reports!: boolean;

  @Prop({ type: Boolean, default: false })
  bills!: boolean;

  updatedAt?: Date;
}

export const FamilyGrantSchema = SchemaFactory.createForClass(FamilyGrant);

FamilyGrantSchema.index(
  { granterId: 1, granteeId: 1 },
  { unique: true, name: 'familygrant_pair_unique' },
);
