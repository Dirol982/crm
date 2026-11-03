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
import contentRoutes, { publishDue } from './routes/content.js';
import channelRoutes, { processDeliveries } from './routes/channels.js';
import billingRoutes from './routes/billing.js';
import accountRoutes from './routes/account.js';
import adsRoutes from './routes/ads.js';
import { scheduleAds } from './lib/ads/schedule.js';
import { processOutbox, mailEnabled } from './lib/mailer.js';
import { runNotifications } from './lib/notify.js';
import { autoRenew, billingEnabled, syncPending } from './lib/billing.js';

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
  await app.register(contentRoutes);
  await app.register(channelRoutes);
  await app.register(billingRoutes);
  await app.register(accountRoutes);
  await app.register(adsRoutes);

  // Лендинг на «/», панель на «/app/» (HashRouter — все маршруты панели внутри index.html)
  const hasApp = existsSync(config.webDist);
  if (hasApp) await app.register(fastifyStatic, { root: config.webDist, prefix: '/app/' });
  if (existsSync(config.landingDir)) {
    await app.register(fastifyStatic, { root: config.landingDir, prefix: '/', decorateReply: !hasApp });
  }
  app.get('/app', async (_req, reply) => reply.redirect('/app/'));
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0];
    if (hasApp && req.method === 'GET' && path.startsWith('/app/') && !/\.[a-z0-9]+$/i.test(path)) return reply.sendFile('index.html', config.webDist);
    if (req.method === 'GET' && !path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path)) return reply.redirect('/');
    return reply.code(404).send({ error: 'not_found' });
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate();
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  // Планировщик публикаций: выкладывает запланированные материалы в срок
  // и отправляет их в подключённые Telegram-каналы и сообщества VK
  const tick = () => publishDue()
    .then((n) => n && app.log.info(`published ${n} scheduled post(s)`))
    .then(() => processDeliveries(app.log))
    .catch((e) => app.log.error(e));
  tick();
  setInterval(tick, 30_000).unref();
  // Письма: очередь — каждые 30 секунд, напоминания и отчёты — раз в 5 минут
  const mailTick = () => processOutbox(app.log).catch((e) => app.log.error(e));
  mailTick();
  setInterval(mailTick, 30_000).unref();
  const notifyTick = () => runNotifications(app.log);
  setTimeout(notifyTick, 10_000).unref();
  setInterval(notifyTick, 5 * 60_000).unref();
  app.log.info(mailEnabled() ? 'mail: SMTP enabled' : 'mail: SMTP_URL not set, emails are logged only');
  // Реклама: проверка результатов, синхронизация и ежедневный анализ агентом
  scheduleAds(app.log);
  // Оплата: автопродление и сверка платежей — раз в 5 минут
  if (billingEnabled()) {
    const billingTick = () => syncPending(app.log).then(() => autoRenew(app.log)).catch((e) => app.log.error(e));
    billingTick();
    setInterval(billingTick, 5 * 60_000).unref();
    app.log.info('billing: YooKassa enabled');
  }
}
