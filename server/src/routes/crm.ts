import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../lib/db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { recordOrder } from '../lib/ingest.js';

const page = z.object({
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const contactBody = z.object({
  name: z.string().trim().max(200).nullish(),
  email: z.string().trim().toLowerCase().email().max(200).nullish().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(50).nullish(),
  company: z.string().trim().max(200).nullish(),
  source: z.string().trim().max(100).nullish(),
  notes: z.string().max(10000).nullish(),
  tags: z.array(z.string().max(50)).max(30).optional(),
  owner_id: z.string().uuid().nullish(),
});

const dealBody = z.object({
  title: z.string().trim().min(1).max(300),
  amount: z.coerce.number().min(0).max(1e12).default(0),
  stage: z.string().max(50).optional(),
  contact_id: z.string().uuid().nullish(),
  owner_id: z.string().uuid().nullish(),
});

const taskBody = z.object({
  title: z.string().trim().min(1).max(500),
  due_at: z.string().datetime({ offset: true }).nullish(),
  done: z.boolean().optional(),
  assignee_id: z.string().uuid().nullish(),
  contact_id: z.string().uuid().nullish(),
  deal_id: z.string().uuid().nullish(),
});

export default async function crmRoutes(app: FastifyInstance) {
  const write = { preHandler: requireRole('manager') };
  const read = { preHandler: requireAuth };

  // ---------- Контакты ----------
  app.get('/api/contacts', read, async (req) => {
    const p = page.parse(req.query);
    const params: unknown[] = [req.user.tid, p.limit, p.offset];
    let where = 'c.tenant_id=$1';
    if (p.q) {
      params.push(`%${p.q}%`);
      where += ` AND (c.name ILIKE $4 OR c.email ILIKE $4 OR c.phone ILIKE $4 OR c.company ILIKE $4)`;
    }
    const rows = await q(
      `SELECT c.*, COALESCE(o.cnt,0) AS orders_count, COALESCE(o.total,0) AS revenue, o.last_order_at,
              count(*) OVER() AS total_count
       FROM contacts c
       LEFT JOIN LATERAL (SELECT count(*) cnt, sum(amount) total, max(created_at) last_order_at FROM orders
                          WHERE contact_id=c.id AND status='paid') o ON true
       WHERE ${where} ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`,
      params,
    );
    return { items: rows.map(({ total_count, ...r }) => r), total: rows[0]?.total_count ?? 0 };
  });

  app.get('/api/contacts/:id', read, async (req, reply) => {
    const { id } = req.params as { id: string };
    const contact = await one('SELECT * FROM contacts WHERE id=$1 AND tenant_id=$2', [id, req.user.tid]);
    if (!contact) return reply.code(404).send({ error: 'not_found' });
    const [orders, deals, tasks, sessions] = await Promise.all([
      q('SELECT id, external_id, amount, currency, status, source, medium, created_at FROM orders WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 100', [id]),
      q('SELECT id, title, amount, stage, created_at FROM deals WHERE contact_id=$1 ORDER BY created_at DESC', [id]),
      q('SELECT id, title, due_at, done FROM tasks WHERE contact_id=$1 ORDER BY done, due_at NULLS LAST', [id]),
      q(
        `SELECT s.id, s.started_at, s.source, s.medium, s.campaign, s.landing_page, s.exit_page, s.pageviews, s.duration_sec, s.device
         FROM visitors v JOIN sessions s ON s.site_id=v.site_id AND s.visitor_id=v.id
         JOIN sites st ON st.id=v.site_id AND st.tenant_id=$2
         WHERE v.contact_id=$1 ORDER BY s.started_at DESC LIMIT 50`,
        [id, req.user.tid],
      ),
    ]);
    return { contact, orders, deals, tasks, sessions };
  });

  app.post('/api/contacts', write, async (req) => {
    const b = contactBody.parse(req.body);
    return one(
      `INSERT INTO contacts(tenant_id,name,email,phone,company,source,notes,tags,owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.tid, b.name, b.email, b.phone, b.company, b.source ?? 'manual', b.notes, b.tags ?? [], b.owner_id ?? req.user.uid],
    );
  });

  app.patch('/api/contacts/:id', write, async (req, reply) => {
    const b = contactBody.partial().parse(req.body);
    const keys = Object.keys(b) as (keyof typeof b)[];
    if (!keys.length) return reply.code(400).send({ error: 'empty' });
    const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(', ');
    const row = await one(`UPDATE contacts SET ${sets} WHERE id=$1 AND tenant_id=$2 RETURNING *`, [(req.params as any).id, req.user.tid, ...keys.map((k) => b[k])]);
    return row ?? reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/api/contacts/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const row = await one('DELETE FROM contacts WHERE id=$1 AND tenant_id=$2 RETURNING id', [(req.params as any).id, req.user.tid]);
    return row ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // ---------- Сделки (воронка) ----------
  app.get('/api/deals', read, async (req) =>
    q(
      `SELECT d.*, c.name AS contact_name, u.name AS owner_name FROM deals d
       LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN users u ON u.id=d.owner_id
       WHERE d.tenant_id=$1 ORDER BY d.updated_at DESC LIMIT 1000`,
      [req.user.tid],
    ),
  );

  app.post('/api/deals', write, async (req) => {
    const b = dealBody.parse(req.body);
    return one(
      `INSERT INTO deals(tenant_id,title,amount,stage,contact_id,owner_id)
       VALUES ($1,$2,$3,COALESCE($4,(SELECT deal_stages->>0 FROM tenants WHERE id=$1)),$5,$6) RETURNING *`,
      [req.user.tid, b.title, b.amount, b.stage, b.contact_id, b.owner_id ?? req.user.uid],
    );
  });

  app.patch('/api/deals/:id', write, async (req, reply) => {
    const b = dealBody.partial().parse(req.body);
    const keys = Object.keys(b) as (keyof typeof b)[];
    if (!keys.length) return reply.code(400).send({ error: 'empty' });
    const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(', ');
    const row = await one(
      `UPDATE deals SET ${sets}, updated_at=now()${
        b.stage ? `, closed_at = CASE WHEN $${keys.indexOf('stage') + 3}::text IN ('won','lost') THEN COALESCE(closed_at, now()) ELSE NULL END` : ''
      }
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [(req.params as any).id, req.user.tid, ...keys.map((k) => b[k])],
    );
    return row ?? reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/api/deals/:id', write, async (req, reply) => {
    const row = await one('DELETE FROM deals WHERE id=$1 AND tenant_id=$2 RETURNING id', [(req.params as any).id, req.user.tid]);
    return row ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // ---------- Задачи ----------
  app.get('/api/tasks', read, async (req) => {
    const { mine } = z.object({ mine: z.coerce.boolean().optional() }).parse(req.query);
    return q(
      `SELECT t.*, c.name AS contact_name, d.title AS deal_title, u.name AS assignee_name FROM tasks t
       LEFT JOIN contacts c ON c.id=t.contact_id LEFT JOIN deals d ON d.id=t.deal_id LEFT JOIN users u ON u.id=t.assignee_id
       WHERE t.tenant_id=$1 ${mine ? 'AND t.assignee_id=$2' : ''}
       ORDER BY t.done, t.due_at NULLS LAST, t.created_at DESC LIMIT 500`,
      mine ? [req.user.tid, req.user.uid] : [req.user.tid],
    );
  });

  app.post('/api/tasks', write, async (req) => {
    const b = taskBody.parse(req.body);
    return one(
      'INSERT INTO tasks(tenant_id,title,due_at,assignee_id,contact_id,deal_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.tid, b.title, b.due_at, b.assignee_id ?? req.user.uid, b.contact_id, b.deal_id],
    );
  });

  app.patch('/api/tasks/:id', write, async (req, reply) => {
    const b = taskBody.partial().parse(req.body);
    const keys = Object.keys(b) as (keyof typeof b)[];
    if (!keys.length) return reply.code(400).send({ error: 'empty' });
    const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(', ');
    const row = await one(`UPDATE tasks SET ${sets} WHERE id=$1 AND tenant_id=$2 RETURNING *`, [(req.params as any).id, req.user.tid, ...keys.map((k) => b[k])]);
    return row ?? reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/api/tasks/:id', write, async (req, reply) => {
    const row = await one('DELETE FROM tasks WHERE id=$1 AND tenant_id=$2 RETURNING id', [(req.params as any).id, req.user.tid]);
    return row ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // ---------- Заказы / продажи ----------
  app.get('/api/orders', read, async (req) => {
    const p = page.extend({ status: z.enum(['pending', 'paid', 'cancelled', 'refunded']).optional() }).parse(req.query);
    const params: unknown[] = [req.user.tid, p.limit, p.offset];
    let where = 'o.tenant_id=$1';
    if (p.status) { params.push(p.status); where += ` AND o.status=$${params.length}`; }
    if (p.q) { params.push(`%${p.q}%`); where += ` AND (o.external_id ILIKE $${params.length} OR c.name ILIKE $${params.length} OR c.email ILIKE $${params.length})`; }
    const rows = await q(
      `SELECT o.id, o.external_id, o.amount, o.currency, o.status, o.items, o.source, o.medium, o.campaign, o.created_at,
              o.contact_id, c.name AS contact_name, c.email AS contact_email, s.name AS site_name, count(*) OVER() AS total_count
       FROM orders o LEFT JOIN contacts c ON c.id=o.contact_id LEFT JOIN sites s ON s.id=o.site_id
       WHERE ${where} ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
      params,
    );
    return { items: rows.map(({ total_count, ...r }) => r), total: rows[0]?.total_count ?? 0 };
  });

  app.post('/api/orders', write, async (req) => {
    const b = z.object({
      amount: z.coerce.number().min(0).max(1e12),
      status: z.enum(['pending', 'paid', 'cancelled', 'refunded']).default('paid'),
      external_id: z.string().max(100).optional(),
      contact_id: z.string().uuid().optional(),
      customer: z.object({ name: z.string().max(200).optional(), email: z.string().email().optional(), phone: z.string().max(50).optional() }).optional(),
      items: z.array(z.record(z.unknown())).max(500).optional(),
    }).parse(req.body);
    const res = await recordOrder(req.user.tid, null, { ...b, external_id: b.external_id ?? null });
    if (b.contact_id) await q('UPDATE orders SET contact_id=$3, source=COALESCE(source,\'manual\') WHERE id=$1 AND tenant_id=$2', [res.id, req.user.tid, b.contact_id]);
    else await q("UPDATE orders SET source=COALESCE(source,'manual'), medium=COALESCE(medium,'offline') WHERE id=$1", [res.id]);
    return res;
  });

  app.patch('/api/orders/:id', write, async (req, reply) => {
    const b = z.object({ status: z.enum(['pending', 'paid', 'cancelled', 'refunded']) }).parse(req.body);
    const row = await one('UPDATE orders SET status=$3 WHERE id=$1 AND tenant_id=$2 RETURNING id, status', [(req.params as any).id, req.user.tid, b.status]);
    return row ?? reply.code(404).send({ error: 'not_found' });
  });
}
