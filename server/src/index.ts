import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { config } from './lib/config.js';
import { migrate } from './migrate.js';
import authRoutes from './routes/auth.js';
import siteRoutes from './routes/sites.js';
import trackRoutes from './routes/track.js';
import publicApiRoutes from './routes/publicApi.js';
import crmRoutes from './routes/crm.js';
import analyticsRoutes from './routes/analytics.js';

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true, bodyLimit: 1024 * 1024 });

  await app.register(rateLimit, { global: false });
  await app.register(jwt, { secret: config.jwtSecret });
  // CORS для панели (трекер /t ставит свои заголовки сам)
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'validation', details: err.flatten() });
    if ((err as any).statusCode && (err as any).statusCode < 500) return reply.code((err as any).statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(siteRoutes);
  await app.register(trackRoutes);
  await app.register(publicApiRoutes);
  await app.register(crmRoutes);
  await app.register(analyticsRoutes);

  // Раздача собранной панели (web/dist), если она есть
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.method === 'GET' && !req.url.startsWith('/api/') ? reply.sendFile('index.html') : reply.code(404).send({ error: 'not_found' }),
    );
  }
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate();
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
}
