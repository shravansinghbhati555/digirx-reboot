import { DateTime } from 'luxon';
import type { QuietHours } from '../tenancy/clinic-settings.types';

export type QuietWindow = QuietHours;

/**
 * True when `now` falls inside the clinic's daily quiet window. The window
 * is HH:MM in the clinic's timezone and may cross midnight (start > end).
 *
 * Examples (tz Asia/Kolkata):
 *   - { start: '21:00', end: '08:00' } → 22:30 IST is quiet, 09:00 IST is not.
 *   - { start: '13:00', end: '14:00' } → 13:30 IST is quiet (lunch).
 *   - { start: null, end: null }       → never quiet.
 */
export function isWithinQuietHours(
  now: Date,
  tz: string,
  qh: QuietWindow,
): boolean {
  if (!qh.start || !qh.end) return false;
  const local = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(tz);
  const nowMin = local.hour * 60 + local.minute;
  const startMin = hhmmToMinutes(qh.start);
  const endMin = hhmmToMinutes(qh.end);
  if (startMin === endMin) return false; // zero-width window
  if (startMin < endMin) {
    // Same-day window: 13:00–14:00 → quiet between those minutes.
    return nowMin >= startMin && nowMin < endMin;
  }
  // Crosses midnight: 21:00–08:00 → quiet if `>= 21:00` OR `< 08:00`.
  return nowMin >= startMin || nowMin < endMin;
}

/**
 * Returns the next instant the quiet window ends. Used by the scheduler to
 * defer queued reminders to "right after the window ends" rather than
 * dropping them entirely. If `now` is not in the window, returns `now`.
 */
export function quietWindowEndsAt(
  now: Date,
  tz: string,
  qh: QuietWindow,
): Date {
  if (!qh.start || !qh.end || !isWithinQuietHours(now, tz, qh)) return now;
  const local = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(tz);
  const endMin = hhmmToMinutes(qh.end);
  // The "end" hour today; if we already crossed it (window wraps midnight),
  // the relevant end is tomorrow.
  const startMin = hhmmToMinutes(qh.start);
  let target = local.startOf('day').plus({ minutes: endMin });
  if (startMin >= endMin) {
    // Window wraps midnight. We're inside iff (now >= start) OR (now < end).
    // - If now >= start, the end fires tomorrow.
    // - If now < end, the end is later today.
    if (local.hour * 60 + local.minute >= startMin) {
      target = target.plus({ days: 1 });
    }
  }
  return target.toUTC().toJSDate();
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
