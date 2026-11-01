export const DEMO = import.meta.env.MODE === 'demo' || import.meta.env.VITE_DEMO === '1';
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const TOKEN_KEY = 'crm_token';
export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t: string | null) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* приватный режим */ }
};

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  if (DEMO) {
    const { mockApi } = await import('./mock');
    return mockApi(method, path, opts.body) as Promise<T>;
  }
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    setToken(null);
    location.hash = '#/login';
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'error');
  return data as T;
}

export const qs = (o: Record<string, string | number | undefined | null | boolean>) =>
  '?' + Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
