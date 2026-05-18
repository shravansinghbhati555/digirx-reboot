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

/**
 * Cosine match cutoffs for Facenet512. The defaults are tuned for the
 * real-world variance you see at a front desk — same person captured
 * minutes / weeks apart under different lighting + a different webcam
 * angle. DeepFace's own published threshold for Facenet512 + cosine is
 * 0.30 distance ≈ 0.70 similarity, but that's a strict pairwise verify;
 * for "search the whole clinic" we trade a small false-positive rate
 * for many more correct hits.
 *
 * Override via env (FACE_HIGH_THRESHOLD / FACE_LOW_THRESHOLD) without
 * a code change if you find your clinic skews one way.
 *
 *  - >HIGH  → auto-pick the patient (front desk skips confirmation)
 *  - LOW..HIGH → show candidate list, ask for confirmation
 *  - <LOW   → no match, fall back to typed search
 */
const HIGH_CONFIDENCE_THRESHOLD = parseFloat(
  process.env.FACE_HIGH_THRESHOLD ?? '0.55',
);
const LOW_CONFIDENCE_THRESHOLD = parseFloat(
  process.env.FACE_LOW_THRESHOLD ?? '0.4',
);

// Lower than the previous 0.85 so a slightly off-angle but otherwise
// valid enrollment isn't rejected. The detector's own confidence rarely
// drops below 0.9 on a well-framed face, so 0.7 still keeps junk out.
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
  ) {}

  /**
   * Refuses if the clinic has `modules.faceRecognition.enabled === false`.
   * Returns 404 (not 403) so a probing caller can't fingerprint which
   * features a clinic has enabled vs which they're forbidden from.
   */
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
  }): Promise<{ enrolled: true; faceConfidence: number; model: string }> {
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

    const embed = await this.faceClient.embed({ ...input.image, preDetected: input.preDetected });

    // Pre-detected uploads come pre-cropped from the browser, so the
    // server detector is skipped and `faceConfidence` is whatever the
    // browser-side MediaPipe reported (forwarded by the client) or 1.0
    // as a placeholder. Skip the strict confidence floor in that case —
    // the FE wouldn't have flagged the bbox if quality was poor.
    if (!input.preDetected && embed.faceConfidence < MIN_ENROLLMENT_FACE_CONFIDENCE) {
      throw new BadRequestException(
        `Face detection too weak (confidence ${embed.faceConfidence.toFixed(2)}) — retake the photo with better lighting`,
      );
    }
    if (embed.facesDetected > 1) {
      // Multiple faces in frame are fine at recognition (we pick the
      // biggest) but at enrollment we refuse — wrong patient locked in
      // is a serious data-integrity bug.
      throw new BadRequestException(
        'Multiple faces detected — only one person should be in the frame at enrollment',
      );
    }

    await this.embeddingModel.findOneAndUpdate(
      { clinicId: input.clinicId, patientId: patientObjId },
      {
        $set: {
          embedding: embed.embedding,
          model: embed.model,
          detector: embed.detector,
          faceConfidence: embed.faceConfidence,
          capturedBy: input.actorUserId,
        },
      },
      { upsert: true, new: true },
    );

    await this.patientModel.updateOne(
      { _id: patientObjId, clinicId: input.clinicId },
      { $set: { faceEnrolledAt: new Date() } },
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
    const probe = await this.faceClient.embed({ ...input.image, preDetected: input.preDetected });
    const probeVec = probe.embedding;

    // Pull every embedding for the clinic. Linear scan is fine up to
    // ~50k patients (single-digit ms cosine over 512-dim vectors); add
    // a vector index when we outgrow that.
    const rows = await this.embeddingModel
      .find({ clinicId: input.clinicId })
      .select({ patientId: 1, embedding: 1 })
      .lean();

    if (rows.length === 0) {
      return { matches: [], autoMatch: null, facesDetected: probe.facesDetected };
    }

    const scored = rows
      .map((row) => ({
        patientId: row.patientId,
        score: cosineSimilarity(probeVec, row.embedding),
      }))
      .sort((a, b) => b.score - a.score);

    const topK = Math.max(1, Math.min(input.topK ?? 3, 10));
    const top = scored.slice(0, topK);

    // Hydrate patient name + MRN for the candidates only. Avoids
    // streaming the whole patient collection.
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
    const result = await this.embeddingModel.deleteOne({
      clinicId,
      patientId: patientObjId,
    });
    await this.patientModel.updateOne(
      { _id: patientObjId, clinicId },
      { $unset: { faceEnrolledAt: '' } },
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
