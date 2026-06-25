/**
 * Country-aware phone helpers driven by the clinic's timezone.
 *
 * Instead of hardcoding dial codes, we derive them from maintained data:
 *   timezone  --countries-and-timezones-->  ISO country (e.g. "GB")
 *   ISO country  --libphonenumber-js-->  dial code (+44) + real validation
 *
 * So when the clinic changes its location/timezone in Settings, the phone
 * prefix and the validation rules follow automatically.
 */
import { getCountryForTimezone } from 'countries-and-timezones';
import { getCountryCallingCode, isValidPhoneNumber, type CountryCode } from 'libphonenumber-js';
import { phoneDigits } from './validators';

// Falls back to India (the product's default locale) when the timezone is
// missing or can't be resolved to a country.
const DEFAULT_COUNTRY: CountryCode = 'IN';

/** ISO 3166-1 alpha-2 country for an IANA timezone (e.g. Europe/London → GB). */
export function countryForTimezone(tz?: string): CountryCode {
  if (!tz) return DEFAULT_COUNTRY;
  try {
    const c = getCountryForTimezone(tz);
    return (c?.id as CountryCode) || DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
}

/** International dial-code prefix for the clinic's timezone (e.g. "+44"). */
export function dialCodeForTimezone(tz?: string): string {
  try {
    return '+' + getCountryCallingCode(countryForTimezone(tz));
  } catch {
    return '+91';
  }
}

/** True when `raw` is a valid phone number for the clinic's country. */
export function isValidPhoneForTimezone(raw: string, tz?: string): boolean {
  const digits = phoneDigits(raw);
  if (!digits) return false;
  try {
    return isValidPhoneNumber(digits, countryForTimezone(tz));
  } catch {
    return false;
  }
}

/**
 * National digit string when valid for the clinic's country, else null.
 * We store the national digits (the dial code is contextual to the clinic),
 * keeping the storage shape consistent for duplicate detection.
 */
export function normalizePhoneForTimezone(raw: string, tz?: string): string | null {
  return isValidPhoneForTimezone(raw, tz) ? phoneDigits(raw) : null;
}
