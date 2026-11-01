/**
 * Кросспостинг: отправка публикаций в Telegram-каналы (Bot API) и сообщества VK (wall.post).
 * Адреса API можно переопределить переменными окружения (для тестов и прокси).
 */
import { textExcerpt } from './content.js';

const TG_API = (process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org').replace(/\/$/, '');
const VK_API = (process.env.VK_API_URL ?? 'https://api.vk.com').replace(/\/$/, '');
const VK_VERSION = '5.199';

export interface SocialPost {
  title: string;
  excerpt: string | null;
  content: string;
  cover_url: string | null;
  social_text: string | null;
  url: string | null; // ссылка на статью на сайте
}

export interface SendResult { url: string | null }

export class SocialError extends Error {
  constructor(message: string, public permanent = false) { super(message); }
}

const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s\S*$/, '') + '…' : s);

/** Текст поста: свой текст или «Заголовок + анонс», плюс ссылка на сайт */
export function plainText(p: SocialPost, max: number) {
  const link = p.url ? `\n\n${p.url}` : '';
  const body = p.social_text?.trim() || `${p.title}\n\n${p.excerpt?.trim() || textExcerpt(p.content, 400)}`;
  return clip(body.trim(), max - link.length) + link;
}

function telegramHtml(p: SocialPost, max: number) {
  const link = p.url ? `\n\n<a href="${escHtml(p.url)}">Читать полностью →</a>` : '';
  const head = p.social_text?.trim() ? '' : `<b>${escHtml(p.title)}</b>\n\n`;
  let body = p.social_text?.trim() || p.excerpt?.trim() || textExcerpt(p.content, 400);
  // Лимит Telegram считается по видимому тексту, длина с HTML-сущностями — безопасная оценка сверху
  const budget = max - link.length - head.length;
  while (body.length > 1 && escHtml(body).length > budget) body = clip(body, Math.floor(body.length * 0.9));
  return head + escHtml(body) + link;
}

async function call(url: string, body: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: new URLSearchParams(body), signal: AbortSignal.timeout(15000) });
  } catch (e: any) {
    throw new SocialError(`Сеть недоступна: ${e.message}`);
  }
  const data: any = await res.json().catch(() => null);
  return { status: res.status, data };
}

// ---------------- Telegram ----------------
const tgPermanent = (code: number, desc: string) => code === 401 || code === 403 || /chat not found|not enough rights|bot was kicked/i.test(desc);

export async function sendTelegram(token: string, chatId: string, p: SocialPost): Promise<SendResult> {
  const base = `${TG_API}/bot${token}`;
  const photo = p.cover_url && /^https:\/\//.test(p.cover_url) ? p.cover_url : null;
  let r = photo
    ? await call(`${base}/sendPhoto`, { chat_id: chatId, photo, caption: telegramHtml(p, 1024), parse_mode: 'HTML' })
    : await call(`${base}/sendMessage`, { chat_id: chatId, text: telegramHtml(p, 4096), parse_mode: 'HTML' });
  // Telegram не смог скачать картинку — отправим текстом
  if (photo && !r.data?.ok && /wrong.*(file|url)|failed to get http url|wrong type of the web page content/i.test(r.data?.description ?? '')) {
    r = await call(`${base}/sendMessage`, { chat_id: chatId, text: telegramHtml(p, 4096), parse_mode: 'HTML' });
  }
  if (!r.data?.ok) {
    const desc = r.data?.description ?? `HTTP ${r.status}`;
    throw new SocialError(`Telegram: ${desc}`, tgPermanent(r.data?.error_code ?? r.status, desc));
  }
  const msg = r.data.result;
  const username = msg?.chat?.username ?? (chatId.startsWith('@') ? chatId.slice(1) : null);
  return { url: username ? `https://t.me/${username}/${msg.message_id}` : null };
}

export async function checkTelegram(token: string, chatId: string) {
  const me = await call(`${TG_API}/bot${token}/getMe`, {});
  if (!me.data?.ok) throw new SocialError('Неверный токен бота', true);
  const chat = await call(`${TG_API}/bot${token}/getChat`, { chat_id: chatId });
  if (!chat.data?.ok) throw new SocialError(`Канал не найден или бот не добавлен в него: ${chat.data?.description ?? ''}`, true);
  const admin = await call(`${TG_API}/bot${token}/getChatMember`, { chat_id: chatId, user_id: String(me.data.result.id) });
  const st = admin.data?.result?.status;
  if (st !== 'administrator' && st !== 'creator') throw new SocialError('Бот должен быть администратором канала с правом публикации', true);
  return { info: `@${me.data.result.username} → ${chat.data.result.title ?? chatId}` };
}

// ---------------- VK ----------------
const vkPermanent = (code: number) => [5, 7, 15, 27, 28, 100, 113, 203, 214].includes(code);

async function vk(method: string, token: string, params: Record<string, string>) {
  const r = await call(`${VK_API}/method/${method}`, { ...params, access_token: token, v: VK_VERSION });
  if (r.data?.error) throw new SocialError(`VK: ${r.data.error.error_msg}`, vkPermanent(r.data.error.error_code));
  if (!r.data?.response) throw new SocialError(`VK: HTTP ${r.status}`);
  return r.data.response;
}

export async function sendVk(token: string, groupId: string, p: SocialPost): Promise<SendResult> {
  const gid = groupId.replace(/^-/, '');
  // Ссылка во вложении — VK сам построит карточку с картинкой из og:image страницы
  const res = await vk('wall.post', token, {
    owner_id: `-${gid}`, from_group: '1', message: plainText(p, 15000), ...(p.url ? { attachments: p.url } : {}),
  });
  return { url: `https://vk.com/wall-${gid}_${res.post_id}` };
}

export async function checkVk(token: string, groupId: string) {
  const gid = groupId.replace(/^-/, '');
  const res = await vk('groups.getById', token, { group_id: gid });
  const g = res.groups?.[0] ?? res[0];
  if (!g) throw new SocialError('Сообщество не найдено', true);
  return { info: g.name as string };
}
