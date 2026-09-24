import { Types } from 'mongoose';

/**
 * Error code returned in the 409 body when a client-minted `_id` already
 * exists. The offline write queue keys on this string to tell a replay of an
 * already-applied create apart from a genuine failure.
 */
export const CLIENT_ID_EXISTS = 'CLIENT_ID_EXISTS';

export function resolveClientId(raw?: string): Types.ObjectId | undefined {
  return raw ? new Types.ObjectId(raw) : undefined;
}

/**
 * Spreadable `_id` for `Model.create(...)`. Returns an empty object when the
 * client did not supply one, so the key is omitted entirely and Mongoose
 * applies its own default rather than seeing an explicit `undefined`.
 *
 * This is the single line a feature service adds to opt a create path into
 * offline creation. Everything else — validation, conflict mapping — is
 * handled by this module.
 */
export function clientIdFields(raw?: string): { _id?: Types.ObjectId } {
  const id = resolveClientId(raw);
  return id ? { _id: id } : {};
}

/** True when a Mongo write failed on the `_id` unique index specifically. */
export function isDuplicateIdError(err: unknown): boolean {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> } | null;
  return e?.code === 11000 && e?.keyPattern?._id !== undefined;
}
