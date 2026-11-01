import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { one, pool, q } from '../lib/db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { cleanHtml, escapeXml, slugify, textExcerpt } from '../lib/content.js';

const STATUSES = ['idea', 'draft', 'review', 'scheduled', 'published', 'archived'] as const;
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const postBody = z.object({
  site_id: z.string().uuid(),
  type: z.enum(['post', 'page']).default('post'),
  title: z.string().trim().min(1).max(300),
  slug: z.string().trim().max(100).optional().nullable(),
  excerpt: z.string().max(1000).optional().nullable(),
  content: z.string().max(500_000).default(''),
  cover_url: z.string().url().max(1000).optional().nullable().or(z.literal('').transform(() => null)),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  status: z.enum(STATUSES).default('draft'),
  publish_at: z.string().datetime({ offset: true }).optional().nullable(),
  seo_title: z.string().max(300).optional().nullable(),
  seo_description: z.string().max(500).optional().nullable(),
});

const blockBody = z.object({
  site_id: z.string().uuid(),
  key: z.string().trim().regex(/^[a-z0-9_-]{1,50}$/i),
  title: z.string().trim().min(1).max(200),
  html: z.string().max(100_000).default(''),
  active: z.boolean().default(true),
  starts_at: z.string().datetime({ offset: true }).optional().nullable(),
  ends_at: z.string().datetime({ offset: true }).optional().nullable(),
});

// Опубликовано = published, либо scheduled с наступившим временем (на случай задержки планировщика)
const LIVE = `(p.status='published' OR (p.status='scheduled' AND p.publish_at <= now()))`;

/** Публикует запланированные материалы, у которых наступило время */
export async function publishDue() {
  const r = await pool.query(
    `UPDATE posts SET status='published', published_at=COALESCE(publish_at, now()), updated_at=now()
     WHERE status='scheduled' AND publish_at <= now() RETURNING id`,
  );
  return r.rowCount ?? 0;
}

/** Нормализация статуса и дат перед сохранением */
function schedule(status: string, publishAt: string | null | undefined, wasPublishedAt: string | null) {
  if (status === 'scheduled') {
    if (!publishAt) throw Object.assign(new Error('publish_at_required'), { statusCode: 400 });
    if (new Date(publishAt) <= new Date()) return { status: 'published', publish_at: publishAt, published_at: publishAt };
    return { status, publish_at: publishAt, published_at: null };
  }
  if (status === 'published') return { status, publish_at: publishAt ?? null, published_at: wasPublishedAt ?? new Date().toISOString() };
  return { status, publish_at: publishAt ?? null, published_at: status === 'archived' ? wasPublishedAt : null };
}

async function uniqueSlug(siteId: string, type: string, base: string, exceptId?: string) {
  let slug = slugify(base);
  for (let i = 2; ; i++) {
    const taken = await one('SELECT 1 FROM posts WHERE site_id=$1 AND type=$2 AND slug=$3 AND id IS DISTINCT FROM $4', [siteId, type, slug, exceptId ?? null]);
    if (!taken) return slug;
    slug = `${slugify(base).slice(0, 74)}-${i}`;
  }
}

async function assertSite(tenantId: string, siteId: string) {
  if (!(await one('SELECT 1 FROM sites WHERE id=$1 AND tenant_id=$2', [siteId, tenantId]))) {
    throw Object.assign(new Error('site_not_found'), { statusCode: 404 });
  }
}

