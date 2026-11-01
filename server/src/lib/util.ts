import { randomBytes } from 'node:crypto';

export const genKey = (prefix: string, bytes = 12) => `${prefix}_${randomBytes(bytes).toString('hex')}`;

export function parseUA(ua = '') {
  const s = ua.toLowerCase();
  const device = /ipad|tablet|(android(?!.*mobile))/.test(s)
    ? 'tablet'
    : /mobi|iphone|ipod|android/.test(s)
      ? 'mobile'
      : 'desktop';
  const browser = /yabrowser/.test(s) ? 'Yandex'
    : /edg\//.test(s) ? 'Edge'
    : /opr\/|opera/.test(s) ? 'Opera'
    : /samsungbrowser/.test(s) ? 'Samsung'
    : /firefox|fxios/.test(s) ? 'Firefox'
    : /chrome|crios/.test(s) ? 'Chrome'
    : /safari/.test(s) ? 'Safari'
    : 'Other';
  const os = /windows/.test(s) ? 'Windows'
    : /iphone|ipad|ipod/.test(s) ? 'iOS'
    : /android/.test(s) ? 'Android'
    : /mac os/.test(s) ? 'macOS'
    : /linux/.test(s) ? 'Linux'
    : 'Other';
  return { device, browser, os };
}

const SEARCH = ['google.', 'yandex.', 'bing.', 'duckduckgo.', 'mail.ru', 'yahoo.', 'rambler.'];
const SOCIAL = ['vk.com', 'vk.ru', 'ok.ru', 't.me', 'telegram.', 'facebook.', 'instagram.', 'twitter.', 'x.com', 'youtube.', 'tiktok.', 'dzen.ru', 'linkedin.', 'pinterest.'];

/** Классификация источника трафика: UTM > реферер > прямой заход. */
export function classifySource(input: {
  utm_source?: string | null;
  utm_medium?: string | null;
  referrer?: string | null;
  host?: string | null;
}): { source: string; medium: string } {
  if (input.utm_source) {
    return { source: input.utm_source.toLowerCase().slice(0, 100), medium: (input.utm_medium || 'referral').toLowerCase().slice(0, 100) };
  }
  let refHost = '';
  try {
    refHost = input.referrer ? new URL(input.referrer).hostname.replace(/^www\./, '') : '';
  } catch {
    refHost = '';
  }
  if (!refHost || (input.host && refHost === input.host.replace(/^www\./, ''))) {
    return { source: '(direct)', medium: '(none)' };
  }
  if (SEARCH.some((d) => refHost.includes(d))) return { source: refHost.split('.').slice(-2, -1)[0] || refHost, medium: 'organic' };
  if (SOCIAL.some((d) => refHost.includes(d))) return { source: refHost, medium: 'social' };
  return { source: refHost, medium: 'referral' };
}

export function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || !v) return null;
  return v.slice(0, max);
}
