/**
 * Демо-бэкенд в браузере (для GitHub Pages): генерирует правдоподобные данные
 * и реализует те же эндпоинты, что и сервер. Изменения живут до перезагрузки.
 */
import { isoDay } from './format';

let seed = 20261101;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rnd = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const pick = <T,>(arr: [T, number][]): T => {
  const total = arr.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of arr) if ((r -= w) < 0) return v;
  return arr[0][0];
};
let idc = 1000;
const id = () => `00000000-0000-4000-8000-${String(++idc).padStart(12, '0')}`;

interface S { id: string; v: string; site: string; start: number; last: number; source: string; medium: string; campaign: string | null; landing: string; exit: string; device: string; browser: string; os: string; pv: number; ev: number; dur: number }
interface PV { sid: string; site: string; path: string; ts: number; d: number }
interface EV { sid: string; site: string; name: string; ts: number; value: number | null }

const DAY = 86400000;
const now = Date.now();
const USER = { id: id(), email: 'demo@example.com', name: 'Демо Владелец' };
const MANAGER = { id: id(), email: 'manager@example.com', name: 'Мария Менеджер' };
const tenant = { id: id(), name: 'Демо магазин', plan: 'pro', currency: 'RUB', timezone: 'Europe/Moscow', deal_stages: ['new', 'contacted', 'proposal', 'negotiation', 'won', 'lost'] };
const team = [
  { ...USER, role: 'owner', created_at: new Date(now - 90 * DAY).toISOString() },
  { ...MANAGER, role: 'manager', created_at: new Date(now - 60 * DAY).toISOString() },
];
const sites = [
  { id: id(), name: 'shop.example.com', domain: 'shop.example.com', public_key: 'pk_demo_shop', secret_key: 'sk_demo_' + 'x'.repeat(40), created_at: new Date(now - 90 * DAY).toISOString() },
  { id: id(), name: 'landing.example.com', domain: 'landing.example.com', public_key: 'pk_demo_land', secret_key: 'sk_demo_' + 'y'.repeat(40), created_at: new Date(now - 40 * DAY).toISOString() },
];

const SOURCES: [[string, string, string | null], number][] = [
  [['(direct)', '(none)', null], 26], [['google', 'organic', null], 18], [['yandex', 'organic', null], 22],
  [['yandex', 'cpc', 'autumn_sale'], 14], [['vk.com', 'social', null], 8], [['telegram', 'social', 'channel_post'], 6],
  [['email', 'newsletter', 'november'], 4], [['partner-blog.ru', 'referral', null], 2],
];
const PAGES = ['/', '/catalog', '/catalog/shoes', '/catalog/bags', '/product/123', '/product/456', '/product/789', '/cart', '/checkout', '/about', '/delivery', '/contacts', '/blog/how-to-choose'];
const LAND_PAGES = ['/', '/promo', '/promo/form', '/thanks'];
const NAMES = ['Анна Смирнова', 'Иван Петров', 'Мария Козлова', 'Дмитрий Волков', 'Елена Новикова', 'Сергей Морозов', 'Ольга Соколова', 'Алексей Лебедев', 'Наталья Попова', 'Павел Кузнецов', 'Татьяна Васильева', 'Николай Фёдоров', 'Юлия Михайлова', 'Андрей Егоров', 'Екатерина Павлова', 'Михаил Орлов', 'Светлана Белова', 'Артём Зайцев'];
const COMPANIES = [null, null, 'ООО «Ромашка»', 'ИП Сидоров', 'АО «Вектор»', null, 'ООО «Северный ветер»'];

const contacts: any[] = [];
for (let i = 0; i < 80; i++) {
  contacts.push({
    id: id(), tenant_id: tenant.id, name: NAMES[i % NAMES.length], email: `client${i + 1}@mail.ru`,
    phone: `+7 900 ${String(100 + i).padStart(3, '0')}-${String(10 + (i * 37) % 90)}-${String(10 + (i * 53) % 90)}`,
    company: COMPANIES[i % COMPANIES.length], source: pick(SOURCES)[0], notes: null, tags: i % 5 === 0 ? ['VIP'] : [],
    owner_id: i % 2 ? USER.id : MANAGER.id, created_at: new Date(now - rnd(0, 89) * DAY).toISOString(),
  });
}

const sessions: S[] = [];
const pageviews: PV[] = [];
const events: EV[] = [];
const orders: any[] = [];

