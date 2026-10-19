import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FamilyConnectionDocument = HydratedDocument<FamilyConnection>;

export enum FamilyConnectionStatus {
  Pending = 'PENDING',
  Active = 'ACTIVE',
  Declined = 'DECLINED',
  Cancelled = 'CANCELLED',
  Removed = 'REMOVED',
}

/**
 * Two adult portal accounts that agreed to be family. Being connected
 * shares NOTHING by itself — each side opts in per capability through a
 * `FamilyGrant`.
 */
@Schema({ timestamps: true })
export class FamilyConnection {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  requesterId!: Types.ObjectId;

  /** Set once the invitee has an account (at accept time at the latest). */
  @Prop({ type: Types.ObjectId, index: true })
  targetId?: Types.ObjectId;

  /** Mobile the invite was sent to, digits only. */
  @Prop({ type: String, required: true, trim: true, index: true })
  targetPhone!: string;

  /** Name the requester typed, shown only to the requester. */
  @Prop({ type: String, trim: true })
  targetLabel?: string;

  /** How the requester described the invitee, e.g. "Spouse". */
  @Prop({ type: String, trim: true })
  relation?: string;

  @Prop({
    required: true,
    enum: FamilyConnectionStatus,
    default: FamilyConnectionStatus.Pending,
  })
  status!: FamilyConnectionStatus;

  @Prop({ type: Date })
  respondedAt?: Date;

  createdAt?: Date;
}

export const FamilyConnectionSchema =
  SchemaFactory.createForClass(FamilyConnection);

FamilyConnectionSchema.index(
  { requesterId: 1, targetPhone: 1 },
  {
    unique: true,
    name: 'familyconnection_open_unique',
    partialFilterExpression: {
      status: {
        $in: [FamilyConnectionStatus.Pending, FamilyConnectionStatus.Active],
      },
    },
  },
);
