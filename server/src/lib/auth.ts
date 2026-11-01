import type { FastifyReply, FastifyRequest } from 'fastify';

export type Role = 'owner' | 'admin' | 'manager' | 'viewer';
export interface AuthUser { uid: string; tid: string; role: Role }

declare module '@fastify/jwt' {
  interface FastifyJWT { payload: AuthUser; user: AuthUser }
}

const RANK: Record<Role, number> = { viewer: 0, manager: 1, admin: 2, owner: 3 };

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

export function requireRole(min: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (RANK[req.user.role] < RANK[min]) return reply.code(403).send({ error: 'forbidden' });
  };
}
