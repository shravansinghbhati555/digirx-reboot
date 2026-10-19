import { DateTime } from 'luxon';
import { normalizeName, normalizePhone } from '../patients/patient.utils';

/**
 * Mobile number as typed into the portal → the national digits we key the
 * account on. Accepts "+91 98450 12345", "098450 12345", "9845012345".
 * Returns null when it does not look like a mobile number.
 */
export function normalizePortalPhone(
  raw: string,
  dialCode = '91',
): string | null {
  let digits = normalizePhone(String(raw ?? ''));
  if (dialCode && digits.length > 10 && digits.startsWith(dialCode)) {
    digits = digits.slice(dialCode.length);
  }
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^\d{6,15}$/.test(digits) ? digits : null;
}

/**
 * Every form the same mobile may have been stored in on a clinic record
 * (`Patient.normalizedPhones` keeps digits only, with or without the dial
 * code). Used to find candidate clinic records for a verified number.
 */
export function phoneVariants(phone: string, dialCode = '91'): string[] {
  const out = new Set<string>([phone]);
  if (dialCode) out.add(`${dialCode}${phone}`);
  out.add(`0${phone}`);
  return Array.from(out);
}

/**
 * Calendar date stored on a clinic `Patient.dob`, as YYYY-MM-DD.
 * Forms submit a date-only string, which lands at UTC midnight; a local
 * midnight is read in the clinic timezone instead.
 */
export function storedDobIso(
  stored: Date | undefined | null,
  timezone?: string,
): string | null {
  if (!stored) return null;
  const d = stored instanceof Date ? stored : new Date(stored);
  if (isNaN(d.getTime())) return null;
  const utc = DateTime.fromJSDate(d, { zone: 'utc' });
  if (!utc.isValid) return null;
  if (utc.hour === 0 && utc.minute === 0 && utc.second === 0) {
    return utc.toISODate();
  }
  if (timezone) return utc.setZone(timezone).toISODate();
  return utc.toISODate();
}

/** True when a stored date of birth falls on the given local calendar date. */
export function dobMatches(
  stored: Date | undefined | null,
  dob: string,
  timezone?: string,
): boolean {
  if (!stored || !dob) return false;
  const d = stored instanceof Date ? stored : new Date(stored);
  if (isNaN(d.getTime())) return false;
  // Clinic forms submit YYYY-MM-DD, which lands at midnight UTC; some
  // clients send a local midnight instead. Accept either reading.
  const utc = DateTime.fromJSDate(d, { zone: 'utc' }).toISODate();
  if (utc === dob) return true;
  if (timezone) {
    const local = DateTime.fromJSDate(d, { zone: 'utc' })
      .setZone(timezone)
      .toISODate();
    if (local === dob) return true;
  }
  return false;
}

export type LinkCandidate = {
  _id: { toHexString(): string } | string;
  clinicId: unknown;
  fullName?: string;
  normalizedName?: string;
};

/**
 * From the records at ONE clinic that match phone + DOB, pick the one that
 * is this person — or none.
 *
 * One match: it is theirs. Several (twins on a parent's number, duplicate
 * registrations): only a record whose name also matches is accepted, and
 * only if exactly one does. Anything else stays unlinked rather than risk
 * showing someone else's records.
 */
export function pickCandidate<T extends LinkCandidate>(
  matches: T[],
  accountName?: string,
): T | null {
  if (matches.length === 1) return matches[0];
  if (matches.length === 0 || !accountName) return null;
  const want = normalizeName(accountName);
  const named = matches.filter(
    (m) => (m.normalizedName ?? normalizeName(m.fullName ?? '')) === want,
  );
  return named.length === 1 ? named[0] : null;
}

/** Whole years between a YYYY-MM-DD birth date and `now`. */
export function ageOn(
  dob: string,
  now: DateTime = DateTime.now(),
): number | null {
  const d = DateTime.fromISO(dob);
  if (!d.isValid) return null;
  return Math.floor(now.diff(d, 'years').years);
}

/** Show only the last digits of a number, e.g. "••••••2345". */
export function maskPhone(phone: string): string {
  const tail = phone.slice(-4);
  return `${'•'.repeat(Math.max(0, phone.length - 4))}${tail}`;
}
