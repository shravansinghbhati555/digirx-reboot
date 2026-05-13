/**
 * Single source of truth for the format checks used by every form in the
 * app — patient registration, user creation, branch settings, login,
 * forgot-password. Keep the rules here so a tightening (e.g. allowing
 * landlines) lands in one place instead of being scattered across
 * screens with subtly different regexes.
 */

/**
 * Loose-but-useful email check. Class-validator's @IsEmail is the source
 * of truth server-side; this is just enough to fail-fast on obvious typos
 * before round-tripping the request. RFC 5322 grammar is intentionally
 * out of scope — anything that looks like `local@host.tld` and is under
 * the 254-char limit clears the bar.
 */
export function isValidEmail(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Strips a phone string down to digits. Spaces, dashes, parentheses, and
 * a leading `+` are stripped; everything else is preserved so the caller
 * can still see what the user typed in error messages.
 */
export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Validates an Indian mobile number. Accepts:
 *   - 10 digits starting with 6/7/8/9 (e.g. "9876543210")
 *   - 12 digits starting with "91" + a valid mobile (e.g. "919876543210")
 *   - Display spacing / dashes / leading "+" — all stripped before checking.
 *
 * Returns the canonical 10-digit form when valid, `null` otherwise. The
 * canonical form keeps the storage shape consistent so duplicate-detection
 * on `Patient.phones` works regardless of how the operator typed it.
 */
export function normalizeIndianMobile(raw: string): string | null {
  const digits = phoneDigits(raw);
  if (digits.length === 10 && /^[6-9]/.test(digits)) return digits;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
    return digits.slice(2);
  }
  return null;
}

export function isValidIndianMobile(raw: string): boolean {
  return normalizeIndianMobile(raw) !== null;
}
