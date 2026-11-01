/**
 * Напоминания об оплате и еженедельный отчёт. Запускается планировщиком раз в 5 минут;
 * каждое напоминание отправляется один раз (таблица notifications_sent).
 */
import { one, pool, q } from './db.js';
import { billingEnabled } from './billing.js';
import { GRACE_DAYS } from './plans.js';
import { queueEmail, unsubUrl } from './mailer.js';
import { digestEmail, frozenEmail, paidEndingEmail, trialEndingEmail, type Digest } from './emails.js';

/** Кому писать по оплате: почта для счетов или владелец */
export async function billingContact(tenantId: string) {
  return one<{ email: string; company: string }>(
    `SELECT COALESCE(t.billing_email, (SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id
              WHERE m.tenant_id=t.id AND m.role='owner' ORDER BY m.created_at LIMIT 1)) AS email, t.name AS company
     FROM tenants t WHERE t.id=$1`,
    [tenantId],
  );
}

/** true — если напоминание ещё не отправлялось (и теперь помечено отправленным) */
async function once(tenantId: string, kind: string, ref: string) {
  const r = await pool.query('INSERT INTO notifications_sent(tenant_id, kind, ref) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1', [tenantId, kind, ref]);
  return (r.rowCount ?? 0) > 0;
}

const isoDate = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

async function billingReminders() {
  if (!billingEnabled()) return;
  // пробный период заканчивается в ближайшие 3 дня
  for (const t of await q(`SELECT id, trial_ends_at FROM tenants WHERE paid_until IS NULL AND trial_ends_at BETWEEN now() AND now() + interval '3 days'`)) {
    if (!(await once(t.id, 'trial_ending', isoDate(t.trial_ends_at)))) continue;
    const c = await billingContact(t.id);
    const days = Math.max(1, Math.ceil((new Date(t.trial_ends_at).getTime() - Date.now()) / 864e5));
    if (c?.email) await queueEmail({ to: c.email, kind: 'trial_ending', tenantId: t.id, ...trialEndingEmail({ company: c.company, days, ends: t.trial_ends_at }) });
  }
  // оплата заканчивается, а автопродления нет
  for (const t of await q(`SELECT id, paid_until FROM tenants WHERE paid_until BETWEEN now() AND now() + interval '3 days' AND (NOT auto_renew OR payment_method_id IS NULL)`)) {
    if (!(await once(t.id, 'paid_ending', isoDate(t.paid_until)))) continue;
    const c = await billingContact(t.id);
    if (c?.email) await queueEmail({ to: c.email, kind: 'paid_ending', tenantId: t.id, ...paidEndingEmail({ company: c.company, until: t.paid_until }) });
  }
  // доступ приостановлен (в течение недели после заморозки — чтобы не писать давно ушедшим)
  for (const t of await q(
    `SELECT id, paid_until, trial_ends_at FROM tenants
     WHERE (paid_until IS NULL AND trial_ends_at < now() AND trial_ends_at > now() - interval '7 days')
        OR (paid_until IS NOT NULL AND paid_until + interval '${GRACE_DAYS} days' < now() AND paid_until > now() - interval '10 days')`,
  )) {
    const reason = t.paid_until ? 'paid' : 'trial';
    if (!(await once(t.id, 'frozen', `${reason}:${isoDate(t.paid_until ?? t.trial_ends_at)}`))) continue;
    const c = await billingContact(t.id);
    if (c?.email) await queueEmail({ to: c.email, kind: 'frozen', tenantId: t.id, ...frozenEmail({ company: c.company, reason }) });
  }
}

