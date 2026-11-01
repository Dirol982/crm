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
  ['GET', /^\/api\/me$/, () => ({ user: USER, tenant, role: 'owner', workspaces: [{ id: tenant.id, name: tenant.name, role: 'owner' }] })],
  ['PATCH', /^\/api\/tenant$/, (_m, _p, b) => Object.assign(tenant, b)],
  ['GET', /^\/api\/sites$/, () => sites.map((s) => ({ ...s, snippet: `<script async src="https://crm.example.com/t.js" data-key="${s.public_key}"></script>`, api_url: 'https://crm.example.com/api/v1' }))],
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
