import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type QueueCounterDocument = HydratedDocument<QueueCounter>;

@Schema({ timestamps: true })
export class QueueCounter {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  doctorId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  queueDate!: string; // YYYY-MM-DD

  @Prop({ required: true, default: 0 })
  lastNumber!: number;
}

export const QueueCounterSchema = SchemaFactory.createForClass(QueueCounter);

QueueCounterSchema.index(
  { clinicId: 1, branchId: 1, doctorId: 1, queueDate: 1 },
  { unique: true, name: 'queue_counter_unique' },
);
