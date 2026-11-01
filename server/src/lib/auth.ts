import type { FastifyReply, FastifyRequest } from 'fastify';
import { billingEnabled, tenantState } from './billing.js';

export type Role = 'owner' | 'admin' | 'manager' | 'viewer';
export interface AuthUser { uid: string; tid: string; role: Role }

declare module '@fastify/jwt' {
  interface FastifyJWT { payload: AuthUser; user: AuthUser }
}

const RANK: Record<Role, number> = { viewer: 0, manager: 1, admin: 2, owner: 3 };

// Замороженный аккаунт (не оплачен) видит только оплату и свой профиль.
// Сбор статистики и вывод контента на сайт клиента при этом продолжают работать.
const FROZEN_ALLOWED = /^\/api\/(me|billing|auth|admin)(\/|$|\?)/;

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  if (billingEnabled() && !FROZEN_ALLOWED.test(req.url) && !(req.method === 'GET' && /^\/api\/(sites|team)(\?|$)/.test(req.url))) {
    const st = await tenantState(req.user.tid);
    if (st.status === 'frozen') return reply.code(402).send({ error: 'payment_required' });
  }
}

export function requireRole(min: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (RANK[req.user.role] < RANK[min]) return reply.code(403).send({ error: 'forbidden' });
  };
}
