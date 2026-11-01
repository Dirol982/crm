import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, pool, q } from '../lib/db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { decrypt, encrypt, mask } from '../lib/secrets.js';
import { checkTelegram, checkVk, sendTelegram, sendVk, SocialError, type SocialPost } from '../lib/social.js';

const MAX_ATTEMPTS = 5;

const channelBody = z.object({
  type: z.enum(['telegram', 'vk']),
  name: z.string().trim().min(1).max(100),
  target: z.string().trim().min(1).max(100),
  secret: z.string().trim().min(10).max(500),
  active: z.boolean().default(true),
});

/** Нормализация адресата: t.me/name → @name; vk.com/club123 → 123 */
function normTarget(type: string, t: string) {
  t = t.trim();
  if (type === 'telegram') {
    const m = t.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{4,})\/?$/);
    if (m) return `@${m[1]}`;
    return /^-?\d+$/.test(t) || t.startsWith('@') ? t : `@${t}`;
  }
  const m = t.match(/(?:club|public|-)?(\d+)\/?$/);
  return m ? m[1] : t;
}

/** Ссылка на статью на сайте клиента */
export function postUrl(site: { post_url_template: string | null; domain: string | null }, slug: string) {
  if (site.post_url_template?.includes('{slug}')) return site.post_url_template.replace('{slug}', encodeURIComponent(slug));
  if (site.domain) return `https://${site.domain}/?post=${encodeURIComponent(slug)}`;
  return null;
}

