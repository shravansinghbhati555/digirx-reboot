import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../../authz/schemas/user.schema';
import {
  UserFaceEnrollInput,
  UserFaceMatch,
  UserFaceProvider,
} from '../user-face-provider.interface';

// Staff login is cross-clinic and pre-auth, so ALL staff share a single
// global PersonGroup (unlike patients, who get one group per clinic).
// Must match Azure's id rule ^[a-z0-9-_]{1,64}$.
const STAFF_GROUP_ID = process.env.AZURE_FACE_STAFF_GROUP ?? 'staff-all';

const TRAIN_POLL_INTERVAL_MS = 1000;
const TRAIN_POLL_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Azure Face staff-login provider. Mirrors AzureFaceProvider (patients)
 * but targets ONE global "staff" PersonGroup so a single identify call
 * resolves a face to a user across all clinics. The matched Person's
 * name is the userId; we look the user up to recover their clinicId.
 *
 * Requires the same env as the patient Azure provider:
 *   AZURE_FACE_ENDPOINT, AZURE_FACE_KEY (+ optional model overrides).
 */
@Injectable()
export class AzureUserFaceProvider implements UserFaceProvider {
  readonly name = 'azure';
  private readonly logger = new Logger(AzureUserFaceProvider.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  private get endpoint(): string {
    const e = process.env.AZURE_FACE_ENDPOINT;
    if (!e) throw new InternalServerErrorException('AZURE_FACE_ENDPOINT is not configured (FACE_PROVIDER=azure)');
    return e.replace(/\/+$/, '');
  }
  private get key(): string {
    const k = process.env.AZURE_FACE_KEY;
    if (!k) throw new InternalServerErrorException('AZURE_FACE_KEY is not configured (FACE_PROVIDER=azure)');
    return k;
  }
  private get recognitionModel(): string {
    return process.env.AZURE_FACE_RECOGNITION_MODEL ?? 'recognition_04';
  }
  private get detectionModel(): string {
    return process.env.AZURE_FACE_DETECTION_MODEL ?? 'detection_03';
  }
  // Staff login is account-takeover-sensitive, so default stricter than
  // the patient low band.
  private get loginThreshold(): number {
    return parseFloat(process.env.AZURE_FACE_STAFF_THRESHOLD ?? '0.7');
  }

  private async call(
    method: string,
    path: string,
    opts: { json?: unknown; body?: Buffer; contentType?: string } = {},
  ): Promise<any> {
    const url = `${this.endpoint}/face/v1.0${path}`;
    const headers: Record<string, string> = { 'Ocp-Apim-Subscription-Key': this.key };
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.body) {
      headers['Content-Type'] = opts.contentType ?? 'application/octet-stream';
      body = new Uint8Array(opts.body);
    }
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body });
    } catch (e) {
      this.logger.error(`[azure-staff] ✗ UNREACHABLE ${method} ${url} — ${e instanceof Error ? e.message : e}`);
      throw new InternalServerErrorException('Face service (Azure) unavailable');
    }
    if (res.status === 404) return { __notFound: true };
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        if (j?.error?.message) detail = j.error.message;
      } catch { /* ignore */ }
      if (/no face|InvalidImage|invalid face/i.test(detail)) throw new BadRequestException(detail);
      throw new InternalServerErrorException(`Azure Face error (${res.status}): ${detail}`);
    }
    if (res.status === 204) return {};
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('application/json') ? await res.json() : {};
  }

  private async ensureStaffGroup(): Promise<void> {
    const existing = await this.call('GET', `/persongroups/${STAFF_GROUP_ID}`);
    if (!existing.__notFound) return;
    await this.call('PUT', `/persongroups/${STAFF_GROUP_ID}`, {
      json: { name: STAFF_GROUP_ID, recognitionModel: this.recognitionModel },
    });
    this.logger.log(`[azure-staff] created PersonGroup "${STAFF_GROUP_ID}"`);
  }

  private async trainAndWait(): Promise<void> {
    await this.call('POST', `/persongroups/${STAFF_GROUP_ID}/train`);
    const deadline = Date.now() + TRAIN_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await this.call('GET', `/persongroups/${STAFF_GROUP_ID}/training`);
      if (status?.status === 'succeeded') return;
      if (status?.status === 'failed') {
        throw new InternalServerErrorException(`Azure Face training failed: ${status?.message ?? 'unknown'}`);
      }
      await sleep(TRAIN_POLL_INTERVAL_MS);
    }
    this.logger.warn(`[azure-staff] training still running after ${TRAIN_POLL_TIMEOUT_MS}ms — proceeding`);
  }

  async enrollUserFace(input: UserFaceEnrollInput): Promise<{ faceConfidence: number }> {
    await this.ensureStaffGroup();

    const user = await this.userModel
      .findOne({ _id: input.userId, clinicId: input.clinicId })
      .select({ azureStaffPersonId: 1, azureStaffFaceIds: 1 })
      .lean();
    let personId = (user as { azureStaffPersonId?: string } | null)?.azureStaffPersonId;

    if (personId) {
      const found = await this.call('GET', `/persongroups/${STAFF_GROUP_ID}/persons/${personId}`);
      if (found.__notFound) personId = undefined; // stale — recreate
    }
    if (!personId) {
      const created = await this.call('POST', `/persongroups/${STAFF_GROUP_ID}/persons`, {
        json: { name: input.userId.toHexString() },
      });
      personId = created.personId as string;
    } else {
      // Single template per user — drop prior faces on re-enroll.
      const prior = (user as { azureStaffFaceIds?: string[] } | null)?.azureStaffFaceIds ?? [];
      for (const fid of prior) {
        await this.call('DELETE', `/persongroups/${STAFF_GROUP_ID}/persons/${personId}/persistedfaces/${fid}`);
      }
    }

    const added = await this.call(
      'POST',
      `/persongroups/${STAFF_GROUP_ID}/persons/${personId}/persistedfaces?detectionModel=${this.detectionModel}`,
      { body: input.image.buffer, contentType: input.image.mimeType },
    );
    const persistedFaceId = added.persistedFaceId as string;
    if (!persistedFaceId) {
      throw new BadRequestException('Azure could not detect a usable face — retake with better lighting');
    }

    await this.userModel.updateOne(
      { _id: input.userId, clinicId: input.clinicId },
      { $set: { azureStaffPersonId: personId, azureStaffFaceIds: [persistedFaceId] } },
    );
    await this.trainAndWait();
    this.logger.log(`[azure-staff] enrolled user ${input.userId.toHexString()} person=${personId}`);
    return { faceConfidence: 1 };
  }

  async identifyUser(image: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<UserFaceMatch | null> {
    const detected = await this.call(
      'POST',
      `/detect?detectionModel=${this.detectionModel}&recognitionModel=${this.recognitionModel}&returnFaceId=true`,
      { body: image.buffer, contentType: image.mimeType },
    );
    const faceIds = (Array.isArray(detected) ? detected : [])
      .map((f: { faceId?: string }) => f.faceId)
      .filter(Boolean) as string[];
    if (faceIds.length === 0) return null;

    const ident = await this.call('POST', `/identify`, {
      json: {
        personGroupId: STAFF_GROUP_ID,
        faceIds: [faceIds[0]],
        maxNumOfCandidatesReturned: 1,
        confidenceThreshold: this.loginThreshold,
      },
    });
    if (ident.__notFound) return null;
    const result: Array<{ candidates?: Array<{ personId: string; confidence: number }> }> =
      Array.isArray(ident) ? ident : [];
    const best = result[0]?.candidates?.[0];
    this.logger.log(`[azure-staff] login identify: best=${best ? `${best.personId}@${best.confidence}` : 'none'} threshold=${this.loginThreshold}`);
    if (!best || best.confidence < this.loginThreshold) return null;

    // Person name is the userId; recover the user (and their clinicId).
    const user = await this.userModel
      .findOne({ azureStaffPersonId: best.personId })
      .select({ _id: 1, clinicId: 1 })
      .lean();
    if (!user) return null;
    return {
      userId: (user as { _id: Types.ObjectId })._id,
      clinicId: (user as { clinicId: Types.ObjectId }).clinicId,
      score: best.confidence,
    };
  }

  async removeUserFace(input: { clinicId: Types.ObjectId; userId: Types.ObjectId }): Promise<void> {
    const user = await this.userModel
      .findOne({ _id: input.userId, clinicId: input.clinicId })
      .select({ azureStaffPersonId: 1 })
      .lean();
    const personId = (user as { azureStaffPersonId?: string } | null)?.azureStaffPersonId;
    if (!personId) return;
    await this.call('DELETE', `/persongroups/${STAFF_GROUP_ID}/persons/${personId}`);
    await this.userModel.updateOne(
      { _id: input.userId, clinicId: input.clinicId },
      { $unset: { azureStaffPersonId: '', azureStaffFaceIds: '' } },
    );
    void this.trainAndWait().catch(() => undefined);
  }
}