for (let day = 89; day >= 0; day--) {
  const dayStart = new Date(now - day * DAY); dayStart.setHours(0, 0, 0, 0);
  const wd = dayStart.getDay();
  const base = (wd === 0 || wd === 6 ? 70 : 110) + (90 - day) * 0.9;
  const n = Math.round(base * (0.85 + rand() * 0.3));
  for (let i = 0; i < n; i++) {
    const hour = pick([[rnd(0, 7), 1], [rnd(8, 12), 3], [rnd(13, 18), 4], [rnd(19, 23), 3]] as [number, number][]);
    const start = dayStart.getTime() + hour * 3600000 + rnd(0, 3599) * 1000;
    if (start > now) continue;
    const isLanding = rand() < 0.25;
    const site = isLanding ? sites[1] : sites[0];
    const [source, medium, campaign] = isLanding ? pick([[['yandex', 'cpc', 'lead_form'], 6], [['vk.com', 'social', 'ads_nov'], 3], [['(direct)', '(none)', null], 1]] as [[string, string, string | null], number][]) : pick(SOURCES);
    const sid = id();
    const v = rand() < 0.25 ? `v-${rnd(1, 600)}` : sid;
    const bounce = rand() < (medium === 'cpc' ? 0.5 : medium === 'social' ? 0.6 : 0.38);
    const pages = bounce ? 1 : rnd(2, isLanding ? 4 : 9);
    const pool = isLanding ? LAND_PAGES : PAGES;
    let path = isLanding ? '/promo' : pick([['/', 40], ['/catalog', 20], ['/product/123', 15], ['/blog/how-to-choose', 10], ['/delivery', 5], ['/catalog/shoes', 10]] as [string, number][]);
    let ts = start; let dur = 0; let last = path; const landing = path;
    for (let p = 0; p < pages; p++) {
      const d = bounce ? rnd(2, 25) : rnd(8, 140);
      pageviews.push({ sid, site: site.id, path, ts, d });
      ts += d * 1000; dur += d; last = path;
      path = pool[rnd(0, pool.length - 1)];
    }
    let ev = 0;
    if (!bounce && rand() < (isLanding ? 0.16 : 0.05)) { ev++; events.push({ sid, site: site.id, name: 'lead', ts, value: null }); }
    if (!isLanding && !bounce && rand() < 0.15) { ev++; events.push({ sid, site: site.id, name: 'add_to_cart', ts, value: null }); }
    if (!isLanding && !bounce && rand() < (medium === 'cpc' ? 0.05 : 0.035)) {
      ev++;
      const amount = rnd(9, 160) * 100;
      const c = contacts[rnd(0, contacts.length - 1)];
      orders.push({
        id: id(), external_id: `ORD-${10000 + orders.length}`, amount, currency: 'RUB',
        status: rand() < 0.92 ? 'paid' : pick([['refunded', 1], ['cancelled', 1], ['pending', 1]] as [string, number][]),
        items: [{ name: pick([['Кроссовки', 3], ['Сумка', 2], ['Рюкзак', 2], ['Кошелёк', 1]] as [string, number][]), qty: 1, price: amount }],
        source, medium, campaign, created_at: new Date(ts).toISOString(), contact_id: c.id, site_id: site.id, session_id: sid,
      });
    }
    sessions.push({
      id: sid, v, site: site.id, start, last: ts, source, medium, campaign, landing, exit: last,
      device: pick([['desktop', 52], ['mobile', 42], ['tablet', 6]] as [string, number][]),
      browser: pick([['Chrome', 45], ['Yandex', 25], ['Safari', 18], ['Firefox', 6], ['Edge', 6]] as [string, number][]),
      os: pick([['Windows', 40], ['Android', 30], ['iOS', 18], ['macOS', 10], ['Linux', 2]] as [string, number][]),
      pv: pages, ev, dur,
    });
  }
}
// «Живые» посетители прямо сейчас
for (let i = 0; i < 7; i++) {
  const s = { ...sessions[sessions.length - 1 - i] };
  s.id = id(); s.last = now - rnd(0, 240) * 1000; s.start = s.last - 60000;
  sessions.push(s);
}
for (let i = 0; i < 30; i++) {
  orders.push({
    id: id(), external_id: null, amount: rnd(20, 300) * 100, currency: 'RUB', status: 'paid', items: [],
    source: 'manual', medium: 'offline', campaign: null, created_at: new Date(now - rnd(0, 89) * DAY).toISOString(),
    contact_id: contacts[rnd(0, contacts.length - 1)].id, site_id: null, session_id: null,
  });
}
orders.sort((a, b) => b.created_at.localeCompare(a.created_at));

const TITLES = ['Оптовый заказ', 'Корпоративный подарок', 'Поставка в филиал', 'Годовой контракт', 'Пробная партия', 'Сервисное обслуживание'];
const deals: any[] = [];
for (let i = 0; i < 26; i++) {
  const stage = tenant.deal_stages[i % 6];
  deals.push({
    id: id(), title: `${TITLES[i % TITLES.length]} #${i + 1}`, amount: rnd(30, 900) * 1000, stage, contact_id: contacts[i].id,
    owner_id: i % 2 ? USER.id : MANAGER.id, created_at: new Date(now - rnd(1, 40) * DAY).toISOString(),
    updated_at: new Date(now - rnd(0, 10) * DAY).toISOString(), closed_at: ['won', 'lost'].includes(stage) ? new Date().toISOString() : null,
  });
}
const TASKS = ['Перезвонить клиенту', 'Отправить КП', 'Уточнить адрес доставки', 'Выставить счёт', 'Напомнить об оплате', 'Собрать отзыв'];
const tasks: any[] = [];
for (let i = 0; i < 14; i++) {
  tasks.push({ id: id(), title: TASKS[i % TASKS.length], due_at: new Date(now + (i - 4) * DAY).toISOString(), done: i < 3, assignee_id: i % 2 ? USER.id : MANAGER.id, contact_id: contacts[i].id, deal_id: null, created_at: new Date(now - 5 * DAY).toISOString() });
}

