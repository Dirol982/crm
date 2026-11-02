/**
 * Отправка писем через SMTP (Яндекс 360, Mail.ru, UniSender Go, SendPulse…).
 * Письма сначала попадают в очередь (таблица emails) и уходят фоном с повторами.
 * Без SMTP_URL письма не отправляются: в журнале — «skipped», ссылки видны в логе сервера.
 */
import nodemailer from 'nodemailer';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { pool, q } from './db.js';
import { config } from './config.js';

export const mailConfig = {
  url: process.env.SMTP_URL ?? '',                       // smtps://user:pass@smtp.yandex.ru:465
  from: process.env.MAIL_FROM ?? 'Пульс CRM <no-reply@localhost>',
  replyTo: process.env.MAIL_REPLY_TO ?? '',
};
export const mailEnabled = () => !!mailConfig.url;
const transport = mailConfig.url ? nodemailer.createTransport(mailConfig.url) : null;

export interface Mail { to: string; subject: string; html: string; text: string; kind: string; tenantId?: string | null; headers?: Record<string, string> }

export async function queueEmail(m: Mail) {
  await pool.query(
    'INSERT INTO emails(tenant_id, kind, to_email, subject, html, text, headers) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [m.tenantId ?? null, m.kind, m.to, m.subject, m.html, m.text, JSON.stringify(m.headers ?? {})],
  );
  kick();
}

let running = false, again = false;
/** Сразу отправить очередь (без ожидания планировщика) */
export function kick() { setImmediate(() => processOutbox().catch((e) => console.error(e))); }

const MAX_ATTEMPTS = 6;
export async function processOutbox(log?: { info: (m: string) => void; error: (e: unknown) => void }) {
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      await pool.query(`UPDATE emails SET status='pending' WHERE status='sending' AND next_attempt_at < now() - interval '10 minutes'`);
      const jobs = (await pool.query(
        `UPDATE emails SET status='sending', attempts=attempts+1, next_attempt_at=now()
         WHERE id IN (SELECT id FROM emails WHERE status='pending' AND next_attempt_at <= now() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
         RETURNING id, to_email, subject, html, text, headers, attempts, kind`,
      )).rows;
      for (const j of jobs) {
        if (!transport) {
          await pool.query(`UPDATE emails SET status='skipped', error='SMTP не настроен' WHERE id=$1`, [j.id]);
          const link = j.text.match(/https?:\/\/\S+/)?.[0];
          (log?.info ?? console.log)(`[mail:skipped] ${j.kind} → ${j.to_email}: «${j.subject}»${link ? ` ${link}` : ''}`);
          continue;
        }
        try {
          await transport.sendMail({
            from: mailConfig.from, to: j.to_email, subject: j.subject, html: j.html, text: j.text,
            replyTo: mailConfig.replyTo || undefined, headers: j.headers,
          });
          await pool.query(`UPDATE emails SET status='sent', sent_at=now(), error=NULL WHERE id=$1`, [j.id]);
        } catch (e: any) {
          // 5xx от почтового сервера (адрес не существует) — повторять бессмысленно
          const permanent = e.responseCode === 550 || e.responseCode === 553;
          const last = permanent || j.attempts >= MAX_ATTEMPTS;
          await pool.query(
            `UPDATE emails SET status=$2, error=$3, next_attempt_at=now() + ($4 || ' minutes')::interval WHERE id=$1`,
            [j.id, last ? 'failed' : 'pending', String(e.message).slice(0, 500), String(2 ** j.attempts)],
          );
          log?.error(e);
        }
      }
      if (jobs.length === 20) again = true;
    } while (again);
  } finally {
    running = false;
  }
}

// ---------- Токены ----------
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** Подпись ссылки «отписаться» (без входа в аккаунт) */
export const unsubSig = (uid: string) => createHmac('sha256', config.jwtSecret).update(`unsub:${uid}`).digest('base64url').slice(0, 32);
export const unsubUrl = (uid: string) => `${config.publicUrl}/api/email/unsubscribe?u=${uid}&s=${unsubSig(uid)}`;

export async function recentEmails(tenantId: string) {
  return q('SELECT id, kind, to_email, subject, status, error, created_at, sent_at FROM emails WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [tenantId]);
}
