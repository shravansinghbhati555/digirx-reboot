/**
 * Device PIN — ticket A4.
 *
 * One PIN per tablet, required on every device. It does two jobs:
 *
 *   1. **Unlocks the encrypted offline store** (P6). The PIN is never stored;
 *      it unwraps the device data key in `vault.ts`, and a wrong PIN simply
 *      fails to. See that file for the key layout and the admin unlock code.
 *   2. **Gates the UI.** Every fresh launch needs it (the key does not survive
 *      a reload), and so does a device left idle for `VITE_OFFLINE_IDLE_LOCK_MINUTES`
 *      (default 15). The idle lock is a UI gate only — the key stays in memory
 *      so the background sync keeps working while the screen is locked.
 *
 * This file owns the lockout/backoff and idle-timer state; `vault.ts` owns the
 * cryptography.
 */
import {
  changeVaultPin,
  closeVault,
  createVault,
  hasVault,
  isVaultOpen,
  openWithPin,
  resetPinWithRecoveryCode,
} from './vault';

const LOCK_KEY = 'digirx.deviceLock.v1';

/**
 * Digits only, so tablets show a number pad. Six is the floor: four digits is
 * 10k combinations — not enough even behind a slow KDF.
 */
export const MIN_PIN_LENGTH = 6;
export const MAX_PIN_LENGTH = 12;

type LockState = {
  /** Consecutive failed attempts since the last success. */
  failures: number;
  /** Epoch ms until which unlocking is refused. */
  blockedUntil: number;
  /** Epoch ms of the last unlock or activity — drives the idle timer. */
  unlockedAt: number | null;
};

const DEFAULT_LOCK: LockState = { failures: 0, blockedUntil: 0, unlockedAt: null };

export function idleLockMs(): number {
  const raw = (import.meta.env as Record<string, string | undefined>)
    .VITE_OFFLINE_IDLE_LOCK_MINUTES;
  const parsed = raw ? Number(raw) : NaN;
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
  return minutes * 60 * 1000;
}

function readLock(): LockState {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    return raw ? { ...DEFAULT_LOCK, ...(JSON.parse(raw) as LockState) } : DEFAULT_LOCK;
  } catch {
    return DEFAULT_LOCK;
  }
}

function writeLock(next: LockState): void {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export class PinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinError';
    Object.setPrototypeOf(this, PinError.prototype);
  }
}

/** Throws a `PinError` describing what is wrong with a proposed PIN. */
export function validatePin(pin: string): void {
  if (!/^\d+$/.test(pin)) throw new PinError('PIN must contain digits only.');
  if (pin.length < MIN_PIN_LENGTH) {
    throw new PinError(`PIN must be at least ${MIN_PIN_LENGTH} digits.`);
  }
  if (pin.length > MAX_PIN_LENGTH) {
    throw new PinError(`PIN must be at most ${MAX_PIN_LENGTH} digits.`);
  }
}

export function hasPin(): boolean {
  return hasVault();
}

/**
 * First-time setup. Returns the clinic admin unlock code, which the caller
 * must show once and queue for upload.
 */
export async function setPin(pin: string): Promise<{ recoveryCode: string }> {
  validatePin(pin);
  if (hasVault()) throw new PinError('A PIN is already set on this device.');
  const out = await createVault(pin);
  writeLock({ failures: 0, blockedUntil: 0, unlockedAt: Date.now() });
  return out;
}

export async function changePin(currentPin: string, newPin: string): Promise<void> {
  validatePin(newPin);
  const ok = await changeVaultPin(currentPin, newPin);
  if (!ok) throw new PinError('Current PIN is incorrect.');
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string; blockedForMs?: number };

/**
 * Backoff after repeated failures. Deliberately **not** a data wipe: the
 * device may be holding days of unsynced consultations, and destroying them
 * because someone fat-fingered a PIN would be far worse than a delay. Caps
 * out rather than escalating forever.
 */
