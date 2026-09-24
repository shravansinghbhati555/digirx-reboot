import { Types } from 'mongoose';

export type RequestContext = {
  clinicId: Types.ObjectId;
  branchId?: Types.ObjectId;
  actorUserId?: Types.ObjectId;
  /**
   * Opaque per-device id from the `x-device-id` header, minted client-side.
   * Lets a write entered offline stay attributable once it syncs, and scopes
   * number leases to a device rather than a user. Untrusted and unauthenticated
   * — it identifies, it never authorizes.
   */
  deviceId?: string;
};

/** Matches the UUID/hex ids `src/offline/device.ts` mints, and nothing else. */
const DEVICE_ID_RE = /^[a-f0-9-]{16,64}$/i;

/**
 * Read `x-device-id` defensively. The value goes into audit rows, so a
 * malformed or oversized header is dropped rather than stored.
 */
export function parseDeviceId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return DEVICE_ID_RE.test(trimmed) ? trimmed : undefined;
}

export function parseObjectId(
  value: string,
  fieldName: string,
): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return new Types.ObjectId(value);
}
