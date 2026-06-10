import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Patient } from '../../patients/schemas/patient.schema';
import {
  FaceCandidate,
  FaceConfidenceBand,
  FaceProvider,
  FaceProviderEnrollInput,
  FaceProviderEnrollResult,
  FaceProviderRecognizeInput,
  FaceProviderRecognizeResult,
} from './face-provider.interface';

// Azure identify confidence cutoffs (0..1). Azure's confidence scale is
// NOT the same as cosine similarity, so these are separate from the
// local FACE_*_THRESHOLD vars. Azure's own default identify confidence
// is 0.5; we keep auto-pick stricter.
// NOTE: thresholds are read lazily (inside getters) so they reflect
// the .env value that NestJS has already loaded by call time.

// Train polling. After adding a face we kick a training job and poll
// until it's `succeeded` (or time out). Training is usually a few
// seconds for a small group.
const TRAIN_POLL_INTERVAL_MS = 1000;
const TRAIN_POLL_TIMEOUT_MS = 30_000;

/**
 * Azure Face API provider (PersonGroup-per-clinic).
 *
 * Model:
 *   - Each clinic is one Azure PersonGroup: id = `clinic-<clinicHex>`.
 *   - Each enrolled patient is one Person in that group; the GUID is
 *     stored on Patient.azurePersonId.
 *   - Enrollment adds a persistedFace to the person, then trains.
 *   - Recognition = Detect (faceId) → Identify (faceId vs group).
 *
 * IMPORTANT — Limited Access: Azure Face Identify/Verify are gated
 * behind Microsoft's Limited Access approval. Detection works without
 * it; identification (recognize) does NOT until your subscription is
 * approved. Apply via the Azure Face "Limited Access" form first.
 *
 * Required env:
 *   AZURE_FACE_ENDPOINT  e.g. https://<resource>.cognitiveservices.azure.com
 *   AZURE_FACE_KEY       the resource key
 * Optional:
 *   AZURE_FACE_RECOGNITION_MODEL  default "recognition_04"
 *   AZURE_FACE_DETECTION_MODEL    default "detection_03"
 */
@Injectable()
export class AzureFaceProvider implements FaceProvider {
  readonly name = 'azure';
  private readonly logger = new Logger(AzureFaceProvider.name);

  constructor(
    @InjectModel(Patient.name)
    private readonly patientModel: Model<Patient>,
  ) { }

  private get endpoint(): string {
    const e = process.env.AZURE_FACE_ENDPOINT;
    if (!e) {
      throw new InternalServerErrorException(
        'AZURE_FACE_ENDPOINT is not configured (FACE_PROVIDER=azure)',
      );
    }
    return e.replace(/\/+$/, '');
  }

  private get key(): string {
    const k = process.env.AZURE_FACE_KEY;
    if (!k) {
      throw new InternalServerErrorException(
        'AZURE_FACE_KEY is not configured (FACE_PROVIDER=azure)',
      );
    }
    return k;
  }

  private get recognitionModel(): string {
    return process.env.AZURE_FACE_RECOGNITION_MODEL ?? 'recognition_04';
  }

  private get detectionModel(): string {
    return process.env.AZURE_FACE_DETECTION_MODEL ?? 'detection_03';
  }

  private get azureHigh(): number {
    return parseFloat(process.env.AZURE_FACE_HIGH_THRESHOLD ?? '0.75');
  }

  private get azureLow(): number {
    return parseFloat(process.env.AZURE_FACE_LOW_THRESHOLD ?? '0.5');
  }

  private personGroupId(clinicId: Types.ObjectId): string {
    // PersonGroup id must match ^[a-z0-9-_]{1,64}$. clinic-<24hex> = 31.
    return `clinic-${clinicId.toHexString()}`;
  }

  // --- HTTP helpers -------------------------------------------------

