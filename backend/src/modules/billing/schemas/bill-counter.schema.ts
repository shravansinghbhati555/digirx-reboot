import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BillCounterDocument = HydratedDocument<BillCounter>;

/**
 * Per-(clinic, branch, fiscalYear) monotonic counter for bill numbers.
 * Mirrors `QueueCounter` and `MrnCounter`: a single atomic
 * `findOneAndUpdate({upsert:true,$inc})` per `mint` keeps the sequence
 * unique even under concurrent issuance.
 *
 * `fiscalYear` is a **string** label (e.g. "2026-27" for India, or "2026"
 * for clinics that use a calendar year) so format variations coexist
 * without forcing a numeric encoding.
 */
@Schema({ timestamps: true })
export class BillCounter {
  @Prop({ type: Types.ObjectId, required: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  branchId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  fiscalYear!: string;

  @Prop({ type: Number, required: true, default: 0 })
  lastNumber!: number;
}

export const BillCounterSchema = SchemaFactory.createForClass(BillCounter);

BillCounterSchema.index(
  { clinicId: 1, branchId: 1, fiscalYear: 1 },
  { unique: true, name: 'bill_counter_unique_per_branch_year' },
);
