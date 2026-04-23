export type DevContext = {
  apiBaseUrl: string;
  clinicId: string;
  branchId?: string;
  userId: string;
  accessToken?: string;
};

const KEY = 'digirx.devContext.v1';

export function loadContext(): DevContext {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as DevContext;
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

