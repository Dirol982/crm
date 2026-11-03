/**
 * Учебный рекламный кабинет: 4 кампании с правдоподобной статистикой за 30 дней.
 * Агент и контролёр работают с ним по-настоящему, изменения не уходят ни на одну площадку,
 * а «выручка» хранится в ad_stats.revenue и никогда не смешивается с заказами CRM.
 *
 * Кампании подобраны так, чтобы агенту было что делать:
 *  - брендовый поиск окупается отлично, но упирается в дневной бюджет → расширить;
 *  - общий поиск — нормальная окупаемость → оставить;
 *  - ретаргетинг не окупается → урезать;
 *  - медийная кампания тратит деньги без заказов → выключить.
 */
import { one, tx } from '../db.js';

interface DemoModel { demand: number; cpc: number; roas: number; avg: number; elasticity: number; ref: number }

const CAMPAIGNS: { name: string; budget: number; model: DemoModel }[] = [
  { name: 'Поиск — брендовые запросы', budget: 1500, model: { demand: 2600, cpc: 18, roas: 5.2, avg: 4200, elasticity: 0.3, ref: 1500 } },
  { name: 'Поиск — общие запросы', budget: 3000, model: { demand: 3300, cpc: 32, roas: 1.9, avg: 5100, elasticity: 0.5, ref: 3000 } },
  { name: 'РСЯ — ретаргетинг', budget: 2000, model: { demand: 2200, cpc: 9, roas: 0.65, avg: 3800, elasticity: 0.4, ref: 2000 } },
  { name: 'Медийная — охват', budget: 2500, model: { demand: 2600, cpc: 6, roas: 0, avg: 4000, elasticity: 0, ref: 2500 } },
];

/** Детерминированный «случай» от строки — чтобы статистика была стабильной */
function rand(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function dayStats(campaignId: string, day: string, m: DemoModel, budget: number, on: boolean) {
  if (!on || budget <= 0) return { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };
  const spend = Math.min(budget, m.demand) * (0.9 + 0.1 * rand(`${campaignId}:${day}:s`));
  const clicks = Math.round(spend / m.cpc);
  // чем сильнее раздуваем бюджет сверх привычного, тем дороже каждый следующий заказ
  const roas = m.roas * (spend > m.ref ? Math.max(0.3, 1 - m.elasticity * (spend / m.ref - 1)) : 1);
  // дробные заказы округляем вероятностно — иначе у дешёвых кампаний их всегда было бы 0
  const orders = Math.floor((spend * roas * (0.7 + 0.6 * rand(`${campaignId}:${day}:r`))) / m.avg + rand(`${campaignId}:${day}:o`));
  return { impressions: clicks * (20 + Math.round(30 * rand(`${campaignId}:${day}:i`))), clicks, cost: Math.round(spend), conversions: orders, revenue: orders * m.avg };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function createDemoAccount(tenantId: string) {
  const exists = await one(`SELECT id FROM ad_accounts WHERE tenant_id=$1 AND platform='demo'`, [tenantId]);
  if (exists) return exists.id as string;
  return tx(async (c) => {
    // чтобы учебный цикл показывал автопилот: включаем его, если клиент ещё не настраивал правила
    // (у настоящих кампаний автопилот по умолчанию выключен — для них агент только предлагает)
    await c.query(`INSERT INTO ad_policies(tenant_id, mode) VALUES ($1,'autopilot') ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
    const acc = (await c.query(`INSERT INTO ad_accounts(tenant_id, platform, name, last_sync_at) VALUES ($1,'demo','Учебный кабинет', now()) RETURNING id`, [tenantId])).rows[0];
    for (const [i, x] of CAMPAIGNS.entries()) {
      const camp = (await c.query(
        `INSERT INTO ad_campaigns(tenant_id, account_id, external_id, name, status, daily_budget, utm_campaign, autopilot, demo)
         VALUES ($1,$2,$3,$4,'on',$5,$4,true,$6) RETURNING id`,
        [tenantId, acc.id, `demo-${i + 1}`, x.name, x.budget, JSON.stringify(x.model)],
      )).rows[0];
      for (let d = 29; d >= 0; d--) {
        const day = iso(new Date(Date.now() - d * 864e5));
        const s = dayStats(camp.id, day, x.model, x.budget, true);
        await c.query(`INSERT INTO ad_stats(campaign_id, day, impressions, clicks, cost, conversions, revenue) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [camp.id, day, s.impressions, s.clicks, s.cost, s.conversions, s.revenue]);
      }
    }
    return acc.id as string;
  });
}

/**
 * «Перемотать время»: сдвигаем историю учебного кабинета на N дней назад и досчитываем
 * N новых дней с текущими бюджетами и статусами — так видно, как изменения агента
 * сказались на результате, и проверка результата срабатывает сразу.
 */
export async function simulateDays(tenantId: string, days: number) {
  await tx(async (c) => {
    const camps = (await c.query(
      `SELECT x.id, x.daily_budget, x.status, x.demo FROM ad_campaigns x JOIN ad_accounts a ON a.id=x.account_id WHERE x.tenant_id=$1 AND a.platform='demo'`,
      [tenantId],
    )).rows;
    if (!camps.length) throw Object.assign(new Error('no_demo'), { statusCode: 400 });
    const ids = camps.map((x) => x.id);
    // ad_stats: (campaign_id, day) — первичный ключ, поэтому сдвигаем в два шага через далёкие даты
    await c.query(`UPDATE ad_stats SET day = day + 100000 WHERE campaign_id = ANY($1)`, [ids]);
    await c.query(`UPDATE ad_stats SET day = day - 100000 - $2::int WHERE campaign_id = ANY($1)`, [ids, days]);
    await c.query(`DELETE FROM ad_stats WHERE campaign_id = ANY($1) AND day < current_date - 60`, [ids]);
    await c.query(
      `UPDATE ad_actions SET created_at = created_at - ($2 || ' days')::interval, applied_at = applied_at - ($2 || ' days')::interval,
         check_after = check_after - ($2 || ' days')::interval, rolled_back_at = rolled_back_at - ($2 || ' days')::interval
       WHERE campaign_id = ANY($1)`, [ids, String(days)]);
    for (const x of camps) {
      for (let d = days - 1; d >= 0; d--) {
        const day = iso(new Date(Date.now() - d * 864e5));
        const s = dayStats(x.id, day, x.demo, Number(x.daily_budget ?? 0), x.status === 'on');
        await c.query(
          `INSERT INTO ad_stats(campaign_id, day, impressions, clicks, cost, conversions, revenue) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (campaign_id, day) DO UPDATE SET impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, cost=EXCLUDED.cost, conversions=EXCLUDED.conversions, revenue=EXCLUDED.revenue`,
          [x.id, day, s.impressions, s.clicks, s.cost, s.conversions, s.revenue]);
      }
    }
  });

}
