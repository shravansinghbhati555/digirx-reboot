import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FaceClient } from './face-client.service';
import { FaceEmbedding } from './schemas/face-embedding.schema';
import { Patient } from '../patients/schemas/patient.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';
import { StorageService } from '../storage/storage.service';

// Cosine cutoffs for the SFace (128-d) gallery search. Override via
// env (FACE_HIGH_THRESHOLD / FACE_LOW_THRESHOLD).
//   >HIGH  → auto-pick the patient (front desk skips confirmation)
//   LOW..HIGH → show candidate list, ask for confirmation
//   <LOW   → no match, fall back to typed search
//
// 0.65 / 0.45 reflect SFace's pairwise-verify sweet spot. At 0.55
// we were getting false positives on same-demographic faces (same
// gender + glasses + similar age were enough to cross the bar);
// 0.65 keeps the auto-pick conservative. The anti-spoof gate in
// face-svc catches photo replays before we ever get this far.
const HIGH_CONFIDENCE_THRESHOLD = parseFloat(
  process.env.FACE_HIGH_THRESHOLD ?? '0.65',
);
const LOW_CONFIDENCE_THRESHOLD = parseFloat(
  process.env.FACE_LOW_THRESHOLD ?? '0.45',
);

const MIN_ENROLLMENT_FACE_CONFIDENCE = parseFloat(
  process.env.FACE_MIN_ENROLLMENT_CONFIDENCE ?? '0.7',
);

export type RecognitionMatch = {
  patientId: string;
  fullName: string;
  mrn?: string;
  score: number;
  confidence: 'high' | 'low' | 'none';
};

@Injectable()
export class FaceService {
  private readonly logger = new Logger(FaceService.name);

  constructor(
    @InjectModel(FaceEmbedding.name)
    private readonly embeddingModel: Model<FaceEmbedding>,
    @InjectModel(Patient.name)
    private readonly patientModel: Model<Patient>,
    @InjectModel(Clinic.name)
    private readonly clinicModel: Model<Clinic>,
    private readonly faceClient: FaceClient,
    private readonly storage: StorageService,
  ) {}

  // Returns 404 (not 403) so a probing caller can't fingerprint which
  // features a clinic has enabled vs which they're forbidden from.
  private async assertFeatureEnabled(clinicId: Types.ObjectId): Promise<void> {
    const clinic = await this.clinicModel.findById(clinicId).lean();
    if (!clinic) throw new NotFoundException('Clinic not found');
    const settings = mergeClinicSettings(clinic.settings);
    if (!settings.modules.faceRecognition.enabled) {
      throw new NotFoundException(
        'Face recognition is not enabled for this clinic',
      );
    }
  }

