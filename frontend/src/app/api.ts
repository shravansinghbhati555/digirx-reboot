import type { DevContext } from './context';
import { saveContext } from './context';

export async function apiGet<T>(ctx: DevContext, path: string): Promise<T> {
  return await apiFetch<T>(ctx, path, { method: 'GET' });
}

export async function apiPost<T>(ctx: DevContext, path: string, body: unknown): Promise<T> {
  return await apiFetch<T>(ctx, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiPut<T>(ctx: DevContext, path: string, body: unknown): Promise<T> {
  return await apiFetch<T>(ctx, path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiPatch<T>(ctx: DevContext, path: string, body: unknown = {}): Promise<T> {
  return await apiFetch<T>(ctx, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiDelete<T>(ctx: DevContext, path: string): Promise<T> {
  return await apiFetch<T>(ctx, path, { method: 'DELETE' });
}

async function apiFetch<T>(
  ctx: DevContext,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
  attempt: number = 0,
): Promise<T> {
  const res = await fetch(`${ctx.apiBaseUrl}${path}`, {
    method: init.method,
    credentials: 'include',
    headers: { ...buildHeaders(ctx), ...(init.headers ?? {}) },
    body: init.body,
  });

  if (res.status === 401 && attempt === 0) {
    const next = await refreshAccessToken(ctx);
    if (next) {
      ctx.accessToken = next;
      saveContext(ctx);
      return await apiFetch<T>(ctx, path, init, 1);
    }
  }

  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // fall through
    }
    const detail =
      parsed && typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? Array.isArray((parsed as { message: unknown }).message)
          ? ((parsed as { message: string[] }).message.join(', '))
          : String((parsed as { message: unknown }).message)
        : (text || `HTTP ${res.status}`);
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) return undefined as T;
  return (await res.json()) as T;
}

async function refreshAccessToken(ctx: DevContext): Promise<string | null> {
  const res = await fetch(`${ctx.apiBaseUrl}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...buildHeaders(ctx), 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { accessToken?: string };
  return data.accessToken ?? null;
}

function buildHeaders(ctx: DevContext) {
  const headers: Record<string, string> = {};
  if (ctx.accessToken) headers['Authorization'] = `Bearer ${ctx.accessToken}`;
  if (ctx.clinicId) headers['x-clinic-id'] = ctx.clinicId;
  if (ctx.branchId) headers['x-branch-id'] = ctx.branchId;
  if (!ctx.accessToken && ctx.userId) headers['x-user-id'] = ctx.userId; // dev fallback
  return headers;
}