function blockDurationMs(failures: number): number {
  if (failures < 5) return 0;
  const step = Math.min(failures - 4, 6); // 30s, 1m, 2m, 4m, 8m, 15m
  return Math.min(30_000 * 2 ** (step - 1), 15 * 60_000);
}

function blocked(now: number): Failure | null {
  const lock = readLock();
  if (lock.blockedUntil > now) {
    return {
      ok: false,
      reason: 'Too many attempts. Try again shortly.',
      blockedForMs: lock.blockedUntil - now,
    };
  }
  return null;
}

type Failure = { ok: false; reason: string; blockedForMs?: number };

function recordFailure(now: number, message: string): Failure {
  const lock = readLock();
  const failures = lock.failures + 1;
  const blockMs = blockDurationMs(failures);
  writeLock({ failures, blockedUntil: blockMs ? now + blockMs : 0, unlockedAt: null });
  return {
    ok: false,
    reason: blockMs ? `${message} Too many attempts — try again shortly.` : message,
    blockedForMs: blockMs || undefined,
  };
}

export async function verifyPin(pin: string, now: number = Date.now()): Promise<VerifyResult> {
  if (!hasVault()) return { ok: false, reason: 'No PIN is set on this device.' };
  const refused = blocked(now);
  if (refused) return refused;

  if (await openWithPin(pin)) {
    writeLock({ failures: 0, blockedUntil: 0, unlockedAt: now });
    return { ok: true };
  }
  return recordFailure(now, 'Incorrect PIN.');
}

export type RecoveryResult =
  | { ok: true; recoveryCode: string }
  | { ok: false; reason: string; blockedForMs?: number };

/**
 * Forgotten PIN: the clinic admin reads out the unlock code, the user picks a
 * new PIN. Shares the PIN's backoff — the code is the stronger secret, but
 * there is no reason to let it be guessed faster.
 */
export async function recoverWithCode(
  code: string,
  newPin: string,
  now: number = Date.now(),
): Promise<RecoveryResult> {
  validatePin(newPin);
  const refused = blocked(now);
  if (refused) return refused;
  const out = await resetPinWithRecoveryCode(code, newPin);
  if (out) {
    writeLock({ failures: 0, blockedUntil: 0, unlockedAt: now });
    return { ok: true, recoveryCode: out.recoveryCode };
  }
  return recordFailure(now, 'That unlock code is not right for this device.');
}

/** True when the UI should be showing the unlock prompt. */
export function isLocked(now: number = Date.now()): boolean {
  if (!hasVault()) return false;
  // A fresh launch has no key in memory: always locked, whatever the timer says.
  if (!isVaultOpen()) return true;
  const { unlockedAt } = readLock();
  if (unlockedAt == null) return true;
  return now - unlockedAt >= idleLockMs();
}

/** Lock the screen now. Keeps the key so background sync continues. */
export function lock(): void {
  writeLock({ ...readLock(), unlockedAt: null });
}

/** Lock and drop the key — used on sign-out. */
export function lockHard(): void {
  lock();
  closeVault();
}

/** Push the idle timer out. Called on real user activity, throttled. */
export function touchActivity(now: number = Date.now()): void {
  const lockState = readLock();
  if (lockState.unlockedAt == null) return; // already locked; don't revive it
  if (now - lockState.unlockedAt < 30_000) return; // throttle writes
  if (now - lockState.unlockedAt >= idleLockMs()) return; // idled out; needs the PIN
  writeLock({ ...lockState, unlockedAt: now });
}

/** Milliseconds until the idle lock engages, or null when no PIN is set. */
export function msUntilIdleLock(now: number = Date.now()): number | null {
  if (!hasVault()) return null;
  const { unlockedAt } = readLock();
  if (unlockedAt == null || !isVaultOpen()) return 0;
  return Math.max(0, unlockedAt + idleLockMs() - now);
}

/** Forget lockout/idle state. Only for a device reset. */
export function resetLockState(): void {
  try {
    localStorage.removeItem(LOCK_KEY);
  } catch {
    // ignore
  }
}
