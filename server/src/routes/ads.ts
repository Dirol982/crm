import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, pool, q } from '../lib/db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { encrypt } from '../lib/secrets.js';
import { applyAction, checkPolicy, getPolicy, performance, rollbackAction, syncAccount, DEFAULT_POLICY } from '../lib/ads/core.js';
import { aiEnabled, AGENT_MODEL, runMonitor, runOptimizer } from '../lib/ads/agent.js';
import { createDemoAccount, simulateDays } from '../lib/ads/demo.js';
import { PlatformError } from '../lib/ads/platforms.js';

const accountBody = z.discriminatedUnion('platform', [
  z.object({ platform: z.literal('yandex'), name: z.string().trim().min(1).max(100), token: z.string().trim().min(10).max(500), login: z.string().trim().max(100).optional() }),
  z.object({ platform: z.literal('vk'), name: z.string().trim().min(1).max(100), token: z.string().trim().min(10).max(1000) }),
  z.object({
    platform: z.literal('google'), name: z.string().trim().min(1).max(100), refresh_token: z.string().trim().min(10).max(1000),
    login: z.string().trim().regex(/^\d{3}-?\d{3}-?\d{4}$/), login_customer_id: z.string().trim().regex(/^\d{3}-?\d{3}-?\d{4}$/).optional().or(z.literal('')),
  }),
  z.object({ platform: z.literal('telegram'), name: z.string().trim().min(1).max(100) }),
]);

const policyBody = z.object({
  mode: z.enum(['off', 'suggest', 'autopilot']),
  max_change_pct: z.number().int().min(1).max(100),
  max_campaign_budget: z.number().positive().nullable(),
  max_total_budget: z.number().positive().nullable(),
  min_clicks: z.number().int().min(0).max(100000),
  allow_pause: z.boolean(),
  target_roas: z.number().positive().nullable(),
  max_cpa: z.number().positive().nullable(),
  cooldown_hours: z.number().int().min(12).max(720),
  rollback_threshold_pct: z.number().int().min(5).max(100),
  controller_enabled: z.boolean(),
});

/** CSV из Telegram Ads: дата, кампания, показы, клики, расход (разделитель «,» или «;») */
function parseCsv(text: string) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const sep = (lines[0] ?? '').includes(';') ? ';' : ',';
  const rows = lines.map((l) => l.split(sep).map((x) => x.trim().replace(/^"|"$/g, '')));
  const head = rows[0]?.map((h) => h.toLowerCase()) ?? [];
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const ix = { date: col('date', 'дата'), name: col('campaign', 'кампан', 'ad', 'объявл'), views: col('view', 'impr', 'показ', 'просмотр'), clicks: col('click', 'клик'), spend: col('spen', 'cost', 'расход', 'потрач') };
  if (ix.date < 0 || ix.name < 0 || ix.spend < 0) throw Object.assign(new Error('csv_columns'), { statusCode: 400 });
  const num = (v?: string) => Number((v ?? '0').replace(/\s/g, '').replace(',', '.')) || 0;
  return rows.slice(1).map((r) => {
    const d = r[ix.date] ?? '';
    const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return { day: m ? `${m[3]}-${m[2]}-${m[1]}` : d.slice(0, 10), name: r[ix.name], impressions: num(r[ix.views]), clicks: num(r[ix.clicks]), cost: num(r[ix.spend]) };
  }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && r.name);
}

