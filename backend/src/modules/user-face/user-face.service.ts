import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FaceClient } from '../face/face-client.service';
import { User, UserStatus } from '../authz/schemas/user.schema';
import { UserFaceEmbedding } from './schemas/user-face-embedding.schema';

// Cosine cutoff for staff face LOGIN. Stricter than the patient
// recognition default (0.65 high) because a false accept here is an
// account takeover, not just a wrong chart. Override via env.
const LOGIN_THRESHOLD = parseFloat(process.env.USER_FACE_LOGIN_THRESHOLD ?? '0.62');
const MIN_ENROLL_CONFIDENCE = parseFloat(
  process.env.USER_FACE_MIN_ENROLL_CONFIDENCE ?? '0.7',
);

export interface UserFaceMatch {
  userId: Types.ObjectId;
  clinicId: Types.ObjectId;
  score: number;
}

/**
 * Staff face login. Distinct from the patient face system:
 *   - Patient face → identify a patient at the front desk (per-clinic).
 *   - Staff face   → log a user in (pre-auth, cross-clinic scan).
 *
 * Uses the same face-svc embedding pipeline (YuNet + SFace, with
 * anti-spoofing in the embed path) as the local patient provider, but
 * keeps its own embedding collection keyed by userId.
 */
@Injectable()
export class UserFaceService {
  private readonly logger = new Logger(UserFaceService.name);

  constructor(
    @InjectModel(UserFaceEmbedding.name)
    private readonly embeddingModel: Model<UserFaceEmbedding>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    private readonly faceClient: FaceClient,
  ) {}

  /** Enroll / re-enroll a staff member's face. */
  async enroll(input: {
    clinicId: Types.ObjectId;
    userId: string;
    actorUserId?: Types.ObjectId;
    image: { buffer: Buffer; mimeType: string; filename: string };
    preDetected?: boolean;
  }): Promise<{ enrolled: true; faceConfidence: number }> {
    if (!Types.ObjectId.isValid(input.userId)) {
      throw new NotFoundException('User not found');
    }
    const userObjId = new Types.ObjectId(input.userId);
    const user = await this.userModel.findOne({
      _id: userObjId,
      clinicId: input.clinicId,
    });
    if (!user) throw new NotFoundException('User not found');

    // ALWAYS use server-side detection + alignment (preDetected=false),
    // exactly like identify() at login time. SFace embeddings from an
    // aligned face vs a naively-resized browser crop don't compare well,
    // so enroll and login MUST use the same path or the same person's
    // embeddings won't match. We ignore the FE's pre_detected flag here
    // on purpose.
    const embed = await this.faceClient.embed({
      ...input.image,
      preDetected: false,
    });

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

    // One embedding per user — replace any prior on re-enroll.
    await this.embeddingModel.deleteMany({ userId: userObjId });
    await this.embeddingModel.create({
      clinicId: input.clinicId,
      userId: userObjId,
      embedding: embed.embedding,
      model: embed.model,
      detector: embed.detector,
      faceConfidence: embed.faceConfidence,
      capturedBy: input.actorUserId,
    });

    await this.userModel.updateOne(
      { _id: userObjId, clinicId: input.clinicId },
      { $set: { faceEnrolledAt: new Date() } },
    );

    this.logger.log(`[user-face] enrolled user ${input.userId} confidence=${embed.faceConfidence.toFixed(2)}`);
    return { enrolled: true, faceConfidence: embed.faceConfidence };
  }

  /** Remove a staff member's face template. */
  async remove(clinicId: Types.ObjectId, userId: string): Promise<{ removed: number }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const userObjId = new Types.ObjectId(userId);
    const res = await this.embeddingModel.deleteMany({ userId: userObjId });
    await this.userModel.updateOne(
      { _id: userObjId, clinicId },
      { $unset: { faceEnrolledAt: '' } },
    );
    return { removed: res.deletedCount ?? 0 };
  }

  /**
   * Identify a user from a login face scan. Cross-clinic scan (login is
   * pre-auth). Returns the best match above LOGIN_THRESHOLD, or null.
   * Anti-spoofing is enforced upstream in face-svc's /embed.
   */
  async identify(image: {
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
      `[user-face] login scan: gallery=${rows.length} best=${best?.score.toFixed(4) ?? '-'} threshold=${LOGIN_THRESHOLD}`,
    );

    if (!best || best.score < LOGIN_THRESHOLD) return null;

    // Confirm the matched user is still active before letting them in.
    const user = await this.userModel
      .findOne({ _id: best.userId, clinicId: best.clinicId })
      .select({ status: 1 })
      .lean();
    if (!user || (user as { status?: string }).status !== UserStatus.Active) {
      return null;
    }
    return best;
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
