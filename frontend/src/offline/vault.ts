/**
 * Encryption at rest for the offline store — ticket P6, built with A4's PIN.
 *
 * ## Shape
 *
 * One random 256-bit **data key** (DEK) encrypts everything the offline layer
 * writes to IndexedDB that could identify a patient: cached record bodies,
 * queued request bodies and labels, and meta values. The DEK itself is never
 * stored in the clear. It is wrapped twice, each under a key derived from a
 * secret with PBKDF2:
 *
 *   - the device **PIN** — the everyday unlock
 *   - the clinic admin **unlock code** — for a PIN forgotten mid-outage. The
 *     code is uploaded to the server (an admin reads it out over the phone)
 *     and is not kept on the device once uploaded.
 *
 * A wrong secret fails AES-GCM authentication when unwrapping, which is how a
 * PIN is verified — no PIN hash is stored, so there is nothing to brute-force
 * that is cheaper than unwrapping the key itself.
 *
 * ## While unlocked
 *
 * The DEK lives in this module's memory as a non-extractable `CryptoKey`. A
 * page reload drops it, so every fresh launch needs the PIN. The idle lock
 * (pin.ts) is a UI gate on top: it does not drop the key, so the background
 * sync keeps draining the queue while the screen is locked.
 *
 * ## Before a PIN exists
 *
 * Right after sign-in, before the user has set a PIN, there is no key. Writes
 * then go in plaintext, and `sealExistingRows` (db.ts) encrypts them in place
 * the moment the PIN is set. Once a vault exists, a write without the key
 * throws `VaultLockedError` rather than silently falling back to plaintext.
 */

const VAULT_KEY = 'digirx.vault.v1';

/**
 * OWASP's PBKDF2-HMAC-SHA256 guidance. A PIN has very little entropy, so the
 * KDF cost is what stands between a copied localStorage and a brute force.
 * Roughly a second on a low-end tablet, paid once per unlock.
 */
const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** No I, L, O, U, 0 or 1 — the code is read aloud over the phone. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

type Wrapped = {
  saltB64: string;
  iterations: number;
  ivB64: string;
  ctB64: string;
};

type VaultFile = {
  v: 1;
  pin: Wrapped;
  recovery: Wrapped;
  createdAt: number;
};

/** What a sealed value looks like at rest. */
export type Sealed = { __sealed: 1; iv: Uint8Array; ct: ArrayBuffer };

let dek: CryptoKey | null = null;

export const VAULT_CHANGED_EVENT = 'digirx:vault-changed';

function announce(): void {
  try {
    window.dispatchEvent(new Event(VAULT_CHANGED_EVENT));
  } catch {
    // No window (tests) — nothing to notify.
  }
}

export class VaultLockedError extends Error {
  readonly isVaultLockedError = true;
  constructor(message = 'This device is locked. Enter your PIN to continue.') {
    super(message);
    this.name = 'VaultLockedError';
    Object.setPrototypeOf(this, VaultLockedError.prototype);
  }
}

export function isVaultLockedError(err: unknown): err is VaultLockedError {
  return (
    err instanceof VaultLockedError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as VaultLockedError).isVaultLockedError === true)
  );
}

// ------------------------------------------------------------- encoding

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function readFile(): VaultFile | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultFile;
    return parsed?.v === 1 && parsed.pin && parsed.recovery ? parsed : null;
  } catch {
    return null;
  }
}

function writeFile(file: VaultFile): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(file));
}

// --------------------------------------------------------------- crypto

async function kekFrom(secret: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function wrap(raw: Uint8Array, secret: string): Promise<Wrapped> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const kek = await kekFrom(secret, salt, PBKDF2_ITERATIONS);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    kek,
    raw as BufferSource,
  );
  return {
    saltB64: toB64(salt),
    iterations: PBKDF2_ITERATIONS,
    ivB64: toB64(iv),
    ctB64: toB64(ct),
  };
}

/** Unwrap the raw DEK, or null when the secret is wrong. */
async function unwrap(w: Wrapped, secret: string): Promise<Uint8Array | null> {
  try {
    const kek = await kekFrom(secret, fromB64(w.saltB64), w.iterations);
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(w.ivB64) as BufferSource },
      kek,
      fromB64(w.ctB64) as BufferSource,
    );
    return new Uint8Array(raw);
  } catch {
    return null;
  }
}

