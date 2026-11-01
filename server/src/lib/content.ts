import sanitizeHtml from 'sanitize-html';

const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** «Новая коллекция осени!» → «novaya-kollektsiya-oseni» */
export function slugify(s: string) {
  return s.toLowerCase().split('').map((c) => TR[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'post';
}

/**
 * Контент выводится на сайт клиента, поэтому HTML очищаем: никаких скриптов,
 * обработчиков событий и javascript:-ссылок. Разрешены разметка текста,
 * картинки, таблицы и видео с YouTube / VK / Rutube.
 */
export function cleanHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
      'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'iframe', 'mark', 'sub', 'sup',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      iframe: ['src', 'width', 'height', 'allowfullscreen', 'frameborder', 'allow'],
      '*': ['class', 'style'],
    },
    allowedStyles: { '*': { 'text-align': [/^(left|right|center|justify)$/], color: [/^#[0-9a-f]{3,6}$/i, /^rgb\(/] } },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedIframeHostnames: ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'vk.com', 'vkvideo.ru', 'rutube.ru'],
    exclusiveFilter: (frame) => (frame.tag === 'iframe' || frame.tag === 'img') && !frame.attribs.src,
    transformTags: {
      a: (tag, attribs) => ({ tagName: 'a', attribs: attribs.target === '_blank' ? { ...attribs, rel: 'noopener noreferrer' } : attribs }),
      img: (tag, attribs) => ({ tagName: 'img', attribs: { loading: 'lazy', ...attribs } }),
    },
  });
}

export const textExcerpt = (html: string, len = 220) => {
  const t = sanitizeHtml(html.replace(/</g, ' <'), { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
  return t.length > len ? t.slice(0, len).replace(/\s\S*$/, '') + '…' : t;
};

export const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
