import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { one, q } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const range = z.object({
  site: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

interface Ctx { tid: string; tz: string; sites: string[]; from: string; to: string; site?: string }

/** Сайты тенанта (или один выбранный) + часовой пояс компании. */
async function ctx(req: FastifyRequest): Promise<Ctx> {
  const r = range.parse(req.query);
  const t = await one<{ timezone: string }>('SELECT timezone FROM tenants WHERE id=$1', [req.user.tid]);
  const sites = (await q<{ id: string }>(
    `SELECT id FROM sites WHERE tenant_id=$1 ${r.site ? 'AND id=$2' : ''}`,
    r.site ? [req.user.tid, r.site] : [req.user.tid],
  )).map((s) => s.id);
  return { tid: req.user.tid, tz: t?.timezone ?? 'UTC', sites, from: r.from, to: r.to, site: r.site };
}

// Границы периода в часовом поясе компании: [$from 00:00, $to+1 00:00)
const RANGE = (col: string, a: number) =>
  `${col} >= ($${a}::date)::timestamp AT TIME ZONE $${a + 2} AND ${col} < ($${a + 1}::date + 1)::timestamp AT TIME ZONE $${a + 2}`;

const shiftBack = (from: string, to: string) => {
  const f = new Date(from + 'T00:00:00Z');
  const t = new Date(to + 'T00:00:00Z');
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  const pf = new Date(f.getTime() - days * 86400000);
  const pt = new Date(f.getTime() - 86400000);
  return [pf.toISOString().slice(0, 10), pt.toISOString().slice(0, 10)];
};

async function totals(c: Ctx, from: string, to: string) {
  const s = await one(
    `SELECT count(*)::int AS sessions,
            count(DISTINCT visitor_id)::int AS visitors,
            COALESCE(sum(pageviews),0)::int AS pageviews,
            COALESCE(avg(duration_sec),0)::float AS avg_duration,
            COALESCE(avg(CASE WHEN pageviews<=1 AND events=0 THEN 1.0 ELSE 0 END),0)::float AS bounce_rate,
            count(*) FILTER (WHERE pageviews>1 OR events>0)::int AS engaged
     FROM sessions WHERE site_id = ANY($1) AND ${RANGE('started_at', 2)}`,
    [c.sites, from, to, c.tz],
  );
  // Без фильтра по сайту учитываем и офлайн/ручные заказы (site_id IS NULL)
  const o = await one(
    `SELECT count(*)::int AS orders, COALESCE(sum(amount),0)::float AS revenue,
            count(DISTINCT contact_id)::int AS customers
     FROM orders WHERE tenant_id=$1 AND status='paid'
       AND (${c.site ? 'site_id = ANY($5)' : 'true'}) AND ${RANGE('created_at', 2)}`,
    c.site ? [c.tid, from, to, c.tz, c.sites] : [c.tid, from, to, c.tz],
  );
  const l = await one(
    `SELECT count(*)::int AS leads FROM events WHERE site_id = ANY($1) AND name='lead' AND ${RANGE('ts', 2)}`,
    [c.sites, from, to, c.tz],
  );
  const conversion = s.sessions ? o.orders / s.sessions : 0;
  const aov = o.orders ? o.revenue / o.orders : 0;
  return { ...s, ...o, ...l, conversion, aov };
}

export default async function analyticsRoutes(app: FastifyInstance) {
  const opts = { preHandler: requireAuth };

  app.get('/api/analytics/overview', opts, async (req) => {
    const c = await ctx(req);
    const [pf, pt] = shiftBack(c.from, c.to);
    const [current, previous] = await Promise.all([totals(c, c.from, c.to), totals(c, pf, pt)]);

    const daily = await q(
      `WITH days AS (SELECT generate_series($2::date, $3::date, '1 day')::date AS day),
       s AS (SELECT (started_at AT TIME ZONE $4)::date AS day, count(*) sessions, count(DISTINCT visitor_id) visitors,
                    avg(CASE WHEN pageviews<=1 AND events=0 THEN 1.0 ELSE 0 END) bounce_rate
             FROM sessions WHERE site_id = ANY($1) AND ${RANGE('started_at', 2)} GROUP BY 1),
       o AS (SELECT (created_at AT TIME ZONE $4)::date AS day, count(*) orders, sum(amount) revenue
             FROM orders WHERE tenant_id=$5 AND status='paid' AND (${c.site ? 'site_id = ANY($1)' : 'true'}) AND ${RANGE('created_at', 2)} GROUP BY 1)
       SELECT to_char(days.day,'YYYY-MM-DD') AS day, COALESCE(s.sessions,0)::int sessions, COALESCE(s.visitors,0)::int visitors,
              COALESCE(s.bounce_rate,0)::float bounce_rate, COALESCE(o.orders,0)::int orders, COALESCE(o.revenue,0)::float revenue
       FROM days LEFT JOIN s USING(day) LEFT JOIN o USING(day) ORDER BY days.day`,
      [c.sites, c.from, c.to, c.tz, c.tid],
    );

    const funnel = [
      { step: 'visits', value: current.sessions },
      { step: 'engaged', value: current.engaged },
      { step: 'leads', value: current.leads },
      { step: 'orders', value: current.orders },
    ];
    return { current, previous, previous_range: { from: pf, to: pt }, daily, funnel };
  });

  app.get('/api/analytics/sources', opts, async (req) => {
    const c = await ctx(req);
    const sessions = await q(
      `SELECT source, medium, count(*)::int sessions, count(DISTINCT visitor_id)::int visitors,
              avg(CASE WHEN pageviews<=1 AND events=0 THEN 1.0 ELSE 0 END)::float bounce_rate,
              avg(duration_sec)::float avg_duration
       FROM sessions WHERE site_id = ANY($1) AND ${RANGE('started_at', 2)}
       GROUP BY 1,2`,
      [c.sites, c.from, c.to, c.tz],
    );
    const orders = await q(
      `SELECT COALESCE(source,'(unknown)') source, COALESCE(medium,'(none)') medium, count(*)::int orders, sum(amount)::float revenue
       FROM orders WHERE tenant_id=$1 AND status='paid' AND (${c.site ? 'site_id = ANY($5)' : 'true'}) AND ${RANGE('created_at', 2)}
       GROUP BY 1,2`,
      c.site ? [c.tid, c.from, c.to, c.tz, c.sites] : [c.tid, c.from, c.to, c.tz],
    );
    const map = new Map<string, any>();
    for (const s of sessions) map.set(`${s.source}|${s.medium}`, { ...s, orders: 0, revenue: 0 });
    for (const o of orders) {
      const k = `${o.source}|${o.medium}`;
      const row = map.get(k) ?? { source: o.source, medium: o.medium, sessions: 0, visitors: 0, bounce_rate: 0, avg_duration: 0, orders: 0, revenue: 0 };
      row.orders = o.orders;
      row.revenue = o.revenue;
      map.set(k, row);
    }
    return [...map.values()]
      .map((r) => ({ ...r, conversion: r.sessions ? r.orders / r.sessions : 0 }))
      .sort((a, b) => b.sessions - a.sessions || b.revenue - a.revenue);
  });

  app.get('/api/analytics/pages', opts, async (req) => {
    const c = await ctx(req);
    const params = [c.sites, c.from, c.to, c.tz];
    const [top, entry, exit] = await Promise.all([
      q(
        `SELECT path, count(*)::int views, count(DISTINCT session_id)::int sessions, avg(NULLIF(duration_sec,0))::float avg_time
         FROM pageviews WHERE site_id = ANY($1) AND ${RANGE('ts', 2)}
         GROUP BY path ORDER BY views DESC LIMIT 50`,
        params,
      ),
      q(
        `SELECT landing_page AS path, count(*)::int sessions,
                avg(CASE WHEN pageviews<=1 AND events=0 THEN 1.0 ELSE 0 END)::float bounce_rate
         FROM sessions WHERE site_id = ANY($1) AND ${RANGE('started_at', 2)}
         GROUP BY 1 ORDER BY sessions DESC LIMIT 50`,
        params,
      ),
      // Точки ухода: на какой странице закончилась сессия и доля выходов от просмотров страницы
      q(
        `WITH ex AS (SELECT exit_page AS path, count(*) exits FROM sessions
                     WHERE site_id = ANY($1) AND ${RANGE('started_at', 2)} GROUP BY 1),
              pv AS (SELECT path, count(*) views FROM pageviews WHERE site_id = ANY($1) AND ${RANGE('ts', 2)} GROUP BY 1)
         SELECT ex.path, ex.exits::int, COALESCE(pv.views, ex.exits)::int views,
                (ex.exits::float / GREATEST(COALESCE(pv.views, ex.exits),1)) exit_rate
         FROM ex LEFT JOIN pv USING(path) ORDER BY ex.exits DESC LIMIT 50`,
        params,
      ),
    ]);
    return { top, entry, exit };
  });

  app.get('/api/analytics/tech', opts, async (req) => {
    const c = await ctx(req);
    const params = [c.sites, c.from, c.to, c.tz];
    const by = (col: string) =>
      q(
        `SELECT COALESCE(${col},'Other') AS name, count(*)::int sessions,
                avg(CASE WHEN pageviews<=1 AND events=0 THEN 1.0 ELSE 0 END)::float bounce_rate
         FROM sessions WHERE site_id = ANY($1) AND ${RANGE('started_at', 2)} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
        params,
      );
    const [device, browser, os] = await Promise.all([by('device'), by('browser'), by('os')]);
    return { device, browser, os };
  });

  app.get('/api/analytics/events', opts, async (req) => {
    const c = await ctx(req);
    return q(
      `SELECT name, count(*)::int count, count(DISTINCT session_id)::int sessions, COALESCE(sum(value),0)::float value
       FROM events WHERE site_id = ANY($1) AND ${RANGE('ts', 2)} GROUP BY 1 ORDER BY 2 DESC LIMIT 100`,
      [c.sites, c.from, c.to, c.tz],
    );
  });

  app.get('/api/analytics/realtime', opts, async (req) => {
    const { site } = z.object({ site: z.string().uuid().optional() }).parse(req.query);
    const sites = (await q<{ id: string }>(`SELECT id FROM sites WHERE tenant_id=$1 ${site ? 'AND id=$2' : ''}`, site ? [req.user.tid, site] : [req.user.tid])).map((s) => s.id);
    const active = await one(
      `SELECT count(*)::int AS visitors FROM sessions WHERE site_id = ANY($1) AND last_activity_at > now() - interval '5 minutes'`,
      [sites],
    );
    const pages = await q(
      `SELECT exit_page AS path, count(*)::int visitors FROM sessions
       WHERE site_id = ANY($1) AND last_activity_at > now() - interval '5 minutes' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      [sites],
    );
    return { visitors: active?.visitors ?? 0, pages };
  });
}
