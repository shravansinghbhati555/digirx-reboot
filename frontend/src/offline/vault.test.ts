import { beforeEach, describe, expect, it } from 'vitest';
import {
  VaultLockedError,
  changeVaultPin,
  closeVault,
  createVault,
  destroyVault,
  hasVault,
  isSealed,
  isVaultOpen,
  mintRecoveryCode,
  normalizeRecoveryCode,
  openWithPin,
  resetPinWithRecoveryCode,
  seal,
  unseal,
} from './vault';

/**
 * The vault is the only thing between a lost tablet and the patient records
 * cached on it. These run real WebCrypto (Node's), not a mock.
 */

const PIN = '482913';
const PATIENT = { _id: 'p1', fullName: 'Asha Verma', phone: '9876543210' };

beforeEach(() => {
  destroyVault();
  localStorage.clear();
});

describe('before a PIN exists', () => {
  it('passes values through unsealed, so sign-in works before setup', async () => {
    expect(hasVault()).toBe(false);
    const out = await seal(PATIENT);
    expect(out).toEqual(PATIENT);
    expect(await unseal(out)).toEqual(PATIENT);
  });
});

describe('createVault', () => {
  it('opens the vault and seals values so they are unreadable at rest', async () => {
    await createVault(PIN);
    expect(isVaultOpen()).toBe(true);

    const sealed = await seal(PATIENT);
    expect(isSealed(sealed)).toBe(true);
    // Nothing identifying survives into the stored shape.
    expect(JSON.stringify(sealed)).not.toContain('Asha');
    expect(await unseal(sealed)).toEqual(PATIENT);
  });

  it('never writes the PIN or the raw key to storage', async () => {
    await createVault(PIN);
    const stored = localStorage.getItem('digirx.vault.v1') ?? '';
    expect(stored).not.toContain(PIN);
    expect(stored.length).toBeGreaterThan(0);
  });

  it('returns a well-formed unlock code', async () => {
    const { recoveryCode } = await createVault(PIN);
    expect(recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  });

  it('refuses to overwrite an existing vault', async () => {
    await createVault(PIN);
    await expect(createVault('111111')).rejects.toThrow();
  });
});

describe('locked', () => {
  it('refuses to read or write once the key leaves memory', async () => {
    await createVault(PIN);
    const sealed = await seal(PATIENT);
    closeVault();

    await expect(unseal(sealed)).rejects.toBeInstanceOf(VaultLockedError);
    // Must not silently fall back to plaintext once a vault exists.
    await expect(seal(PATIENT)).rejects.toBeInstanceOf(VaultLockedError);
  });

  it('still passes legacy plaintext through while locked', async () => {
    await createVault(PIN);
    closeVault();
    expect(await unseal(PATIENT)).toEqual(PATIENT);
  });
});

describe('openWithPin', () => {
  it('rejects a wrong PIN and accepts the right one', async () => {
    await createVault(PIN);
    const sealed = await seal(PATIENT);
    closeVault();

    expect(await openWithPin('000000')).toBe(false);
    expect(isVaultOpen()).toBe(false);

    expect(await openWithPin(PIN)).toBe(true);
    expect(await unseal(sealed)).toEqual(PATIENT);
  });
});

describe('resetPinWithRecoveryCode', () => {
  it('opens with the unlock code, sets a new PIN, and keeps existing data readable', async () => {
    const { recoveryCode } = await createVault(PIN);
    const sealed = await seal(PATIENT);
    closeVault();

    const out = await resetPinWithRecoveryCode(recoveryCode, '777777');
    expect(out).not.toBeNull();
    expect(await unseal(sealed)).toEqual(PATIENT);

    closeVault();
    expect(await openWithPin(PIN)).toBe(false);
    expect(await openWithPin('777777')).toBe(true);
  });

  it('rotates the code — the one read out over the phone stops working', async () => {
    const { recoveryCode } = await createVault(PIN);
    closeVault();
    const out = await resetPinWithRecoveryCode(recoveryCode, '777777');
    closeVault();

    expect(out!.recoveryCode).not.toBe(recoveryCode);
    expect(await resetPinWithRecoveryCode(recoveryCode, '888888')).toBeNull();
    expect(await resetPinWithRecoveryCode(out!.recoveryCode, '888888')).not.toBeNull();
  });

  it('accepts the code typed in lowercase with spaces', async () => {
    const { recoveryCode } = await createVault(PIN);
    closeVault();
    const sloppy = recoveryCode.toLowerCase().replace(/-/g, ' ');
    expect(await resetPinWithRecoveryCode(sloppy, '777777')).not.toBeNull();
  });

  it('rejects a wrong code without opening the vault', async () => {
    await createVault(PIN);
    closeVault();
    expect(await resetPinWithRecoveryCode(mintRecoveryCode(), '777777')).toBeNull();
    expect(isVaultOpen()).toBe(false);
  });
});

describe('changeVaultPin', () => {
  it('needs the current PIN', async () => {
    await createVault(PIN);
    expect(await changeVaultPin('000000', '555555')).toBe(false);
    expect(await changeVaultPin(PIN, '555555')).toBe(true);
    closeVault();
    expect(await openWithPin('555555')).toBe(true);
  });
});

describe('normalizeRecoveryCode', () => {
  it('uppercases and regroups whatever was typed', () => {
    expect(normalizeRecoveryCode('abcd efgh-jk23mn45')).toBe('ABCD-EFGH-JK23-MN45');
  });
});
