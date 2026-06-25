import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserStatus } from '../authz/schemas/user.schema';
import { StorageService } from '../storage/storage.service';
import { LocalUserFaceProvider } from './providers/local-user-face.provider';
import { AzureUserFaceProvider } from './providers/azure-user-face.provider';
import { UserFaceMatch, UserFaceProvider } from './user-face-provider.interface';

// Re-exported for callers that import the match shape from here.
export type { UserFaceMatch } from './user-face-provider.interface';

/**
 * Staff face login. Distinct from the patient face system:
 *   - Patient face → identify a patient at the front desk (per-clinic).
 *   - Staff face   → log a user in (pre-auth, cross-clinic scan).
 *
 * The actual enroll / identify / remove is delegated to a UserFaceProvider
 * chosen by the SAME `FACE_PROVIDER` env var the patient face system uses:
 *
 *     FACE_PROVIDER=local  → face-svc embeddings + cosine            [default]
 *     FACE_PROVIDER=azure  → Azure Face API, one global staff group
 *
 * This service keeps the shared concerns: user existence, the active-user
 * gate, and the `faceEnrolledAt` marker.
 */
@Injectable()
export class UserFaceService {
  private readonly logger = new Logger(UserFaceService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly storage: StorageService,
    private readonly localProvider: LocalUserFaceProvider,
    private readonly azureProvider: AzureUserFaceProvider,
  ) {}

  /** Active provider — flip FACE_PROVIDER to switch (same env as patients). */
  private get provider(): UserFaceProvider {
    const choice = (process.env.FACE_PROVIDER ?? 'local').toLowerCase();
    return choice === 'azure' ? this.azureProvider : this.localProvider;
  }

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
    const user = await this.userModel.findOne({ _id: userObjId, clinicId: input.clinicId });
    if (!user) throw new NotFoundException('User not found');

    const result = await this.provider.enrollUserFace({
      clinicId: input.clinicId,
      userId: userObjId,
      actorUserId: input.actorUserId,
      image: input.image,
    });

    // The captured frame doubles as the user's profile photo, so staff
    // never have to upload one separately. Non-fatal: the face template is
    // the critical artifact, so a storage hiccup must not fail enrollment.
    const setFields: Record<string, unknown> = { faceEnrolledAt: new Date() };
    const profileImageKey = `clinic/${input.clinicId.toHexString()}/user/${userObjId.toHexString()}/profile.jpg`;
    try {
      await this.storage.putObject({
        key: profileImageKey,
        body: new Uint8Array(input.image.buffer),
        contentType: input.image.mimeType,
      });
      setFields.profileImageKey = profileImageKey;
    } catch (e) {
      this.logger.warn(
        `[user-face] failed to save profile image for ${input.userId} (template kept): ${e instanceof Error ? e.message : e}`,
      );
    }

    await this.userModel.updateOne(
      { _id: userObjId, clinicId: input.clinicId },
      { $set: setFields },
    );
    this.logger.log(`[user-face] enrolled user ${input.userId} via ${this.provider.name}`);
    return { enrolled: true, faceConfidence: result.faceConfidence };
  }

  /** Remove a staff member's face template. */
  async remove(clinicId: Types.ObjectId, userId: string): Promise<{ removed: number }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const userObjId = new Types.ObjectId(userId);
    await this.provider.removeUserFace({ clinicId, userId: userObjId });
    await this.userModel.updateOne(
      { _id: userObjId, clinicId },
      { $unset: { faceEnrolledAt: '' } },
    );
    return { removed: 1 };
  }

  /**
   * Identify a user from a login face scan. Cross-clinic (login is
   * pre-auth). Returns the best provider match, or null. Confirms the
   * matched user is still active before letting them in.
   */
  async identify(image: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<UserFaceMatch | null> {
    const match = await this.provider.identifyUser(image);
    if (!match) return null;

    const user = await this.userModel
      .findOne({ _id: match.userId, clinicId: match.clinicId })
      .select({ status: 1 })
      .lean();
    if (!user || (user as { status?: string }).status !== UserStatus.Active) {
      return null;
    }
    return match;
  }
}
