import { Types } from 'mongoose';

/**
 * Face-recognition provider abstraction.
 *
 * Two implementations exist:
 *   - LocalFaceProvider  — OpenCV YuNet+SFace via the face-svc sidecar,
 *                          embeddings stored in MongoDB, cosine search.
 *   - AzureFaceProvider  — Azure Face API (PersonGroup-per-clinic).
 *
 * The active provider is chosen by the FACE_PROVIDER env var (read in
 * FaceService). Swapping providers is a single env line; both stay
 * compiled so you can fall back instantly.
 *
 * FaceService keeps the SHARED orchestration — feature-flag check,
 * consent gate, profile-image save, patient-name hydration — and
 * delegates only the template operations (store / match / delete) to
 * the provider. That keeps the providers small and their behaviours
 * directly comparable.
 */

export type FaceConfidenceBand = 'high' | 'low' | 'none';

/** A single recognition candidate, normalized across providers. */
export interface FaceCandidate {
  /** Patient ObjectId hex. */
  patientId: string;
  /**
   * Match score in [0,1]. For local this is cosine similarity; for
   * Azure it's the identify confidence. Not directly comparable across
   * providers — each provider also returns the resolved `confidence`
   * band so FaceService doesn't need provider-specific thresholds.
   */
  score: number;
  confidence: FaceConfidenceBand;
}

export interface FaceProviderEnrollInput {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  actorUserId?: Types.ObjectId;
  image: { buffer: Buffer; mimeType: string; filename: string };
  /** Browser already cropped to the face (MediaPipe). */
  preDetected?: boolean;
}

export interface FaceProviderEnrollResult {
  /** Detector confidence for the enrolled face, 0..1. */
  faceConfidence: number;
  /** Human-readable model id for logs / audit ("SFace", "azure-face"). */
  model: string;
}

export interface FaceProviderRecognizeInput {
  clinicId: Types.ObjectId;
  image: { buffer: Buffer; mimeType: string; filename: string };
  topK: number;
  preDetected?: boolean;
}

export interface FaceProviderRecognizeResult {
  candidates: FaceCandidate[];
  facesDetected: number;
}

export interface FaceProvider {
  /** Short id used in logs ("local" | "azure"). */
  readonly name: string;

  /**
   * Store / replace the patient's face template. Consent and the
   * feature flag are already checked by FaceService before this runs.
   */
  enrollFace(input: FaceProviderEnrollInput): Promise<FaceProviderEnrollResult>;

  /** Identify candidate patients for the probe image. */
  recognizeFace(
    input: FaceProviderRecognizeInput,
  ): Promise<FaceProviderRecognizeResult>;

  /** Remove the patient's face template. Idempotent. */
  removeFace(input: {
    clinicId: Types.ObjectId;
    patientId: Types.ObjectId;
  }): Promise<void>;
}

/** DI token for the two concrete providers. */
export const LOCAL_FACE_PROVIDER = 'LOCAL_FACE_PROVIDER';
export const AZURE_FACE_PROVIDER = 'AZURE_FACE_PROVIDER';
