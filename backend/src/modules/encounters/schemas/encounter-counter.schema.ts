import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EncounterCounterDocument = HydratedDocument<EncounterCounter>;

/**
 * Per-clinic monotonic counter for encounter numbers.
 */
@Schema({ timestamps: true })
export class EncounterCounter {
  @Prop({ type: Types.ObjectId, required: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Number, required: true, default: 0 })
  lastNumber!: number;
}

export const EncounterCounterSchema = SchemaFactory.createForClass(EncounterCounter);

EncounterCounterSchema.index(
  { clinicId: 1 },
  { unique: true, name: 'encounter_counter_unique_per_clinic' },
);