export default async function adsRoutes(app: FastifyInstance) {
  const read = { preHandler: requireAuth };
  const manager = { preHandler: requireRole('manager') };
  const admin = { preHandler: requireRole('admin') };

  app.get('/api/ads/overview', read, async (req) => {
    const tid = req.user.tid;
    const [accounts, campaigns, policy, runs, actions] = await Promise.all([
      q(`SELECT id, platform, name, login, active, last_sync_at, sync_error, created_at FROM ad_accounts WHERE tenant_id=$1 ORDER BY created_at`, [tid]),
      performance(tid, 14),
      getPolicy(tid),
      q(`SELECT id, kind, trigger, status, summary, error, model, input_tokens, output_tokens, started_at, finished_at FROM agent_runs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 15`, [tid]),
      q(`SELECT x.*, c.name AS campaign, a.platform FROM ad_actions x LEFT JOIN ad_campaigns c ON c.id=x.campaign_id LEFT JOIN ad_accounts a ON a.id=c.account_id
         WHERE x.tenant_id=$1 ORDER BY x.created_at DESC LIMIT 150`, [tid]),
    ]);
    const running = runs.some((r) => r.status === 'running' && Date.now() - new Date(r.started_at).getTime() < 15 * 60000);
    return { ai_enabled: aiEnabled(), model: AGENT_MODEL, accounts, campaigns, policy, runs, actions, running };
  });

  // ---------- Подключения ----------
  app.post('/api/ads/accounts', admin, async (req, reply) => {
    const b = accountBody.parse(req.body);
    const secret = b.platform === 'yandex' || b.platform === 'vk' ? { token: b.token }
      : b.platform === 'google' ? { refresh_token: b.refresh_token, login_customer_id: b.login_customer_id || null } : null;
    const login = b.platform === 'yandex' ? b.login || null : b.platform === 'google' ? b.login : null;
    const acc = await one(
      'INSERT INTO ad_accounts(tenant_id, platform, name, login, secret) VALUES ($1,$2,$3,$4,$5) RETURNING id, platform, name',
      [req.user.tid, b.platform, b.name, login, secret ? encrypt(JSON.stringify(secret)) : null],
    );
    if (b.platform !== 'telegram') {
      try { await syncAccount(acc.id); } catch (e: any) { return reply.code(200).send({ ...acc, sync_error: e.message }); }
    }
    return acc;
  });

  app.post('/api/ads/accounts/:id/sync', manager, async (req, reply) => {
    const acc = await one('SELECT id FROM ad_accounts WHERE id=$1 AND tenant_id=$2', [(req.params as any).id, req.user.tid]);
    if (!acc) return reply.code(404).send({ error: 'not_found' });
    try { await syncAccount(acc.id); return { ok: true }; } catch (e: any) { return reply.code(502).send({ error: 'platform', detail: e.message }); }
  });

  app.delete('/api/ads/accounts/:id', admin, async (req, reply) => {
    const r = await one('DELETE FROM ad_accounts WHERE id=$1 AND tenant_id=$2 RETURNING id', [(req.params as any).id, req.user.tid]);
    return r ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  app.post('/api/ads/telegram/import', manager, async (req, reply) => {
    const b = z.object({ account_id: z.string().uuid(), csv: z.string().min(10).max(2_000_000) }).parse(req.body);
    const acc = await one(`SELECT id FROM ad_accounts WHERE id=$1 AND tenant_id=$2 AND platform='telegram'`, [b.account_id, req.user.tid]);
    if (!acc) return reply.code(404).send({ error: 'not_found' });
    const rows = parseCsv(b.csv);
    for (const r of rows) {
      const c = await one(
        `INSERT INTO ad_campaigns(tenant_id, account_id, external_id, name, utm_campaign) VALUES ($1,$2,$3,$3,$3)
         ON CONFLICT (account_id, external_id) DO UPDATE SET updated_at=now() RETURNING id`, [req.user.tid, acc.id, r.name]);
      await pool.query(
        `INSERT INTO ad_stats(campaign_id, day, impressions, clicks, cost) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (campaign_id, day) DO UPDATE SET impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, cost=EXCLUDED.cost`,
        [c.id, r.day, r.impressions, r.clicks, r.cost]);
    }
    await pool.query('UPDATE ad_accounts SET last_sync_at=now(), sync_error=NULL WHERE id=$1', [acc.id]);
    return { rows: rows.length };
  });

  // ---------- Учебный кабинет ----------
  app.post('/api/ads/demo', admin, async (req) => ({ account_id: await createDemoAccount(req.user.tid) }));
  app.post('/api/ads/demo/simulate', admin, async (req) => {
    const { days } = z.object({ days: z.number().int().min(1).max(7) }).parse(req.body);
    await simulateDays(req.user.tid, days);
    await runMonitor();
    return { ok: true };
  });

  // ---------- Кампании и правила ----------
  app.patch('/api/ads/campaigns/:id', manager, async (req, reply) => {
    const b = z.object({ utm_campaign: z.string().trim().max(200).optional(), autopilot: z.boolean().optional() }).parse(req.body);
    if (b.autopilot !== undefined && !['owner', 'admin'].includes(req.user.role)) return reply.code(403).send({ error: 'forbidden' });
    const r = await one(
      `UPDATE ad_campaigns SET utm_campaign=COALESCE($3, utm_campaign), autopilot=COALESCE($4, autopilot), updated_at=now()
       WHERE id=$1 AND tenant_id=$2 RETURNING id`, [(req.params as any).id, req.user.tid, b.utm_campaign || null, b.autopilot ?? null]);
    return r ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  app.put('/api/ads/policy', admin, async (req) => {
    const b = policyBody.parse({ ...DEFAULT_POLICY, ...(req.body as object) });
    await pool.query(
      `INSERT INTO ad_policies(tenant_id, mode, max_change_pct, max_campaign_budget, max_total_budget, min_clicks, allow_pause, target_roas, max_cpa, cooldown_hours, rollback_threshold_pct, controller_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id) DO UPDATE SET mode=$2, max_change_pct=$3, max_campaign_budget=$4, max_total_budget=$5, min_clicks=$6, allow_pause=$7,
         target_roas=$8, max_cpa=$9, cooldown_hours=$10, rollback_threshold_pct=$11, controller_enabled=$12, updated_at=now()`,
      [req.user.tid, b.mode, b.max_change_pct, b.max_campaign_budget, b.max_total_budget, b.min_clicks, b.allow_pause, b.target_roas, b.max_cpa, b.cooldown_hours, b.rollback_threshold_pct, b.controller_enabled],
    );
    return getPolicy(req.user.tid);
  });

  // ---------- Запуск агента ----------
  app.post('/api/ads/run', { ...manager, config: { rateLimit: { max: 6, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!aiEnabled()) return reply.code(400).send({ error: 'ai_disabled' });
    const running = await one(`SELECT 1 FROM agent_runs WHERE tenant_id=$1 AND kind='optimize' AND status='running' AND started_at > now() - interval '15 minutes'`, [req.user.tid]);
    if (running) return reply.code(409).send({ error: 'already_running' });
    const camps = await one('SELECT count(*)::int AS n FROM ad_campaigns WHERE tenant_id=$1', [req.user.tid]);
    if (!camps.n) return reply.code(400).send({ error: 'no_campaigns' });
    // анализ занимает 1–3 минуты — идёт в фоне, страница следит за статусом
    runOptimizer(req.user.tid, 'manual').catch((e) => req.log.error(e));
    return { started: true };
  });

  // ---------- Решения человека ----------
  const action = (id: string, tid: string) => one('SELECT * FROM ad_actions WHERE id=$1 AND tenant_id=$2', [id, tid]);

  app.post('/api/ads/actions/:id/approve', manager, async (req, reply) => {
    const a = await action((req.params as any).id, req.user.tid);
    if (!a || a.status !== 'proposed' || a.type === 'recommendation') return reply.code(404).send({ error: 'not_found' });
    // человек может разрешить больший шаг, но не выйти за потолки бюджета из правил
    const policy = await getPolicy(req.user.tid);
    const check = await checkPolicy(req.user.tid, { campaign_id: a.campaign_id, type: a.type, new_budget: a.new_value?.daily_budget }, policy, { byUser: true });
    if (!check.ok) return reply.code(400).send({ error: 'policy', detail: check.reason });
    try {
      await applyAction(a.id, 'user', req.user.uid, policy.cooldown_hours);
      return { ok: true };
    } catch (e: any) {
      return reply.code(502).send({ error: 'platform', detail: e instanceof PlatformError ? e.message : 'Не удалось применить' });
    }
  });

  app.post('/api/ads/actions/:id/reject', manager, async (req, reply) => {
    const r = await one(`UPDATE ad_actions SET status=CASE WHEN type='recommendation' THEN 'done' ELSE 'rejected' END, decided_by='user', decided_user=$3
                         WHERE id=$1 AND tenant_id=$2 AND status='proposed' RETURNING id`, [(req.params as any).id, req.user.tid, req.user.uid]);
    return r ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  app.post('/api/ads/actions/:id/rollback', manager, async (req, reply) => {
    const a = await action((req.params as any).id, req.user.tid);
    if (!a || a.status !== 'applied') return reply.code(404).send({ error: 'not_found' });
    try {
      await rollbackAction(a.id, 'user', req.user.uid, null);
      return { ok: true };
    } catch (e: any) {
      return reply.code(502).send({ error: 'platform', detail: e.message });
    }
  });
}