  async enroll(input: {
    clinicId: Types.ObjectId;
    patientId: string;
    actorUserId?: Types.ObjectId;
    image: { buffer: Buffer; mimeType: string; filename: string };
    preDetected?: boolean;
  }): Promise<{
    enrolled: true;
    faceConfidence: number;
    model: string;
  }> {
    await this.assertFeatureEnabled(input.clinicId);
    if (!Types.ObjectId.isValid(input.patientId)) {
      throw new NotFoundException('Patient not found');
    }
    const patientObjId = new Types.ObjectId(input.patientId);

    const patient = await this.patientModel.findOne({
      _id: patientObjId,
      clinicId: input.clinicId,
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const patientDoc = patient as unknown as {
      faceConsent?: boolean;
      faceEnrolledAt?: Date;
    };
    if (!patientDoc.faceConsent) {
      throw new ForbiddenException(
        'Patient has not consented to face enrollment — record consent before scanning',
      );
    }

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

    // One embedding per patient. Replace any prior so re-enrollment
    // overwrites the old vector cleanly.
    await this.embeddingModel.deleteMany({
      clinicId: input.clinicId,
      patientId: patientObjId,
    });
    await this.embeddingModel.create({
      clinicId: input.clinicId,
      patientId: patientObjId,
      embedding: embed.embedding,
      model: embed.model,
      detector: embed.detector,
      faceConfidence: embed.faceConfidence,
      capturedBy: input.actorUserId,
    });

    // Persist the captured frame as the patient's profile picture.
    // The face-svc itself never stores the image (privacy comment in
    // face-svc/main.py) — we keep our own copy here so the FE can
    // render a real photo on patient detail / list views instead of
    // initials. Re-enrollment overwrites the same key. Failures are
    // logged but don't fail the whole enroll — the embedding is the
    // critical artifact.
    const profileImageKey = `clinic/${input.clinicId.toHexString()}/patient/${patientObjId.toHexString()}/profile.jpg`;
    const setFields: Record<string, unknown> = { faceEnrolledAt: new Date() };
    try {
      await this.storage.putObject({
        key: profileImageKey,
        body: new Uint8Array(input.image.buffer),
        contentType: input.image.mimeType,
      });
      setFields.profileImageKey = profileImageKey;
    } catch (e) {
      this.logger.warn(
        `[enroll] failed to save profile image for ${input.patientId} (embedding kept): ${e instanceof Error ? e.message : e}`,
      );
    }

    await this.patientModel.updateOne(
      { _id: patientObjId, clinicId: input.clinicId },
      { $set: setFields },
    );

    this.logger.log(
      `[enroll] patient ${input.patientId} model=${embed.model} confidence=${embed.faceConfidence.toFixed(2)}`,
    );

    return {
      enrolled: true,
      faceConfidence: embed.faceConfidence,
      model: embed.model,
    };
  }

  async recognize(input: {
    clinicId: Types.ObjectId;
    image: { buffer: Buffer; mimeType: string; filename: string };
    topK?: number;
    preDetected?: boolean;
  }): Promise<{
    matches: RecognitionMatch[];
    autoMatch: RecognitionMatch | null;
    facesDetected: number;
  }> {
    await this.assertFeatureEnabled(input.clinicId);

    // Honor the FE's MediaPipe pre-crop when present so the server
    // skips its own (slower) face detector.
    const probe = await this.faceClient.embed({
      ...input.image,
      preDetected: input.preDetected,
    });
    if (probe.facesDetected === 0) {
      return { matches: [], autoMatch: null, facesDetected: 0 };
    }

    // Linear scan over the clinic's embeddings. Fine up to ~50k
    // patients; revisit with a vector index when we outgrow that.
    const rows = await this.embeddingModel
      .find({ clinicId: input.clinicId })
      .select({ patientId: 1, embedding: 1 })
      .lean();
    if (rows.length === 0) {
      return { matches: [], autoMatch: null, facesDetected: probe.facesDetected };
    }

    // One embedding per patient now, but keep the per-patient max-pick
    // in case any legacy rows from the multi-shot era are still around.
    const bestByPatient = new Map<string, { patientId: Types.ObjectId; score: number }>();
    for (const row of rows) {
      const key = String(row.patientId);
      const score = cosineSimilarity(probe.embedding, row.embedding);
      const prev = bestByPatient.get(key);
      if (!prev || score > prev.score) {
        bestByPatient.set(key, { patientId: row.patientId as Types.ObjectId, score });
      }
    }

    const scored = Array.from(bestByPatient.values()).sort((a, b) => b.score - a.score);
    const topK = Math.max(1, Math.min(input.topK ?? 3, 10));
    const top = scored.slice(0, topK);

    const patients = await this.patientModel
      .find({
        _id: { $in: top.map((t) => t.patientId) },
        clinicId: input.clinicId,
      })
      .select({ fullName: 1, mrn: 1 })
      .lean();
    const byId = new Map(patients.map((p) => [String(p._id), p]));

    const matches: RecognitionMatch[] = top.flatMap((t) => {
      const p = byId.get(String(t.patientId));
      if (!p) return [];
      const m: RecognitionMatch = {
        patientId: String(t.patientId),
        fullName: p.fullName,
        score: round4(t.score),
        confidence: bandFor(t.score),
      };
      if (p.mrn) m.mrn = p.mrn;
      return [m];
    });

    const autoMatch =
      matches[0] && matches[0].confidence === 'high' ? matches[0] : null;

    return { matches, autoMatch, facesDetected: probe.facesDetected };
  }

  async unenroll(clinicId: Types.ObjectId, patientId: string): Promise<{ removed: number }> {
    if (!Types.ObjectId.isValid(patientId)) {
      throw new NotFoundException('Patient not found');
    }
    const patientObjId = new Types.ObjectId(patientId);
    const result = await this.embeddingModel.deleteMany({
      clinicId,
      patientId: patientObjId,
    });
    // Pull the existing profileImageKey so we can delete the S3
    // object too — removing the embedding while keeping the photo
    // would leave behind a face the operator thought they cleared.
    const patient = await this.patientModel
      .findOne({ _id: patientObjId, clinicId })
      .select({ profileImageKey: 1 })
      .lean();
    const oldKey = (patient as { profileImageKey?: string } | null)?.profileImageKey;
    if (oldKey) {
      try {
        await this.storage.deleteObject({ key: oldKey });
      } catch (e) {
        this.logger.warn(
          `[unenroll] failed to delete profile image for ${patientId}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    await this.patientModel.updateOne(
      { _id: patientObjId, clinicId },
      { $unset: { faceEnrolledAt: '', profileImageKey: '' } },
    );
    return { removed: result.deletedCount ?? 0 };
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

function bandFor(score: number): 'high' | 'low' | 'none' {
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return 'high';
  if (score >= LOW_CONFIDENCE_THRESHOLD) return 'low';
  return 'none';
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