/** Понедельник утром по времени компании — отчёт за прошлую неделю владельцам и админам */
async function weeklyDigests() {
  const tenants = await q(
    `SELECT t.id, t.name, t.timezone,
            to_char((now() AT TIME ZONE t.timezone)::date - 7, 'IYYY-IW') AS week,
            ((now() AT TIME ZONE t.timezone)::date - 7) AS w_from, ((now() AT TIME ZONE t.timezone)::date - 1) AS w_to
     FROM tenants t
     WHERE extract(isodow FROM now() AT TIME ZONE t.timezone) = 1
       AND extract(hour FROM now() AT TIME ZONE t.timezone) BETWEEN 8 AND 11
       AND (NOT $1::boolean OR t.paid_until > now() - interval '${GRACE_DAYS} days' OR (t.paid_until IS NULL AND t.trial_ends_at > now()))`,
    [billingEnabled()],
  );
  for (const t of tenants) {
    const d = await digestFor(t.id, t.name, t.timezone, t.w_from, t.w_to);
    if (!d.sessions && !d.orders) continue; // нечего рассказывать — не шлём
    const recipients = await q(
      `SELECT u.id, u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.role IN ('owner','admin') AND u.email_digest`,
      [t.id],
    );
    if (!recipients.length || !(await once(t.id, 'digest', t.week))) continue;
    for (const r of recipients) {
      const unsub = unsubUrl(r.id);
      await queueEmail({
        to: r.email, kind: 'digest', tenantId: t.id, ...digestEmail(d, unsub),
        headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
    }
  }
}

export async function digestFor(tenantId: string, company: string, tz: string, from: Date | string, to: Date | string): Promise<Digest> {
  const f = isoDate(from), tt = isoDate(to);
  const R = (col: string) => `${col} >= ($2::date)::timestamp AT TIME ZONE $4 AND ${col} < ($3::date + 1)::timestamp AT TIME ZONE $4`;
  const P = (col: string) => `${col} >= ($2::date - 7)::timestamp AT TIME ZONE $4 AND ${col} < ($2::date)::timestamp AT TIME ZONE $4`;
  const sites = `(SELECT id FROM sites WHERE tenant_id=$1)`;
  const args = [tenantId, f, tt, tz];
  const s = await one(
    `SELECT count(*) FILTER (WHERE ${R('started_at')})::int AS cur, count(*) FILTER (WHERE ${P('started_at')})::int AS prev
     FROM sessions WHERE site_id IN ${sites}`, args);
  const o = await one(
    `SELECT coalesce(sum(amount) FILTER (WHERE ${R('created_at')}),0)::float AS rev, coalesce(sum(amount) FILTER (WHERE ${P('created_at')}),0)::float AS rev_prev,
            count(*) FILTER (WHERE ${R('created_at')})::int AS orders
     FROM orders WHERE tenant_id=$1 AND status='paid'`, args);
  const l = await one(`SELECT count(*)::int AS n FROM events WHERE site_id IN ${sites} AND name='lead' AND ${R('ts')}`, args);
  const src = await q(
    `SELECT CASE WHEN source='(direct)' THEN 'Прямые заходы' WHEN source='manual' THEN 'Вручную / офлайн' ELSE coalesce(source,'не определён') || ' · ' || coalesce(medium,'') END AS label,
            sum(amount)::float AS revenue,
            (SELECT count(*) FROM sessions s WHERE s.site_id IN ${sites} AND s.source=o.source AND s.medium=o.medium AND ${R('s.started_at')})::int AS sessions
     FROM orders o WHERE o.tenant_id=$1 AND o.status='paid' AND ${R('o.created_at')}
     GROUP BY o.source, o.medium ORDER BY revenue DESC LIMIT 5`, args);
  const ex = await one(
    `WITH ex AS (SELECT exit_page AS path, count(*) n FROM sessions WHERE site_id IN ${sites} AND ${R('started_at')} GROUP BY 1),
          pv AS (SELECT path, count(*) v FROM pageviews WHERE site_id IN ${sites} AND ${R('ts')} GROUP BY 1)
     SELECT ex.path, ex.n::float / GREATEST(pv.v, 1) AS rate FROM ex JOIN pv USING(path) WHERE pv.v >= 30 ORDER BY rate DESC LIMIT 1`, args);
  const fmt = (d: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(d + 'T00:00:00'));
  return {
    company, from: fmt(f), to: fmt(tt),
    revenue: o.rev, revenuePrev: o.rev_prev, orders: o.orders, sessions: s.cur, sessionsPrev: s.prev, leads: l.n,
    conversion: s.cur ? o.orders / s.cur : 0, sources: src, exitPage: ex ?? null,
  };
}

export async function runNotifications(log?: { error: (e: unknown) => void }) {
  await billingReminders().catch((e) => log?.error(e));
  await weeklyDigests().catch((e) => log?.error(e));
}
