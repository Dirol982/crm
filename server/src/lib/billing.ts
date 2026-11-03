/**
 * Оплата через ЮKassa (https://yookassa.ru/developers/api).
 * Без YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY оплата выключена и лимитов нет —
 * так работает разработка и «коробочная» установка на сервер клиента.
 */
import { randomUUID } from 'node:crypto';
import { one, pool, q } from './db.js';
import { config } from './config.js';
import { addonApplies, GRACE_DAYS, hasAi, isPlan, PLANS, priceFor, TRIAL_PLAN, type PlanId } from './plans.js';
import { queueEmail } from './mailer.js';
import { paymentSucceededEmail, renewFailedEmail } from './emails.js';

export const billingConfig = {
  shopId: process.env.YOOKASSA_SHOP_ID ?? '',
  secretKey: process.env.YOOKASSA_SECRET_KEY ?? '',
  apiUrl: (process.env.YOOKASSA_API_URL ?? 'https://api.yookassa.ru').replace(/\/$/, ''),
  // Чеки по 54-ФЗ через ЮKassa: включите, если подключены «Чеки от ЮKassa» или онлайн-касса
  receipts: process.env.YOOKASSA_RECEIPTS === 'true',
  vatCode: Number(process.env.YOOKASSA_VAT_CODE ?? 1), // 1 = без НДС
  superadmins: (process.env.SUPERADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  seller: {
    name: process.env.SELLER_NAME ?? '', inn: process.env.SELLER_INN ?? '', kpp: process.env.SELLER_KPP ?? '',
    address: process.env.SELLER_ADDRESS ?? '', bank: process.env.SELLER_BANK ?? '', bik: process.env.SELLER_BIK ?? '',
    account: process.env.SELLER_ACCOUNT ?? '', corr: process.env.SELLER_CORR_ACCOUNT ?? '',
  },
};
export const billingEnabled = () => !!(billingConfig.shopId && billingConfig.secretKey);
export const invoicesEnabled = () => !!(billingConfig.seller.name && billingConfig.seller.inn && billingConfig.seller.account);

export type AccountStatus = 'unlimited' | 'trial' | 'active' | 'grace' | 'frozen';

export interface AccountState {
  status: AccountStatus;
  plan: PlanId | null;          // по чьим лимитам работает аккаунт
  limits: { visits: number; sites: number; users: number } | null;
  trial_ends_at: string | null;
  paid_until: string | null;
  days_left: number | null;
  ai: boolean;                  // доступен ли ИИ-агент рекламы
  ai_addon: boolean;            // подключена ли опция «ИИ-агент» (для тарифов, куда он не входит)
}

const DAY = 86400000;

export function accountState(t: { plan: string; trial_ends_at: Date | string; paid_until: Date | string | null; ai_addon?: boolean }): AccountState {
  if (!billingEnabled()) return { status: 'unlimited', plan: null, limits: null, trial_ends_at: null, paid_until: null, days_left: null, ai: true, ai_addon: false };
  const now = Date.now();
  const paid = t.paid_until ? new Date(t.paid_until).getTime() : null;
  const trial = new Date(t.trial_ends_at).getTime();
  const plan = isPlan(t.plan) ? t.plan : TRIAL_PLAN;
  const addon = addonApplies(plan, t.ai_addon);
  const base = { trial_ends_at: new Date(trial).toISOString(), paid_until: paid ? new Date(paid).toISOString() : null, ai_addon: addon };
  const lim = (p: PlanId) => ({ visits: PLANS[p].visits, sites: PLANS[p].sites, users: PLANS[p].users });
  const ai = hasAi(plan, addon);
  if (paid && paid > now) return { ...base, status: 'active', plan, limits: lim(plan), days_left: Math.ceil((paid - now) / DAY), ai };
  if (paid && paid + GRACE_DAYS * DAY > now) return { ...base, status: 'grace', plan, limits: lim(plan), days_left: Math.ceil((paid + GRACE_DAYS * DAY - now) / DAY), ai };
  if (!paid && trial > now) return { ...base, status: 'trial', plan: TRIAL_PLAN, limits: lim(TRIAL_PLAN), days_left: Math.ceil((trial - now) / DAY), ai: hasAi(TRIAL_PLAN, false) };
  return { ...base, status: 'frozen', plan: isPlan(t.plan) ? t.plan : null, limits: null, days_left: 0, ai: false };
}

// Кэш состояния (проверяется на каждом запросе панели)
const cache = new Map<string, { at: number; state: AccountState }>();
export async function tenantState(tenantId: string): Promise<AccountState> {
  const c = cache.get(tenantId);
  if (c && Date.now() - c.at < 15_000) return c.state;
  const t = await one('SELECT plan, trial_ends_at, paid_until, ai_addon FROM tenants WHERE id=$1', [tenantId]);
  const state = t ? accountState(t) : accountState({ plan: 'trial', trial_ends_at: new Date(0), paid_until: null });
  cache.set(tenantId, { at: Date.now(), state });
  return state;
}
export const invalidateState = (tenantId: string) => cache.delete(tenantId);

export async function usage(tenantId: string) {
  const r = await one(
    `SELECT
       (SELECT count(*) FROM sessions s JOIN sites st ON st.id=s.site_id WHERE st.tenant_id=$1 AND s.started_at >= date_trunc('month', now()))::int AS visits,
       (SELECT count(*) FROM sites WHERE tenant_id=$1)::int AS sites,
       ((SELECT count(*) FROM memberships WHERE tenant_id=$1) + (SELECT count(*) FROM invitations WHERE tenant_id=$1 AND accepted_at IS NULL AND expires_at > now()))::int AS users`,
    [tenantId],
  );
  return r as { visits: number; sites: number; users: number };
}

/** Ошибка лимита тарифа для создания сайтов/сотрудников */
export async function assertLimit(tenantId: string, what: 'sites' | 'users') {
  const st = await tenantState(tenantId);
  if (!st.limits) return;
  const u = await usage(tenantId);
  if (u[what] >= st.limits[what]) throw Object.assign(new Error('plan_limit'), { statusCode: 402 });
}

// ---------------- ЮKassa ----------------
export class PaymentError extends Error {}

async function yk(method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${billingConfig.apiUrl}/v3${path}`, {
    method,
    headers: {
      authorization: 'Basic ' + Buffer.from(`${billingConfig.shopId}:${billingConfig.secretKey}`).toString('base64'),
      'content-type': 'application/json',
      ...(method === 'POST' ? { 'idempotence-key': randomUUID() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  }).catch((e) => { throw new PaymentError(`ЮKassa недоступна: ${e.message}`); });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) throw new PaymentError(`ЮKassa: ${data?.description ?? `HTTP ${res.status}`}`);
  return data;
}

function receipt(email: string | null, description: string, amount: number) {
  if (!billingConfig.receipts || !email) return undefined;
  return {
    customer: { email },
    items: [{
      description: description.slice(0, 128), quantity: '1.00', amount: { value: amount.toFixed(2), currency: 'RUB' },
      vat_code: billingConfig.vatCode, payment_mode: 'full_payment', payment_subject: 'service',
    }],
  };
}

const describe = (plan: PlanId, period: 'month' | 'year', addon = false) =>
  `Пульс CRM, тариф «${PLANS[plan].name}»${addonApplies(plan, addon) ? ' + ИИ-агент' : ''}, ${period === 'year' ? '12 месяцев' : '1 месяц'}`;

/** Платёж с переходом на страницу оплаты ЮKassa (карта, СБП, SberPay…) */
export async function createCheckout(tenantId: string, userId: string, plan: PlanId, period: 'month' | 'year', aiAddon = false) {
  const addon = addonApplies(plan, aiAddon);
  const amount = priceFor(plan, period, addon);
  const t = await one('SELECT billing_email, (SELECT email FROM users WHERE id=$2) AS user_email FROM tenants WHERE id=$1', [tenantId, userId]);
  const p = await one<{ id: string }>(
    `INSERT INTO payments(tenant_id, provider, plan, period, amount, created_by, ai_addon) VALUES ($1,'yookassa',$2,$3,$4,$5,$6) RETURNING id`,
    [tenantId, plan, period, amount, userId, addon],
  );
  try {
    const r = await yk('POST', '/payments', {
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      capture: true,
      save_payment_method: true, // для автопродления
      confirmation: { type: 'redirect', return_url: `${config.publicUrl}/app/#/billing?payment=${p!.id}` },
      description: describe(plan, period, addon),
      metadata: { tenant_id: tenantId, payment_id: p!.id },
      receipt: receipt(t?.billing_email || t?.user_email, describe(plan, period, addon), amount),
    });
    await pool.query('UPDATE payments SET external_id=$2, confirmation_url=$3 WHERE id=$1', [p!.id, r.id, r.confirmation?.confirmation_url ?? null]);
    return { id: p!.id, confirmation_url: r.confirmation?.confirmation_url as string };
  } catch (e: any) {
    await pool.query(`UPDATE payments SET status='canceled', error=$2 WHERE id=$1`, [p!.id, String(e.message).slice(0, 500)]);
    throw e;
  }
}

