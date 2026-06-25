import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FaceClient } from '../face-client.service';
import { FaceEmbedding } from '../schemas/face-embedding.schema';
import { UserFaceEmbedding } from '../../user-face/schemas/user-face-embedding.schema';
import {
  FaceCandidate,
  FaceConfidenceBand,
  FaceProvider,
  FaceProviderEnrollInput,
  FaceProviderEnrollResult,
  FaceProviderRecognizeInput,
  FaceProviderRecognizeResult,
} from './face-provider.interface';

// Cosine cutoffs for the SFace (128-d) gallery search. Override via env.
//   >HIGH  → auto-pick the patient (front desk skips confirmation)
//   LOW..HIGH → show candidate list, ask for confirmation
//   <LOW   → no match, fall back to typed search
const HIGH_CONFIDENCE_THRESHOLD = parseFloat(process.env.FACE_HIGH_THRESHOLD ?? '0.65');
const LOW_CONFIDENCE_THRESHOLD = parseFloat(process.env.FACE_LOW_THRESHOLD ?? '0.45');
const MIN_ENROLLMENT_FACE_CONFIDENCE = parseFloat(
  process.env.FACE_MIN_ENROLLMENT_CONFIDENCE ?? '0.7',
);
// At enroll time, a face this close to an ALREADY-registered face (another
// patient in the clinic, or any staff account) is treated as the same
// person and rejected — one physical face maps to exactly one identity.
const DUPLICATE_THRESHOLD = parseFloat(
  process.env.FACE_DUPLICATE_THRESHOLD ?? '0.62',
);

/**
 * OpenCV YuNet + SFace face provider. Talks to the face-svc Python
 * sidecar for detection + embedding; stores one 128-d embedding per
 * patient in MongoDB and does a linear cosine search at recognize time.
 */
@Injectable()
export class LocalFaceProvider implements FaceProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalFaceProvider.name);

  constructor(
    @InjectModel(FaceEmbedding.name)
    private readonly embeddingModel: Model<FaceEmbedding>,
    // Staff gallery — same SFace embeddings, so a patient face can be
    // checked against it directly to block "register as a patient when
    // already registered as staff" (and vice versa).
    @InjectModel(UserFaceEmbedding.name)
    private readonly userEmbeddingModel: Model<UserFaceEmbedding>,
    private readonly faceClient: FaceClient,
  ) {}

  async enrollFace(
    input: FaceProviderEnrollInput,
  ): Promise<FaceProviderEnrollResult> {
    const embed = await this.faceClient.embed({
      ...input.image,
      preDetected: input.preDetected,
    });

    if (!input.preDetected && embed.faceConfidence < MIN_ENROLLMENT_FACE_CONFIDENCE) {
      throw new BadRequestException(
        `Face detection too weak (confidence ${embed.faceConfidence.toFixed(2)}) — retake the photo with better lighting`,
      );
    }
    if (embed.facesDetected > 1) {
      throw new BadRequestException(
        'Multiple faces detected — only one person should be in the frame at enrollment',
      );
    }

    // One physical face = one identity. Reject if this face is already
    // registered to a DIFFERENT patient in this clinic, or to any staff
    // account. (The current patient is excluded so re-enrollment works.)
    await this.assertFaceNotAlreadyRegistered(
      input.clinicId,
      input.patientId,
      embed.embedding,
    );

    // One embedding per patient. Replace any prior so re-enrollment
    // overwrites the old vector cleanly.
    await this.embeddingModel.deleteMany({
      clinicId: input.clinicId,
      patientId: input.patientId,
    });
    await this.embeddingModel.create({
      clinicId: input.clinicId,
      patientId: input.patientId,
      embedding: embed.embedding,
      model: embed.model,
      detector: embed.detector,
      faceConfidence: embed.faceConfidence,
      capturedBy: input.actorUserId,
    });

    return { faceConfidence: embed.faceConfidence, model: embed.model };
  }

  async recognizeFace(
    input: FaceProviderRecognizeInput,
  ): Promise<FaceProviderRecognizeResult> {
    const probe = await this.faceClient.embed({
      ...input.image,
      preDetected: input.preDetected,
    });
    if (probe.facesDetected === 0) {
      return { candidates: [], facesDetected: 0 };
    }

    const rows = await this.embeddingModel
      .find({ clinicId: input.clinicId })
      .select({ patientId: 1, embedding: 1 })
      .lean();
    if (rows.length === 0) {
      return { candidates: [], facesDetected: probe.facesDetected };
    }

    // One embedding per patient now, but keep the per-patient max-pick
    // in case any legacy rows from the multi-shot era are still around.
    const bestByPatient = new Map<string, number>();
    for (const row of rows) {
      const key = String(row.patientId);
      const score = cosineSimilarity(probe.embedding, row.embedding);
      const prev = bestByPatient.get(key);
      if (prev === undefined || score > prev) bestByPatient.set(key, score);
    }

    const scored = Array.from(bestByPatient.entries())
      .map(([patientId, score]) => ({ patientId, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, input.topK);

    const candidates: FaceCandidate[] = scored.map((s) => ({
      patientId: s.patientId,
      score: round4(s.score),
      confidence: bandFor(s.score),
    }));

    return { candidates, facesDetected: probe.facesDetected };
  }

  async removeFace(input: {
    clinicId: Types.ObjectId;
    patientId: Types.ObjectId;
  }): Promise<void> {
    await this.embeddingModel.deleteMany({
      clinicId: input.clinicId,
      patientId: input.patientId,
    });
  }

  /**
   * Throw 409 if `embedding` matches a face already registered to another
   * patient in this clinic, or to any staff account. Patient-vs-patient is
   * scoped to the clinic (the same person may legitimately be a patient at
   * two independent clinics); the staff gallery is global.
   */
  private async assertFaceNotAlreadyRegistered(
    clinicId: Types.ObjectId,
    patientId: Types.ObjectId,
    embedding: number[],
  ): Promise<void> {
    // Another patient in this clinic (excluding this patient).
    const patientRows = await this.embeddingModel
      .find({ clinicId, patientId: { $ne: patientId } })
      .select({ embedding: 1 })
      .lean();
    for (const row of patientRows) {
      if (cosineSimilarity(embedding, row.embedding) >= DUPLICATE_THRESHOLD) {
        throw new ConflictException(
          'This face is already registered to another patient.',
        );
      }
    }

    // Any staff account (cross-system check).
    const staffRows = await this.userEmbeddingModel
      .find({})
      .select({ embedding: 1 })
      .lean();
    for (const row of staffRows) {
      if (cosineSimilarity(embedding, row.embedding as number[]) >= DUPLICATE_THRESHOLD) {
        throw new ConflictException(
          'This face is already registered to a staff account.',
        );
      }
    }
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function bandFor(score: number): FaceConfidenceBand {
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return 'high';
  if (score >= LOW_CONFIDENCE_THRESHOLD) return 'low';
  return 'none';
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
