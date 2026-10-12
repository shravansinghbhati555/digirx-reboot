/**
 * Device setup and recovery flows — the orchestration around `pin.ts` and
 * `vault.ts` that the lock screens call. Keeps the order of operations in one
 * place, because getting it wrong loses either data or the unlock code.
 */
import { deleteMeta, getMeta, setMeta, sealExistingRows, wipeOfflineStores } from './db';
import { getDevice } from './device';
import { recoverWithCode, resetLockState, setPin, type RecoveryResult } from './pin';
import { counts } from './queue';
import { destroyVault, isVaultOpen } from './vault';

/** An unlock code minted on this device but not yet confirmed by the server. */
const PENDING_RECOVERY = 'vault:pendingRecovery';

type PendingRecovery = { recoveryCode: string; label?: string };

async function queueRecoveryUpload(recoveryCode: string, label?: string): Promise<void> {
  // Sealed like every other meta value, so the code is not readable at rest
  // while it waits — and it is deleted the moment the server confirms it.
  await setMeta<PendingRecovery>(PENDING_RECOVERY, { recoveryCode, label });
}

/**
 * First-time setup on this device. Order matters:
 *   1. create the vault (mints the key + unlock code, opens it)
 *   2. encrypt anything cached in plaintext since sign-in
 *   3. queue the unlock code for upload
 * Returns the unlock code for the one-time display.
 */
export async function setupDevicePin(pin: string, label?: string): Promise<string> {
  settingUp = true;
  try {
    const { recoveryCode } = await setPin(pin);
    await sealExistingRows();
    await queueRecoveryUpload(recoveryCode, label ?? getDevice().label);
    return recoveryCode;
  } finally {
    settingUp = false;
  }
}

let settingUp = false;

/**
 * True while setup is re-encrypting existing rows. The vault is already open
 * by then, so the background sync checks this too — a replay racing the
 * rewrite could have a just-confirmed entry put back as pending.
 */
export function isDeviceSetupInProgress(): boolean {
  return settingUp;
}

/**
 * Forgotten PIN. On success the old code has been rotated: the new one is
 * returned for display and queued for upload, replacing what the admin sees.
 */
export async function recoverDevice(code: string, newPin: string): Promise<RecoveryResult> {
  const result = await recoverWithCode(code, newPin);
  if (result.ok) await queueRecoveryUpload(result.recoveryCode, getDevice().label);
  return result;
}

type Put = (path: string, body: unknown) => Promise<unknown>;

/**
 * Send a waiting unlock code to the server. Called from the background sync;
 * a failure just leaves it queued for the next run.
 */
export async function uploadPendingRecovery(put: Put): Promise<boolean> {
  if (!isVaultOpen()) return false;
  const pending = await getMeta<PendingRecovery>(PENDING_RECOVERY);
  if (!pending) return false;
  try {
    await put('/offline/devices/me/recovery-code', {
      recoveryCode: pending.recoveryCode,
      ...(pending.label ? { label: pending.label } : {}),
    });
    await deleteMeta(PENDING_RECOVERY);
    return true;
  } catch {
    return false;
  }
}

/** True while an unlock code is waiting to reach the server. */
export async function hasPendingRecoveryUpload(): Promise<boolean> {
  try {
    return (await getMeta(PENDING_RECOVERY)) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Whether a full reset is safe: nothing on this device is waiting to sync.
 * Reads queue status only, so it works while locked.
 */
export async function canResetDevice(): Promise<boolean> {
  try {
    const c = await counts();
    return c.pending === 0 && c.failed === 0;
  } catch {
    return false;
  }
}

/**
 * Last resort when both the PIN and the unlock code are lost. Refuses while
 * anything is unsynced — that work exists nowhere else, and is only
 * recoverable with the unlock code from Settings → Devices.
 */
export async function resetDevice(): Promise<void> {
  if (!(await canResetDevice())) {
    throw new Error(
      'This device has work that has not synced yet. Ask your clinic admin for the unlock code instead.',
    );
  }
  await wipeOfflineStores();
  destroyVault();
  resetLockState();
}
