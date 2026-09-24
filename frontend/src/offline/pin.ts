/**
 * Local device PIN.
 *
 * ## What this is, and what it is NOT
 *
 * This is a **UI gate**, not encryption at rest. Cached clinical data lives in
 * localStorage and (from B1) IndexedDB, both readable by anyone who can open
 * DevTools on an unlocked OS account. A PIN prompt does not change that.
 *
 * It is still worth having: it stops the realistic case — a tablet left on a
 * reception desk, picked up by the next person in the room — which is the
 * threat a clinic actually faces. It does not stop a determined attacker with
 * physical possession.
 *
 * Real at-rest protection needs one of:
 *   - OS/disk encryption on the device (the practical answer, and required
 *     from Phase 2 when a clinic box holds the whole database), or
 *   - encrypting the cached store under a PIN-derived key, which B1 should do
 *     when it defines the IndexedDB schema. `deriveKey` below exists so that
 *     work has a starting point rather than a rewrite.
 *
 * Do not describe this feature to a clinic as "your data is encrypted".
 */

const PIN_KEY = 'digirx.devicePin.v1';
const LOCK_KEY = 'digirx.deviceLock.v1';

/**
 * OWASP's PBKDF2-HMAC-SHA256 guidance. A PIN has very little entropy, so the
 * KDF is the only thing standing between a leaked hash and a trivial offline
 * brute force. Costs roughly a second on a low-end tablet, which is fine for
 * an unlock that happens once per session.
 */
const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

/** Minimum length. Four digits is 10k combinations — not enough even with a
 *  slow KDF, so we require six. */
export const MIN_PIN_LENGTH = 6;
export const MAX_PIN_LENGTH = 64;

type StoredPin = {
  saltB64: string;
  hashB64: string;
  iterations: number;
  createdAt: number;
};

type LockState = {
  /** Consecutive failed attempts since the last success. */
  failures: number;
  /** Epoch ms until which unlocking is refused. */
  blockedUntil: number;
  /** Epoch ms of the last successful unlock — drives the idle timer. */
  unlockedAt: number | null;
};

const DEFAULT_LOCK: LockState = { failures: 0, blockedUntil: 0, unlockedAt: null };

function idleLockMs(): number {
  const raw = (import.meta.env as Record<string, string | undefined>)
    .VITE_OFFLINE_IDLE_LOCK_MINUTES;
  const parsed = raw ? Number(raw) : NaN;
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  return minutes * 60 * 1000;
}

// ---------------------------------------------------------------- storage

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...(JSON.parse(raw) as T) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function readLock(): LockState {
  return readJson<LockState>(LOCK_KEY, DEFAULT_LOCK);
}

function writeLock(next: LockState): void {
  writeJson(LOCK_KEY, next);
}

// ---------------------------------------------------------------- crypto

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/**
 * Derive raw key bits from a PIN. Exposed so B1 can encrypt the cached store
 * under the same secret instead of inventing a second one.
 */
export async function deriveKey(
  pin: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<ArrayBuffer> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    material,
    KEY_BITS,
  );
}

/** Constant-time-ish comparison. Avoids leaking a prefix match via timing. */
function equalB64(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- public

export function hasPin(): boolean {
  try {
    return Boolean(localStorage.getItem(PIN_KEY));
  } catch {
    return false;
  }
}

export class PinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinError';
    Object.setPrototypeOf(this, PinError.prototype);
  }
}

export async function setPin(pin: string): Promise<void> {
  if (pin.length < MIN_PIN_LENGTH) {
    throw new PinError(`PIN must be at least ${MIN_PIN_LENGTH} characters.`);
  }
  if (pin.length > MAX_PIN_LENGTH) {
    throw new PinError(`PIN must be at most ${MAX_PIN_LENGTH} characters.`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await deriveKey(pin, salt);
  const stored: StoredPin = {
    saltB64: toB64(salt.buffer as ArrayBuffer),
    hashB64: toB64(bits),
    iterations: PBKDF2_ITERATIONS,
    createdAt: Date.now(),
  };
  writeJson(PIN_KEY, stored);
  // Setting a PIN counts as proving you hold it.
  writeLock({ failures: 0, blockedUntil: 0, unlockedAt: Date.now() });
}

/**
 * Remove the PIN. Requires the current one — otherwise anybody holding the
 * device could simply turn the lock off.
 */
export async function clearPin(currentPin: string): Promise<void> {
  const ok = await verifyPin(currentPin);
  if (!ok.ok) throw new PinError(ok.reason);
  try {
    localStorage.removeItem(PIN_KEY);
  } catch {
    // ignore
  }
  writeLock(DEFAULT_LOCK);
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string; blockedForMs?: number };

/**
 * Backoff after repeated failures. Deliberately **not** a data wipe: the
 * device may be holding a morning of unsynced consultations, and destroying
 * them because someone fat-fingered a PIN would be a far worse outcome than a
 * delay. Caps out rather than escalating forever.
 */
function blockDurationMs(failures: number): number {
  if (failures < 5) return 0;
  const step = Math.min(failures - 4, 6); // 30s, 1m, 2m, 4m, 8m, 15m
  return Math.min(30_000 * 2 ** (step - 1), 15 * 60_000);
}

export async function verifyPin(pin: string, now: number = Date.now()): Promise<VerifyResult> {
  const stored = readJson<StoredPin | null>(PIN_KEY, null as unknown as StoredPin);
  if (!stored?.hashB64) return { ok: false, reason: 'No PIN is set on this device.' };

  const lock = readLock();
  if (lock.blockedUntil > now) {
    return {
      ok: false,
      reason: 'Too many attempts. Try again shortly.',
      blockedForMs: lock.blockedUntil - now,
    };
  }

  const bits = await deriveKey(pin, fromB64(stored.saltB64), stored.iterations);
  if (equalB64(toB64(bits), stored.hashB64)) {
    writeLock({ failures: 0, blockedUntil: 0, unlockedAt: now });
    return { ok: true };
  }

  const failures = lock.failures + 1;
  const blockMs = blockDurationMs(failures);
  writeLock({ failures, blockedUntil: blockMs ? now + blockMs : 0, unlockedAt: null });
  return {
    ok: false,
    reason: blockMs
      ? 'Incorrect PIN. Too many attempts — try again shortly.'
      : 'Incorrect PIN.',
    blockedForMs: blockMs || undefined,
  };
}

/** True when the UI should be showing the unlock prompt. */
export function isLocked(now: number = Date.now()): boolean {
  if (!hasPin()) return false;
  const { unlockedAt } = readLock();
  if (unlockedAt == null) return true;
  return now - unlockedAt >= idleLockMs();
}

/** Lock immediately — manual "Lock device" action, or on tab hide. */
export function lock(): void {
  writeLock({ ...readLock(), unlockedAt: null });
}

/** Push the idle timer out. Called on real user activity, throttled. */
export function touchActivity(now: number = Date.now()): void {
  const lockState = readLock();
  if (lockState.unlockedAt == null) return; // already locked; don't revive it
  if (now - lockState.unlockedAt < 30_000) return; // throttle writes
  writeLock({ ...lockState, unlockedAt: now });
}

/** Milliseconds until the idle lock engages, or null when no PIN is set. */
export function msUntilIdleLock(now: number = Date.now()): number | null {
  if (!hasPin()) return null;
  const { unlockedAt } = readLock();
  if (unlockedAt == null) return 0;
  return Math.max(0, unlockedAt + idleLockMs() - now);
}
