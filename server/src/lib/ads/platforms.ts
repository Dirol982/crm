/**
 * Подключения к рекламным площадкам. Единый интерфейс: список кампаний, статистика по дням,
 * изменение дневного бюджета и включение/выключение.
 *
 * Форматы запросов — по документации площадок; перед продакшеном проверить на тестовом кабинете.
 * Адреса API переопределяются переменными окружения (тесты, прокси, новые версии API).
 */

export interface RemoteCampaign { external_id: string; name: string; status: 'on' | 'off'; daily_budget: number | null; currency: string }
export interface RemoteStat { external_id: string; day: string; impressions: number; clicks: number; cost: number; conversions: number }

export interface Connector {
  canAct: boolean;
  /** Минимальный дневной бюджет площадки */
  minBudget: number;
  listCampaigns(): Promise<RemoteCampaign[]>;
  stats(from: string, to: string): Promise<RemoteStat[]>;
  setBudget(externalId: string, amount: number): Promise<void>;
  setStatus(externalId: string, status: 'on' | 'off'): Promise<void>;
}

export class PlatformError extends Error {
  constructor(message: string, public permanent = false) { super(message); }
}

async function http(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 30000) });
  } catch (e: any) {
    throw new PlatformError(`Площадка недоступна: ${e.message}`);
  }
}

// ---------------- Яндекс Директ (API v5) ----------------
const YANDEX = (process.env.YANDEX_DIRECT_API_URL || 'https://api.direct.yandex.com/json/v5').replace(/\/$/, '');

