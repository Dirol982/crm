import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, DEMO } from './api';
import { isoDay, setCurrency } from './format';

export interface Me {
  user: { id: string; email: string; name: string; email_digest?: boolean };
  tenant: { id: string; name: string; plan: string; currency: string; timezone: string; deal_stages: string[] };
  role: 'owner' | 'admin' | 'manager' | 'viewer';
  workspaces: { id: string; name: string; role: string }[];
  billing?: { status: 'unlimited' | 'trial' | 'active' | 'grace' | 'frozen'; plan: string | null; days_left: number | null; trial_ends_at: string | null; paid_until: string | null };
  is_superadmin?: boolean;
}
export interface Site { id: string; name: string; domain: string | null; post_url_template?: string | null; public_key: string; secret_key?: string; snippet: string; api_url: string }

export type Preset = '7d' | '30d' | '90d' | 'month' | 'custom';
export interface Range { preset: Preset; from: string; to: string }

export function presetRange(p: Preset): Range {
  const today = new Date();
  const back = (n: number) => isoDay(new Date(today.getTime() - n * 86400000));
  switch (p) {
    case '7d': return { preset: p, from: back(6), to: isoDay(today) };
    case '90d': return { preset: p, from: back(89), to: isoDay(today) };
    case 'month': return { preset: p, from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(today) };
    default: return { preset: '30d', from: back(29), to: isoDay(today) };
  }
}

interface Store {
  me: Me | null;
  loading: boolean;
  sites: Site[];
  site: string; // '' = все сайты
  setSite: (s: string) => void;
  range: Range;
  setRange: (r: Range) => void;
  refresh: () => Promise<void>;
  login: (token: string) => Promise<void>;
  logout: () => void;
  can: (min: 'viewer' | 'manager' | 'admin' | 'owner') => boolean;
}

const Ctx = createContext<Store>(null as any);
const RANK = { viewer: 0, manager: 1, admin: 2, owner: 3 };

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export function StoreProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<Site[]>([]);
  const [site, setSiteState] = useState(read('crm_site') ?? '');
  const [range, setRangeState] = useState<Range>(() => {
    const p = (read('crm_range') as Preset) || '30d';
    return presetRange(p === 'custom' ? '30d' : p);
  });

  const refresh = useCallback(async () => {
    if (!getToken() && !DEMO) { setMe(null); setLoading(false); return; }
    try {
      const [m, s] = await Promise.all([api<Me>('/api/me'), api<Site[]>('/api/sites')]);
      setCurrency(m.tenant.currency);
      setMe(m);
      setSites(s);
      setSiteState((cur) => (cur && !s.some((x) => x.id === cur) ? '' : cur));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo<Store>(() => ({
    me, loading, sites, site, range,
    setSite: (s) => { setSiteState(s); write('crm_site', s); },
    setRange: (r) => { setRangeState(r); write('crm_range', r.preset); },
    refresh,
    // при обновлении сессии уже вошедшего пользователя экран не перерисовываем целиком
    login: async (token) => { setToken(token); if (!me) setLoading(true); await refresh(); },
    logout: () => { setToken(null); setMe(null); location.hash = '#/login'; },
    can: (min) => !!me && RANK[me.role] >= RANK[min],
  }), [me, loading, sites, site, range, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);

/** Загрузка данных с перезапросом при смене зависимостей */
export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api<T>(path)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
