import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';

// Ключ шифрования токенов соцсетей: SECRETS_KEY или производный от JWT_SECRET
const KEY = createHash('sha256').update(process.env.SECRETS_KEY ?? `secrets:${config.jwtSecret}`).digest();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(blob: string): string {
  const [v, iv, tag, data] = blob.split(':');
  if (v !== 'v1') throw new Error('bad_secret_format');
  const d = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

/** «123456:ABC…xyz» → «1234…xyz» для показа в интерфейсе */
export const mask = (s: string) => (s.length <= 8 ? '••••' : `${s.slice(0, 4)}…${s.slice(-3)}`);
