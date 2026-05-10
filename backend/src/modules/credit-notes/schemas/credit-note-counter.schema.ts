import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CreditNoteCounterDocument = HydratedDocument<CreditNoteCounter>;

/**
 * Parallel of `BillCounter`, scoped to credit notes. Separate collection so
 * CN sequences don't share numbers with bills (CN/2026-27/000001 is its own
 * series).
 */
@Schema({ timestamps: true })
export class CreditNoteCounter {
  @Prop({ type: Types.ObjectId, required: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  branchId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  fiscalYear!: string;

  @Prop({ type: Number, required: true, default: 0 })
  lastNumber!: number;
}

export const CreditNoteCounterSchema = SchemaFactory.createForClass(
  CreditNoteCounter,
);

CreditNoteCounterSchema.index(
  { clinicId: 1, branchId: 1, fiscalYear: 1 },
  { unique: true, name: 'cn_counter_unique_per_branch_year' },
);
