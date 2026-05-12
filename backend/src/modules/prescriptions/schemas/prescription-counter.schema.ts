import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PrescriptionCounterDocument = HydratedDocument<PrescriptionCounter>;

/**
 * Per-clinic monotonic counter for the human-readable prescription
 * number that gets printed on the slip and typed by the pharmacist.
 * Single atomic `findOneAndUpdate({upsert:true,$inc:{lastNumber:1}})`
 * per mint keeps the sequence unique under concurrent encounter signs.
 *
 * Kept per-clinic (not per-branch/year) on purpose — pharmacists are
 * the typical readers and the simpler sequence is easier to dictate
 * over the counter ("R X dash zero zero zero one two three"). If a
 * clinic later wants per-year resets, this schema can grow a `period`
 * field the same way BillCounter has `fiscalYear`.
 */
@Schema({ timestamps: true })
export class PrescriptionCounter {
  @Prop({ type: Types.ObjectId, required: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Number, required: true, default: 0 })
  lastNumber!: number;
}

export const PrescriptionCounterSchema =
  SchemaFactory.createForClass(PrescriptionCounter);

PrescriptionCounterSchema.index(
  { clinicId: 1 },
  { unique: true, name: 'rx_counter_unique_per_clinic' },
);
