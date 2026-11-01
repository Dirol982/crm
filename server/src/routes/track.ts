import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { pool } from '../lib/db.js';
import { classifySource, clampStr, parseUA } from '../lib/util.js';
import { recordOrder, siteByPublicKey, upsertContact } from '../lib/ingest.js';

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor/i;

const payload = z.object({
  k: z.string().max(64),
  t: z.enum(['pv', 'leave', 'ev', 'id', 'order']),
  v: z.string().min(8).max(64),
  s: z.string().min(8).max(64),
  p: z.string().max(64).optional(),
  u: z.string().max(2000).optional(),
  ti: z.string().max(500).optional(),
  r: z.string().max(2000).optional(),
  h: z.string().max(253).optional(),
  utm: z.record(z.string().max(200)).optional(),
  d: z.number().min(0).max(86400).optional(),
  n: z.string().max(100).optional(),
  val: z.number().min(0).max(1e10).optional(),
  props: z.record(z.unknown()).optional(),
  who: z.object({ email: z.string().max(200).optional(), name: z.string().max(200).optional(), phone: z.string().max(50).optional() }).optional(),
  order: z.object({
    id: z.string().max(100).optional(),
    amount: z.number().min(0).max(1e10),
    currency: z.string().length(3).optional(),
    items: z.array(z.unknown()).max(200).optional(),
  }).optional(),
});

function hostMatches(origin: string | undefined, domain: string | null) {
  if (!domain) return true;
  if (!origin) return true; // sendBeacon из некоторых браузеров без Origin
  try {
    const h = new URL(origin).hostname.replace(/^www\./, '');
    const d = domain.replace(/^www\./, '');
    return h === d || h.endsWith('.' + d);
  } catch {
    return false;
  }
}

export default async function trackRoutes(app: FastifyInstance) {
  // sendBeacon шлёт text/plain — разбираем как JSON
  app.addContentTypeParser('text/plain', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
    try { done(null, JSON.parse(body as string)); } catch (e) { done(e as Error, undefined); }
  });

  const trackerJs = await readFile(new URL('../../../tracker/t.js', import.meta.url), 'utf8').catch(() => '/* tracker missing */');
  app.get('/t.js', async (_req, reply) =>
    reply.header('content-type', 'application/javascript; charset=utf-8').header('cache-control', 'public, max-age=3600').header('access-control-allow-origin', '*').send(trackerJs),
  );

  app.options('/t', async (_req, reply) =>
    reply.header('access-control-allow-origin', '*').header('access-control-allow-methods', 'POST').header('access-control-allow-headers', 'content-type').code(204).send(),
  );

  app.post('/t', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('access-control-allow-origin', '*');
    const ua = req.headers['user-agent'] ?? '';
    const parsed = payload.safeParse(req.body);
    if (!parsed.success || BOT_RE.test(ua)) return reply.code(204).send();
    const b = parsed.data;
    const site = await siteByPublicKey(b.k);
    if (!site || !hostMatches(req.headers.origin, site.domain)) return reply.code(204).send();

    const path = clampStr(b.u, 2000) ?? '/';
    switch (b.t) {
      case 'pv': {
        const { source, medium } = classifySource({ utm_source: b.utm?.source, utm_medium: b.utm?.medium, referrer: b.r, host: b.h });
        const { device, browser, os } = parseUA(ua);
        await pool.query(
          `INSERT INTO visitors(site_id,id) VALUES ($1,$2) ON CONFLICT (site_id,id) DO UPDATE SET last_seen=now()`,
          [site.id, b.v],
        );
        await pool.query(
          `INSERT INTO sessions(site_id,id,visitor_id,started_at,last_activity_at,landing_page,exit_page,referrer,source,medium,campaign,device,browser,os,pageviews)
           VALUES ($1,$2,$3,now(),now(),$4,$4,$5,$6,$7,$8,$9,$10,$11,1)
           ON CONFLICT (site_id,id) DO UPDATE SET last_activity_at=now(), exit_page=$4, pageviews=sessions.pageviews+1,
             duration_sec=GREATEST(sessions.duration_sec, EXTRACT(EPOCH FROM now()-sessions.started_at)::int)`,
          [site.id, b.s, b.v, path, clampStr(b.r, 2000), source, medium, clampStr(b.utm?.campaign, 200), device, browser, os],
        );
        if (b.p) {
          await pool.query(
            'INSERT INTO pageviews(site_id,session_id,visitor_id,pv_id,path,title,ts) VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT DO NOTHING',
            [site.id, b.s, b.v, b.p, path, clampStr(b.ti, 500)],
          );
        }
        break;
      }
      case 'leave': {
        const d = Math.round(b.d ?? 0);
        if (b.p) await pool.query('UPDATE pageviews SET duration_sec=GREATEST(duration_sec,$3) WHERE site_id=$1 AND pv_id=$2', [site.id, b.p, d]);
        await pool.query(
          `UPDATE sessions SET last_activity_at=now(), duration_sec=GREATEST(duration_sec, EXTRACT(EPOCH FROM now()-started_at)::int) WHERE site_id=$1 AND id=$2`,
          [site.id, b.s],
        );
        break;
      }
      case 'ev': {
        if (!b.n) break;
        await pool.query(
          'INSERT INTO events(site_id,session_id,visitor_id,name,path,value,props,ts) VALUES ($1,$2,$3,$4,$5,$6,$7,now())',
          [site.id, b.s, b.v, b.n, path, b.val ?? null, JSON.stringify(b.props ?? {})],
        );
        await pool.query('UPDATE sessions SET events=events+1, last_activity_at=now() WHERE site_id=$1 AND id=$2', [site.id, b.s]);
        if (b.who) await identify(site, b);
        break;
      }
      case 'id':
        if (b.who) await identify(site, b);
        break;
      case 'order':
        if (b.order) {
          if (b.who) await identify(site, b);
          await recordOrder(site.tenant_id, site.id, {
            external_id: b.order.id ? `web:${b.order.id}` : null,
            amount: b.order.amount, currency: b.order.currency, items: b.order.items,
            customer: b.who, visitor_id: b.v, session_id: b.s,
          });
          await pool.query('UPDATE sessions SET events=events+1 WHERE site_id=$1 AND id=$2', [site.id, b.s]);
        }
        break;
    }
    return reply.code(204).send();
  });
}

async function identify(site: { id: string; tenant_id: string }, b: z.infer<typeof payload>) {
  const src = (await pool.query('SELECT source FROM sessions WHERE site_id=$1 AND id=$2', [site.id, b.s])).rows[0]?.source;
  const contactId = await upsertContact(pool, site.tenant_id, b.who!, src);
  if (contactId) await pool.query('UPDATE visitors SET contact_id=$3 WHERE site_id=$1 AND id=$2', [site.id, b.v, contactId]);
}
