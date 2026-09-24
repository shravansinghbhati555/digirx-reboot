/**
 * Client-side ObjectId minting — the browser half of ticket A1.
 *
 * A record created offline must be referenceable by records created after it:
 * an encounter needs a `patientId` before either document has reached the
 * server. So the client mints the id and sends it as `_id`, which the backend
 * accepts on the five offline-creatable entities (see
 * `backend/src/modules/offline/`).
 *
 * The layout is Mongo's own, so these are indistinguishable from server-minted
 * ids and sort by creation time like any other:
 *
 *   | 4 bytes: seconds since epoch | 5 bytes: per-process random | 3 bytes: counter |
 */

const PROCESS_RANDOM = (() => {
  const bytes = new Uint8Array(5);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
})();

// Starting the counter at a random point means two tabs that load in the same
// second do not march through the same sequence.
let counter = Math.floor(Math.random() * 0xffffff);

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, '0');
}

/** A fresh 24-character hex ObjectId. */
export function newObjectId(now: number = Date.now()): string {
  const seconds = Math.floor(now / 1000);
  counter = (counter + 1) % 0x1000000;
  return (
    hex(seconds, 8) +
    Array.from(PROCESS_RANDOM, (b) => hex(b, 2)).join('') +
    hex(counter, 6)
  );
}

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_RE.test(value);
}

/** The creation time encoded in an ObjectId, or null if it is malformed. */
export function objectIdTimestamp(id: string): Date | null {
  if (!isObjectId(id)) return null;
  return new Date(parseInt(id.slice(0, 8), 16) * 1000);
}
