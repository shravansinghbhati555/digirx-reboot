import { Types } from 'mongoose';

/**
 * Staff face-login provider abstraction — the staff analogue of the
 * patient-side FaceProvider. Chosen by the same FACE_PROVIDER env var:
 *
 *   FACE_PROVIDER=local  → face-svc (YuNet+SFace) embeddings + cosine    [default]
 *   FACE_PROVIDER=azure  → Azure Face API, single global "staff" PersonGroup
 *
 * Staff login is cross-clinic and pre-auth (no clinic context on the
 * request), so — unlike patients — all staff share ONE gallery: every
 * embedding for local, one global PersonGroup for Azure.
 */

export interface UserFaceMatch {
  userId: Types.ObjectId;
  clinicId: Types.ObjectId;
  /** local: cosine similarity; azure: identify confidence. Both 0..1. */
  score: number;
}

export interface UserFaceEnrollInput {
  clinicId: Types.ObjectId;
  userId: Types.ObjectId;
  actorUserId?: Types.ObjectId;
  image: { buffer: Buffer; mimeType: string; filename: string };
}

export interface UserFaceProvider {
  /** Short id used in logs ("local" | "azure"). */
  readonly name: string;

  /** Store / replace a staff member's face template. */
  enrollUserFace(input: UserFaceEnrollInput): Promise<{ faceConfidence: number }>;

  /**
   * Identify a staff member from a login probe. Cross-clinic scan
   * (login is pre-auth). Returns the best confident match, or null.
   */
  identifyUser(image: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<UserFaceMatch | null>;

  /** Remove a staff member's face template. Idempotent. */
  removeUserFace(input: {
    clinicId: Types.ObjectId;
    userId: Types.ObjectId;
  }): Promise<void>;
}

export const USER_FACE_LOCAL_PROVIDER = 'USER_FACE_LOCAL_PROVIDER';
export const USER_FACE_AZURE_PROVIDER = 'USER_FACE_AZURE_PROVIDER';
