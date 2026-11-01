export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://crm:crm@localhost:5432/crm',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  // Публичный адрес API — подставляется в сниппет трекера
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  // Папка со сборкой фронтенда (web/dist); если есть — сервер раздаёт её
  webDist: process.env.WEB_DIST ?? new URL('../../../web/dist', import.meta.url).pathname,
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  allowSignup: process.env.ALLOW_SIGNUP !== 'false',
};

if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
