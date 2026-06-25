export type DevContext = {
  apiBaseUrl: string;
  clinicId: string;
  clinicName?: string;
  /** ISO 4217 code (INR, USD, …). Drives money formatting + bill defaults. */
  currency?: string;
  branchId?: string;
  branchName?: string;
  userId: string;
  accessToken?: string;
  email?: string;
  fullName?: string;
  /**
   * EFFECTIVE display timezone (IANA) for this user — their personal
   * `displayTimezone` if set, otherwise the clinic timezone. Drives all
   * time/date display and filtering in the app.
   */
  timezone?: string;
  /** The clinic's authoritative timezone (governs booking/scoping). */
  clinicTimezone?: string;
  /** This user's personal display-timezone preference (empty = use clinic). */
  displayTimezone?: string;
  /** Presigned URL of the user's profile photo (set by a Manager). */
  profileImageUrl?: string;
  permissions?: string[];
  /**
   * Clinic branding mirror, populated from /me. The prescription print
   * template reads it for the header name / logo / primary color so a
   * separate settings fetch isn't needed on every print.
   */
  branding?: {
    displayName?: string | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
  };
};

const KEY = 'digirx.devContext.v1';

export function loadContext(): DevContext {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DevContext;
      // Always override the API URL from the environment variable if present,
      // to avoid getting stuck on a cached value in localStorage.
      parsed.apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? parsed.apiBaseUrl ?? 'http://localhost:4000';
      return parsed;
    } catch {
      // ignore
    }
  }
  return {
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000',
    clinicId: '',
    userId: '',
  };
}

export function saveContext(ctx: DevContext) {
  localStorage.setItem(KEY, JSON.stringify(ctx));
}

export function clearContext() {
  const cur = loadContext();
  // Keep apiBaseUrl, drop everything else
  saveContext({ apiBaseUrl: cur.apiBaseUrl, clinicId: '', userId: '' });
}

export function isLoggedIn(ctx: DevContext): boolean {
  return Boolean(ctx.clinicId && (ctx.accessToken || ctx.userId));
}
