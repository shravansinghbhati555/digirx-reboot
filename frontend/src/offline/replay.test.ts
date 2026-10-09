import { describe, expect, it } from 'vitest';
import { classifyResponse } from './replay';

/**
 * The replay decision table.
 *
 * Every queued write ends up here, and the verdict decides whether the work
 * is kept, retried, or declared dead. Getting `already-applied` wrong
 * duplicates a patient record; getting `permanent` wrong either spins
 * forever or throws away a consultation. This is the highest-consequence
 * logic in the offline layer, which is why it is a pure function.
 */
describe('classifyResponse', () => {
  describe('success', () => {
    it.each([200, 201, 204, 299])('treats %i as applied', (status) => {
      expect(classifyResponse(status, null)).toEqual({ kind: 'ok' });
    });
  });

  describe('already applied', () => {
    it('recognises its own replayed create via CLIENT_ID_EXISTS', () => {
      // This is the whole point of client-minted ids: a 409 carrying this
      // code means a previous attempt landed before the connection dropped.
      expect(
        classifyResponse(409, { code: 'CLIENT_ID_EXISTS', _id: 'abc' }),
      ).toEqual({ kind: 'already-applied' });
    });

    it('does NOT treat a plain 409 as already applied', () => {
      // A real conflict — a double-booked slot, a duplicate queue token —
      // must not be silently swallowed as success.
      const out = classifyResponse(409, { message: 'Slot already booked' });
      expect(out.kind).toBe('permanent');
    });

    it('does not accept the code on a non-409 status', () => {
      expect(classifyResponse(400, { code: 'CLIENT_ID_EXISTS' }).kind).toBe('permanent');
    });
  });

  describe('transient failures are retried', () => {
    it.each([408, 429, 500, 502, 503, 504])('retries %i', (status) => {
      expect(classifyResponse(status, null).kind).toBe('retry');
    });

    it('retries auth failures rather than discarding the work', () => {
      // The session died while the write sat in the queue. The work itself
      // is still valid, so it waits for a sign-in instead of being binned.
      for (const status of [401, 403]) {
        const out = classifyResponse(status, null);
        expect(out.kind).toBe('retry');
        if (out.kind === 'retry') {
          expect(out.reason).toMatch(/sign-in/i);
        }
      }
    });
  });

  describe('permanent failures halt the queue', () => {
    it.each([400, 404, 422])('gives up on %i', (status) => {
      expect(classifyResponse(status, null).kind).toBe('permanent');
    });

    it('surfaces the server message so the failure screen can explain it', () => {
      const out = classifyResponse(400, { message: 'phones must be 6 to 15 digits' });
      expect(out.kind).toBe('permanent');
      if (out.kind === 'permanent') {
        expect(out.reason).toBe('phones must be 6 to 15 digits');
      }
    });

    it('falls back to the status when there is no message', () => {
      const out = classifyResponse(404, null);
      if (out.kind === 'permanent') expect(out.reason).toBe('HTTP 404');
    });

    it('survives a non-object body', () => {
      expect(() => classifyResponse(400, 'plain text')).not.toThrow();
      expect(() => classifyResponse(400, undefined)).not.toThrow();
    });
  });

  describe('status carried through', () => {
    it('reports the status on retryable and permanent verdicts', () => {
      const retry = classifyResponse(503, null);
      const perm = classifyResponse(400, null);
      if (retry.kind === 'retry') expect(retry.status).toBe(503);
      if (perm.kind === 'permanent') expect(perm.status).toBe(400);
    });
  });
});
