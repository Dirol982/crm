import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../lib/db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import {
  applyPayment, billingConfig, billingEnabled, createCheckout, invalidateState, invoicesEnabled, PaymentError, syncPayment, tenantState, usage,
} from '../lib/billing.js';
import { addonApplies, AI_ADDON_PRICE, isPlan, PLANS, priceFor, YEAR_DISCOUNT, type PlanId } from '../lib/plans.js';
import { queueEmail } from '../lib/mailer.js';
import { invoiceEmail } from '../lib/emails.js';
import { billingContact } from '../lib/notify.js';

const planBody = z.object({
  plan: z.string().refine(isPlan, 'unknown_plan') as unknown as z.ZodType<PlanId>,
  period: z.enum(['month', 'year']),
  ai_addon: z.boolean().optional(),
});

export default async function billingRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole('admin') };

  app.get('/api/billing', { preHandler: requireAuth }, async (req) => {
    const tid = req.user.tid;
    const [state, used, t, payments] = await Promise.all([
      tenantState(tid), usage(tid),
      one('SELECT auto_renew, payment_method_title, billing_email, billing_period, ai_addon FROM tenants WHERE id=$1', [tid]),
      q(`SELECT id, provider, plan, period, amount, status, is_renewal, created_at, paid_at, error, company, ai_addon
         FROM payments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [tid]),
    ]);
    return {
      enabled: billingEnabled(),
      invoices: invoicesEnabled(),
      state, usage: used, settings: t, payments,
      year_discount: YEAR_DISCOUNT,
      ai_addon_price: AI_ADDON_PRICE,
      plans: Object.values(PLANS).map((p) => ({ ...p, price_month: priceFor(p.id, 'month'), price_year: priceFor(p.id, 'year') })),
    };
  });

  app.post('/api/billing/checkout', { ...admin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!billingEnabled()) return reply.code(400).send({ error: 'billing_disabled' });
    const b = planBody.parse(req.body);
    try {
      return await createCheckout(req.user.tid, req.user.uid, b.plan, b.period, !!b.ai_addon);
    } catch (e) {
      if (e instanceof PaymentError) return reply.code(502).send({ error: 'payment_provider', detail: e.message });
      throw e;
    }
  });

  /** Вызывается страницей после возврата с оплаты, не дожидаясь уведомления */
  app.post('/api/billing/payments/:id/refresh', { preHandler: requireAuth }, async (req, reply) => {
    const p = await one('SELECT id FROM payments WHERE id=$1 AND tenant_id=$2', [(req.params as any).id, req.user.tid]);
    if (!p) return reply.code(404).send({ error: 'not_found' });
    const status = await syncPayment(p.id).catch(() => 'pending');
    invalidateState(req.user.tid);
    return { status, state: await tenantState(req.user.tid) };
  });

  app.patch('/api/billing/settings', admin, async (req) => {
    const b = z.object({
      auto_renew: z.boolean().optional(),
      billing_email: z.string().trim().toLowerCase().email().nullable().optional().or(z.literal('').transform(() => null)),
      remove_card: z.boolean().optional(),
    }).parse(req.body);
    return one(
      `UPDATE tenants SET auto_renew=COALESCE($2, auto_renew),
         billing_email=CASE WHEN $3::boolean THEN $4 ELSE billing_email END,
         payment_method_id=CASE WHEN $5 THEN NULL ELSE payment_method_id END,
         payment_method_title=CASE WHEN $5 THEN NULL ELSE payment_method_title END
       WHERE id=$1 RETURNING auto_renew, payment_method_title, billing_email`,
      [req.user.tid, b.auto_renew ?? null, b.billing_email !== undefined, b.billing_email ?? null, !!b.remove_card],
    );
  });

  // ---------- Счёт для юрлиц ----------
  app.post('/api/billing/invoice', admin, async (req, reply) => {
    if (!invoicesEnabled()) return reply.code(400).send({ error: 'invoices_disabled' });
    const b = planBody.extend({
      company: z.object({
        name: z.string().trim().min(2).max(300),
        inn: z.string().trim().regex(/^\d{10}(\d{2})?$/),
        kpp: z.string().trim().regex(/^\d{9}$/).optional().or(z.literal('')),
        address: z.string().trim().max(500).optional(),
      }),
    }).parse(req.body);
    const inv = await one(
      `INSERT INTO payments(tenant_id, provider, plan, period, amount, company, created_by, ai_addon)
       VALUES ($1,'invoice',$2,$3,$4,$5,$6,$7) RETURNING id, plan, period, amount, status, created_at, company, ai_addon`,
      [req.user.tid, b.plan, b.period, priceFor(b.plan, b.period, addonApplies(b.plan, b.ai_addon)), JSON.stringify(b.company), req.user.uid, addonApplies(b.plan, b.ai_addon)],
    );
    const c = await billingContact(req.user.tid);
    if (c?.email) await queueEmail({ to: c.email, kind: 'invoice', tenantId: req.user.tid, ...invoiceEmail({ company: c.company, buyer: b.company.name, amount: inv.amount, plan: PLANS[b.plan].name }) });
    return inv;
  });

  app.get('/api/billing/invoice/:id', { preHandler: requireAuth }, async (req, reply) => {
    const p = await one(
      `SELECT p.id, p.plan, p.period, p.amount, p.status, p.created_at, p.company, p.ai_addon, t.name AS tenant_name,
              (SELECT count(*) FROM payments x WHERE x.provider='invoice' AND x.created_at <= p.created_at)::int AS number
       FROM payments p JOIN tenants t ON t.id=p.tenant_id WHERE p.id=$1 AND p.tenant_id=$2 AND p.provider='invoice'`,
      [(req.params as any).id, req.user.tid],
    );
    if (!p) return reply.code(404).send({ error: 'not_found' });
    return { ...p, plan_name: (PLANS[p.plan as PlanId]?.name ?? p.plan) + (p.ai_addon ? ' + ИИ-агент' : ''), seller: billingConfig.seller };
  });

  // ---------- Уведомления ЮKassa ----------
  // Уведомления не подписаны, поэтому им не верим: по id платежа запрашиваем его статус в API ЮKassa.
  app.post('/api/billing/webhook/yookassa', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    const extId = (req.body as any)?.object?.id;
    if (typeof extId !== 'string' || extId.length > 100) return reply.code(200).send({ ok: true });
    const p = await one('SELECT id, tenant_id FROM payments WHERE external_id=$1', [extId]);
    if (!p) return { ok: true };
    try {
      await syncPayment(p.id);
      invalidateState(p.tenant_id);
      return { ok: true };
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ error: 'retry' }); // ЮKassa повторит уведомление
    }
  });

  // ---------- Кабинет владельца платформы (SUPERADMIN_EMAILS) ----------
  const superadmin = {
    preHandler: async (req: any, reply: any) => {
      await requireAuth(req, reply);
      if (reply.sent) return;
      const u = await one('SELECT email FROM users WHERE id=$1', [req.user.uid]);
      if (!u || !billingConfig.superadmins.includes(u.email.toLowerCase())) return reply.code(403).send({ error: 'forbidden' });
    },
  };

  app.get('/api/admin/overview', superadmin, async () => {
    const tenants = await q(
      `SELECT t.id, t.name, t.plan, t.billing_period, t.ai_addon, t.trial_ends_at, t.paid_until, t.created_at, t.payment_method_title IS NOT NULL AS has_card,
              (SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=t.id AND m.role='owner' LIMIT 1) AS owner_email,
              (SELECT count(*) FROM sites s WHERE s.tenant_id=t.id)::int AS sites,
              (SELECT coalesce(sum(amount),0) FROM payments p WHERE p.tenant_id=t.id AND p.status='succeeded')::float AS paid_total
       FROM tenants t ORDER BY t.created_at DESC LIMIT 500`,
    );
    const invoices = await q(
      `SELECT p.id, p.plan, p.period, p.amount, p.created_at, p.company, t.name AS tenant_name
       FROM payments p JOIN tenants t ON t.id=p.tenant_id WHERE p.provider='invoice' AND p.status='pending' ORDER BY p.created_at`,
    );
    const now = Date.now();
    const paying = tenants.filter((t) => t.paid_until && new Date(t.paid_until).getTime() > now);
    const mrr = paying.reduce((s, t) => s + (isPlan(t.plan) ? (t.billing_period === 'year' ? priceFor(t.plan, 'year', t.ai_addon) / 12 : priceFor(t.plan, 'month', t.ai_addon)) : 0), 0);
    return {
      totals: {
        tenants: tenants.length, paying: paying.length, mrr: Math.round(mrr),
        trials: tenants.filter((t) => !t.paid_until && new Date(t.trial_ends_at).getTime() > now).length,
      },
      tenants, invoices,
    };
  });

  app.post('/api/admin/payments/:id/mark-paid', superadmin, async (req, reply) => {
    const p = await one(`SELECT id, tenant_id FROM payments WHERE id=$1 AND status='pending'`, [(req.params as any).id]);
    if (!p) return reply.code(404).send({ error: 'not_found' });
    await applyPayment(p.id, null);
    return { ok: true };
  });

  app.post('/api/admin/tenants/:id/extend', superadmin, async (req, reply) => {
    const { days } = z.object({ days: z.number().int().min(1).max(365) }).parse(req.body);
    const t = await one(
      `UPDATE tenants SET trial_ends_at = CASE WHEN paid_until IS NULL THEN GREATEST(trial_ends_at, now()) + ($2 || ' days')::interval ELSE trial_ends_at END,
         paid_until = CASE WHEN paid_until IS NOT NULL THEN GREATEST(paid_until, now()) + ($2 || ' days')::interval ELSE NULL END
       WHERE id=$1 RETURNING id, trial_ends_at, paid_until`,
      [(req.params as any).id, String(days)],
    );
    if (!t) return reply.code(404).send({ error: 'not_found' });
    invalidateState(t.id);
    return t;
  });

}