export default async function contentRoutes(app: FastifyInstance) {
  const uploadDir = process.env.UPLOAD_DIR ?? new URL('../../uploads', import.meta.url).pathname;
  mkdirSync(uploadDir, { recursive: true });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  const read = { preHandler: requireAuth };
  const write = { preHandler: requireRole('manager') };

  // ---------------- Публикации ----------------
  app.get('/api/posts', read, async (req) => {
    const f = z.object({
      site: z.string().uuid().optional(), type: z.enum(['post', 'page']).optional(), status: z.enum(STATUSES).optional(), q: z.string().max(200).optional(),
    }).parse(req.query);
    const params: unknown[] = [req.user.tid];
    const where = ['p.tenant_id=$1'];
    if (f.site) { params.push(f.site); where.push(`p.site_id=$${params.length}`); }
    if (f.type) { params.push(f.type); where.push(`p.type=$${params.length}`); }
    if (f.status) { params.push(f.status); where.push(`p.status=$${params.length}`); }
    if (f.q) { params.push(`%${f.q}%`); where.push(`p.title ILIKE $${params.length}`); }
    return q(
      `SELECT p.id, p.site_id, s.name AS site_name, p.type, p.title, p.slug, p.status, p.publish_at, p.published_at, p.tags, p.cover_url,
              p.updated_at, u.name AS author_name,
              (SELECT count(*) FROM events e WHERE e.site_id=p.site_id AND e.name='post_view' AND e.props->>'slug'=p.slug)::int AS views
       FROM posts p JOIN sites s ON s.id=p.site_id LEFT JOIN users u ON u.id=p.author_id
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(p.published_at, p.publish_at, p.updated_at) DESC LIMIT 500`,
      params,
    );
  });

  app.get('/api/posts/calendar', read, async (req) => {
    const r = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), site: z.string().uuid().optional() }).parse(req.query);
    return q(
      `SELECT p.id, p.site_id, s.name AS site_name, p.type, p.title, p.status, COALESCE(p.published_at, p.publish_at) AS date
       FROM posts p JOIN sites s ON s.id=p.site_id
       WHERE p.tenant_id=$1 AND p.status <> 'archived' ${r.site ? 'AND p.site_id=$4' : ''}
         AND COALESCE(p.published_at, p.publish_at) >= $2::date - interval '1 day'
         AND COALESCE(p.published_at, p.publish_at) <  $3::date + interval '2 day'
       ORDER BY date`,
      r.site ? [req.user.tid, r.from, r.to, r.site] : [req.user.tid, r.from, r.to],
    );
  });

  app.get('/api/posts/:id', read, async (req, reply) => {
    const p = await one(
      `SELECT p.*, s.name AS site_name, s.domain AS site_domain,
              (SELECT count(*) FROM events e WHERE e.site_id=p.site_id AND e.name='post_view' AND e.props->>'slug'=p.slug)::int AS views
       FROM posts p JOIN sites s ON s.id=p.site_id WHERE p.id=$1 AND p.tenant_id=$2`,
      [(req.params as any).id, req.user.tid],
    );
    return p ?? reply.code(404).send({ error: 'not_found' });
  });

  app.post('/api/posts', write, async (req) => {
    const b = postBody.parse(req.body);
    await assertSite(req.user.tid, b.site_id);
    const s = schedule(b.status, b.publish_at, null);
    const slug = await uniqueSlug(b.site_id, b.type, b.slug || b.title);
    return one(
      `INSERT INTO posts(tenant_id,site_id,type,title,slug,excerpt,content,cover_url,tags,status,publish_at,published_at,seo_title,seo_description,author_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [req.user.tid, b.site_id, b.type, b.title, slug, b.excerpt || null, cleanHtml(b.content), b.cover_url ?? null, b.tags,
        s.status, s.publish_at, s.published_at, b.seo_title || null, b.seo_description || null, req.user.uid],
    );
  });

  app.patch('/api/posts/:id', write, async (req, reply) => {
    const id = (req.params as any).id;
    const cur = await one('SELECT * FROM posts WHERE id=$1 AND tenant_id=$2', [id, req.user.tid]);
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    const b = postBody.partial().parse(req.body);
    const m = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
    if (b.site_id) await assertSite(req.user.tid, b.site_id);
    const pa = m.publish_at instanceof Date ? m.publish_at.toISOString() : m.publish_at;
    const s = schedule(m.status, pa, cur.published_at ? new Date(cur.published_at).toISOString() : null);
    const slug = b.slug !== undefined || b.site_id || b.type ? await uniqueSlug(m.site_id, m.type, b.slug || cur.slug || m.title, id) : cur.slug;
    return one(
      `UPDATE posts SET site_id=$3, type=$4, title=$5, slug=$6, excerpt=$7, content=$8, cover_url=$9, tags=$10, status=$11,
         publish_at=$12, published_at=$13, seo_title=$14, seo_description=$15, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [id, req.user.tid, m.site_id, m.type, m.title, slug, m.excerpt || null, b.content !== undefined ? cleanHtml(b.content) : cur.content,
        m.cover_url || null, m.tags, s.status, s.publish_at, s.published_at, m.seo_title || null, m.seo_description || null],
    );
  });

  app.delete('/api/posts/:id', write, async (req, reply) => {
    const r = await one('DELETE FROM posts WHERE id=$1 AND tenant_id=$2 RETURNING id', [(req.params as any).id, req.user.tid]);
    return r ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // ---------------- Блоки сайта ----------------
  app.get('/api/blocks', read, async (req) =>
    q('SELECT b.*, s.name AS site_name FROM content_blocks b JOIN sites s ON s.id=b.site_id WHERE b.tenant_id=$1 ORDER BY s.name, b.key', [req.user.tid]),
  );

  app.post('/api/blocks', write, async (req, reply) => {
    const b = blockBody.parse(req.body);
    await assertSite(req.user.tid, b.site_id);
    const r = await one(
      `INSERT INTO content_blocks(tenant_id,site_id,key,title,html,active,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (site_id,key) DO NOTHING RETURNING *`,
      [req.user.tid, b.site_id, b.key, b.title, cleanHtml(b.html), b.active, b.starts_at ?? null, b.ends_at ?? null],
    );
    return r ?? reply.code(409).send({ error: 'key_taken' });
  });

  app.patch('/api/blocks/:id', write, async (req, reply) => {
    const b = blockBody.partial().parse(req.body);
    if (b.site_id) await assertSite(req.user.tid, b.site_id);
    const keys = Object.keys(b) as (keyof typeof b)[];
    if (!keys.length) return reply.code(400).send({ error: 'empty' });
    const vals = keys.map((k) => (k === 'html' ? cleanHtml(b.html!) : b[k] ?? null));
    const r = await one(
      `UPDATE content_blocks SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(', ')}, updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [(req.params as any).id, req.user.tid, ...vals],
    ).catch((e) => { if (e.code === '23505') return 'taken'; throw e; });
    if (r === 'taken') return reply.code(409).send({ error: 'key_taken' });
    return r ?? reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/api/blocks/:id', write, async (req, reply) => {
    const r = await one('DELETE FROM content_blocks WHERE id=$1 AND tenant_id=$2 RETURNING id', [(req.params as any).id, req.user.tid]);
    return r ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // ---------------- Загрузка картинок ----------------
  app.post('/api/uploads', { ...write, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no_file' });
    const ext = IMAGE_TYPES[file.mimetype];
    if (!ext) return reply.code(415).send({ error: 'unsupported_type' });
    const buf = await file.toBuffer();
    const row = await one<{ id: string }>('INSERT INTO uploads(tenant_id,filename,mime,size) VALUES ($1,$2,$3,$4) RETURNING id', [req.user.tid, file.filename.slice(0, 200), file.mimetype, buf.length]);
    await writeFile(path.join(uploadDir, row!.id + ext), buf);
    return { url: `${config.publicUrl}/u/${row!.id}${ext}` };
  });

  app.get('/u/:file', async (req, reply) => {
    const f = (req.params as any).file as string;
    const m = f.match(/^([0-9a-f-]{36})(\.(jpg|png|webp|gif))$/);
    const full = m && path.join(uploadDir, f);
    if (!full || !existsSync(full)) return reply.code(404).send({ error: 'not_found' });
    const mime = Object.entries(IMAGE_TYPES).find(([, e]) => e === m![2])![0];
    return reply.header('content-type', mime).header('cache-control', 'public, max-age=31536000, immutable')
      .header('access-control-allow-origin', '*').header('x-content-type-options', 'nosniff').send(createReadStream(full));
  });

  // ---------------- Открытый API контента для сайта клиента ----------------
  const pub = async (pk: string) => one<{ id: string; name: string; domain: string | null }>('SELECT id, name, domain FROM sites WHERE public_key=$1', [pk]);
  const cors = (reply: any, maxAge = 60) => reply.header('access-control-allow-origin', '*').header('cache-control', `public, max-age=${maxAge}`);

  app.get('/c/:pk/posts', async (req, reply) => {
    const site = await pub((req.params as any).pk);
    cors(reply);
    if (!site) return reply.code(404).send({ error: 'not_found' });
    const f = z.object({
      type: z.enum(['post', 'page']).default('post'), tag: z.string().max(50).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(10), offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await q(
      `SELECT p.title, p.slug, p.excerpt, p.content, p.cover_url, p.tags, COALESCE(p.published_at, p.publish_at) AS published_at,
              count(*) OVER() AS total
       FROM posts p WHERE p.site_id=$1 AND p.type=$2 AND ${LIVE} ${f.tag ? 'AND $5 = ANY(p.tags)' : ''}
       ORDER BY COALESCE(p.published_at, p.publish_at) DESC LIMIT $3 OFFSET $4`,
      f.tag ? [site.id, f.type, f.limit, f.offset, f.tag] : [site.id, f.type, f.limit, f.offset],
    );
    return {
      total: rows[0]?.total ?? 0,
      items: rows.map(({ content, total, ...r }) => ({ ...r, excerpt: r.excerpt || textExcerpt(content) })),
    };
  });

  app.get('/c/:pk/posts/:slug', async (req, reply) => {
    const { pk, slug } = req.params as any;
    const site = await pub(pk);
    cors(reply);
    if (!site) return reply.code(404).send({ error: 'not_found' });
    const type = (req.query as any).type === 'page' ? 'page' : 'post';
    const p = await one(
      `SELECT p.title, p.slug, p.excerpt, p.content, p.cover_url, p.tags, p.seo_title, p.seo_description,
              COALESCE(p.published_at, p.publish_at) AS published_at, p.updated_at
       FROM posts p WHERE p.site_id=$1 AND p.type=$2 AND p.slug=$3 AND ${LIVE}`,
      [site.id, type, slug],
    );
    return p ?? reply.code(404).send({ error: 'not_found' });
  });

  app.get('/c/:pk/blocks', async (req, reply) => {
    const site = await pub((req.params as any).pk);
    cors(reply);
    if (!site) return reply.code(404).send({ error: 'not_found' });
    const rows = await q(
      `SELECT key, html FROM content_blocks WHERE site_id=$1 AND active
         AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())`,
      [site.id],
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.html]));
  });

  app.get('/c/:pk/rss.xml', async (req, reply) => {
    const site = await pub((req.params as any).pk);
    if (!site) return reply.code(404).send('not found');
    const link = (req.query as any).link as string | undefined; // шаблон ссылки: https://site.ru/blog/?post={slug}
    const rows = await q(
      `SELECT p.title, p.slug, p.excerpt, p.content, COALESCE(p.published_at, p.publish_at) AS published_at
       FROM posts p WHERE p.site_id=$1 AND p.type='post' AND ${LIVE} ORDER BY published_at DESC LIMIT 30`,
      [site.id],
    );
    const base = site.domain ? `https://${site.domain}` : config.publicUrl;
    const url = (slug: string) => (link && /^https?:\/\//.test(link) ? link.replace('{slug}', slug) : `${base}/?post=${slug}`);
    const items = rows.map((r) => `<item><title>${escapeXml(r.title)}</title><link>${escapeXml(url(r.slug))}</link><guid isPermaLink="false">${escapeXml(r.slug)}</guid><pubDate>${new Date(r.published_at).toUTCString()}</pubDate><description>${escapeXml(r.excerpt || textExcerpt(r.content))}</description></item>`).join('');
    cors(reply, 300).header('content-type', 'application/rss+xml; charset=utf-8');
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(site.name)}</title><link>${escapeXml(base)}</link><description>${escapeXml(site.name)}</description>${items}</channel></rss>`;
  });

  const cmsJs = await readFile(new URL('../../../tracker/cms.js', import.meta.url), 'utf8').catch(() => '/* cms missing */');
  app.get('/cms.js', async (_req, reply) => cors(reply, 3600).header('content-type', 'application/javascript; charset=utf-8').send(cmsJs));
}
