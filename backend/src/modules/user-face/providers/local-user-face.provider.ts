import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FaceClient } from '../../face/face-client.service';
import { FaceEmbedding } from '../../face/schemas/face-embedding.schema';
import { UserFaceEmbedding } from '../schemas/user-face-embedding.schema';
import {
  UserFaceEnrollInput,
  UserFaceMatch,
  UserFaceProvider,
} from '../user-face-provider.interface';

// Cosine cutoff for staff face LOGIN. Stricter than the patient
// recognition default because a false accept here is an account
// takeover, not just a wrong chart. Override via env.
const LOGIN_THRESHOLD = parseFloat(process.env.USER_FACE_LOGIN_THRESHOLD ?? '0.62');
const MIN_ENROLL_CONFIDENCE = parseFloat(
  process.env.USER_FACE_MIN_ENROLL_CONFIDENCE ?? '0.7',
);
// At enroll time, a face this close to an ALREADY-registered face (any
// other staff account, or any patient) is treated as the same person and
// rejected — one physical face maps to exactly one identity. Tuned to
// "confidently the same person"; override via env.
const DUPLICATE_THRESHOLD = parseFloat(
  process.env.FACE_DUPLICATE_THRESHOLD ?? '0.62',
);

/**
 * Local staff face provider — face-svc (YuNet + SFace) embeddings stored
 * in `UserFaceEmbedding`, matched by cosine similarity. This is the
 * original UserFaceService logic, now behind the provider abstraction.
 */
@Injectable()
export class LocalUserFaceProvider implements UserFaceProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalUserFaceProvider.name);

  constructor(
    @InjectModel(UserFaceEmbedding.name)
    private readonly embeddingModel: Model<UserFaceEmbedding>,
    // Patient gallery — same SFace embeddings, so a staff face can be
    // checked against it directly to block "register as staff, then again
    // as a patient" (and vice versa).
    @InjectModel(FaceEmbedding.name)
    private readonly patientEmbeddingModel: Model<FaceEmbedding>,
    private readonly faceClient: FaceClient,
  ) {}

  async enrollUserFace(input: UserFaceEnrollInput): Promise<{ faceConfidence: number }> {
    // ALWAYS server-side detect + align (preDetected=false), exactly like
    // identifyUser at login time — SFace embeddings from an aligned face
    // vs a naive browser crop don't compare well, so enroll and login
    // MUST use the same path.
    const embed = await this.faceClient.embed({ ...input.image, preDetected: false });

    if (embed.faceConfidence < MIN_ENROLL_CONFIDENCE) {
      throw new BadRequestException(
        `Face detection too weak (confidence ${embed.faceConfidence.toFixed(2)}) — retake the photo with better lighting`,
      );
    }
    if (embed.facesDetected > 1) {
      throw new BadRequestException(
        'Multiple faces detected — only one person should be in the frame',
      );
    }

    // One physical face = one identity. Reject if this face is already
    // registered to a DIFFERENT staff account or to any patient. (The
    // current user is excluded so re-enrolling your own face still works.)
    await this.assertFaceNotAlreadyRegistered(input.userId, embed.embedding);

    // One embedding per user — replace any prior on re-enroll.
    await this.embeddingModel.deleteMany({ userId: input.userId });
    await this.embeddingModel.create({
      clinicId: input.clinicId,
      userId: input.userId,
      embedding: embed.embedding,
      model: embed.model,
      detector: embed.detector,
      faceConfidence: embed.faceConfidence,
      capturedBy: input.actorUserId,
    });

    this.logger.log(`[local] enrolled user ${input.userId.toHexString()} confidence=${embed.faceConfidence.toFixed(2)}`);
    return { faceConfidence: embed.faceConfidence };
  }

  async identifyUser(image: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<UserFaceMatch | null> {
    const probe = await this.faceClient.embed({ ...image, preDetected: false });
    if (probe.facesDetected === 0) return null;

    const rows = await this.embeddingModel
      .find({})
      .select({ userId: 1, clinicId: 1, embedding: 1 })
      .lean();
    if (rows.length === 0) return null;

    let best: UserFaceMatch | null = null;
    for (const row of rows) {
      const score = cosineSimilarity(probe.embedding, row.embedding as number[]);
      if (!best || score > best.score) {
        best = {
          userId: row.userId as Types.ObjectId,
          clinicId: row.clinicId as Types.ObjectId,
          score,
        };
      }
    }

    this.logger.log(
      `[local] login scan: gallery=${rows.length} best=${best?.score.toFixed(4) ?? '-'} threshold=${LOGIN_THRESHOLD}`,
    );

    if (!best || best.score < LOGIN_THRESHOLD) return null;
    return best;
  }

  async removeUserFace(input: { clinicId: Types.ObjectId; userId: Types.ObjectId }): Promise<void> {
    await this.embeddingModel.deleteMany({ userId: input.userId });
  }

  /**
   * Throw 409 if `embedding` matches a face that's already registered to
   * another staff account or to a patient. Linear cosine scan — the staff
   * gallery is small and patients are bounded per clinic.
   */
  private async assertFaceNotAlreadyRegistered(
    userId: Types.ObjectId,
    embedding: number[],
  ): Promise<void> {
    // Another staff member (global staff gallery, excluding this user).
    const staffRows = await this.embeddingModel
      .find({ userId: { $ne: userId } })
      .select({ embedding: 1 })
      .lean();
    for (const row of staffRows) {
      if (cosineSimilarity(embedding, row.embedding as number[]) >= DUPLICATE_THRESHOLD) {
        throw new ConflictException(
          'This face is already registered to another staff account.',
        );
      }
    }

    // Any patient (cross-system check).
    const patientRows = await this.patientEmbeddingModel
      .find({})
      .select({ embedding: 1 })
      .lean();
    for (const row of patientRows) {
      if (cosineSimilarity(embedding, row.embedding as number[]) >= DUPLICATE_THRESHOLD) {
        throw new ConflictException(
          'This face is already registered to a patient.',
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
