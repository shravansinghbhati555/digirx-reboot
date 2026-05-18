import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FaceEmbeddingDocument = HydratedDocument<FaceEmbedding>;

@Schema({ timestamps: true })
export class FaceEmbedding {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, ref: 'Patient' })
  patientId!: Types.ObjectId;

  // L2-normalized embedding vector. Length depends on model; Facenet512
  // is 512. Stored as number[] (BSON Double array) so a Mongo aggregate
  // can dot-product it on the server later if we ever outgrow linear
  // app-side cosine search.
  @Prop({ type: [Number], required: true })
  embedding!: number[];

  @Prop({ required: true })
  model!: string;

  @Prop({ required: true })
  detector!: string;

  // RetinaFace's detection confidence at enrollment time. Useful for
  // weeding out low-quality embeddings later via a quality filter.
  @Prop({ type: Number, required: true })
  faceConfidence!: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  capturedBy?: Types.ObjectId;
}

export const FaceEmbeddingSchema = SchemaFactory.createForClass(FaceEmbedding);

// One embedding per patient (per clinic) — re-enrolling overwrites the
// previous row via upsert. Multi-embedding-per-patient is a future
// extension; the unique index here protects us from silently piling up
// duplicates if the FE retries.
FaceEmbeddingSchema.index(
  { clinicId: 1, patientId: 1 },
  { name: 'face_embedding_unique_per_patient', unique: true },
);
