import { describe, expect, it } from 'vitest';
import {
  OFFLINE_GRACE_MS,
  OFFLINE_WARN_MS,
  evaluateOfflineSession,
} from './session';

/**
 * How long a device may keep working without reaching the server.
 *
 * The rule this encodes is asymmetric on purpose: wrongly locking a doctor
 * out mid-clinic is far more damaging than extending trust a few hours too
 * long, so every ambiguous case resolves towards "keep working" — except
 * where we have never verified the session at all.
 */

const NOW = 1_700_000_000_000;

describe('online', () => {
  it('is always fresh and writable', () => {
    const s = evaluateOfflineSession({ online: true, verifiedAt: null, now: NOW });
    expect(s.status).toBe('fresh');
    expect(s.canRead).toBe(true);
    expect(s.canWrite).toBe(true);
  });
});

describe('logged out', () => {
  /**
   * Regression: gating a logged-out device made signing in impossible,
   * because signing in is itself a write. A device with no session holds no
   * cached clinical data, so there is nothing to lock.
   */
  it('is never locked — there is no session to protect', () => {
    const s = evaluateOfflineSession({
      online: false,
      hasSession: false,
      verifiedAt: null,
      now: NOW,
    });
    expect(s.status).toBe('fresh');
    expect(s.canWrite).toBe(true);
  });
});

describe('offline with a session', () => {
  it('works normally well inside the window', () => {
    const s = evaluateOfflineSession({
      online: false,
      verifiedAt: NOW - 60_000,
      now: NOW,
    });
    expect(s.status).toBe('grace');
    expect(s.canRead).toBe(true);
    expect(s.canWrite).toBe(true);
  });

  it('warns as the window closes, but keeps working', () => {
    const s = evaluateOfflineSession({
      online: false,
      verifiedAt: NOW - (OFFLINE_GRACE_MS - OFFLINE_WARN_MS / 2),
      now: NOW,
    });
    expect(s.status).toBe('expiring');
    expect(s.canWrite).toBe(true);
  });

  it('locks once the window has passed', () => {
    const s = evaluateOfflineSession({
      online: false,
      verifiedAt: NOW - OFFLINE_GRACE_MS - 1,
      now: NOW,
    });
    expect(s.status).toBe('expired');
    expect(s.canRead).toBe(false);
    expect(s.canWrite).toBe(false);
    expect(s.msRemaining).toBe(0);
  });

  it('does not extend trust it never had', () => {
    const s = evaluateOfflineSession({ online: false, verifiedAt: null, now: NOW });
    expect(s.status).toBe('expired');
  });

  it('reports how much of the window is left', () => {
    const s = evaluateOfflineSession({
      online: false,
      verifiedAt: NOW - 1000,
      now: NOW,
    });
    expect(s.msRemaining).toBe(OFFLINE_GRACE_MS - 1000);
    expect(s.expiresAt).toBe(NOW - 1000 + OFFLINE_GRACE_MS);
  });
});

describe('clock drift', () => {
  /**
   * A dead CMOS battery or a manual clock change can put `verifiedAt` in the
   * future. Treat that as "just verified" rather than trusting a window that
   * appears enormous — and never lock someone out because their clock jumped.
   */
  it('does not lock out a device whose clock ran backwards', () => {
    const s = evaluateOfflineSession({
      online: false,
      verifiedAt: NOW + 5 * 60 * 60 * 1000,
      now: NOW,
    });
    expect(s.status).toBe('grace');
    expect(s.canWrite).toBe(true);
  });
});

describe('permission snapshot freshness', () => {
  it('flags a snapshot older than the window', () => {
    const s = evaluateOfflineSession({
      online: true,
      verifiedAt: NOW,
      permissionsAt: NOW - OFFLINE_GRACE_MS - 1,
      now: NOW,
    });
    expect(s.permissionsStale).toBe(true);
  });

  it('treats a never-fetched snapshot as stale', () => {
    const s = evaluateOfflineSession({ online: true, verifiedAt: NOW, now: NOW });
    expect(s.permissionsStale).toBe(true);
  });

  it('is advisory only — it does not block writing', () => {
    const s = evaluateOfflineSession({
      online: false,
      verifiedAt: NOW - 1000,
      permissionsAt: NOW - OFFLINE_GRACE_MS - 1,
      now: NOW,
    });
    expect(s.permissionsStale).toBe(true);
    expect(s.canWrite).toBe(true);
  });
});
