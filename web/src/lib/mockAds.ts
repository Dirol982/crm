/**
 * Раздел «Реклама» в демо-версии (GitHub Pages): учебный кабинет и сценарий работы агента
 * повторяют серверную логику упрощённо — чтобы весь цикл можно было пройти без сервера.
 */
type H = [string, RegExp, (m: RegExpMatchArray, p: URLSearchParams, body: any) => any];

let idc = 900000;
const id = () => `00000000-0000-4000-9000-${String(++idc).padStart(12, '0')}`;
const DAY = 864e5;
let shift = 0; // «перемотанные» дни
const now = () => Date.now() + shift * DAY;
const iso = (t: number) => new Date(t).toISOString();

function rand(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
interface Model { demand: number; cpc: number; roas: number; avg: number; elasticity: number; ref: number }
function dayStats(cid: string, day: number, m: Model, budget: number, on: boolean) {
  if (!on) return { clicks: 0, cost: 0, orders: 0, revenue: 0 };
  const spend = Math.min(budget, m.demand) * (0.9 + 0.1 * rand(`${cid}:${day}:s`));
  const roas = m.roas * (spend > m.ref ? Math.max(0.3, 1 - m.elasticity * (spend / m.ref - 1)) : 1);
  const orders = Math.floor((spend * roas * (0.7 + 0.6 * rand(`${cid}:${day}:r`))) / m.avg + rand(`${cid}:${day}:o`));
  return { clicks: Math.round(spend / m.cpc), cost: Math.round(spend), orders, revenue: orders * m.avg };
}

const accounts: any[] = [];
const campaigns: any[] = [];
const stats = new Map<string, Map<number, ReturnType<typeof dayStats>>>(); // ключ дня — номер дня от эпохи
const runs: any[] = [];
const actions: any[] = [];
let policy: any = { mode: 'autopilot', max_change_pct: 20, max_campaign_budget: null, max_total_budget: null, min_clicks: 100, allow_pause: true, target_roas: null, max_cpa: null, cooldown_hours: 48, rollback_threshold_pct: 30, controller_enabled: true };

const dayNo = (t: number) => Math.floor(t / DAY);
function fill(c: any, from: number, to: number) {
  const m = stats.get(c.id)!;
  for (let d = from; d <= to; d++) if (!m.has(d)) m.set(d, dayStats(c.id, d, c.model, c.daily_budget, c.status === 'on'));
}

function createDemo() {
  if (accounts.some((a) => a.platform === 'demo')) return;
  const acc = { id: id(), platform: 'demo', name: 'Учебный кабинет', login: null, active: true, last_sync_at: iso(now()), sync_error: null, created_at: iso(now()) };
  accounts.push(acc);
  ([
    ['Поиск — брендовые запросы', 1500, { demand: 2600, cpc: 18, roas: 5.2, avg: 4200, elasticity: 0.3, ref: 1500 }],
    ['Поиск — общие запросы', 3000, { demand: 3300, cpc: 32, roas: 1.9, avg: 5100, elasticity: 0.5, ref: 3000 }],
    ['РСЯ — ретаргетинг', 2000, { demand: 2200, cpc: 9, roas: 0.65, avg: 3800, elasticity: 0.4, ref: 2000 }],
    ['Медийная — охват', 2500, { demand: 2600, cpc: 6, roas: 0, avg: 4000, elasticity: 0, ref: 2500 }],
  ] as [string, number, Model][]).forEach(([name, budget, model]) => {
    const c = { id: id(), account_id: acc.id, platform: 'demo', account: acc.name, name, status: 'on', daily_budget: budget, currency: 'RUB', autopilot: true, can_act: true, utm_campaign: name, model };
    campaigns.push(c);
    stats.set(c.id, new Map());
    fill(c, dayNo(now()) - 29, dayNo(now()));
  });
}
createDemo();

function perf(c: any, days = 14, end = dayNo(now())) {
  const sum = (from: number, to: number) => {
    const s = { cost: 0, clicks: 0, orders: 0, revenue: 0 };
    for (let d = from; d <= to; d++) { const x = stats.get(c.id)!.get(d); if (x) { s.cost += x.cost; s.clicks += x.clicks; s.orders += x.orders; s.revenue += x.revenue; } }
    return s;
  };
  const cur = sum(end - days + 1, end), prev = sum(end - 2 * days + 1, end - days);
  return { cur, prev };
}

function overview() {
  const list = campaigns.map((c) => {
    const { cur, prev } = perf(c);
    const { model: _m, ...rest } = c;
    return { ...rest, ...cur, impressions: cur.clicks * 30, platform_conversions: cur.orders, leads: 0, roas: cur.cost ? Math.round((cur.revenue / cur.cost) * 100) / 100 : null, cpa: cur.orders ? Math.round(cur.cost / cur.orders) : null, prev_cost: prev.cost, prev_revenue: prev.revenue, prev_orders: prev.orders };
  });
  const running = runs.some((r) => r.status === 'running');
  return {
    ai_enabled: true, model: 'claude', accounts, campaigns: list, policy, running,
    runs: [...runs].reverse(),
    actions: [...actions].reverse().map((a) => { const c = campaigns.find((x) => x.id === a.campaign_id); return { ...a, campaign: c?.name ?? null, platform: c?.platform ?? null }; }),
  };
}

function apply(a: any, by: string) {
  const c = campaigns.find((x) => x.id === a.campaign_id);
  if (a.type === 'budget') c.daily_budget = a.new_value.daily_budget; else c.status = a.new_value.status;
  Object.assign(a, { status: 'applied', decided_by: by, applied_at: iso(now()), check_after: iso(now() + policy.cooldown_hours * 3600e3) });
}

/** Сценарий агента — как ответил бы Claude на эти данные */
function agentRun() {
  const run = { id: id(), kind: 'optimize', trigger: 'manual', status: 'running', summary: null as string | null, error: null, input_tokens: 0, output_tokens: 0, started_at: iso(now()), finished_at: null as string | null };
  runs.push(run);
  setTimeout(() => {
    const by = (s: string) => campaigns.find((c) => c.name.includes(s));
    const first = runs.filter((r) => r.kind === 'optimize').length === 1;
    const add = (c: any, type: string, nv: any, reason: string, expected: string, verdict: string, note: string) => {
      const ov = type === 'budget' ? { daily_budget: c.daily_budget } : { status: c.status };
      const a = { id: id(), run_id: run.id, campaign_id: c.id, type, old_value: ov, new_value: nv, reason, expected, status: 'proposed', policy_ok: true, policy_note: null, controller_verdict: policy.controller_enabled ? verdict : null, controller_note: policy.controller_enabled ? note : null, decided_by: null, applied_at: null, check_after: null, check_result: null, error: null, created_at: iso(now()) };
      actions.push(a);
      if (policy.mode === 'autopilot' && c.autopilot && (!policy.controller_enabled || verdict === 'approve')) apply(a, 'autopilot');
    };
    if (first) {
      const brand = by('брендовые'), media = by('Медийная'), rt = by('ретаргетинг');
      const { cur: b } = perf(brand), { cur: m } = perf(media), { cur: r } = perf(rt);
      add(brand, 'budget', { daily_budget: Math.round(brand.daily_budget * 1.2) }, `Брендовый поиск приносит ${(b.revenue / b.cost).toFixed(1).replace('.', ',')} ₽ на каждый рубль и почти каждый день расходует весь бюджет — часть покупателей мы просто не показываем рекламу.`, 'Примерно +15–20% заказов с этой кампании при сохранении хорошей окупаемости', 'approve', 'Согласен: окупаемость в 5 раз выше средней, бюджет упирается в потолок. Шаг +20% в рамках правил.');
      if (policy.allow_pause) add(media, 'pause', { status: 'off' }, `За 14 дней кампания потратила ${Math.round(m.cost).toLocaleString('ru-RU')} ₽ и не принесла ни одного заказа.`, `Экономия около ${media.daily_budget.toLocaleString('ru-RU')} ₽ в день без потери продаж`, 'approve', 'Подтверждаю: ноль заказов при заметном расходе. Остальные кампании продолжают работать.');
      add(rt, 'budget', { daily_budget: Math.round(rt.daily_budget * 0.8) }, `Ретаргетинг возвращает ${(r.revenue / Math.max(1, r.cost)).toFixed(2).replace('.', ',')} ₽ на рубль — кампания работает в убыток.`, 'Меньше убытка; заказы почти не уменьшатся', 'uncertain', 'Ретаргетинг часто помогает «дожать» покупателей, которых засчитали другим кампаниям. Снижение разумно, но пусть решит владелец.');
      actions.push({ id: id(), run_id: run.id, campaign_id: null, type: 'recommendation', reason: 'Проверьте, что во всех объявлениях стоит utm_campaign — без метки CRM не видит, какая реклама принесла заказ, и агент недооценит кампанию.', status: 'proposed', policy_ok: true, created_at: iso(now()) });
      run.summary = 'Брендовый поиск окупается лучше всего и упирается в бюджет — расширяю на 20%. Медийная кампания тратит деньги без заказов — выключаю. Ретаргетинг убыточен; предлагаю урезать на 20%, но контролёр не уверен, поэтому решение за вами. Общий поиск окупается нормально — оставляю как есть.';
    } else {
      actions.push({ id: id(), run_id: run.id, campaign_id: null, type: 'recommendation', reason: 'Изменения последних дней ещё не проверены — новых шагов не делаю, чтобы не смешивать эффекты. Вернусь к кампаниям после проверки результата.', status: 'proposed', policy_ok: true, created_at: iso(now()) });
      run.summary = 'Недавние изменения ещё «набирают» статистику. Новых изменений не предлагаю — дождусь проверки результата, чтобы не смешивать эффекты.';
    }
    Object.assign(run, { status: 'done', finished_at: iso(now()), input_tokens: 21500, output_tokens: 3400 });
  }, 3500);
}

function monitor() {
  for (const a of actions) {
    if (a.status !== 'applied' || a.check_result || new Date(a.check_after).getTime() > now()) continue;
    const c = campaigns.find((x) => x.id === a.campaign_id);
    const appliedDay = dayNo(new Date(a.applied_at).getTime());
    const win = Math.max(1, dayNo(now()) - appliedDay);
    const after = perf(c, win).cur, before = perf(c, win, appliedDay - 1).cur;
    const rb = before.cost ? before.revenue / before.cost : 0, ra = after.cost ? after.revenue / after.cost : 0;
    const f = (v: number) => v.toFixed(2).replace('.', ',');
    let explanation: string, verdict = 'ok';
    if (a.type === 'pause') {
      const total = (end: number) => campaigns.reduce((s, x) => s + perf(x, win, end).cur.revenue, 0);
      explanation = `Общая выручка с рекламы после выключения: ${total(dayNo(now())).toLocaleString('ru-RU')} ₽ (до: ${total(appliedDay - 1).toLocaleString('ru-RU')} ₽). Деньги сэкономлены без потери продаж.`;
    } else if (before.orders + after.orders < 6 && win < 7) {
      a.check_after = iso(now() + DAY); // мало заказов — ждём ещё сутки, а не судим по шуму
      continue;
    } else if (before.orders + after.orders < 6) {
      explanation = `За неделю набралось слишком мало заказов (${before.orders} до и ${after.orders} после), чтобы честно сравнить. Изменение оставлено.`;
    } else if (rb && ra < rb * (1 - policy.rollback_threshold_pct / 100)) {
      verdict = 'rolled_back';
      explanation = `Каждый рубль рекламы стал возвращать ${f(ra)} ₽ вместо ${f(rb)} ₽ — хуже больше чем на ${policy.rollback_threshold_pct}%. Бюджет возвращён к прежнему.`;
      c.daily_budget = a.old_value.daily_budget; a.status = 'rolled_back'; a.decided_by = 'monitor';
    } else explanation = `Каждый рубль рекламы возвращает ${f(ra)} ₽ (было ${f(rb)} ₽). Изменение оставлено.`;
    a.check_result = { verdict, explanation, before: { roas: rb }, after: { roas: ra }, checked_at: iso(now()) };
  }
}

export const adsHandlers: H[] = [
  ['GET', /^\/api\/ads\/overview$/, () => overview()],
  ['POST', /^\/api\/ads\/demo$/, () => { createDemo(); return { account_id: accounts[0]?.id }; }],
  ['POST', /^\/api\/ads\/demo\/simulate$/, (_m, _p, b) => {
    const days = Number(b?.days ?? 3);
    shift += days;
    for (const c of campaigns) fill(c, dayNo(now()) - days + 1, dayNo(now()));
    monitor();
    return { ok: true };
  }],
  ['POST', /^\/api\/ads\/run$/, () => { if (runs.some((r) => r.status === 'running')) throw new Error('already_running'); agentRun(); return { started: true }; }],
  ['PUT', /^\/api\/ads\/policy$/, (_m, _p, b) => (policy = { ...policy, ...b })],
  ['PATCH', /^\/api\/ads\/campaigns\/([^/]+)$/, (m, _p, b) => { Object.assign(campaigns.find((c) => c.id === m[1]), b); return { ok: true }; }],
  ['POST', /^\/api\/ads\/actions\/([^/]+)\/approve$/, (m) => { apply(actions.find((a) => a.id === m[1]), 'user'); return { ok: true }; }],
  ['POST', /^\/api\/ads\/actions\/([^/]+)\/reject$/, (m) => { const a = actions.find((x) => x.id === m[1]); Object.assign(a, { status: a.type === 'recommendation' ? 'done' : 'rejected', decided_by: 'user' }); return { ok: true }; }],
  ['POST', /^\/api\/ads\/actions\/([^/]+)\/rollback$/, (m) => {
    const a = actions.find((x) => x.id === m[1]); const c = campaigns.find((x) => x.id === a.campaign_id);
    if (a.type === 'budget') c.daily_budget = a.old_value.daily_budget; else c.status = a.old_value.status;
    Object.assign(a, { status: 'rolled_back', decided_by: 'user', rolled_back_at: iso(now()) });
    return { ok: true };
  }],
  ['POST', /^\/api\/ads\/accounts$/, (_m, _p, b) => {
    const acc = { id: id(), platform: b.platform, name: b.name, login: b.login ?? null, active: true, last_sync_at: null, created_at: iso(now()),
      sync_error: b.platform === 'telegram' ? null : 'Демо-версия не подключается к настоящим кабинетам — попробуйте учебный кабинет' };
    accounts.push(acc);
    return { ...acc };
  }],
  ['POST', /^\/api\/ads\/accounts\/([^/]+)\/sync$/, () => { throw new Error('platform'); }],
  ['DELETE', /^\/api\/ads\/accounts\/([^/]+)$/, (m) => {
    accounts.splice(accounts.findIndex((a) => a.id === m[1]), 1);
    for (let i = campaigns.length - 1; i >= 0; i--) if (campaigns[i].account_id === m[1]) {
      const cid = campaigns[i].id; campaigns.splice(i, 1);
      for (let j = actions.length - 1; j >= 0; j--) if (actions[j].campaign_id === cid) actions.splice(j, 1);
    }
    return { ok: true };
  }],
  ['POST', /^\/api\/ads\/telegram\/import$/, () => ({ rows: 0 })],
];
