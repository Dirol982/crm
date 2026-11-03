/**
 * Рекламные данные и правила: синхронизация с площадками, окупаемость по данным CRM,
 * проверка предложений агента жёсткими лимитами, применение и откат изменений.
 *
 * Деньги клиента защищают правила В КОДЕ — модель не может их обойти, что бы ни написала.
 */
import { one, pool, q } from '../db.js';
import { decrypt } from '../secrets.js';
import { demoConnector, googleAds, telegramManual, vkAds, yandexDirect, PlatformError, type Connector } from './platforms.js';

export interface Policy {
  mode: 'off' | 'suggest' | 'autopilot';
  max_change_pct: number; max_campaign_budget: number | null; max_total_budget: number | null;
  min_clicks: number; allow_pause: boolean; target_roas: number | null; max_cpa: number | null;
  cooldown_hours: number; rollback_threshold_pct: number; controller_enabled: boolean;
}

export const DEFAULT_POLICY: Policy = {
  mode: 'suggest', max_change_pct: 20, max_campaign_budget: null, max_total_budget: null, min_clicks: 100,
  allow_pause: true, target_roas: null, max_cpa: null, cooldown_hours: 48, rollback_threshold_pct: 30, controller_enabled: true,
};

export async function getPolicy(tenantId: string): Promise<Policy> {
  const p = await one('SELECT * FROM ad_policies WHERE tenant_id=$1', [tenantId]);
  return p ? { ...DEFAULT_POLICY, ...p } : DEFAULT_POLICY;
}

