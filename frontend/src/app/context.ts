export type DevContext = {
  apiBaseUrl: string;
  clinicId: string;
  clinicName?: string;
  branchId?: string;
  branchName?: string;
  userId: string;
  accessToken?: string;
  email?: string;
  fullName?: string;
  permissions?: string[];
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
