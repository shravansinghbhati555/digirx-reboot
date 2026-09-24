/**
 * Stable per-device identity.
 *
 * Two jobs:
 *  1. Attribution — a write queued offline needs to say which device produced
 *     it, so the audit trail survives the gap between "entered" and "synced".
 *  2. Leases — number leases (C1/C2) are handed to a *device*, not a user. Two
 *     tablets in the same clinic must never draw from the same MRN block.
 *
 * Deliberately stored under its own key, NOT in `DevContext`: `clearContext()`
 * wipes the session on logout, and a device that forgot its identity would
 * orphan its outstanding leases and break attribution for anything still
 * sitting in the queue. The identity outlives the session.
 */

const DEVICE_KEY = 'digirx.device.v1';

export type DeviceIdentity = {
  /** Opaque UUID. Never derived from hardware — that is neither available to
   *  the browser nor something we want to fingerprint. */
  id: string;
  /** Optional human name, e.g. "Front desk tablet". Shown when managing
   *  leases or reading an audit row. */
  label?: string;
  /** Epoch ms this device first identified itself. */
  registeredAt: number;
};

function readRaw(): DeviceIdentity | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceIdentity;
    return typeof parsed?.id === 'string' && parsed.id ? parsed : null;
  } catch {
    // Private mode, cleared storage, corrupt JSON — mint a fresh identity
    // rather than throwing on app boot.
    return null;
  }
}

function write(identity: DeviceIdentity): void {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(identity));
  } catch {
    // Storage unavailable. The in-memory id still works for this session;
    // the device simply re-identifies next load.
  }
}

function mintId(): string {
  // `crypto.randomUUID` needs a secure context — which is exactly what we
  // already require for service workers and getUserMedia. Fall back anyway so
  // a plain-HTTP dev origin does not hard-fail.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let cached: DeviceIdentity | null = null;

/** The device identity, minting and persisting one on first call. */
export function getDevice(): DeviceIdentity {
  if (cached) return cached;
  const existing = readRaw();
  if (existing) {
    cached = existing;
    return cached;
  }
  const fresh: DeviceIdentity = { id: mintId(), registeredAt: Date.now() };
  write(fresh);
  cached = fresh;
  return fresh;
}

export function getDeviceId(): string {
  return getDevice().id;
}

export function setDeviceLabel(label: string): DeviceIdentity {
  const next = { ...getDevice(), label: label.trim() || undefined };
  write(next);
  cached = next;
  return next;
}

/**
 * Forget this device. Only for an explicit "unregister this device" action —
 * never on logout. Any outstanding number leases are abandoned, and anything
 * still in the write queue loses its origin, so the caller must confirm the
 * queue is empty first.
 */
export function forgetDevice(): void {
  try {
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    // ignore
  }
  cached = null;
}