/** Привязать публикацию к выбранным каналам (не трогая уже отправленное) */
export async function syncDeliveries(tenantId: string, postId: string, channelIds: string[]) {
  const valid = (await q<{ id: string }>('SELECT id FROM channels WHERE tenant_id=$1 AND id = ANY($2)', [tenantId, channelIds])).map((c) => c.id);
  await pool.query(`DELETE FROM post_deliveries WHERE post_id=$1 AND status IN ('pending','failed') AND NOT (channel_id = ANY($2))`, [postId, valid]);
  for (const cid of valid) {
    await pool.query('INSERT INTO post_deliveries(post_id, channel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [postId, cid]);
  }
}

export async function deliveriesFor(postId: string) {
  return q(
    `SELECT d.id, d.channel_id, c.name AS channel_name, c.type, d.status, d.attempts, d.external_url, d.error, d.sent_at, d.next_attempt_at
     FROM post_deliveries d JOIN channels c ON c.id=d.channel_id WHERE d.post_id=$1 ORDER BY c.name`,
    [postId],
  );
}

let running = false;
/**
 * Отправка в соцсети опубликованных материалов. Берёт задачи с блокировкой (SKIP LOCKED),
 * поэтому безопасно при нескольких экземплярах сервера. Ошибки сети — повтор с паузой
 * 1, 2, 4, 8 минут; ошибки доступа (неверный токен, нет прав) — сразу «ошибка».
 */
export async function processDeliveries(log?: { error: (e: unknown) => void; info: (m: string) => void }) {
  if (running) return;
  running = true;
  try {
    // зависшие «отправляется» (сервер упал во время отправки) возвращаем в очередь
    await pool.query(`UPDATE post_deliveries SET status='pending' WHERE status='sending' AND next_attempt_at < now() - interval '10 minutes'`);
    const jobs = (await pool.query(
      `UPDATE post_deliveries d SET status='sending', attempts=attempts+1, next_attempt_at=now()
       WHERE d.id IN (
         SELECT d2.id FROM post_deliveries d2
         JOIN posts p ON p.id=d2.post_id JOIN channels c ON c.id=d2.channel_id
         WHERE d2.status='pending' AND d2.next_attempt_at <= now() AND c.active AND p.status='published'
         ORDER BY d2.next_attempt_at LIMIT 20 FOR UPDATE OF d2 SKIP LOCKED)
       RETURNING d.id, d.post_id, d.channel_id, d.attempts`,
    )).rows;
    for (const j of jobs) {
      const row = await one(
        `SELECT p.title, p.slug, p.excerpt, p.content, p.cover_url, p.social_text, s.domain, s.post_url_template, c.type, c.target, c.secret
         FROM posts p JOIN sites s ON s.id=p.site_id, channels c WHERE p.id=$1 AND c.id=$2`,
        [j.post_id, j.channel_id],
      );
      if (!row) continue;
      const post: SocialPost = { ...row, url: postUrl(row, row.slug) };
      try {
        const token = decrypt(row.secret);
        const res = row.type === 'telegram' ? await sendTelegram(token, row.target, post) : await sendVk(token, row.target, post);
        await pool.query(`UPDATE post_deliveries SET status='sent', external_url=$2, error=NULL, sent_at=now() WHERE id=$1`, [j.id, res.url]);
        log?.info(`crosspost sent: ${row.type} ${j.post_id}`);
      } catch (e: any) {
        const permanent = e instanceof SocialError ? e.permanent : false;
        const last = permanent || j.attempts >= MAX_ATTEMPTS;
        await pool.query(
          `UPDATE post_deliveries SET status=$2, error=$3, next_attempt_at=now() + ($4 || ' minutes')::interval WHERE id=$1`,
          [j.id, last ? 'failed' : 'pending', String(e.message).slice(0, 500), String(2 ** (j.attempts - 1))],
        );
        if (!(e instanceof SocialError)) log?.error(e);
      }
    }
  } finally {
    running = false;
  }
}

export default async function channelRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole('admin') };

  app.get('/api/channels', { preHandler: requireAuth }, async (req) => {
    const rows = await q(
      `SELECT c.id, c.type, c.name, c.target, c.secret, c.active, c.created_at,
              count(d.*) FILTER (WHERE d.status='sent')::int AS sent,
              count(d.*) FILTER (WHERE d.status='failed')::int AS failed,
              max(d.sent_at) AS last_sent_at
       FROM channels c LEFT JOIN post_deliveries d ON d.channel_id=c.id
       WHERE c.tenant_id=$1 GROUP BY c.id ORDER BY c.created_at`,
      [req.user.tid],
    );
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    return rows.map(({ secret, ...c }) => {
      let m = '••••';
      try { m = mask(decrypt(secret)); } catch { /* ключ сменился */ }
      return { ...c, secret_mask: isAdmin ? m : undefined };
    });
  });

  app.post('/api/channels', admin, async (req) => {
    const b = channelBody.parse(req.body);
    return one(
      'INSERT INTO channels(tenant_id,type,name,target,secret,active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, type, name, target, active',
      [req.user.tid, b.type, b.name, normTarget(b.type, b.target), encrypt(b.secret), b.active],
    );
  });

  app.patch('/api/channels/:id', admin, async (req, reply) => {
    const b = channelBody.partial().omit({ type: true }).parse(req.body);
    const cur = await one('SELECT type FROM channels WHERE id=$1 AND tenant_id=$2', [(req.params as any).id, req.user.tid]);
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    return one(
      `UPDATE channels SET name=COALESCE($3,name), target=COALESCE($4,target), secret=COALESCE($5,secret), active=COALESCE($6,active)
       WHERE id=$1 AND tenant_id=$2 RETURNING id, type, name, target, active`,
      [(req.params as any).id, req.user.tid, b.name, b.target ? normTarget(cur.type, b.target) : null, b.secret ? encrypt(b.secret) : null, b.active],
    );
  });

  app.delete('/api/channels/:id', admin, async (req, reply) => {
    const r = await one('DELETE FROM channels WHERE id=$1 AND tenant_id=$2 RETURNING id', [(req.params as any).id, req.user.tid]);
    return r ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  /** Проверка подключения: токен валиден, бот — админ канала / сообщество доступно */
  app.post('/api/channels/:id/test', { ...admin, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const c = await one('SELECT type, target, secret FROM channels WHERE id=$1 AND tenant_id=$2', [(req.params as any).id, req.user.tid]);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    try {
      const token = decrypt(c.secret);
      const r = c.type === 'telegram' ? await checkTelegram(token, c.target) : await checkVk(token, c.target);
      return { ok: true, info: r.info };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  app.get('/api/deliveries', { preHandler: requireAuth }, async (req) =>
    q(
      `SELECT d.id, d.status, d.attempts, d.external_url, d.error, d.sent_at, d.created_at, d.next_attempt_at,
              c.name AS channel_name, c.type, p.id AS post_id, p.title AS post_title, p.status AS post_status, p.publish_at
       FROM post_deliveries d JOIN channels c ON c.id=d.channel_id JOIN posts p ON p.id=d.post_id
       WHERE c.tenant_id=$1 ORDER BY COALESCE(d.sent_at, p.publish_at, d.created_at) DESC LIMIT 100`,
      [req.user.tid],
    ),
  );

  app.post('/api/deliveries/:id/retry', { preHandler: requireRole('manager') }, async (req, reply) => {
    const r = await one(
      `UPDATE post_deliveries d SET status='pending', next_attempt_at=now(), error=NULL, attempts=0
       FROM channels c WHERE d.id=$1 AND c.id=d.channel_id AND c.tenant_id=$2 AND d.status='failed' RETURNING d.id`,
      [(req.params as any).id, req.user.tid],
    );
    if (!r) return reply.code(404).send({ error: 'not_found' });
    setImmediate(() => processDeliveries(app.log).catch((e) => app.log.error(e)));
    return { ok: true };
  });
}