const PERIOD_DAYS = { month: 30, year: 365 } as const;

/**
 * Новый срок оплаты. Тот же тариф — период добавляется к оставшемуся сроку.
 * Другой тариф или период — неиспользованный остаток пересчитывается по стоимости
 * в дни нового тарифа (иначе можно оплатить год «Старта», доплатить месяц «Агентства»
 * и получить «Агентство» на весь год).
 */
export function nextPaidUntil(
  cur: { plan: string; period: string | null; paid_until: Date | null; ai_addon?: boolean },
  next: { plan: PlanId; period: 'month' | 'year'; ai_addon?: boolean },
  now = Date.now(),
) {
  const add = PERIOD_DAYS[next.period] * DAY;
  const left = cur.paid_until ? Math.max(0, cur.paid_until.getTime() - now) : 0;
  if (!left) return new Date(now + add);
  const oldPlan = isPlan(cur.plan) ? cur.plan : null;
  const oldAddon = !!oldPlan && addonApplies(oldPlan, cur.ai_addon), newAddon = addonApplies(next.plan, next.ai_addon);
  if (cur.plan === next.plan && cur.period === next.period && oldAddon === newAddon) return new Date(now + left + add);
  const oldPeriod = cur.period === 'year' ? 'year' : 'month';
  const oldDaily = oldPlan ? priceFor(oldPlan, oldPeriod, oldAddon) / PERIOD_DAYS[oldPeriod] : 0;
  const newDaily = priceFor(next.plan, next.period, newAddon) / PERIOD_DAYS[next.period];
  return new Date(now + add + Math.round(left * (oldDaily / newDaily)));
}