async function importDek(raw: Uint8Array): Promise<CryptoKey> {
  // Non-extractable: once imported, nothing in the page can read the bytes
  // back out — not even this module.
  return await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Uppercase and re-dash whatever the user typed, so spacing never matters. */
export function normalizeRecoveryCode(input: string): string {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.match(/.{1,4}/g)?.join('-') ?? '';
}

export function mintRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return normalizeRecoveryCode(out);
}

// --------------------------------------------------------------- public

/** True once a PIN has been set on this device. */
export function hasVault(): boolean {
  return readFile() !== null;
}

/** True while the data key is in memory — i.e. unlocked since the last load. */
export function isVaultOpen(): boolean {
  return dek !== null;
}

/**
 * First-time setup: mint the data key, wrap it under the PIN and a fresh
 * unlock code, and open the vault. Returns the unlock code — the caller shows
 * it once, queues it for upload, and dispatches `VAULT_CHANGED_EVENT` when the
 * app may resume.
 */
export async function createVault(pin: string): Promise<{ recoveryCode: string }> {
  if (hasVault()) throw new Error('A PIN is already set on this device.');
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const recoveryCode = mintRecoveryCode();
  const file: VaultFile = {
    v: 1,
    pin: await wrap(raw, pin),
    recovery: await wrap(raw, recoveryCode),
    createdAt: Date.now(),
  };
  writeFile(file);
  dek = await importDek(raw);
  raw.fill(0);
  // No announce: the caller still has to seal pre-PIN rows and show the code.
  // Announcing now would let the app start reading and writing mid-migration.
  return { recoveryCode };
}

/** Unlock with the PIN. False when the PIN is wrong. */
export async function openWithPin(pin: string): Promise<boolean> {
  const file = readFile();
  if (!file) return false;
  const raw = await unwrap(file.pin, pin);
  if (!raw) return false;
  dek = await importDek(raw);
  raw.fill(0);
  announce();
  return true;
}

/**
 * Forgotten PIN: open with the admin's unlock code and set a new PIN in one
 * step. The used code is rotated — it has just been read out over a phone
 * line — so a new one is returned for the caller to show and upload.
 *
 * Returns null when the code is wrong.
 */
export async function resetPinWithRecoveryCode(
  code: string,
  newPin: string,
): Promise<{ recoveryCode: string } | null> {
  const file = readFile();
  if (!file) return null;
  const raw = await unwrap(file.recovery, normalizeRecoveryCode(code));
  if (!raw) return null;
  const recoveryCode = mintRecoveryCode();
  writeFile({
    ...file,
    pin: await wrap(raw, newPin),
    recovery: await wrap(raw, recoveryCode),
  });
  dek = await importDek(raw);
  raw.fill(0);
  // No announce, as in createVault: the new code is shown before the app resumes.
  return { recoveryCode };
}

/** Change the PIN, proving the current one. False when it is wrong. */
export async function changeVaultPin(currentPin: string, newPin: string): Promise<boolean> {
  const file = readFile();
  if (!file) return false;
  const raw = await unwrap(file.pin, currentPin);
  if (!raw) return false;
  writeFile({ ...file, pin: await wrap(raw, newPin) });
  raw.fill(0);
  return true;
}

/** Drop the key from memory. The next read needs the PIN again. */
export function closeVault(): void {
  dek = null;
  announce();
}

/**
 * Forget the vault entirely. Only for a device reset, after the caller has
 * wiped the encrypted stores — without the key they are unreadable anyway.
 */
export function destroyVault(): void {
  dek = null;
  try {
    localStorage.removeItem(VAULT_KEY);
  } catch {
    // ignore
  }
  announce();
}

export function isSealed(value: unknown): value is Sealed {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Sealed).__sealed === 1 &&
    (value as Sealed).ct != null
  );
}

/**
 * Encrypt a value for storage. Plaintext passes through only while no vault
 * exists at all (the pre-PIN window); with a vault but no key it throws.
 */
export async function seal(value: unknown): Promise<unknown> {
  if (value === undefined) return undefined;
  if (!dek) {
    if (hasVault()) throw new VaultLockedError();
    return value;
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    dek,
    new TextEncoder().encode(JSON.stringify(value)) as BufferSource,
  );
  const sealed: Sealed = { __sealed: 1, iv, ct };
  return sealed;
}

/** Decrypt a stored value. Plaintext (legacy or pre-PIN) passes through. */
export async function unseal<T = unknown>(value: unknown): Promise<T> {
  if (!isSealed(value)) return value as T;
  if (!dek) throw new VaultLockedError();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: value.iv as BufferSource },
    dek,
    value.ct as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