// ---------------- Контент сайта ----------------
const slugify = (t: string) => {
  const tr: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  return t.toLowerCase().split('').map((c) => tr[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'post';
};
const COVERS = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6'].map((c, i) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="${c}"/><circle cx="${60 + i * 60}" cy="70" r="46" fill="white" fill-opacity=".25"/><rect x="150" y="104" width="130" height="14" rx="7" fill="white" fill-opacity=".5"/></svg>`));
const POSTS_SRC: [string, string, number, string[], string, string?][] = [
  ['Как выбрать кроссовки для бега', 'published', -20, ['советы'], '<p>Правильная пара снижает нагрузку на суставы. Рассказываем, на что смотреть в магазине.</p><h2>Амортизация</h2><p>Для асфальта нужна мягкая подошва, для трейла — жёсткая и с протектором.</p><h2>Размер</h2><p>Между большим пальцем и носком должен оставаться зазор около сантиметра.</p>'],
  ['Осенняя распродажа: скидки до 40%', 'published', -9, ['новости', 'акции'], '<p>С 20 октября по 10 ноября — скидки до 40% на коллекцию прошлого сезона.</p><ul><li>Кроссовки — до 30%</li><li>Сумки и рюкзаки — до 40%</li></ul>'],
  ['Новая коллекция сумок', 'published', -3, ['новости'], '<p>Встречайте новую коллекцию: натуральная кожа, три цвета, сделано в России.</p>'],
  ['Уход за кожаной обувью зимой', 'scheduled', 2, ['советы'], '<p>Соль и реагенты — главные враги кожи. Как сохранить обувь до весны.</p>'],
  ['Как подобрать рюкзак для города', 'scheduled', 6, ['советы'], '<p>Объём, спинка, отделение для ноутбука — разбираем по пунктам.</p>'],
  ['Чёрная пятница 2026', 'scheduled', 26, ['акции'], '<p>Главная распродажа года. Подпишитесь, чтобы не пропустить старт.</p>'],
  ['Подарки к Новому году: подборка', 'review', 12, ['подборки'], '<p>Черновик подборки подарков до 5 000 ₽.</p>'],
  ['Интервью с дизайнером коллекции', 'draft', 18, ['истории'], '<p>Текст в работе.</p>'],
  ['Обзор беговых маршрутов города', 'idea', 34, [], ''],
  ['Итоги года: что покупали чаще всего', 'idea', 50, [], ''],
  ['Доставка и оплата', 'published', -60, [], '<h2>Доставка</h2><p>По Москве — 1 день, по России — 2–7 дней. Бесплатно от 5 000 ₽.</p><h2>Оплата</h2><p>Картой онлайн, СБП или при получении.</p>', 'page'],
  ['О компании', 'published', -60, [], '<p>Мы продаём обувь и аксессуары с 2015 года.</p>', 'page'],
];
const posts: any[] = POSTS_SRC.map(([title, status, days, tags, content, type], i) => {
  const at = new Date(now + days * DAY); at.setHours(10 + (i % 3) * 3, 0, 0, 0);
  return {
    id: id(), site_id: sites[0].id, type: type ?? 'post', title, slug: slugify(title), excerpt: null, content, tags, status,
    cover_url: (type ?? 'post') === 'post' && i < 6 ? COVERS[i % COVERS.length] : null,
    publish_at: at.toISOString(), published_at: status === 'published' ? at.toISOString() : null,
    seo_title: null, seo_description: null, author_id: USER.id, updated_at: new Date(now - i * 3600000).toISOString(),
    views: status === 'published' && (type ?? 'post') === 'post' ? rnd(80, 900) : 0,
  };
});
const blocks: any[] = [
  { id: id(), site_id: sites[0].id, key: 'top-banner', title: 'Баннер распродажи', html: '<p><strong>Осенняя распродажа</strong> — скидки до 40% до 10 ноября!</p>', active: true, starts_at: null, ends_at: new Date(now + 9 * DAY).toISOString() },
  { id: id(), site_id: sites[0].id, key: 'footer-note', title: 'Режим работы', html: '<p>Пн–Вс, 10:00–21:00 · +7 495 000-00-00</p>', active: true, starts_at: null, ends_at: null },
  { id: id(), site_id: sites[0].id, key: 'bf-banner', title: 'Баннер «Чёрная пятница»', html: '<p><strong>Чёрная пятница</strong> — скидки до 60%</p>', active: true, starts_at: new Date(now + 26 * DAY).toISOString(), ends_at: new Date(now + 30 * DAY).toISOString() },
];
const channels: any[] = [
  { id: id(), type: 'telegram', name: 'Канал магазина', target: '@shop_demo', secret_mask: '7012…k9Q', active: true, created_at: new Date(now - 30 * DAY).toISOString() },
  { id: id(), type: 'vk', name: 'Группа ВКонтакте', target: '218000000', secret_mask: 'vk1.…f3a', active: true, created_at: new Date(now - 30 * DAY).toISOString() },
];
const deliveries: any[] = [];
let extId = 300;
const sentUrl = (c: any) => (c.type === 'telegram' ? `https://t.me/${c.target.slice(1)}/${++extId}` : `https://vk.com/wall-${c.target}_${++extId}`);
for (const p of posts.filter((x) => x.type === 'post' && ['published', 'scheduled'].includes(x.status))) {
  for (const c of channels) {
    const sent = p.status === 'published';
    deliveries.push({ id: id(), post_id: p.id, channel_id: c.id, status: sent ? 'sent' : 'pending', attempts: sent ? 1 : 0, external_url: sent ? sentUrl(c) : null, error: null, sent_at: sent ? p.published_at : null, next_attempt_at: p.publish_at, created_at: p.updated_at });
  }
}
const deliveriesFor = (postId: string) => deliveries.filter((d) => d.post_id === postId).map((d) => {
  const c = channels.find((x) => x.id === d.channel_id)!;
  return { ...d, channel_name: c.name, type: c.type };
});
/** В демо «отправка» мгновенная */
function deliverPublished() {
  for (const d of deliveries) {
    const p = posts.find((x) => x.id === d.post_id);
    const c = channels.find((x) => x.id === d.channel_id);
    if (d.status === 'pending' && p?.status === 'published' && c?.active) Object.assign(d, { status: 'sent', attempts: 1, external_url: sentUrl(c), sent_at: new Date().toISOString() });
  }
}

// ---------------- Тарифы (демо: оплата имитируется) ----------------
const PLANS_DEMO = [
  { id: 'start', name: 'Старт', price: 990, visits: 10000, sites: 1, users: 2, note: 'Услуги, небольшой магазин' },
  { id: 'business', name: 'Бизнес', price: 2990, visits: 100000, sites: 3, users: 10, note: 'Магазин с рекламой и соцсетями' },
  { id: 'pro', name: 'Про', price: 6990, visits: 500000, sites: 10, users: 1000, note: 'Несколько направлений, API' },
  { id: 'agency', name: 'Агентство', price: 14990, visits: 1000000, sites: 30, users: 1000, note: 'Веб-студии: много клиентов' },
].map((p) => ({ ...p, price_month: p.price, price_year: Math.round(p.price * 12 * 0.8) }));
const billing: any = { plan: 'business', trial_ends_at: new Date(now + 9 * DAY).toISOString(), paid_until: null as string | null, period: 'month', auto_renew: true, card: null as string | null, email: null };
const payments: any[] = [];
function billingState() {
  const lim = (id: string) => { const p = PLANS_DEMO.find((x) => x.id === id)!; return { visits: p.visits, sites: p.sites, users: p.users }; };
  if (billing.paid_until && Date.parse(billing.paid_until) > Date.now()) {
    return { status: 'active', plan: billing.plan, limits: lim(billing.plan), trial_ends_at: billing.trial_ends_at, paid_until: billing.paid_until, days_left: Math.ceil((Date.parse(billing.paid_until) - Date.now()) / DAY) };
  }
  return { status: 'trial', plan: 'business', limits: lim('business'), trial_ends_at: billing.trial_ends_at, paid_until: null, days_left: Math.ceil((Date.parse(billing.trial_ends_at) - Date.now()) / DAY) };
}
const visitsThisMonth = () => { const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0); return sessions.filter((x) => x.start >= m.getTime()).length; };

const siteName = (sid: string) => sites.find((s) => s.id === sid)?.name ?? '';
function savePost(p: any, b: any) {
  const { channels: chosen, ...rest } = b;
  b = rest;
  Object.assign(p, b);
  if (b.title && !p.slug) p.slug = slugify(b.title);
  if (b.slug === null) p.slug = slugify(p.title);
  if (p.status === 'scheduled') {
    if (!p.publish_at) throw new Error('publish_at_required');
    if (Date.parse(p.publish_at) <= Date.now()) { p.status = 'published'; p.published_at = p.publish_at; }
  } else if (p.status === 'published') p.published_at = p.published_at ?? new Date().toISOString();
  else if (p.status !== 'archived') p.published_at = null;
  p.updated_at = new Date().toISOString();
  if (chosen) {
    for (let i = deliveries.length - 1; i >= 0; i--) {
      const d = deliveries[i];
      if (d.post_id === p.id && ['pending', 'failed'].includes(d.status) && !chosen.includes(d.channel_id)) deliveries.splice(i, 1);
    }
    for (const cid of chosen) if (!deliveries.some((d) => d.post_id === p.id && d.channel_id === cid)) {
      deliveries.push({ id: id(), post_id: p.id, channel_id: cid, status: 'pending', attempts: 0, external_url: null, error: null, sent_at: null, next_attempt_at: p.publish_at, created_at: new Date().toISOString() });
    }
  }
  deliverPublished();
  return { ...p, deliveries: deliveriesFor(p.id) };
}

// ---------------- Аналитика ----------------
const dayOf = (ts: number) => isoDay(new Date(ts));
const inRange = (ts: number, from: string, to: string) => { const d = dayOf(ts); return d >= from && d <= to; };
const isBounce = (s: S) => s.pv <= 1 && s.ev === 0;
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const shiftBack = (from: string, to: string): [string, string] => {
  const f = new Date(from + 'T00:00:00'); const t = new Date(to + 'T00:00:00');
  const days = Math.round((t.getTime() - f.getTime()) / DAY) + 1;
  return [isoDay(new Date(f.getTime() - days * DAY)), isoDay(new Date(f.getTime() - DAY))];
};

function filtered(p: URLSearchParams, from = p.get('from')!, to = p.get('to')!) {
  const site = p.get('site');
  const ss = sessions.filter((s) => (!site || s.site === site) && inRange(s.start, from, to));
  const os = orders.filter((o) => o.status === 'paid' && (!site || o.site_id === site) && inRange(Date.parse(o.created_at), from, to));
  const es = events.filter((e) => (!site || e.site === site) && inRange(e.ts, from, to));
  const pv = pageviews.filter((x) => (!site || x.site === site) && inRange(x.ts, from, to));
  return { ss, os, es, pv };
}

function totals(p: URLSearchParams, from: string, to: string) {
  const { ss, os, es } = filtered(p, from, to);
  const revenue = os.reduce((s, o) => s + o.amount, 0);
  return {
    sessions: ss.length, visitors: new Set(ss.map((s) => s.v)).size, pageviews: ss.reduce((a, s) => a + s.pv, 0),
    avg_duration: avg(ss.map((s) => s.dur)), bounce_rate: avg(ss.map((s) => (isBounce(s) ? 1 : 0))),
    engaged: ss.filter((s) => !isBounce(s)).length, orders: os.length, revenue, customers: new Set(os.map((o) => o.contact_id)).size,
    leads: es.filter((e) => e.name === 'lead').length, conversion: ss.length ? os.length / ss.length : 0, aov: os.length ? revenue / os.length : 0,
  };
}

function group<T>(arr: T[], key: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of arr) { const k = key(x); (m.get(k) ?? m.set(k, []).get(k)!).push(x); }
  return m;
}