/** Зачислить оплату. Идемпотентно — повторное уведомление о том же платеже ничего не меняет. */
export async function applyPayment(paymentId: string, method?: { id: string; title: string } | null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = (await client.query(`UPDATE payments SET status='succeeded', paid_at=now(), error=NULL WHERE id=$1 AND status='pending' RETURNING *`, [paymentId])).rows[0];
    if (!p) { await client.query('ROLLBACK'); return false; }
    const t = (await client.query('SELECT plan, billing_period, paid_until, ai_addon FROM tenants WHERE id=$1 FOR UPDATE', [p.tenant_id])).rows[0];
    const until = nextPaidUntil({ plan: t.plan, period: t.billing_period, paid_until: t.paid_until, ai_addon: t.ai_addon }, { plan: p.plan, period: p.period, ai_addon: p.ai_addon });
    await client.query(
      `UPDATE tenants SET plan=$2, billing_period=$3, paid_until=$4, ai_addon=$7,
         payment_method_id = COALESCE($5, payment_method_id), payment_method_title = COALESCE($6, payment_method_title)
       WHERE id=$1`,
      [p.tenant_id, p.plan, p.period, until, method?.id ?? null, method?.title ?? null, !!p.ai_addon],
    );
    await client.query('COMMIT');
    invalidateState(p.tenant_id);
    const { billingContact } = await import('./notify.js');
    const c = await billingContact(p.tenant_id);
    if (c?.email) {
      await queueEmail({ to: c.email, kind: 'payment_succeeded', tenantId: p.tenant_id,
        ...paymentSucceededEmail({ company: c.company, plan: PLANS[p.plan as PlanId]?.name ?? p.plan, amount: Number(p.amount), until, renewal: p.is_renewal }) });
    }
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const methodTitle = (pm: any) => {
  if (!pm?.saved || !pm.id) return null;
  const title = pm.type === 'bank_card' && pm.card ? `Карта •••• ${pm.card.last4}` : pm.type === 'sbp' ? 'СБП' : pm.title ?? pm.type;
  return { id: pm.id as string, title: title as string };
};

/** Сверить платёж с ЮKassa (источник правды — их API, уведомления не подписаны) */
export async function syncPayment(paymentId: string) {
  const p = await one('SELECT id, external_id, status FROM payments WHERE id=$1', [paymentId]);
  if (!p?.external_id || p.status !== 'pending') return p?.status ?? null;
  const r = await yk('GET', `/payments/${encodeURIComponent(p.external_id)}`);
  if (r.status === 'succeeded') { await applyPayment(p.id, methodTitle(r.payment_method)); return 'succeeded'; }
  if (r.status === 'canceled') {
    await pool.query(`UPDATE payments SET status='canceled', error=$2 WHERE id=$1 AND status='pending'`, [p.id, r.cancellation_details?.reason ?? null]);
    return 'canceled';
  }
  return 'pending';
}

/**
 * Автопродление: за сутки до окончания списываем с сохранённой карты.
 * Не чаще одной попытки в 12 часов на компанию.
 */
export async function autoRenew(log?: { info: (m: string) => void; error: (e: unknown) => void }) {
  if (!billingEnabled()) return;
  const due = await q(
    `SELECT t.id, t.plan, t.billing_period, t.ai_addon, t.payment_method_id, t.billing_email, t.paid_until,
            (SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=t.id AND m.role='owner' LIMIT 1) AS owner_email
     FROM tenants t
     WHERE t.auto_renew AND t.payment_method_id IS NOT NULL AND t.paid_until IS NOT NULL
       AND t.paid_until < now() + interval '1 day' AND t.paid_until > now() - interval '${GRACE_DAYS} days'
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.tenant_id=t.id AND p.is_renewal AND p.created_at > now() - interval '12 hours')
     LIMIT 20`,
  );
  for (const t of due) {
    if (!isPlan(t.plan)) continue;
    const period = t.billing_period === 'year' ? 'year' : 'month';
    const addon = addonApplies(t.plan, t.ai_addon);
    const amount = priceFor(t.plan, period, addon);
    const p = await one<{ id: string }>(
      `INSERT INTO payments(tenant_id, provider, plan, period, amount, is_renewal, ai_addon) VALUES ($1,'yookassa',$2,$3,$4,true,$5) RETURNING id`,
      [t.id, t.plan, period, amount, addon],
    );
    try {
      const r = await yk('POST', '/payments', {
        amount: { value: amount.toFixed(2), currency: 'RUB' }, capture: true, payment_method_id: t.payment_method_id,
        description: `${describe(t.plan, period, addon)} (автопродление)`, metadata: { tenant_id: t.id, payment_id: p!.id },
        receipt: receipt(t.billing_email || t.owner_email, describe(t.plan, period, addon), amount),
      });
      await pool.query('UPDATE payments SET external_id=$2 WHERE id=$1', [p!.id, r.id]);
      if (r.status === 'succeeded') await applyPayment(p!.id, null);
      else if (r.status === 'canceled') {
        await pool.query(`UPDATE payments SET status='canceled', error=$2 WHERE id=$1`, [p!.id, r.cancellation_details?.reason ?? 'canceled']);
        const { billingContact } = await import('./notify.js');
        const c = await billingContact(t.id);
        if (c?.email) await queueEmail({ to: c.email, kind: 'renew_failed', tenantId: t.id, ...renewFailedEmail({ company: c.company, reason: r.cancellation_details?.reason ?? '', until: t.paid_until }) });
        // карта больше не работает (отозвано разрешение, истёк срок) — не пытаемся снова
        if (['permission_revoked', 'card_expired'].includes(r.cancellation_details?.reason)) {
          await pool.query('UPDATE tenants SET payment_method_id=NULL, payment_method_title=NULL WHERE id=$1', [t.id]);
        }
      }
      log?.info(`auto-renew ${t.id}: ${r.status}`);
    } catch (e: any) {
      await pool.query(`UPDATE payments SET status='canceled', error=$2 WHERE id=$1`, [p!.id, String(e.message).slice(0, 500)]);
      log?.error(e);
    }
  }
}

/** Подстраховка, если уведомление ЮKassa не дошло: сверяем «зависшие» платежи */
export async function syncPending(log?: { error: (e: unknown) => void }) {
  if (!billingEnabled()) return;
  const rows = await q(
    `SELECT id FROM payments WHERE provider='yookassa' AND status='pending' AND external_id IS NOT NULL
       AND created_at < now() - interval '1 minute' AND created_at > now() - interval '2 days' LIMIT 20`,
  );
  for (const r of rows) await syncPayment(r.id).catch((e) => log?.error(e));
}
