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

// Multi-embedding-per-patient is now the default: 3-shot enrollment
// gives a stronger same-person signal than a single capture and
// dramatically reduces false-positive rates against lookalike
// strangers. The index is non-unique so a patient can hold multiple
// rows; the service caps the count and chooses MAX score across them
// at match time.
FaceEmbeddingSchema.index(
  { clinicId: 1, patientId: 1 },
  { name: 'face_embedding_per_patient_idx' },
);
