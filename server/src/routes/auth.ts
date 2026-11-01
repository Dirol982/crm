import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, q, tx } from '../lib/db.js';
import { requireAuth, requireRole, type Role } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { genKey } from '../lib/util.js';
import { assertLimit, billingConfig, tenantState } from '../lib/billing.js';

const signupSchema = z.object({
  company: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  tenantId: z.string().uuid().optional(),
});

export default async function authRoutes(app: FastifyInstance) {
  const sign = (uid: string, tid: string, role: Role) => app.jwt.sign({ uid, tid, role }, { expiresIn: '30d' });

  app.post('/api/auth/signup', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!config.allowSignup) return reply.code(403).send({ error: 'signup_disabled' });
    const body = signupSchema.parse(req.body);
    if (await one('SELECT 1 FROM users WHERE email=$1', [body.email])) {
      return reply.code(409).send({ error: 'email_taken' });
    }
    const hash = await bcrypt.hash(body.password, 10);
    const { uid, tid } = await tx(async (c) => {
      const t = (await c.query('INSERT INTO tenants(name) VALUES ($1) RETURNING id', [body.company])).rows[0];
      const u = (await c.query('INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id', [body.email, body.name, hash])).rows[0];
      await c.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,'owner')", [t.id, u.id]);
      await c.query('INSERT INTO sites(tenant_id,name,public_key,secret_key) VALUES ($1,$2,$3,$4)', [t.id, 'Мой сайт', genKey('pk'), genKey('sk', 24)]);
      return { uid: u.id, tid: t.id };
    });
    return { token: sign(uid, tid, 'owner') };
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await one('SELECT id, password_hash FROM users WHERE email=$1', [body.email]);
    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const m = await one<{ tenant_id: string; role: Role }>(
      `SELECT tenant_id, role FROM memberships WHERE user_id=$1 ${body.tenantId ? 'AND tenant_id=$2' : ''} ORDER BY created_at LIMIT 1`,
      body.tenantId ? [user.id, body.tenantId] : [user.id],
    );
    if (!m) return reply.code(403).send({ error: 'no_workspace' });
    return { token: sign(user.id, m.tenant_id, m.role) };
  });

  app.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const { uid, tid, role } = req.user;
    const user = await one('SELECT id, email, name FROM users WHERE id=$1', [uid]);
    const tenant = await one('SELECT id, name, plan, currency, timezone, deal_stages FROM tenants WHERE id=$1', [tid]);
    const workspaces = await q(
      'SELECT t.id, t.name, m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 ORDER BY t.name',
      [uid],
    );
    const billing = await tenantState(tid);
    const is_superadmin = !!user && billingConfig.superadmins.includes(user.email.toLowerCase());
    return { user, tenant, role, workspaces, billing, is_superadmin };
  });

  app.post('/api/auth/switch', { preHandler: requireAuth }, async (req, reply) => {
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.body);
    const m = await one<{ role: Role }>('SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2', [req.user.uid, tenantId]);
    if (!m) return reply.code(403).send({ error: 'forbidden' });
    return { token: sign(req.user.uid, tenantId, m.role) };
  });

  app.patch('/api/tenant', { preHandler: requireRole('admin') }, async (req) => {
    const body = z.object({
      name: z.string().trim().min(1).max(200).optional(),
      currency: z.string().length(3).optional(),
      timezone: z.string().max(64).optional(),
      deal_stages: z.array(z.string().trim().min(1).max(50)).min(2).max(20).optional(),
    }).parse(req.body);
    const t = await one(
      `UPDATE tenants SET name=COALESCE($2,name), currency=COALESCE($3,currency), timezone=COALESCE($4,timezone),
         deal_stages=COALESCE($5,deal_stages) WHERE id=$1 RETURNING id, name, plan, currency, timezone, deal_stages`,
      [req.user.tid, body.name, body.currency, body.timezone, body.deal_stages ? JSON.stringify(body.deal_stages) : null],
    );
    return t;
  });

  // ---- Команда ----
  app.get('/api/team', { preHandler: requireAuth }, async (req) =>
    q('SELECT u.id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 ORDER BY m.created_at', [req.user.tid]),
  );

  app.post('/api/team', { preHandler: requireRole('admin') }, async (req, reply) => {
    const body = z.object({
      email: z.string().trim().toLowerCase().email(),
      name: z.string().trim().min(1).max(200),
      role: z.enum(['admin', 'manager', 'viewer']),
      password: z.string().min(8).max(200),
    }).parse(req.body);
    await assertLimit(req.user.tid, 'users');
    let user = await one('SELECT id FROM users WHERE email=$1', [body.email]);
    if (!user) {
      user = await one('INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id', [body.email, body.name, await bcrypt.hash(body.password, 10)]);
    }
    const ins = await one('INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id', [req.user.tid, user.id, body.role]);
    if (!ins) return reply.code(409).send({ error: 'already_member' });
    return { id: user.id };
  });

  app.delete('/api/team/:userId', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const m = await one('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2', [req.user.tid, userId]);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    if (m.role === 'owner') return reply.code(400).send({ error: 'cannot_remove_owner' });
    await q('DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2', [req.user.tid, userId]);
    return { ok: true };
  });
}