const handlers: [string, RegExp, (m: RegExpMatchArray, p: URLSearchParams, body: any) => any][] = [
  ['POST', /^\/api\/auth\/(login|signup|switch)$/, () => ({ token: 'demo' })],
  ['GET', /^\/api\/me$/, () => ({ user: USER, tenant, role: 'owner', workspaces: [{ id: tenant.id, name: tenant.name, role: 'owner' }], billing: billingState(), is_superadmin: false })],
  ['GET', /^\/api\/billing$/, () => ({
    enabled: true, invoices: true, state: billingState(), year_discount: 0.2, plans: PLANS_DEMO, payments,
    usage: { visits: visitsThisMonth(), sites: sites.length, users: team.length },
    settings: { auto_renew: billing.auto_renew, payment_method_title: billing.card, billing_email: billing.email, billing_period: billing.period },
  })],
  ['POST', /^\/api\/billing\/checkout$/, (_m, _p, b) => {
    const pl = PLANS_DEMO.find((x) => x.id === b.plan)!;
    const pay = { id: id(), provider: 'yookassa', plan: b.plan, period: b.period, amount: b.period === 'year' ? pl.price_year : pl.price_month, status: 'pending', is_renewal: false, created_at: new Date().toISOString(), paid_at: null, error: null, company: null };
    payments.unshift(pay);
    return { id: pay.id, confirmation_url: `#/billing?payment=${pay.id}` }; // в демо сразу «возвращаемся» с оплаты
  }],
  ['POST', /^\/api\/billing\/payments\/([^/]+)\/refresh$/, (m) => {
    const pay = payments.find((x) => x.id === m[1]);
    if (pay && pay.status === 'pending') {
      Object.assign(pay, { status: 'succeeded', paid_at: new Date().toISOString() });
      const from = Math.max(Date.now(), billing.paid_until ? Date.parse(billing.paid_until) : 0);
      const until = new Date(from); if (pay.period === 'year') until.setFullYear(until.getFullYear() + 1); else until.setMonth(until.getMonth() + 1);
      Object.assign(billing, { plan: pay.plan, period: pay.period, paid_until: until.toISOString(), card: 'Карта •••• 4242' });
    }
    return { status: pay?.status ?? 'canceled', state: billingState() };
  }],
  ['PATCH', /^\/api\/billing\/settings$/, (_m, _p, b) => {
    if (b.auto_renew !== undefined) billing.auto_renew = b.auto_renew;
    if (b.billing_email !== undefined) billing.email = b.billing_email || null;
    if (b.remove_card) billing.card = null;
    return {};
  }],
  ['POST', /^\/api\/billing\/invoice$/, (_m, _p, b) => {
    const pl = PLANS_DEMO.find((x) => x.id === b.plan)!;
    const pay = { id: id(), provider: 'invoice', plan: b.plan, period: b.period, amount: b.period === 'year' ? pl.price_year : pl.price_month, status: 'pending', is_renewal: false, created_at: new Date().toISOString(), paid_at: null, error: null, company: b.company };
    payments.unshift(pay);
    return pay;
  }],
  ['GET', /^\/api\/billing\/invoice\/([^/]+)$/, (m) => {
    const pay = payments.find((x) => x.id === m[1]);
    return { ...pay, number: payments.filter((x) => x.provider === 'invoice').length, plan_name: PLANS_DEMO.find((x) => x.id === pay.plan)!.name,
      seller: { name: 'ООО «Пример»', inn: '7700000000', kpp: '770001001', address: 'г. Москва, ул. Примерная, д. 1', bank: 'АО «Банк»', bik: '044500000', account: '40702810000000000000', corr: '30101810000000000000' } };
  }],
  ['PATCH', /^\/api\/tenant$/, (_m, _p, b) => Object.assign(tenant, b)],
  ['GET', /^\/api\/sites$/, () => sites.map((s) => ({ ...s, snippet: `<script async src="https://crm.example.com/t.js" data-key="${s.public_key}"></script>`, api_url: 'https://crm.example.com/api/v1' }))],
  ['PATCH', /^\/api\/sites\/([^/]+)$/, (m, _p, b) => Object.assign(sites.find((x) => x.id === m[1])!, b)],
  ['POST', /^\/api\/sites$/, (_m, _p, b) => { const s = { id: id(), name: b.name, domain: b.domain || null, public_key: 'pk_demo_' + rnd(1000, 9999), secret_key: 'sk_demo_' + 'z'.repeat(40), created_at: new Date().toISOString() }; sites.push(s); return s; }],
  ['POST', /^\/api\/sites\/([^/]+)\/rotate-secret$/, (m) => { const s = sites.find((x) => x.id === m[1])!; s.secret_key = 'sk_demo_' + rnd(1e8, 9e8) + 'z'.repeat(31); return s; }],
  ['DELETE', /^\/api\/sites\/([^/]+)$/, (m) => { sites.splice(sites.findIndex((x) => x.id === m[1]), 1); return { ok: true }; }],
  ['GET', /^\/api\/team$/, () => team],
  ['POST', /^\/api\/team$/, (_m, _p, b) => { const u = { id: id(), email: b.email, name: b.name, role: b.role, created_at: new Date().toISOString() }; team.push(u); return u; }],
  ['DELETE', /^\/api\/team\/([^/]+)$/, (m) => { team.splice(team.findIndex((x) => x.id === m[1]), 1); return { ok: true }; }],

  ['GET', /^\/api\/analytics\/overview$/, (_m, p) => {
    const from = p.get('from')!, to = p.get('to')!;
    const [pf, pt] = shiftBack(from, to);
    const current = totals(p, from, to);
    const { ss, os } = filtered(p);
    const sByDay = group(ss, (s) => dayOf(s.start));
    const oByDay = group(os, (o) => dayOf(Date.parse(o.created_at)));
    const daily = [];
    for (let d = new Date(from + 'T00:00:00'); isoDay(d) <= to; d = new Date(d.getTime() + DAY)) {
      const k = isoDay(d); const s = sByDay.get(k) ?? []; const o = oByDay.get(k) ?? [];
      daily.push({ day: k, sessions: s.length, visitors: new Set(s.map((x) => x.v)).size, bounce_rate: avg(s.map((x) => (isBounce(x) ? 1 : 0))), orders: o.length, revenue: o.reduce((a, x) => a + x.amount, 0) });
    }
    return {
      current, previous: totals(p, pf, pt), previous_range: { from: pf, to: pt }, daily,
      funnel: [{ step: 'visits', value: current.sessions }, { step: 'engaged', value: current.engaged }, { step: 'leads', value: current.leads }, { step: 'orders', value: current.orders }],
    };
  }],
  ['GET', /^\/api\/analytics\/sources$/, (_m, p) => {
    const { ss, os } = filtered(p);
    const rows = new Map<string, any>();
    for (const [k, g] of group(ss, (s) => `${s.source}|${s.medium}`)) {
      rows.set(k, { source: g[0].source, medium: g[0].medium, sessions: g.length, visitors: new Set(g.map((s) => s.v)).size, bounce_rate: avg(g.map((s) => (isBounce(s) ? 1 : 0))), avg_duration: avg(g.map((s) => s.dur)), orders: 0, revenue: 0 });
    }
    for (const [k, g] of group(os, (o) => `${o.source}|${o.medium}`)) {
      const r = rows.get(k) ?? { source: g[0].source, medium: g[0].medium, sessions: 0, visitors: 0, bounce_rate: 0, avg_duration: 0, orders: 0, revenue: 0 };
      r.orders = g.length; r.revenue = g.reduce((a, o) => a + o.amount, 0); rows.set(k, r);
    }
    return [...rows.values()].map((r) => ({ ...r, conversion: r.sessions ? r.orders / r.sessions : 0 })).sort((a, b) => b.sessions - a.sessions || b.revenue - a.revenue);
  }],
  ['GET', /^\/api\/analytics\/pages$/, (_m, p) => {
    const { ss, pv } = filtered(p);
    const views = group(pv, (x) => x.path);
    const top = [...views].map(([path, g]) => ({ path, views: g.length, sessions: new Set(g.map((x) => x.sid)).size, avg_time: avg(g.map((x) => x.d)) })).sort((a, b) => b.views - a.views);
    const entry = [...group(ss, (s) => s.landing)].map(([path, g]) => ({ path, sessions: g.length, bounce_rate: avg(g.map((s) => (isBounce(s) ? 1 : 0))) })).sort((a, b) => b.sessions - a.sessions);
    const exit = [...group(ss, (s) => s.exit)].map(([path, g]) => { const v = views.get(path)?.length ?? g.length; return { path, exits: g.length, views: v, exit_rate: g.length / Math.max(v, 1) }; }).sort((a, b) => b.exits - a.exits);
    return { top, entry, exit };
  }],
  ['GET', /^\/api\/analytics\/tech$/, (_m, p) => {
    const { ss } = filtered(p);
    const by = (k: keyof S) => [...group(ss, (s) => String(s[k]))].map(([name, g]) => ({ name, sessions: g.length, bounce_rate: avg(g.map((s) => (isBounce(s) ? 1 : 0))) })).sort((a, b) => b.sessions - a.sessions);
    return { device: by('device'), browser: by('browser'), os: by('os') };
  }],
  ['GET', /^\/api\/analytics\/events$/, (_m, p) => {
    const { es, os } = filtered(p);
    const rows = [...group(es, (e) => e.name)].map(([name, g]) => ({ name, count: g.length, sessions: new Set(g.map((e) => e.sid)).size, value: 0 }));
    const web = os.filter((o) => o.session_id);
    rows.push({ name: 'purchase', count: web.length, sessions: web.length, value: web.reduce((a, o) => a + o.amount, 0) });
    return rows.sort((a, b) => b.count - a.count);
  }],
  ['GET', /^\/api\/analytics\/realtime$/, (_m, p) => {
    const site = p.get('site');
    const act = sessions.filter((s) => (!site || s.site === site) && s.last > Date.now() - 5 * 60000);
    return { visitors: act.length, pages: [...group(act, (s) => s.exit)].map(([path, g]) => ({ path, visitors: g.length })).sort((a, b) => b.visitors - a.visitors) };
  }],

  ['GET', /^\/api\/contacts$/, (_m, p) => {
    const q = (p.get('q') ?? '').toLowerCase();
    const list = contacts.filter((c) => !q || [c.name, c.email, c.phone, c.company].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((c) => { const o = orders.filter((x) => x.contact_id === c.id && x.status === 'paid'); return { ...c, orders_count: o.length, revenue: o.reduce((a, x) => a + x.amount, 0), last_order_at: o[0]?.created_at ?? null }; });
    const off = +(p.get('offset') ?? 0), lim = +(p.get('limit') ?? 50);
    return { items: list.slice(off, off + lim), total: list.length };
  }],
  ['GET', /^\/api\/contacts\/([^/]+)$/, (m) => {
    const contact = contacts.find((c) => c.id === m[1]);
    if (!contact) throw new Error('not_found');
    const o = orders.filter((x) => x.contact_id === contact.id);
    const sids = new Set(o.map((x) => x.session_id).filter(Boolean));
    return {
      contact, orders: o, deals: deals.filter((d) => d.contact_id === contact.id), tasks: tasks.filter((t) => t.contact_id === contact.id),
      sessions: sessions.filter((s) => sids.has(s.id)).map((s) => ({ id: s.id, started_at: new Date(s.start).toISOString(), source: s.source, medium: s.medium, campaign: s.campaign, landing_page: s.landing, exit_page: s.exit, pageviews: s.pv, duration_sec: s.dur, device: s.device })),
    };
  }],
  ['POST', /^\/api\/contacts$/, (_m, _p, b) => { const c = { id: id(), tags: [], source: 'manual', ...b, created_at: new Date().toISOString() }; contacts.unshift(c); return c; }],
  ['PATCH', /^\/api\/contacts\/([^/]+)$/, (m, _p, b) => Object.assign(contacts.find((c) => c.id === m[1]), b)],
  ['DELETE', /^\/api\/contacts\/([^/]+)$/, (m) => { contacts.splice(contacts.findIndex((c) => c.id === m[1]), 1); return { ok: true }; }],

  ['GET', /^\/api\/deals$/, () => deals.map((d) => ({ ...d, contact_name: contacts.find((c) => c.id === d.contact_id)?.name ?? null, owner_name: team.find((u) => u.id === d.owner_id)?.name ?? null }))],
  ['POST', /^\/api\/deals$/, (_m, _p, b) => { const d = { id: id(), stage: tenant.deal_stages[0], amount: 0, owner_id: USER.id, ...b, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; deals.unshift(d); return d; }],
  ['PATCH', /^\/api\/deals\/([^/]+)$/, (m, _p, b) => Object.assign(deals.find((d) => d.id === m[1]), b, { updated_at: new Date().toISOString() })],
  ['DELETE', /^\/api\/deals\/([^/]+)$/, (m) => { deals.splice(deals.findIndex((d) => d.id === m[1]), 1); return { ok: true }; }],

  ['GET', /^\/api\/tasks$/, (_m, p) => tasks.filter((t) => p.get('mine') !== 'true' || t.assignee_id === USER.id)
    .map((t) => ({ ...t, contact_name: contacts.find((c) => c.id === t.contact_id)?.name ?? null, assignee_name: team.find((u) => u.id === t.assignee_id)?.name ?? null }))
    .sort((a, b) => Number(a.done) - Number(b.done) || String(a.due_at).localeCompare(String(b.due_at)))],
  ['POST', /^\/api\/tasks$/, (_m, _p, b) => { const t = { id: id(), done: false, assignee_id: USER.id, ...b, created_at: new Date().toISOString() }; tasks.unshift(t); return t; }],
  ['PATCH', /^\/api\/tasks\/([^/]+)$/, (m, _p, b) => Object.assign(tasks.find((t) => t.id === m[1]), b)],
  ['DELETE', /^\/api\/tasks\/([^/]+)$/, (m) => { tasks.splice(tasks.findIndex((t) => t.id === m[1]), 1); return { ok: true }; }],

  ['GET', /^\/api\/posts\/calendar$/, (_m, p) => posts
    .filter((x) => x.status !== 'archived' && (!p.get('site') || x.site_id === p.get('site')))
    .map((x) => ({ id: x.id, site_id: x.site_id, site_name: siteName(x.site_id), type: x.type, title: x.title, status: x.status, date: x.published_at ?? x.publish_at }))
    .filter((x) => x.date && x.date.slice(0, 10) >= p.get('from')! && x.date.slice(0, 10) <= p.get('to')!)],
  ['GET', /^\/api\/posts$/, (_m, p) => posts
    .filter((x) => (!p.get('type') || x.type === p.get('type')) && (!p.get('status') || x.status === p.get('status')) && (!p.get('site') || x.site_id === p.get('site'))
      && (!p.get('q') || x.title.toLowerCase().includes(p.get('q')!.toLowerCase())))
    .map((x) => ({ ...x, site_name: siteName(x.site_id), author_name: USER.name }))
    .sort((a, b) => String(b.published_at ?? b.publish_at ?? b.updated_at).localeCompare(String(a.published_at ?? a.publish_at ?? a.updated_at)))],
  ['GET', /^\/api\/posts\/([^/]+)$/, (m) => { const x = posts.find((y) => y.id === m[1]); if (!x) throw new Error('not_found'); return { ...x, site_name: siteName(x.site_id), deliveries: deliveriesFor(x.id) }; }],
  ['GET', /^\/api\/channels$/, () => channels.map((c) => {
    const ds = deliveries.filter((d) => d.channel_id === c.id);
    return { ...c, sent: ds.filter((d) => d.status === 'sent').length, failed: ds.filter((d) => d.status === 'failed').length,
      last_sent_at: ds.map((d) => d.sent_at).filter(Boolean).sort().pop() ?? null };
  })],
  ['POST', /^\/api\/channels$/, (_m, _p, b) => { const c = { id: id(), active: true, ...b, secret_mask: `${String(b.secret).slice(0, 4)}…${String(b.secret).slice(-3)}`, created_at: new Date().toISOString() }; delete c.secret; channels.push(c); return c; }],
  ['PATCH', /^\/api\/channels\/([^/]+)$/, (m, _p, b) => { const c = channels.find((x) => x.id === m[1]); const { secret, ...rest } = b; Object.assign(c, rest); if (secret) c.secret_mask = `${secret.slice(0, 4)}…${secret.slice(-3)}`; return c; }],
  ['DELETE', /^\/api\/channels\/([^/]+)$/, (m) => { channels.splice(channels.findIndex((x) => x.id === m[1]), 1); return { ok: true }; }],
  ['POST', /^\/api\/channels\/([^/]+)\/test$/, (m) => { const c = channels.find((x) => x.id === m[1]); return { ok: true, info: c.type === 'telegram' ? `@demo_bot → ${c.name}` : c.name }; }],
  ['GET', /^\/api\/deliveries$/, () => deliveries.map((d) => {
    const p = posts.find((x) => x.id === d.post_id); const c = channels.find((x) => x.id === d.channel_id);
    return p && c ? { ...d, channel_name: c.name, type: c.type, post_title: p.title, post_status: p.status, publish_at: p.publish_at } : null;
  }).filter(Boolean).sort((a: any, b: any) => String(b.sent_at ?? b.publish_at).localeCompare(String(a.sent_at ?? a.publish_at)))],
  ['POST', /^\/api\/deliveries\/([^/]+)\/retry$/, (m) => { const d = deliveries.find((x) => x.id === m[1]); Object.assign(d, { status: 'pending', error: null }); deliverPublished(); return { ok: true }; }],
  ['POST', /^\/api\/posts$/, (_m, _p, b) => { const x = { id: id(), views: 0, excerpt: null, author_id: USER.id }; posts.unshift(x); return savePost(x, b); }],
  ['PATCH', /^\/api\/posts\/([^/]+)$/, (m, _p, b) => savePost(posts.find((y) => y.id === m[1]), b)],
  ['DELETE', /^\/api\/posts\/([^/]+)$/, (m) => { posts.splice(posts.findIndex((y) => y.id === m[1]), 1); return { ok: true }; }],
  ['GET', /^\/api\/blocks$/, () => blocks.map((b) => ({ ...b, site_name: siteName(b.site_id) }))],
  ['POST', /^\/api\/blocks$/, (_m, _p, b) => { if (blocks.some((x) => x.site_id === b.site_id && x.key === b.key)) throw new Error('key_taken'); const x = { id: id(), ...b }; blocks.push(x); return x; }],
  ['PATCH', /^\/api\/blocks\/([^/]+)$/, (m, _p, b) => Object.assign(blocks.find((x) => x.id === m[1]), b)],
  ['DELETE', /^\/api\/blocks\/([^/]+)$/, (m) => { blocks.splice(blocks.findIndex((x) => x.id === m[1]), 1); return { ok: true }; }],

  ['GET', /^\/api\/orders$/, (_m, p) => {
    const st = p.get('status'); const q = (p.get('q') ?? '').toLowerCase();
    const list = orders.map((o) => { const c = contacts.find((x) => x.id === o.contact_id); return { ...o, contact_name: c?.name ?? null, contact_email: c?.email ?? null, site_name: sites.find((s) => s.id === o.site_id)?.name ?? null }; })
      .filter((o) => (!st || o.status === st) && (!q || [o.external_id, o.contact_name, o.contact_email].some((v) => v?.toLowerCase().includes(q))));
    const off = +(p.get('offset') ?? 0), lim = +(p.get('limit') ?? 50);
    return { items: list.slice(off, off + lim), total: list.length };
  }],
  ['POST', /^\/api\/orders$/, (_m, _p, b) => { const o = { id: id(), currency: tenant.currency, items: [], source: 'manual', medium: 'offline', ...b, created_at: new Date().toISOString() }; orders.unshift(o); return { id: o.id, created: true }; }],
  ['PATCH', /^\/api\/orders\/([^/]+)$/, (m, _p, b) => Object.assign(orders.find((o) => o.id === m[1]), b)],
];

export async function mockApi(method: string, path: string, body: unknown) {
  await new Promise((r) => setTimeout(r, 120));
  const [p, query = ''] = path.split('?');
  for (const [mth, re, fn] of handlers) {
    const m = p.match(re);
    if (m && mth === method) return structuredClone(fn(m, new URLSearchParams(query), body));
  }
  throw new Error('not_found');
}