  private async call(
    method: string,
    path: string,
    opts: { json?: unknown; body?: Buffer; contentType?: string } = {},
  ): Promise<any> {
    const url = `${this.endpoint}/face/v1.0${path}`;
    const headers: Record<string, string> = {
      'Ocp-Apim-Subscription-Key': this.key,
    };
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.body) {
      headers['Content-Type'] = opts.contentType ?? 'application/octet-stream';
      body = new Uint8Array(opts.body);
    }

    this.logger.log(`[azure] → ${method} ${url}`);

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body });
    } catch (e) {
      this.logger.error(
        `[azure] ✗ UNREACHABLE — ${method} ${url} — ${e instanceof Error ? e.message : e}`,
      );
      this.logger.error(`[azure] Check AZURE_FACE_ENDPOINT ("${process.env.AZURE_FACE_ENDPOINT}") and network connectivity`);
      throw new InternalServerErrorException('Face service (Azure) unavailable');
    }

    this.logger.log(`[azure] ← ${method} ${path} → HTTP ${res.status}`);

    if (res.status === 404) {
      this.logger.log(`[azure] 404 not-found for ${method} ${path}`);
      return { __notFound: true };
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        if (j?.error?.message) detail = j.error.message;
      } catch {
        /* ignore */
      }
      this.logger.error(`[azure] ✗ ${method} ${path} → ${res.status}: ${detail}`);
      // Map the common "no face" case to a 400 so the FE shows a
      // friendly retry message rather than a 500.
      if (/no face|InvalidImage|invalid face/i.test(detail)) {
        throw new BadRequestException(detail);
      }
      throw new InternalServerErrorException(`Azure Face error (${res.status}): ${detail}`);
    }
    if (res.status === 204) return {};
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return {};
    return await res.json();
  }

  /** Create the clinic's PersonGroup if it doesn't exist yet. */
  private async ensurePersonGroup(clinicId: Types.ObjectId): Promise<string> {
    const groupId = this.personGroupId(clinicId);
    this.logger.log(`[azure] ensurePersonGroup → checking groupId="${groupId}"`);
    const existing = await this.call('GET', `/persongroups/${groupId}`);
    if (!existing.__notFound) {
      this.logger.log(`[azure] ✔ PersonGroup "${groupId}" already exists`);
      return groupId;
    }
    this.logger.log(`[azure] PersonGroup "${groupId}" not found — creating (recognitionModel=${this.recognitionModel})`);
    await this.call('PUT', `/persongroups/${groupId}`, {
      json: { name: groupId, recognitionModel: this.recognitionModel },
    });
    this.logger.log(`[azure] ✔ Created PersonGroup "${groupId}"`);
    return groupId;
  }

  /** Kick a training job and poll until it succeeds (or time out). */
  private async trainAndWait(groupId: string): Promise<void> {
    this.logger.log(`[azure] Starting training for PersonGroup "${groupId}"`);
    await this.call('POST', `/persongroups/${groupId}/train`);
    const deadline = Date.now() + TRAIN_POLL_TIMEOUT_MS;
    let polls = 0;
    while (Date.now() < deadline) {
      const status = await this.call('GET', `/persongroups/${groupId}/training`);
      polls++;
      this.logger.log(`[azure] training poll #${polls} → status=${status?.status}`);
      if (status?.status === 'succeeded') {
        this.logger.log(`[azure] ✔ Training succeeded for "${groupId}" after ${polls} poll(s)`);
        return;
      }
      if (status?.status === 'failed') {
        this.logger.error(`[azure] ✗ Training FAILED for "${groupId}": ${status?.message ?? 'unknown'}`);
        throw new InternalServerErrorException(
          `Azure Face training failed: ${status?.message ?? 'unknown'}`,
        );
      }
      await sleep(TRAIN_POLL_INTERVAL_MS);
    }
    this.logger.warn(`[azure] training still running after ${TRAIN_POLL_TIMEOUT_MS}ms — proceeding`);
  }

  // --- Provider API -------------------------------------------------

  async enrollFace(
    input: FaceProviderEnrollInput,
  ): Promise<FaceProviderEnrollResult> {
    this.logger.log(`[azure] enrollFace — patientId=${input.patientId} clinicId=${input.clinicId}`);
    this.logger.log(`[azure] Config — endpoint=${process.env.AZURE_FACE_ENDPOINT} keySet=${!!process.env.AZURE_FACE_KEY}`);
    const groupId = await this.ensurePersonGroup(input.clinicId);

    const patient = await this.patientModel
      .findOne({ _id: input.patientId, clinicId: input.clinicId })
      .select({ azurePersonId: 1, azureFaceIds: 1, fullName: 1 })
      .lean();
    const existingPersonId = (patient as { azurePersonId?: string } | null)?.azurePersonId;

    // Re-enroll = wipe the existing person's faces so the new photo is
    // the only template. Simpler than tracking individual persistedFace
    // ids and keeps one face per patient (mirrors the local provider).
    let personId = existingPersonId;
    if (personId) {
      const del = await this.call(
        'GET',
        `/persongroups/${groupId}/persons/${personId}`,
      );
      if (del.__notFound) personId = undefined; // stale id — recreate
    }
    if (!personId) {
      const created = await this.call('POST', `/persongroups/${groupId}/persons`, {
        json: { name: input.patientId.toHexString() },
      });
      personId = created.personId as string;
    } else {
      // Drop prior faces for a clean single-template re-enroll.
      const prior = (patient as { azureFaceIds?: string[] } | null)?.azureFaceIds ?? [];
      for (const fid of prior) {
        await this.call(
          'DELETE',
          `/persongroups/${groupId}/persons/${personId}/persistedfaces/${fid}`,
        );
      }
    }

    const added = await this.call(
      'POST',
      `/persongroups/${groupId}/persons/${personId}/persistedfaces` +
      `?detectionModel=${this.detectionModel}`,
      { body: input.image.buffer, contentType: input.image.mimeType },
    );
    const persistedFaceId = added.persistedFaceId as string;
    if (!persistedFaceId) {
      throw new BadRequestException(
        'Azure could not detect a usable face in the image — retake with better lighting',
      );
    }

    await this.patientModel.updateOne(
      { _id: input.patientId, clinicId: input.clinicId },
      { $set: { azurePersonId: personId, azureFaceIds: [persistedFaceId] } },
    );

    await this.trainAndWait(groupId);
    this.logger.log(`[azure] ✔ Enrolled patient ${input.patientId.toHexString()} person=${personId} persistedFaceId=${persistedFaceId}`);

    // Azure doesn't return a detection confidence on add-face; report 1.0.
    return { faceConfidence: 1, model: 'azure-face' };
  }

  async recognizeFace(
    input: FaceProviderRecognizeInput,
  ): Promise<FaceProviderRecognizeResult> {
    this.logger.log(`[azure] recognizeFace — clinicId=${input.clinicId} topK=${input.topK}`);
    this.logger.log(`[azure] Config — endpoint=${process.env.AZURE_FACE_ENDPOINT} keySet=${!!process.env.AZURE_FACE_KEY}`);
    const groupId = this.personGroupId(input.clinicId);
    this.logger.log(`[azure] Using personGroupId="${groupId}"`);

    // 1) Detect → faceId(s). detectionModel=03 + recognitionModel must
    //    match the group's recognition model for identify to work.
    this.logger.log(`[azure] Step 1: Detecting faces (detectionModel=${this.detectionModel} recognitionModel=${this.recognitionModel})`);
    const detected = await this.call(
      'POST',
      `/detect?detectionModel=${this.detectionModel}` +
      `&recognitionModel=${this.recognitionModel}&returnFaceId=true`,
      { body: input.image.buffer, contentType: input.image.mimeType },
    );
    const faces: Array<{ faceId?: string }> = Array.isArray(detected) ? detected : [];
    const faceIds = faces.map((f) => f.faceId).filter(Boolean) as string[];
    this.logger.log(`[azure] Detect result: ${faceIds.length} face(s) found`);
    if (faceIds.length === 0) {
      this.logger.warn(`[azure] No faces detected in image — returning empty candidates`);
      return { candidates: [], facesDetected: 0 };
    }

    // 2) Identify the (first) face against the clinic's group.
    this.logger.log(`[azure] Step 2: Identifying faceId=${faceIds[0]} against group="${groupId}"`);
    const ident = await this.call('POST', `/identify`, {
      json: {
        personGroupId: groupId,
        faceIds: [faceIds[0]],
        maxNumOfCandidatesReturned: Math.min(Math.max(input.topK, 1), 10),
        confidenceThreshold: this.azureLow,
      },
    });
    if (ident.__notFound) {
      this.logger.warn(`[azure] Identify returned 404 — group not trained or no persons enrolled yet`);
      return { candidates: [], facesDetected: faceIds.length };
    }

    const result: Array<{ candidates?: Array<{ personId: string; confidence: number }> }> =
      Array.isArray(ident) ? ident : [];
    const azureCandidates = result[0]?.candidates ?? [];
    this.logger.log(
      `[azure] Identify returned ${azureCandidates.length} candidate(s): ${
        azureCandidates.map((c) => `personId=${c.personId} confidence=${round4(c.confidence)}`).join(', ') || 'none'
      }`,
    );
    if (azureCandidates.length === 0) {
      return { candidates: [], facesDetected: faceIds.length };
    }

    // Map Azure personIds back to our patients.
    const personIds = azureCandidates.map((c) => c.personId);
    const patients = await this.patientModel
      .find({ clinicId: input.clinicId, azurePersonId: { $in: personIds } })
      .select({ _id: 1, azurePersonId: 1 })
      .lean();
    this.logger.log(`[azure] DB lookup: found ${patients.length}/${personIds.length} matching patient(s)`);
    const patientByPerson = new Map(
      patients.map((p) => [
        (p as { azurePersonId?: string }).azurePersonId,
        String((p as { _id: Types.ObjectId })._id),
      ]),
    );

    const candidates: FaceCandidate[] = azureCandidates.flatMap((c) => {
      const patientId = patientByPerson.get(c.personId);
      if (!patientId) {
        this.logger.warn(`[azure] personId=${c.personId} has no matching patient in DB — skipping`);
        return [];
      }
      return [
        {
          patientId,
          score: round4(c.confidence),
          confidence: bandFor(c.confidence, this.azureHigh, this.azureLow),
        },
      ];
    });

    this.logger.log(`[azure] ✔ recognizeFace done — ${candidates.length} candidate(s) returned`);
    return { candidates, facesDetected: faceIds.length };
  }

  async removeFace(input: {
    clinicId: Types.ObjectId;
    patientId: Types.ObjectId;
  }): Promise<void> {
    const patient = await this.patientModel
      .findOne({ _id: input.patientId, clinicId: input.clinicId })
      .select({ azurePersonId: 1 })
      .lean();
    const personId = (patient as { azurePersonId?: string } | null)?.azurePersonId;
    if (!personId) return;

    const groupId = this.personGroupId(input.clinicId);
    await this.call('DELETE', `/persongroups/${groupId}/persons/${personId}`);
    await this.patientModel.updateOne(
      { _id: input.patientId, clinicId: input.clinicId },
      { $unset: { azurePersonId: '', azureFaceIds: '' } },
    );
    // Retrain so the deleted person leaves the model. Fire-and-forget —
    // identify of a deleted person just won't match in the meantime.
    void this.call('POST', `/persongroups/${groupId}/train`).catch(() => undefined);
  }
}

function bandFor(score: number, high: number, low: number): FaceConfidenceBand {
  if (score >= high) return 'high';
  if (score >= low) return 'low';
  return 'none';
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