export function connectorFor(acc: { platform: string; login: string | null; secret: string | null }): Connector {
  if (acc.platform === 'telegram') return telegramManual;
  if (acc.platform === 'demo') return demoConnector;
  const s = JSON.parse(decrypt(acc.secret!));
  if (acc.platform === 'yandex') return yandexDirect(s.token, acc.login || null);
  if (acc.platform === 'vk') return vkAds(s.token);
  return googleAds(s.refresh_token, acc.login!, s.login_customer_id || null);
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Загрузить кампании и статистику за последние `days` дней */
export async function syncAccount(accountId: string, days = 30) {
  const acc = await one('SELECT * FROM ad_accounts WHERE id=$1', [accountId]);
  if (!acc || acc.platform === 'telegram' || acc.platform === 'demo') return;
  const c = connectorFor(acc);
  try {
    const campaigns = await c.listCampaigns();
    for (const r of campaigns) {
      await pool.query(
        `INSERT INTO ad_campaigns(tenant_id, account_id, external_id, name, status, daily_budget, currency, utm_campaign)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$4)
         ON CONFLICT (account_id, external_id) DO UPDATE SET name=EXCLUDED.name, status=EXCLUDED.status,
           daily_budget=EXCLUDED.daily_budget, currency=EXCLUDED.currency, updated_at=now()`,
        [acc.tenant_id, acc.id, r.external_id, r.name, r.status, r.daily_budget, r.currency],
      );
    }
    const to = new Date(), from = new Date(Date.now() - days * 864e5);
    const stats = await c.stats(isoDay(from), isoDay(to));
    for (const s of stats) {
      await pool.query(
        `INSERT INTO ad_stats(campaign_id, day, impressions, clicks, cost, conversions)
         SELECT id, $3::date, $4, $5, $6, $7 FROM ad_campaigns WHERE account_id=$1 AND external_id=$2
         ON CONFLICT (campaign_id, day) DO UPDATE SET impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, cost=EXCLUDED.cost, conversions=EXCLUDED.conversions`,
        [acc.id, s.external_id, s.day, s.impressions, s.clicks, s.cost, s.conversions],
      );
    }
    await pool.query('UPDATE ad_accounts SET last_sync_at=now(), sync_error=NULL WHERE id=$1', [acc.id]);
  } catch (e: any) {
    await pool.query('UPDATE ad_accounts SET sync_error=$2 WHERE id=$1', [acc.id, String(e.message).slice(0, 500)]);
    throw e;
  }
}

export interface Perf {
  id: string; platform: string; account: string; name: string; status: 'on' | 'off'; daily_budget: number | null; currency: string;
  autopilot: boolean; can_act: boolean; utm_campaign: string | null;
  cost: number; clicks: number; impressions: number; platform_conversions: number;
  orders: number; revenue: number; leads: number; roas: number | null; cpa: number | null;
  prev_cost: number; prev_revenue: number; prev_orders: number;
}

/**
 * Окупаемость кампаний: расход — из площадок, заказы и выручка — из CRM
 * (по utm_campaign, который пришёл с визитом). Окно — `days` дней и такое же окно до него.
 */
export async function performance(tenantId: string, days = 14, campaignId?: string): Promise<Perf[]> {
  const rows = await q(
    `WITH c AS (
       SELECT c.*, a.platform, a.name AS account FROM ad_campaigns c JOIN ad_accounts a ON a.id=c.account_id
       WHERE c.tenant_id=$1 AND a.active ${campaignId ? 'AND c.id=$3' : ''}),
     st AS (
       SELECT campaign_id,
         sum(cost) FILTER (WHERE day > current_date - $2::int) AS cost, sum(clicks) FILTER (WHERE day > current_date - $2::int) AS clicks,
         sum(impressions) FILTER (WHERE day > current_date - $2::int) AS impressions, sum(conversions) FILTER (WHERE day > current_date - $2::int) AS conv,
         sum(cost) FILTER (WHERE day <= current_date - $2::int AND day > current_date - 2 * $2::int) AS prev_cost,
         sum(revenue) FILTER (WHERE day > current_date - $2::int) AS demo_rev,
         sum(revenue) FILTER (WHERE day <= current_date - $2::int AND day > current_date - 2 * $2::int) AS demo_prev_rev,
         sum(conversions) FILTER (WHERE day <= current_date - $2::int AND day > current_date - 2 * $2::int) AS prev_conv
       FROM ad_stats WHERE campaign_id IN (SELECT id FROM c) GROUP BY 1),
     ord AS (
       SELECT lower(campaign) AS k,
         count(*) FILTER (WHERE created_at > now() - ($2 || ' days')::interval) AS orders,
         sum(amount) FILTER (WHERE created_at > now() - ($2 || ' days')::interval) AS revenue,
         count(*) FILTER (WHERE created_at <= now() - ($2 || ' days')::interval) AS prev_orders,
         sum(amount) FILTER (WHERE created_at <= now() - ($2 || ' days')::interval) AS prev_revenue
       FROM orders WHERE tenant_id=$1 AND status='paid' AND campaign IS NOT NULL AND created_at > now() - (2 * $2 || ' days')::interval GROUP BY 1),
     ld AS (
       SELECT lower(s.campaign) AS k, count(*) AS leads FROM events e JOIN sessions s ON s.site_id=e.site_id AND s.id=e.session_id
       WHERE e.name='lead' AND e.site_id IN (SELECT id FROM sites WHERE tenant_id=$1) AND e.ts > now() - ($2 || ' days')::interval AND s.campaign IS NOT NULL GROUP BY 1)
     SELECT c.id, c.platform, c.account, c.name, c.status, c.daily_budget::float, c.currency, c.autopilot, c.utm_campaign,
       coalesce(st.cost,0)::float cost, coalesce(st.clicks,0)::int clicks, coalesce(st.impressions,0)::int impressions, coalesce(st.conv,0)::float platform_conversions,
       -- учебный кабинет считает заказы и выручку по своей модели, настоящие — по CRM
       CASE WHEN c.platform='demo' THEN coalesce(st.conv,0) ELSE coalesce(ord.orders,0) END::int orders,
       CASE WHEN c.platform='demo' THEN coalesce(st.demo_rev,0) ELSE coalesce(ord.revenue,0) END::float revenue,
       CASE WHEN c.platform='demo' THEN 0 ELSE coalesce(ld.leads,0) END::int leads,
       coalesce(st.prev_cost,0)::float prev_cost,
       CASE WHEN c.platform='demo' THEN coalesce(st.demo_prev_rev,0) ELSE coalesce(ord.prev_revenue,0) END::float prev_revenue,
       CASE WHEN c.platform='demo' THEN coalesce(st.prev_conv,0) ELSE coalesce(ord.prev_orders,0) END::int prev_orders
     FROM c LEFT JOIN st ON st.campaign_id=c.id
       LEFT JOIN ord ON ord.k = lower(coalesce(c.utm_campaign, c.name))
       LEFT JOIN ld ON ld.k = lower(coalesce(c.utm_campaign, c.name))
     ORDER BY cost DESC`,
    campaignId ? [tenantId, days, campaignId] : [tenantId, days],
  );
  return rows.map((r) => ({
    ...r, can_act: r.platform !== 'telegram',
    roas: r.cost > 0 ? Math.round((r.revenue / r.cost) * 100) / 100 : null,
    cpa: r.orders > 0 ? Math.round(r.cost / r.orders) : null,
  }));
}

export interface Proposal { campaign_id: string; type: 'budget' | 'pause' | 'resume'; new_budget?: number }

/**
 * Жёсткие правила. Возвращает null, если изменение можно применить автоматически,
 * или причину, по которой нужно решение человека (или почему изменение невозможно вовсе).
 */
export async function checkPolicy(tenantId: string, p: Proposal, policy: Policy, opts: { byUser?: boolean } = {}):
  Promise<{ ok: true } | { ok: false; reason: string; blocking: boolean }> {
  const c = await one(
    `SELECT c.*, a.platform, a.active FROM ad_campaigns c JOIN ad_accounts a ON a.id=c.account_id WHERE c.id=$1 AND c.tenant_id=$2`,
    [p.campaign_id, tenantId],
  );
  const no = (reason: string, blocking = false) => ({ ok: false as const, reason, blocking });
  if (!c) return no('Кампания не найдена', true);
  if (!c.active) return no('Рекламный аккаунт отключён', true);
  if (c.platform === 'telegram') return no('Telegram Ads не даёт менять кампании через API — только вручную', true);

  if (p.type === 'budget') {
    const nb = p.new_budget!;
    const min = ({ yandex: 300, vk: 100, google: 1, demo: 300 } as Record<string, number>)[c.platform] ?? 1;
    if (!(nb > 0)) return no('Бюджет должен быть больше нуля', true);
    if (nb < min) return no(`Минимальный дневной бюджет площадки — ${min}`, true);
    if (policy.max_campaign_budget && nb > policy.max_campaign_budget) return no(`Выше потолка бюджета кампании (${policy.max_campaign_budget})`, true);
    if (policy.max_total_budget) {
      const t = await one(`SELECT coalesce(sum(daily_budget),0)::float AS s FROM ad_campaigns WHERE tenant_id=$1 AND status='on' AND id<>$2`, [tenantId, c.id]);
      if (t.s + nb > policy.max_total_budget) return no(`Сумма дневных бюджетов превысит общий потолок (${policy.max_total_budget})`, true);
    }
    if (!opts.byUser && c.daily_budget) {
      const pct = (Math.abs(nb - Number(c.daily_budget)) / Number(c.daily_budget)) * 100;
      if (pct > policy.max_change_pct + 0.01) return no(`Изменение на ${Math.round(pct)}% — больше разрешённого шага ${policy.max_change_pct}%`);
    }
    if (!opts.byUser && !c.daily_budget) return no('У кампании нет дневного бюджета — первое ограничение ставит человек');
  }
  if (p.type === 'pause') {
    if (!policy.allow_pause && !opts.byUser) return no('Правилами запрещено выключать кампании автоматически');
    if (c.status === 'off') return no('Кампания уже выключена', true);
    const active = await one(`SELECT count(*)::int AS n FROM ad_campaigns c JOIN ad_accounts a ON a.id=c.account_id WHERE c.tenant_id=$1 AND c.status='on' AND a.platform<>'telegram'`, [tenantId]);
    if (!opts.byUser && active.n <= 1) return no('Это последняя активная кампания — выключить её может только человек');
  }
  if (p.type === 'resume' && c.status === 'on') return no('Кампания уже включена', true);

  if (!opts.byUser) {
    if (!c.autopilot) return no('Для этой кампании автопилот выключен');
    const s = await one(`SELECT coalesce(sum(clicks),0)::int AS clicks FROM ad_stats WHERE campaign_id=$1 AND day > current_date - 14`, [c.id]);
    if (s.clicks < policy.min_clicks) return no(`Мало данных: ${s.clicks} кликов за 14 дней, нужно от ${policy.min_clicks}`);
    const recent = await one(
      `SELECT 1 FROM ad_actions WHERE campaign_id=$1 AND status IN ('applied','rolled_back') AND applied_at > now() - ($2 || ' hours')::interval`,
      [c.id, String(policy.cooldown_hours)],
    );
    if (recent) return no(`Кампанию меняли меньше ${policy.cooldown_hours} ч назад — ждём результата прошлого изменения`);
  }
  return { ok: true };
}

/** Применить изменение на площадке и записать старое значение для отката */
export async function applyAction(actionId: string, decidedBy: 'autopilot' | 'user', userId: string | null, checkHours: number) {
  const a = await one(
    `SELECT x.*, c.external_id, c.daily_budget, c.status AS c_status, acc.platform, acc.login, acc.secret
     FROM ad_actions x JOIN ad_campaigns c ON c.id=x.campaign_id JOIN ad_accounts acc ON acc.id=c.account_id WHERE x.id=$1`,
    [actionId],
  );
  if (!a) throw new Error('not_found');
  const conn = connectorFor(a);
  try {
    let old: unknown;
    if (a.type === 'budget') {
      old = { daily_budget: a.daily_budget === null ? null : Number(a.daily_budget) };
      await conn.setBudget(a.external_id, a.new_value.daily_budget);
      await pool.query('UPDATE ad_campaigns SET daily_budget=$2, updated_at=now() WHERE id=$1', [a.campaign_id, a.new_value.daily_budget]);
    } else {
      const st = a.type === 'pause' ? 'off' : 'on';
      old = { status: a.c_status };
      await conn.setStatus(a.external_id, st);
      await pool.query('UPDATE ad_campaigns SET status=$2, updated_at=now() WHERE id=$1', [a.campaign_id, st]);
    }
    await pool.query(
      `UPDATE ad_actions SET status='applied', old_value=$2, decided_by=$3, decided_user=$4, applied_at=now(),
         check_after=now() + ($5 || ' hours')::interval, error=NULL WHERE id=$1`,
      [actionId, JSON.stringify(old), decidedBy, userId, String(checkHours)],
    );
  } catch (e: any) {
    await pool.query(`UPDATE ad_actions SET status='failed', error=$2, decided_by=$3, decided_user=$4 WHERE id=$1`,
      [actionId, String(e.message).slice(0, 500), decidedBy, userId]);
    throw e instanceof PlatformError ? e : new PlatformError(e.message);
  }
}

/** Вернуть значение, которое было до изменения */
export async function rollbackAction(actionId: string, by: 'monitor' | 'user', userId: string | null, note: unknown) {
  const a = await one(
    `SELECT x.*, c.external_id, acc.platform, acc.login, acc.secret
     FROM ad_actions x JOIN ad_campaigns c ON c.id=x.campaign_id JOIN ad_accounts acc ON acc.id=c.account_id WHERE x.id=$1 AND x.status='applied'`,
    [actionId],
  );
  if (!a) throw new Error('not_found');
  const conn = connectorFor(a);
  if (a.type === 'budget') {
    if (a.old_value?.daily_budget) {
      await conn.setBudget(a.external_id, a.old_value.daily_budget);
      await pool.query('UPDATE ad_campaigns SET daily_budget=$2, updated_at=now() WHERE id=$1', [a.campaign_id, a.old_value.daily_budget]);
    }
  } else {
    await conn.setStatus(a.external_id, a.old_value.status);
    await pool.query('UPDATE ad_campaigns SET status=$2, updated_at=now() WHERE id=$1', [a.campaign_id, a.old_value.status]);
  }
  await pool.query(
    `UPDATE ad_actions SET status='rolled_back', rolled_back_at=now(), check_result=coalesce($3::jsonb, check_result), decided_by=$4, decided_user=coalesce($5, decided_user) WHERE id=$1 AND tenant_id=$2`,
    [actionId, a.tenant_id, note ? JSON.stringify(note) : null, by, userId],
  );
}
