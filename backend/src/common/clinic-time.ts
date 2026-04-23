import { DateTime } from 'luxon';

/**
 * Compute the UTC bounds of a calendar day in the given IANA timezone.
 *
 * @param date       A YYYY-MM-DD string representing the local calendar day.
 * @param timezone   An IANA zone identifier (e.g., "Asia/Kolkata"). "UTC" is accepted.
 * @returns          { startUtc, endUtc } — the first and last instant of that
 *                   local day, as UTC `Date`s. Use with Mongo `$gte` / `$lte`.
 * @throws           Error if the date or timezone is not parseable.
 */
export function computeClinicDayRange(
  date: string,
  timezone: string,
): { startUtc: Date; endUtc: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date "${date}": expected YYYY-MM-DD`);
  }
  const day = DateTime.fromISO(date, { zone: timezone });
  if (!day.isValid) {
    throw new Error(
      `Invalid date "${date}" for timezone "${timezone}": ${day.invalidReason ?? 'unknown'}`,
    );
  }
  return {
    startUtc: day.startOf('day').toUTC().toJSDate(),
    endUtc: day.endOf('day').toUTC().toJSDate(),
  };
}
