import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MrnCounterDocument = HydratedDocument<MrnCounter>;

/**
 * Per-clinic monotonic counter for medical-record numbers. Mirrors the shape
 * of `QueueCounter` so the same atomic `findOneAndUpdate({upsert,$inc})`
 * pattern can be reused — readers should never see two patients with the
 * same MRN even under heavy concurrent registration.
 */
@Schema({ timestamps: true })
export class MrnCounter {
  @Prop({ type: Types.ObjectId, required: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Number, required: true, default: 0 })
  lastNumber!: number;
}

export const MrnCounterSchema = SchemaFactory.createForClass(MrnCounter);

MrnCounterSchema.index(
  { clinicId: 1 },
  { unique: true, name: 'mrn_counter_unique_per_clinic' },
);
