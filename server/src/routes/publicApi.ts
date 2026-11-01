import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { one, pool } from '../lib/db.js';
import { recordOrder, upsertContact } from '../lib/ingest.js';

/**
 * Серверный API для интеграций (CMS, интернет-магазины, 1С, Tilda webhooks...).
 * Авторизация: заголовок `Authorization: Bearer <secret_key сайта>`.
 */
const customer = z.object({
  email: z.string().email().max(200).optional(),
  name: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  company: z.string().max(200).optional(),
});

const orderBody = z.object({
  external_id: z.string().max(100).optional(),
  amount: z.coerce.number().min(0).max(1e10),
  currency: z.string().length(3).optional(),
  status: z.enum(['pending', 'paid', 'cancelled', 'refunded']).optional(),
  items: z.array(z.object({ name: z.string().max(300), qty: z.coerce.number().optional(), price: z.coerce.number().optional(), sku: z.string().max(100).optional() }).passthrough()).max(500).optional(),
  customer: customer.optional(),
  visitor_id: z.string().max(64).optional(),
  session_id: z.string().max(64).optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
});

async function siteFromSecret(req: FastifyRequest) {
  const h = req.headers.authorization ?? '';
  const key = h.startsWith('Bearer ') ? h.slice(7).trim() : (req.headers['x-api-key'] as string | undefined);
  if (!key) return undefined;
  return one<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM sites WHERE secret_key=$1', [key]);
}

export default async function publicApiRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/v1/')) return;
    const site = await siteFromSecret(req);
    if (!site) return reply.code(401).send({ error: 'invalid_api_key' });
    (req as any).site = site;
  });

  app.post('/api/v1/orders', async (req) => {
    const site = (req as any).site;
    const body = orderBody.parse(req.body);
    return recordOrder(site.tenant_id, site.id, body);
  });

  app.post('/api/v1/contacts', async (req, reply) => {
    const site = (req as any).site;
    const body = customer.extend({ visitor_id: z.string().max(64).optional() }).parse(req.body);
    const id = await upsertContact(pool, site.tenant_id, body, 'api');
    if (!id) return reply.code(400).send({ error: 'email_or_phone_required' });
    if (body.visitor_id) await pool.query('UPDATE visitors SET contact_id=$3 WHERE site_id=$1 AND id=$2', [site.id, body.visitor_id, id]);
    return { id };
  });

  app.post('/api/v1/events', async (req) => {
    const site = (req as any).site;
    const body = z.object({
      name: z.string().min(1).max(100),
      visitor_id: z.string().max(64).optional(),
      session_id: z.string().max(64).optional(),
      value: z.number().optional(),
      props: z.record(z.unknown()).optional(),
    }).parse(req.body);
    await pool.query(
      'INSERT INTO events(site_id,session_id,visitor_id,name,value,props,ts) VALUES ($1,$2,$3,$4,$5,$6,now())',
      [site.id, body.session_id ?? null, body.visitor_id ?? null, body.name, body.value ?? null, JSON.stringify(body.props ?? {})],
    );
    return { ok: true };
  });
}