export function yandexDirect(token: string, clientLogin: string | null): Connector {
  const headers = (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${token}`, 'accept-language': 'ru', 'content-type': 'application/json; charset=utf-8',
    ...(clientLogin ? { 'client-login': clientLogin } : {}), ...extra,
  });
  const call = async (service: string, method: string, params: unknown) => {
    const res = await http(`${YANDEX}/${service}`, { method: 'POST', headers: headers(), body: JSON.stringify({ method, params }) });
    const data: any = await res.json().catch(() => null);
    if (data?.error) {
      // 53 — ошибка авторизации, 54 — нет прав, 8800 — не найдено: повторять бессмысленно
      throw new PlatformError(`Директ: ${data.error.error_string}${data.error.error_detail ? ` — ${data.error.error_detail}` : ''}`, [53, 54, 513, 8800].includes(+data.error.error_code));
    }
    if (!res.ok || !data?.result) throw new PlatformError(`Директ: HTTP ${res.status}`);
    return data.result;
  };
  const MICRO = 1_000_000; // суммы в API Директа — в миллионных долях валюты
  return {
    canAct: true,
    minBudget: 300,
    async listCampaigns() {
      const r = await call('campaigns', 'get', {
        SelectionCriteria: { States: ['ON', 'OFF', 'SUSPENDED'] },
        FieldNames: ['Id', 'Name', 'State', 'DailyBudget', 'Currency'],
      });
      return (r.Campaigns ?? []).map((c: any) => ({
        external_id: String(c.Id), name: c.Name, status: c.State === 'ON' ? 'on' : 'off',
        daily_budget: c.DailyBudget?.Amount ? c.DailyBudget.Amount / MICRO : null, currency: c.Currency ?? 'RUB',
      }));
    },
    async stats(from, to) {
      // Отчёты строятся асинхронно: 201/202 — «готовится», повторяем через retryIn секунд
      const body = JSON.stringify({
        params: {
          SelectionCriteria: { DateFrom: from, DateTo: to },
          FieldNames: ['Date', 'CampaignId', 'Impressions', 'Clicks', 'Cost'],
          ReportName: `pulse-${from}-${to}-${Date.now()}`, ReportType: 'CAMPAIGN_PERFORMANCE_REPORT',
          DateRangeType: 'CUSTOM_DATE', Format: 'TSV', IncludeVAT: 'YES',
        },
      });
      for (let attempt = 0; attempt < 10; attempt++) {
        const res = await http(`${YANDEX}/reports`, {
          method: 'POST', body, timeoutMs: 60000,
          headers: headers({ processingmode: 'auto', returnmoneyinmicros: 'false', skipreportheader: 'true', skipreportsummary: 'true' }),
        });
        if (res.status === 201 || res.status === 202) {
          const wait = Math.min(30, Number(res.headers.get('retryin') ?? 5));
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }
        const text = await res.text();
        if (!res.ok) throw new PlatformError(`Директ, отчёт: HTTP ${res.status} ${text.slice(0, 200)}`);
        const [head, ...lines] = text.trim().split('\n');
        const cols = head.split('\t');
        const ix = (n: string) => cols.indexOf(n);
        return lines.filter(Boolean).map((l) => {
          const v = l.split('\t');
          return { external_id: v[ix('CampaignId')], day: v[ix('Date')], impressions: +v[ix('Impressions')] || 0, clicks: +v[ix('Clicks')] || 0, cost: +v[ix('Cost')] || 0, conversions: 0 };
        });
      }
      throw new PlatformError('Директ: отчёт не успел построиться');
    },
    async setBudget(id, amount) {
      await call('campaigns', 'update', { Campaigns: [{ Id: Number(id), DailyBudget: { Amount: Math.round(amount * MICRO), Mode: 'STANDARD' } }] });
    },
    async setStatus(id, status) {
      await call('campaigns', status === 'on' ? 'resume' : 'suspend', { SelectionCriteria: { Ids: [Number(id)] } });
    },
  };
}

// ---------------- VK Реклама (API ads.vk.com, v2) ----------------
const VK = (process.env.VK_ADS_API_URL || 'https://ads.vk.com/api/v2').replace(/\/$/, '');

export function vkAds(token: string): Connector {
  const req = async (path: string, init: RequestInit = {}) => {
    const res = await http(`${VK}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    const data: any = await res.json().catch(() => null);
    if (!res.ok) throw new PlatformError(`VK Реклама: ${data?.error?.message ?? `HTTP ${res.status}`}`, res.status === 401 || res.status === 403);
    return data;
  };
  return {
    canAct: true,
    minBudget: 100,
    async listCampaigns() {
      const r = await req('/campaigns.json?fields=id,name,status,budget_limit_day&limit=250');
      return (r.items ?? []).filter((c: any) => c.status !== 'deleted').map((c: any) => ({
        external_id: String(c.id), name: c.name, status: c.status === 'active' ? 'on' : 'off',
        daily_budget: Number(c.budget_limit_day) > 0 ? Number(c.budget_limit_day) : null, currency: 'RUB',
      }));
    },
    async stats(from, to) {
      const ids = (await this.listCampaigns()).map((c) => c.external_id);
      if (!ids.length) return [];
      const r = await req(`/statistics/campaigns/day.json?id=${ids.join(',')}&date_from=${from}&date_to=${to}`);
      return (r.items ?? []).flatMap((it: any) => (it.rows ?? []).map((row: any) => ({
        external_id: String(it.id), day: row.date, impressions: +row.base?.shows || 0, clicks: +row.base?.clicks || 0,
        cost: +row.base?.spent || 0, conversions: +row.base?.goals || 0,
      })));
    },
    async setBudget(id, amount) {
      await req(`/campaigns/${encodeURIComponent(id)}.json`, { method: 'POST', body: JSON.stringify({ budget_limit_day: String(Math.round(amount)) }) });
    },
    async setStatus(id, status) {
      await req(`/campaigns/${encodeURIComponent(id)}.json`, { method: 'POST', body: JSON.stringify({ status: status === 'on' ? 'active' : 'blocked' }) });
    },
  };
}

// ---------------- Google Ads (REST) ----------------
const GOOGLE = (process.env.GOOGLE_ADS_API_URL || 'https://googleads.googleapis.com').replace(/\/$/, '');
const GOOGLE_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v21';
const GOOGLE_OAUTH = process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';

