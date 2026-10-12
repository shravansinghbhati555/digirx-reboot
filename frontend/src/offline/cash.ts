/**
 * Device-side expected cash — the pre-sync half of ticket C6.
 *
 * The server's figure only covers payments that have reached it. During an
 * outage the drawer also holds cash recorded on this device and still sitting
 * in the write queue, so the collector's expected figure is:
 *
 *   last server figure (cached)  +  queued CASH payments for that day
 *
 * The two never overlap: a queued payment is, by definition, one the server
 * has not counted. Cash taken on *other* tablets during the same outage is
 * invisible here until they sync — which is why the approver signs off
 * against the server's post-sync figure, not this one.
 */
import { listPending } from './queue';

const PAYMENT_PATH = /^\/bills\/[^/]+\/payments$/;

/** `YYYY-MM-DD` for an instant, in the given timezone. */
export function localDate(at: Date | number | string, tz?: string): string {
  const d = new Date(at);
  try {
    return new Intl.DateTimeFormat('en-CA', tz ? { timeZone: tz } : undefined).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(d);
  }
}

export type QueuedCash = { amount: number; count: number };

/** Cash payments on this device, not yet synced, falling on `date`. */
export async function queuedCashFor(
  clinicId: string,
  date: string,
  tz?: string,
): Promise<QueuedCash> {
  const pending = await listPending(clinicId);
  let paise = 0;
  let count = 0;
  for (const e of pending) {
    if (e.method !== 'POST' || !PAYMENT_PATH.test(e.path)) continue;
    const body = (e.body ?? {}) as { method?: string; amount?: number; paidAt?: string };
    if (body.method !== 'CASH' || typeof body.amount !== 'number') continue;
    // `paidAt` is stamped when the payment is queued; entries queued before
    // that existed fall back to when they were queued, which is the same moment.
    if (localDate(body.paidAt ?? e.createdAt, tz) !== date) continue;
    paise += Math.round(body.amount * 100);
    count++;
  }
  return { amount: paise / 100, count };
}
