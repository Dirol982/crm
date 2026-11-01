import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../lib/db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { genKey } from '../lib/util.js';
import { config } from '../lib/config.js';
import { assertLimit } from '../lib/billing.js';

const siteBody = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().toLowerCase().max(253).optional().nullable(),
  // шаблон ссылки на статью: https://site.ru/blog/{slug}
  post_url_template: z.string().trim().max(500).regex(/^https?:\/\/.+\{slug\}/).optional().nullable().or(z.literal('').transform(() => null)),
});

const snippet = (pk: string) =>
  `<script async src="${config.publicUrl}/t.js" data-key="${pk}"></script>`;

export default async function siteRoutes(app: FastifyInstance) {
  app.get('/api/sites', { preHandler: requireAuth }, async (req) => {
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    const rows = await q('SELECT id, name, domain, post_url_template, public_key, secret_key, created_at FROM sites WHERE tenant_id=$1 ORDER BY created_at', [req.user.tid]);
    return rows.map((s) => ({
      ...s,
      secret_key: isAdmin ? s.secret_key : undefined,
      snippet: snippet(s.public_key),
      api_url: `${config.publicUrl}/api/v1`,
    }));
  });

  app.post('/api/sites', { preHandler: requireRole('admin') }, async (req) => {
    const body = siteBody.parse(req.body);
    await assertLimit(req.user.tid, 'sites');
    return one(
      'INSERT INTO sites(tenant_id,name,domain,public_key,secret_key) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, domain, public_key, created_at',
      [req.user.tid, body.name, body.domain || null, genKey('pk'), genKey('sk', 24)],
    );
  });

  app.patch('/api/sites/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const body = siteBody.partial().parse(req.body);
    const s = await one(
      `UPDATE sites SET name=COALESCE($3,name), domain=COALESCE($4,domain),
         post_url_template=CASE WHEN $5::boolean THEN $6 ELSE post_url_template END
       WHERE id=$1 AND tenant_id=$2 RETURNING id, name, domain, post_url_template`,
      [(req.params as any).id, req.user.tid, body.name, body.domain, body.post_url_template !== undefined, body.post_url_template ?? null],
    );
    return s ?? reply.code(404).send({ error: 'not_found' });
  });

  app.post('/api/sites/:id/rotate-secret', { preHandler: requireRole('admin') }, async (req, reply) => {
    const s = await one('UPDATE sites SET secret_key=$3 WHERE id=$1 AND tenant_id=$2 RETURNING id, secret_key', [(req.params as any).id, req.user.tid, genKey('sk', 24)]);
    return s ?? reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/api/sites/:id', { preHandler: requireRole('owner') }, async (req, reply) => {
    const s = await one('DELETE FROM sites WHERE id=$1 AND tenant_id=$2 RETURNING id', [(req.params as any).id, req.user.tid]);
    return s ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
}
