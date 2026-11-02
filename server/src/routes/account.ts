import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, pool, q, tx } from '../lib/db.js';
import { requireAuth, requireRole, invalidateUser, type Role } from '../lib/auth.js';
import { hashToken, newToken, queueEmail, unsubSig } from '../lib/mailer.js';
import { addedToTeamEmail, appLink, inviteEmail, resetEmail, ROLE_NAMES } from '../lib/emails.js';
import { assertLimit } from '../lib/billing.js';

const password = z.string().min(8).max(200);

export default async function accountRoutes(app: FastifyInstance) {
  const sign = (uid: string, tid: string, role: Role) => app.jwt.sign({ uid, tid, role }, { expiresIn: '30d' });
  const firstMembership = (uid: string) => one<{ tenant_id: string; role: Role }>('SELECT tenant_id, role FROM memberships WHERE user_id=$1 ORDER BY created_at LIMIT 1', [uid]);

  // ---------- Забыли пароль ----------
  // Ответ всегда одинаковый — чтобы по нему нельзя было узнать, зарегистрирован ли адрес.
  app.post('/api/auth/forgot', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body);
    const user = await one('SELECT id, name, email FROM users WHERE email=$1', [email]);
    if (user) {
      const recent = await one(`SELECT 1 FROM auth_tokens WHERE user_id=$1 AND kind='reset' AND created_at > now() - interval '1 minute'`, [user.id]);
      if (!recent) {
        const token = newToken();
        await pool.query(`INSERT INTO auth_tokens(user_id, kind, token_hash, expires_at) VALUES ($1,'reset',$2, now() + interval '1 hour')`, [user.id, hashToken(token)]);
        await queueEmail({ to: user.email, kind: 'reset', ...resetEmail(user.name, appLink(`/reset?token=${token}`)) });
      }
    }
    return { ok: true };
  });

  app.post('/api/auth/reset', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const b = z.object({ token: z.string().min(20).max(100), password }).parse(req.body);
    const t = await one(
      `SELECT id, user_id FROM auth_tokens WHERE token_hash=$1 AND kind='reset' AND used_at IS NULL AND expires_at > now()`,
      [hashToken(b.token)],
    );
    if (!t) return reply.code(400).send({ error: 'invalid_token' });
    await tx(async (c) => {
      await c.query(`UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1`, [t.user_id, await bcrypt.hash(b.password, 10)]);
      await c.query(`UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND kind='reset' AND used_at IS NULL`, [t.user_id]);
    });
    invalidateUser(t.user_id); // все прежние входы перестают действовать
    const m = await firstMembership(t.user_id);
    return m ? { token: sign(t.user_id, m.tenant_id, m.role) } : { ok: true };
  });

  app.post('/api/auth/password', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const b = z.object({ current: z.string().min(1), password }).parse(req.body);
    const u = await one('SELECT password_hash FROM users WHERE id=$1', [req.user.uid]);
    if (!u || !(await bcrypt.compare(b.current, u.password_hash))) return reply.code(400).send({ error: 'wrong_password' });
    await pool.query('UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1', [req.user.uid, await bcrypt.hash(b.password, 10)]);
    invalidateUser(req.user.uid);
    return { token: sign(req.user.uid, req.user.tid, req.user.role) };
  });

  app.patch('/api/me', { preHandler: requireAuth }, async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(200).optional(), email_digest: z.boolean().optional() }).parse(req.body);
    return one('UPDATE users SET name=COALESCE($2,name), email_digest=COALESCE($3,email_digest) WHERE id=$1 RETURNING id, name, email, email_digest',
      [req.user.uid, b.name ?? null, b.email_digest ?? null]);
  });

  // ---------- Приглашения сотрудников ----------
  const inviteBody = z.object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().max(200).optional(),
    role: z.enum(['admin', 'manager', 'viewer']),
  });

  async function sendInvite(tenantId: string, inviterId: string, invitationId: string, email: string, role: string) {
    const token = newToken();
    await pool.query(`UPDATE invitations SET token_hash=$2, expires_at=now() + interval '7 days', created_at=now() WHERE id=$1`, [invitationId, hashToken(token)]);
    const ctx = await one('SELECT t.name AS company, u.name AS inviter FROM tenants t, users u WHERE t.id=$1 AND u.id=$2', [tenantId, inviterId]);
    await queueEmail({ to: email, kind: 'invite', tenantId, ...inviteEmail({ inviter: ctx.inviter, company: ctx.company, role: ROLE_NAMES[role], link: appLink(`/invite?token=${token}`) }) });
  }

  app.post('/api/team', { preHandler: requireRole('admin') }, async (req, reply) => {
    const b = inviteBody.parse(req.body);
    const user = await one('SELECT id FROM users WHERE email=$1', [b.email]);
    if (user && (await one('SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2', [req.user.tid, user.id]))) {
      return reply.code(409).send({ error: 'already_member' });
    }
    await assertLimit(req.user.tid, 'users');
    const ctx = await one('SELECT t.name AS company, u.name AS inviter FROM tenants t, users u WHERE t.id=$1 AND u.id=$2', [req.user.tid, req.user.uid]);
    if (user) {
      // уже есть аккаунт в Пульсе — сразу добавляем и сообщаем письмом
      await pool.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.user.tid, user.id, b.role]);
      await queueEmail({ to: b.email, kind: 'added_to_team', tenantId: req.user.tid, ...addedToTeamEmail({ inviter: ctx.inviter, company: ctx.company, role: ROLE_NAMES[b.role] }) });
      return { status: 'added' };
    }
    await pool.query('DELETE FROM invitations WHERE tenant_id=$1 AND lower(email)=$2 AND accepted_at IS NULL', [req.user.tid, b.email]);
    const inv = await one<{ id: string }>(
      `INSERT INTO invitations(tenant_id,email,name,role,token_hash,invited_by,expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + interval '7 days') RETURNING id`,
      [req.user.tid, b.email, b.name || null, b.role, hashToken(newToken()), req.user.uid],
    );
    await sendInvite(req.user.tid, req.user.uid, inv!.id, b.email, b.role);
    return { status: 'invited' };
  });

  app.get('/api/team/invitations', { preHandler: requireAuth }, async (req) =>
    q(`SELECT i.id, i.email, i.name, i.role, i.created_at, i.expires_at, i.expires_at < now() AS expired, u.name AS invited_by_name
       FROM invitations i LEFT JOIN users u ON u.id=i.invited_by WHERE i.tenant_id=$1 AND i.accepted_at IS NULL ORDER BY i.created_at DESC`, [req.user.tid]),
  );

  app.post('/api/team/invitations/:id/resend', { preHandler: requireRole('admin'), config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const inv = await one('SELECT id, email, role FROM invitations WHERE id=$1 AND tenant_id=$2 AND accepted_at IS NULL', [(req.params as any).id, req.user.tid]);
    if (!inv) return reply.code(404).send({ error: 'not_found' });
    await sendInvite(req.user.tid, req.user.uid, inv.id, inv.email, inv.role);
    return { ok: true };
  });

  app.delete('/api/team/invitations/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const r = await one('DELETE FROM invitations WHERE id=$1 AND tenant_id=$2 AND accepted_at IS NULL RETURNING id', [(req.params as any).id, req.user.tid]);
    return r ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  const openInvite = (token: string) => one(
    `SELECT i.id, i.tenant_id, i.email, i.name, i.role, t.name AS company, (SELECT id FROM users WHERE email=lower(i.email)) AS user_id
     FROM invitations i JOIN tenants t ON t.id=i.tenant_id
     WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
    [hashToken(token)],
  );

  app.get('/api/invitations/:token', { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const inv = await openInvite((req.params as any).token);
    if (!inv) return reply.code(404).send({ error: 'invalid_token' });
    return { company: inv.company, email: inv.email, name: inv.name, role: inv.role, existing_user: !!inv.user_id };
  });

  app.post('/api/invitations/accept', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const b = z.object({ token: z.string().min(20).max(100), name: z.string().trim().min(1).max(200).optional(), password: password.optional() }).parse(req.body);
    const inv = await openInvite(b.token);
    if (!inv) return reply.code(400).send({ error: 'invalid_token' });
    if (inv.user_id) {
      // аккаунт успел появиться — просто добавляем в компанию, вход по своему паролю
      await tx(async (c) => {
        await c.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [inv.tenant_id, inv.user_id, inv.role]);
        await c.query('UPDATE invitations SET accepted_at=now() WHERE id=$1', [inv.id]);
      });
      return { existing: true };
    }
    if (!b.name || !b.password) return reply.code(400).send({ error: 'validation' });
    const uid = await tx(async (c) => {
      const u = (await c.query('INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id', [inv.email.toLowerCase(), b.name, await bcrypt.hash(b.password!, 10)])).rows[0];
      await c.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,$3)', [inv.tenant_id, u.id, inv.role]);
      await c.query('UPDATE invitations SET accepted_at=now() WHERE id=$1', [inv.id]);
      return u.id as string;
    });
    return { token: sign(uid, inv.tenant_id, inv.role) };
  });

  // ---------- Отписка от еженедельного отчёта (ссылка из письма, без входа) ----------
  app.get('/api/email/unsubscribe', async (req, reply) => {
    const { u, s } = req.query as { u?: string; s?: string };
    const ok = !!u && !!s && /^[0-9a-f-]{36}$/.test(u) && s === unsubSig(u);
    if (ok) await pool.query('UPDATE users SET email_digest=false WHERE id=$1', [u]);
    reply.header('content-type', 'text/html; charset=utf-8');
    return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Пульс CRM</title>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 16px;line-height:1.5">
<h2>${ok ? 'Вы отписались от еженедельного отчёта' : 'Ссылка недействительна'}</h2>
<p>${ok ? 'Письма об оплате и безопасности аккаунта продолжат приходить. Включить отчёт снова можно в настройках профиля.' : 'Отключить отчёт можно в настройках профиля в Пульс CRM.'}</p>
<p><a href="${appLink('/settings')}">Открыть настройки</a></p></body></html>`;
  });
  // RFC 8058: отписка одним нажатием из почтового клиента
  app.post('/api/email/unsubscribe', async (req, reply) => {
    const { u, s } = req.query as { u?: string; s?: string };
    if (u && s && /^[0-9a-f-]{36}$/.test(u) && s === unsubSig(u)) await pool.query('UPDATE users SET email_digest=false WHERE id=$1', [u]);
    return reply.code(200).send({ ok: true });
  });
}
