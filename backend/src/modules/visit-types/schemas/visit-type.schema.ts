import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type VisitTypeDocument = HydratedDocument<VisitType>;

/**
 * Per-doctor consultation catalog row. Used by:
 *   - BookSheet picker, to set the visit-type (and therefore the price)
 *     at appointment-creation time.
 *   - AppointmentsService.create, to auto-issue a SERVICE bill of the
 *     selected price linked to the new appointment.
 *
 * `name` is per-doctor unique within a clinic (e.g. "Consultation"
 * for both Dr. A and Dr. B is allowed; each doctor's own catalog can't
 * have two rows named "Consultation"). Soft-delete via `active=false`
 * so existing appointments that reference an old row still resolve.
 */
@Schema({ timestamps: true })
export class VisitType {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true, ref: 'User' })
  doctorUserId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, min: 0 })
  price!: number;

  @Prop({ required: true, trim: true })
  currency!: string;

  @Prop({ default: true })
  active!: boolean;
}

export const VisitTypeSchema = SchemaFactory.createForClass(VisitType);

VisitTypeSchema.index(
  { clinicId: 1, doctorUserId: 1, name: 1 },
  { unique: true, name: 'visittype_unique_per_doctor' },
);