export function googleAds(refreshToken: string, customerId: string, loginCustomerId: string | null): Connector {
  const cid = customerId.replace(/-/g, '');
  let access: { token: string; until: number } | null = null;
  const token = async () => {
    if (access && access.until > Date.now() + 60000) return access.token;
    const res = await http(GOOGLE_OAUTH, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? '' }),
    });
    const d: any = await res.json().catch(() => null);
    if (!res.ok || !d?.access_token) throw new PlatformError(`Google: не удалось получить доступ (${d?.error ?? res.status})`, true);
    access = { token: d.access_token, until: Date.now() + (d.expires_in ?? 3600) * 1000 };
    return access.token;
  };
  const api = async (path: string, body: unknown) => {
    const res = await http(`${GOOGLE}/${GOOGLE_VERSION}/customers/${cid}/${path}`, {
      method: 'POST', body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${await token()}`, 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '', 'content-type': 'application/json',
        ...(loginCustomerId ? { 'login-customer-id': loginCustomerId.replace(/-/g, '') } : {}),
      },
    });
    const d: any = await res.json().catch(() => null);
    if (!res.ok) throw new PlatformError(`Google Ads: ${d?.error?.message ?? `HTTP ${res.status}`}`, res.status === 401 || res.status === 403);
    return d;
  };
  const search = async (query: string) => {
    const out: any[] = [];
    let pageToken: string | undefined;
    do {
      const d = await api('googleAds:search', { query, ...(pageToken ? { pageToken } : {}) });
      out.push(...(d.results ?? []));
      pageToken = d.nextPageToken;
    } while (pageToken);
    return out;
  };
  const budgets = new Map<string, string>(); // campaign id → resource name бюджета
  return {
    canAct: true,
    minBudget: 1,
    async listCampaigns() {
      const rows = await search(
        "SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, campaign_budget.resource_name, customer.currency_code FROM campaign WHERE campaign.status != 'REMOVED'",
      );
      return rows.map((r: any) => {
        budgets.set(String(r.campaign.id), r.campaignBudget?.resourceName);
        return {
          external_id: String(r.campaign.id), name: r.campaign.name, status: r.campaign.status === 'ENABLED' ? 'on' : 'off',
          daily_budget: r.campaignBudget?.amountMicros ? Number(r.campaignBudget.amountMicros) / 1e6 : null, currency: r.customer?.currencyCode ?? 'USD',
        } as RemoteCampaign;
      });
    },
    async stats(from, to) {
      const rows = await search(
        `SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`,
      );
      return rows.map((r: any) => ({
        external_id: String(r.campaign.id), day: r.segments.date, impressions: +r.metrics?.impressions || 0, clicks: +r.metrics?.clicks || 0,
        cost: (+r.metrics?.costMicros || 0) / 1e6, conversions: +r.metrics?.conversions || 0,
      }));
    },
    async setBudget(id, amount) {
      if (!budgets.size) await this.listCampaigns();
      const rn = budgets.get(id);
      if (!rn) throw new PlatformError('Google Ads: бюджет кампании не найден', true);
      await api('campaignBudgets:mutate', { operations: [{ update: { resourceName: rn, amountMicros: String(Math.round(amount * 1e6)) }, updateMask: 'amount_micros' }] });
    },
    async setStatus(id, status) {
      await api('campaigns:mutate', { operations: [{ update: { resourceName: `customers/${cid}/campaigns/${id}`, status: status === 'on' ? 'ENABLED' : 'PAUSED' }, updateMask: 'status' }] });
    },
  };
}

/** Telegram Ads: открытого API нет — статистика загружается файлом, изменения только вручную */
export const telegramManual: Connector = {
  canAct: false,
  minBudget: 0,
  async listCampaigns() { return []; },
  async stats() { return []; },
  async setBudget() { throw new PlatformError('Telegram Ads не даёт менять кампании через API — измените вручную в ads.telegram.org', true); },
  async setStatus() { throw new PlatformError('Telegram Ads не даёт менять кампании через API — измените вручную в ads.telegram.org', true); },
};

/**
 * Учебный кабинет: кампании живут только в базе Пульса. Агент и контролёр работают с ним
 * по-настоящему, но изменения не уходят ни на одну площадку — чтобы клиент без риска увидел,
 * как всё устроено.
 */
export const demoConnector: Connector = {
  canAct: true,
  minBudget: 300,
  async listCampaigns() { return []; },
  async stats() { return []; },
  async setBudget() { /* меняется только запись в базе */ },
  async setStatus() { /* меняется только запись в базе */ },
};
