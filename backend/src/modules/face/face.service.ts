import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Patient } from '../patients/schemas/patient.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';
import { StorageService } from '../storage/storage.service';
import { LocalFaceProvider } from './providers/local-face.provider';
import { AzureFaceProvider } from './providers/azure-face.provider';
import { FaceProvider } from './providers/face-provider.interface';

export type RecognitionMatch = {
  patientId: string;
  fullName: string;
  mrn?: string;
  score: number;
  confidence: 'high' | 'low' | 'none';
};

/**
 * Face-recognition orchestrator.
 *
 * The actual template store / match / delete is delegated to a
 * FaceProvider, chosen by the FACE_PROVIDER env var:
 *
 *     FACE_PROVIDER=local   → OpenCV YuNet+SFace (face-svc sidecar)   [default]
 *     FACE_PROVIDER=azure   → Azure Face API (PersonGroup-per-clinic)
 *
 * That env line is the single switch. Both providers stay compiled so
 * you can fall back instantly. This service keeps the shared concerns:
 *   - feature-flag check (modules.faceRecognition.enabled)
 *   - consent gate
 *   - profile-image save to S3 (the captured frame doubles as the avatar)
 *   - patient-name hydration for the match list
 */
@Injectable()
export class FaceService {
  private readonly logger = new Logger(FaceService.name);

  constructor(
    @InjectModel(Patient.name)
    private readonly patientModel: Model<Patient>,
    @InjectModel(Clinic.name)
    private readonly clinicModel: Model<Clinic>,
    private readonly storage: StorageService,
    private readonly localProvider: LocalFaceProvider,
    private readonly azureProvider: AzureFaceProvider,
  ) {
    console.log(`\n>>> [FaceService] Active Face Provider resolved: "${process.env.FACE_PROVIDER}" <<<\n`);
    this.logger.log(`Active Face Provider resolved from process.env.FACE_PROVIDER: "${process.env.FACE_PROVIDER}"`);
  }

  /** The active provider — flip FACE_PROVIDER to switch. */
  private get provider(): FaceProvider {
    const choice = (process.env.FACE_PROVIDER ?? 'local').toLowerCase();
    return choice === 'azure' ? this.azureProvider : this.localProvider;
  }

  // Returns 404 (not 403) so a probing caller can't fingerprint which
  // features a clinic has enabled vs which they're forbidden from.
  private async assertFeatureEnabled(clinicId: Types.ObjectId): Promise<void> {
    const clinic = await this.clinicModel.findById(clinicId).lean();
    if (!clinic) throw new NotFoundException('Clinic not found');
    const settings = mergeClinicSettings(clinic.settings);
    if (!settings.modules.faceRecognition.enabled) {
      throw new NotFoundException('Face recognition is not enabled for this clinic');
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

    const patientDoc = patient as unknown as { faceConsent?: boolean };
    if (!patientDoc.faceConsent) {
      throw new ForbiddenException(
        'Patient has not consented to face enrollment — record consent before scanning',
      );
    }

    // Delegate the template store to the active provider.
    const result = await this.provider.enrollFace({
      clinicId: input.clinicId,
      patientId: patientObjId,
      actorUserId: input.actorUserId,
      image: input.image,
      preDetected: input.preDetected,
    });

    // Persist the captured frame as the patient's profile picture
    // regardless of provider (Azure doesn't hand the image back, so we
    // always keep our own copy here). Failures are non-fatal — the
    // template is the critical artifact.
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
        `[enroll] failed to save profile image for ${input.patientId} (template kept): ${e instanceof Error ? e.message : e}`,
      );
    }

    await this.patientModel.updateOne(
      { _id: patientObjId, clinicId: input.clinicId },
      { $set: setFields },
    );

    this.logger.log(
      `[enroll] patient ${input.patientId} provider=${this.provider.name} model=${result.model} confidence=${result.faceConfidence.toFixed(2)}`,
    );

    return {
      enrolled: true,
      faceConfidence: result.faceConfidence,
      model: result.model,
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

    const topK = Math.max(1, Math.min(input.topK ?? 3, 10));
    const { candidates, facesDetected } = await this.provider.recognizeFace({
      clinicId: input.clinicId,
      image: input.image,
      preDetected: input.preDetected,
      topK,
    });

    if (candidates.length === 0) {
      return { matches: [], autoMatch: null, facesDetected };
    }

    // Hydrate patient name + MRN for the candidate ids.
    const ids = candidates.map((c) => new Types.ObjectId(c.patientId));
    const patients = await this.patientModel
      .find({ _id: { $in: ids }, clinicId: input.clinicId })
      .select({ fullName: 1, mrn: 1 })
      .lean();
    const byId = new Map(patients.map((p) => [String(p._id), p]));

    const matches: RecognitionMatch[] = candidates.flatMap((c) => {
      const p = byId.get(c.patientId);
      if (!p) return [];
      const m: RecognitionMatch = {
        patientId: c.patientId,
        fullName: p.fullName,
        score: c.score,
        confidence: c.confidence,
      };
      if (p.mrn) m.mrn = p.mrn;
      return [m];
    });

    const autoMatch =
      matches[0] && matches[0].confidence === 'high' ? matches[0] : null;

    return { matches, autoMatch, facesDetected };
  }

  async unenroll(
    clinicId: Types.ObjectId,
    patientId: string,
  ): Promise<{ removed: number }> {
    if (!Types.ObjectId.isValid(patientId)) {
      throw new NotFoundException('Patient not found');
    }
    const patientObjId = new Types.ObjectId(patientId);

    await this.provider.removeFace({ clinicId, patientId: patientObjId });

    // Drop the profile image too — removing the template while keeping
    // the photo would leave behind a face the operator thought they
    // cleared.
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

    // `removed` retained for response-shape compatibility — providers
    // are idempotent, so report 1 (best-effort) rather than a count.
    return { removed: 1 };
  }
}
