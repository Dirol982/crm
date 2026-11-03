import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PageHeader } from '../components/Layout';
import { Card, Empty, Kpi, Loading, Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { api, ApiError } from '../lib/api';
import { date, money, num } from '../lib/format';
import { useFetch, useStore } from '../lib/store';

export const PLATFORM: Record<string, { label: string; color: string }> = {
  yandex: { label: 'Яндекс Директ', color: '#fc3f1d' },
  vk: { label: 'VK Реклама', color: '#0077ff' },
  google: { label: 'Google Ads', color: '#34a853' },
  telegram: { label: 'Telegram Ads', color: '#2aabee' },
  demo: { label: 'Учебный кабинет', color: '#8a63d2' },
};

const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } } };
const roasText = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(2).replace('.', ',')} ₽`);

export default function Ads() {
  const { can } = useStore();
  const { data, reload } = useFetch<any>('/api/ads/overview');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [connect, setConnect] = useState(false);
  const [csvFor, setCsvFor] = useState<any | null>(null);
  const [startedRun, setStartedRun] = useState(false);
  const admin = can('admin');
  const manager = can('manager');

  // пока агент работает — обновляем страницу каждые 3 секунды
  const running = !!data?.running || startedRun;
  const runsBefore = useRef<number>(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [running, reload]);
  useEffect(() => {
    if (startedRun && data && !data.running && data.runs.length > runsBefore.current) setStartedRun(false);
  }, [data, startedRun]);

  if (!data) return <div className="stack"><PageHeader title="Реклама" filters={false} /><Loading /></div>;

  const demo = data.accounts.find((a: any) => a.platform === 'demo');
  const proposed = data.actions.filter((a: any) => a.status === 'proposed');
  const history = data.actions.filter((a: any) => a.status !== 'proposed');
  const lastRun = data.runs.find((r: any) => r.kind === 'optimize');

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key); setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); } catch (e) {
      const d = e instanceof ApiError ? e.data : null;
      setMsg({ ok: false, text: d?.detail ?? ERRORS[(e as Error).message] ?? 'Не получилось — попробуйте ещё раз' });
    } finally { setBusy(''); reload(); }
  };
  const run = () => act('run', async () => {
    runsBefore.current = data.runs.length;
    await api('/api/ads/run', { method: 'POST' });
    setStartedRun(true);
  });
  const createDemo = () => act('demo', () => api('/api/ads/demo', { method: 'POST' }));
  const simulate = () => act('sim', () => api('/api/ads/demo/simulate', { method: 'POST', body: { days: 3 } }), 'Прошло 3 дня: в учебном кабинете появилась новая статистика, контролёр проверил результат изменений.');

  const totals = data.campaigns.reduce((s: any, c: any) => ({ cost: s.cost + c.cost, revenue: s.revenue + c.revenue, orders: s.orders + c.orders, pc: s.pc + c.prev_cost, pr: s.pr + c.prev_revenue, po: s.po + c.prev_orders }), { cost: 0, revenue: 0, orders: 0, pc: 0, pr: 0, po: 0 });

  return (
    <div className="stack">
      <PageHeader title="Реклама" filters={false}>
        {manager && data.campaigns.length > 0 && (
          <button className="btn primary" disabled={running || !!busy || !data.ai_enabled} onClick={run} title={data.ai_enabled ? 'Агент проанализирует все кампании прямо сейчас' : 'ИИ не подключён на сервере'}>
            <Icon name="spark" size={15} /> {running ? 'Агент анализирует…' : 'Запустить анализ'}
          </button>
        )}
      </PageHeader>

      <HowItWorks policy={data.policy} forceOpen={!data.accounts.length} />

      {!data.ai_enabled && (
        <div className="callout warn">
          <b>ИИ ещё не подключён на сервере.</b> Статистика, ручные изменения и проверка результата работают, а для анализа агентом администратор сервера должен указать ключ Claude API
          (переменная <code>ANTHROPIC_API_KEY</code>).
        </div>
      )}
      {msg && <div className={`callout ${msg.ok ? 'good' : 'bad'}`}>{msg.text}</div>}

      {!data.accounts.length ? (
        <Card title="С чего начать">
          <div className="grid g-2">
            <div className="choice">
              <div className="choice-title"><Icon name="spark" /> Попробовать на учебных кампаниях</div>
              <p className="sub">Четыре кампании с готовой статистикой за 30 дней. Агент и контролёр работают с ними по-настоящему, но деньги не тратятся и никакие площадки не затрагиваются.
                Через 5 минут вы увидите весь цикл: анализ → решения → проверка результата.</p>
              {admin ? <button className="btn primary" disabled={!!busy} onClick={createDemo}>{busy === 'demo' ? 'Создаём…' : 'Создать учебный кабинет'}</button> : <span className="sub">Попросите администратора компании.</span>}
            </div>
            <div className="choice">
              <div className="choice-title"><Icon name="integrations" /> Подключить свой рекламный кабинет</div>
              <p className="sub">Яндекс Директ, VK Реклама и Google Ads — агент видит расходы и меняет бюджеты в рамках ваших правил. Telegram Ads — только статистика из выгрузки (у площадки нет API).</p>
              {admin && <button className="btn" onClick={() => setConnect(true)}><Icon name="plus" size={15} /> Подключить кабинет</button>}
            </div>
          </div>
        </Card>
      ) : (<>
        {demo && <DemoTour data={data} running={running} busy={busy} onRun={run} onSimulate={simulate} admin={admin} manager={manager} />}

        {running && (
          <div className="callout"><span className="spinner" /> <b>Агент изучает кампании.</b> Обычно это занимает 1–3 минуты: он сравнивает расходы с продажами из CRM, предлагает изменения, затем контролёр проверяет каждое предложение. Страница обновится сама.</div>
        )}

        <div className="grid g-4 kpis">
          <Kpi label="Расход на рекламу, 14 дней" value={money(totals.cost)} cur={totals.cost} prev={totals.pc} invert />
          <Kpi label="Выручка с рекламы" value={money(totals.revenue)} cur={totals.revenue} prev={totals.pr} hint="Оплаченные заказы из CRM с UTM-меткой кампании" />
          <Kpi label="Заказы с рекламы" value={num(totals.orders)} cur={totals.orders} prev={totals.po} />
          <Kpi label="Выручка на 1 ₽ рекламы" value={totals.cost ? roasText(totals.revenue / totals.cost) : '—'} cur={totals.cost ? totals.revenue / totals.cost : 0} prev={totals.pc ? totals.pr / totals.pc : 0} hint="Сколько рублей выручки приносит каждый рубль расхода. Больше 1 — реклама окупается" />
        </div>

        {proposed.length > 0 && (
          <Card title={`Ждут вашего решения · ${proposed.length}`} sub="Эти изменения агент не применил сам: либо их не пропустили ваши правила, либо контролёр не был уверен, либо включён режим «только советы»">
            <div className="stack" style={{ gap: 10 }}>
              {proposed.map((a: any) => <ActionCard key={a.id} a={a} manager={manager} busy={busy} act={act} />)}
            </div>
          </Card>
        )}

        <Campaigns data={data} admin={admin} manager={manager} reload={reload} />

        {lastRun && (
          <Card title="Последний отчёт агента" sub={`${date(lastRun.started_at, true)} · ${lastRun.trigger === 'manual' ? 'запущен вручную' : 'плановый ежедневный анализ'}`}>
            {lastRun.status === 'running' ? <p className="sub">Анализ идёт…</p>
              : lastRun.status === 'failed' ? <p className="error">Анализ не удался: {lastRun.error}</p>
              : <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{lastRun.summary}</p>}
          </Card>
        )}

        <Card title="История решений" sub="Всё, что агент предлагал, кто принял решение и чем это закончилось">
          {!history.length ? <Empty>Пока пусто. {data.ai_enabled ? 'Запустите анализ — решения появятся здесь.' : ''}</Empty> : (
            <div className="stack" style={{ gap: 10 }}>
              {history.slice(0, 40).map((a: any) => <ActionCard key={a.id} a={a} manager={manager} busy={busy} act={act} />)}
            </div>
          )}
        </Card>

        <div className="grid g-2">
          <PolicyCard policy={data.policy} admin={admin} onSaved={reload} />
          <Card title="Кабинеты" action={admin && <button className="btn sm" onClick={() => setConnect(true)}><Icon name="plus" size={14} /> Подключить</button>}>
            <div className="stack" style={{ gap: 8 }}>
              {data.accounts.map((a: any) => (
                <div key={a.id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <div>
                    <PlatformBadge p={a.platform} /> <b>{a.name}</b>
                    <div className="sub">{a.sync_error ? <span style={{ color: 'var(--bad)' }}>⚠ {a.sync_error}</span>
                      : a.platform === 'demo' ? 'Деньги не тратятся, площадки не затрагиваются'
                      : a.last_sync_at ? `Обновлено ${date(a.last_sync_at, true)}` : 'Ещё не обновлялся'}</div>
                  </div>
                  <div className="row">
                    {a.platform === 'telegram' && manager && <button className="btn sm" onClick={() => setCsvFor(a)}>Загрузить CSV</button>}
                    {!['telegram', 'demo'].includes(a.platform) && manager && <button className="btn sm" disabled={!!busy} onClick={() => act(`sync${a.id}`, () => api(`/api/ads/accounts/${a.id}/sync`, { method: 'POST' }), 'Данные обновлены')}>{busy === `sync${a.id}` ? '…' : 'Обновить'}</button>}
                    {admin && <button className="btn sm danger" onClick={() => confirm(a.platform === 'demo' ? 'Удалить учебный кабинет со всеми кампаниями и историей?' : 'Отключить кабинет? Кампании и история решений по нему будут удалены из CRM (в самом кабинете ничего не изменится).') && act('del', () => api(`/api/ads/accounts/${a.id}`, { method: 'DELETE' }))}>Удалить</button>}
                  </div>
                </div>
              ))}
              {!demo && admin && <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!!busy} onClick={createDemo}>Добавить учебный кабинет</button>}
            </div>
          </Card>
        </div>

        {data.runs.length > 1 && (
          <Card title="Запуски агента">
            <div className="table-wrap"><table>
              <thead><tr><th>Когда</th><th>Как</th><th>Итог</th><th className="num">Объём, токенов</th></tr></thead>
              <tbody>{data.runs.map((r: any) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{date(r.started_at, true)}</td>
                  <td>{r.trigger === 'manual' ? 'вручную' : 'по расписанию'}</td>
                  <td className="trunc" style={{ maxWidth: 520 }} title={r.summary ?? r.error ?? ''}>{r.status === 'running' ? 'идёт…' : r.status === 'failed' ? <span style={{ color: 'var(--bad)' }}>ошибка: {r.error}</span> : r.summary}</td>
                  <td className="num">{num(r.input_tokens + r.output_tokens)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Card>
        )}
      </>)}

      {connect && <ConnectForm onClose={() => setConnect(false)} onDone={(acc) => { setConnect(false); reload(); if (acc?.platform === 'telegram') setCsvFor(acc); }} />}
      {csvFor && <CsvImport account={csvFor} onClose={() => setCsvFor(null)} onDone={() => { setCsvFor(null); reload(); }} />}
    </div>
  );
}

const ERRORS: Record<string, string> = {
  ai_disabled: 'ИИ не подключён на сервере',
  already_running: 'Агент уже работает — дождитесь окончания',
  no_campaigns: 'Сначала подключите кабинет с кампаниями',
};

export function PlatformBadge({ p }: { p: string }) {
  return <span className="badge"><span className="dot" style={{ background: PLATFORM[p]?.color }} />{PLATFORM[p]?.label ?? p}</span>;
}

// ---------- «Как это работает» ----------

function HowItWorks({ policy, forceOpen }: { policy: any; forceOpen: boolean }) {
  const [open, setOpen] = useState(() => forceOpen || ls.get('ads_how') !== 'closed');
  const toggle = () => { setOpen(!open); ls.set('ads_how', open ? 'closed' : 'open'); };
  const steps: [string, string, ReactNode][] = [
    ['traffic', 'Данные', <>Расходы берём из рекламных кабинетов, а заказы и выручку — из CRM по UTM-метке. Поэтому агент видит не «клики», а <b>сколько денег принесла каждая кампания</b>.</>],
    ['spark', 'ИИ-агент', <>Раз в сутки (или по кнопке) агент на базе Claude изучает кампании и предлагает: где добавить бюджет, где урезать, что выключить. <b>Каждое решение — с объяснением простыми словами.</b></>],
    ['shield', 'Ваши правила', <>Код, а не ИИ, проверяет лимиты: шаг не больше {policy.max_change_pct}%, потолки бюджета, минимум данных, пауза {policy.cooldown_hours} ч между изменениями. <b>Выйти за рамки агент не может.</b></>],
    ['check', 'Контролёр', <>Второй, независимый ИИ перепроверяет каждое предложение: подтверждают ли его цифры. Сам применяется только то, что одобрили <b>и правила, и контролёр</b>; остальное ждёт вас.</>],
    ['undo', 'Проверка результата', <>Через {policy.cooldown_hours} ч система сравнивает «до» и «после». Если стало хуже больше чем на {policy.rollback_threshold_pct}% — <b>изменение откатывается само</b>, а вы получаете письмо.</>],
  ];
  return (
    <Card title="Как работает ИИ-агент" action={<button className="btn sm" onClick={toggle}>{open ? 'Свернуть' : 'Показать'}</button>}>
      {open && (<>
        <ol className="how">
          {steps.map(([icon, title, text], i) => (
            <li key={title}>
              <div className="how-num"><Icon name={icon} size={16} /></div>
              <div><b>{i + 1}. {title}</b><p className="sub">{text}</p></div>
            </li>
          ))}
        </ol>
        <p className="sub" style={{ margin: '8px 0 0' }}>
          Режим сейчас: <b>{policy.mode === 'autopilot' ? 'автопилот в рамках лимитов' : policy.mode === 'suggest' ? 'только советы — всё подтверждаете вы' : 'выключен'}</b>.
          Автопилот можно включить или выключить для каждой кампании отдельно. Любое применённое изменение можно откатить одной кнопкой.
        </p>
      </>)}
    </Card>
  );
}

// ---------- Учебный кабинет: пошаговый тур ----------

function DemoTour({ data, running, busy, onRun, onSimulate, admin, manager }: { data: any; running: boolean; busy: string; onRun: () => void; onSimulate: () => void; admin: boolean; manager: boolean }) {
  const demoIds = new Set(data.campaigns.filter((c: any) => c.platform === 'demo').map((c: any) => c.id));
  const demoActions = data.actions.filter((a: any) => demoIds.has(a.campaign_id));
  const ran = data.runs.some((r: any) => r.kind === 'optimize' && r.status === 'done');
  const decided = demoActions.some((a: any) => a.status === 'applied' || a.status === 'rolled_back' || (a.status === 'rejected' && a.decided_by === 'user'));
  const checked = demoActions.some((a: any) => a.check_result);
  const steps: [boolean, string, string][] = [
    [true, 'Учебный кабинет создан', 'Четыре кампании со статистикой за 30 дней: одна отлично окупается, одна — нормально, одна убыточна, одна тратит деньги впустую. Посмотрите таблицу ниже.'],
    [ran, 'Запустите анализ', 'Агент изучит цифры и предложит изменения. Контролёр перепроверит каждое.'],
    [decided, 'Посмотрите решения', 'Часть изменений применится сама (автопилот), часть будет ждать вас — нажмите «Применить» или «Отклонить».'],
    [checked, 'Перемотайте время', 'В реальности результат проверяется через 2 дня. Здесь можно «прожить» 3 дня за секунду и увидеть, как контролёр оценит изменения.'],
  ];
  const cur = steps.findIndex((s) => !s[0]);
  return (
    <Card className="tour" title="Учебный кабинет: попробуйте весь цикл за 5 минут" sub="Всё по-настоящему, кроме денег: изменения применяются только к учебным кампаниям">
      <ol className="tour-steps">
        {steps.map(([done, title, text], i) => (
          <li key={title} className={done ? 'done' : i === cur ? 'cur' : ''}>
            <div className="tour-dot">{done ? '✓' : i + 1}</div>
            <div><b>{title}</b><p className="sub">{text}</p>
              {i === 1 && i === cur && manager && <button className="btn primary sm" disabled={running || !!busy || !data.ai_enabled} onClick={onRun}>{running ? 'Агент анализирует…' : 'Запустить анализ'}</button>}
              {i === 3 && (i === cur || checked) && admin && ran && <button className="btn primary sm" disabled={running || !!busy} onClick={onSimulate}>{busy === 'sim' ? 'Перематываем…' : 'Перемотать на 3 дня вперёд'}</button>}
            </div>
          </li>
        ))}
      </ol>
      {cur === -1 && <p className="sub" style={{ margin: '10px 0 0' }}>🎉 Вы прошли весь цикл. Когда будете готовы — подключите свой кабинет: агент будет работать так же, но с реальными кампаниями и вашими лимитами.</p>}
    </Card>
  );
}

// ---------- Карточка решения ----------

function describe(a: any) {
  if (a.type === 'budget') return <>Бюджет: <s className="muted">{a.old_value?.daily_budget === null ? 'без лимита' : money(a.old_value?.daily_budget)}</s> → <b>{money(a.new_value?.daily_budget)}</b> в день</>;
  if (a.type === 'pause') return <b>Выключить кампанию</b>;
  if (a.type === 'resume') return <b>Включить кампанию</b>;
  return <b>Совет</b>;
}

const STATUS: Record<string, [string, string]> = {
  proposed: ['Ждёт решения', 'warn'],
  applied: ['Применено', 'info'],
  rejected: ['Отклонено', ''],
  failed: ['Ошибка применения', 'bad'],
  rolled_back: ['Откатено', 'bad'],
  done: ['Учтено', ''],
};

function ActionCard({ a, manager, busy, act }: { a: any; manager: boolean; busy: string; act: (k: string, fn: () => Promise<unknown>, ok?: string) => void }) {
  let [label, tone] = STATUS[a.status] ?? [a.status, ''];
  if (a.status === 'applied' && a.check_result?.verdict === 'ok') [label, tone] = ['Проверено: результат в порядке', 'good'];
  if (a.status === 'rolled_back') label = a.decided_by === 'monitor' || a.check_result?.verdict === 'rolled_back' ? 'Откатено контролёром' : 'Откатено вами';
  if (a.status === 'rejected') label = a.decided_by === 'user' ? 'Отклонено вами' : 'Отклонено правилами';
  const rec = a.type === 'recommendation';
  const verdict = a.controller_verdict;
  return (
    <div className={`action ${tone}`}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            {a.campaign ? <b>{a.campaign}</b> : <b>Общая рекомендация</b>}
            {a.platform && <PlatformBadge p={a.platform} />}
            <span className={`badge ${tone}`}>{label}</span>
          </div>
          <div style={{ marginTop: 4 }}>{describe(a)}</div>
        </div>
        <span className="sub" style={{ whiteSpace: 'nowrap' }}>{date(a.created_at, true)}</span>
      </div>
      <p className="why"><span className="muted">Почему: </span>{a.reason}{a.expected ? <><br /><span className="muted">Ожидаемый эффект: </span>{a.expected}</> : null}</p>
      {!rec && (
        <ol className="trail">
          <li className="ok">Агент предложил</li>
          <li className={a.policy_ok ? 'ok' : 'stop'} title={a.policy_note ?? ''}>{a.policy_ok ? 'В рамках ваших правил' : `Правила: ${a.policy_note}`}</li>
          <li className={verdict === 'approve' ? 'ok' : verdict === 'reject' ? 'stop' : verdict === 'uncertain' ? 'ask' : 'skip'} title={a.controller_note ?? ''}>
            {verdict === 'approve' ? 'Контролёр одобрил' : verdict === 'reject' ? 'Контролёр против' : verdict === 'uncertain' ? 'Контролёр не уверен' : 'Контролёр не проверял'}
          </li>
          <li className={a.status === 'proposed' ? 'ask' : a.applied_at ? 'ok' : a.status === 'rejected' ? 'stop' : a.status === 'failed' ? 'stop' : 'skip'}>
            {a.status === 'proposed' ? 'Ждёт вас' : a.applied_at ? (a.decided_by === 'autopilot' ? 'Применено автопилотом' : 'Применено вами') : a.status === 'rejected' ? (a.decided_by === 'user' ? 'Отклонено вами' : 'Не применено') : a.status === 'failed' ? 'Площадка не приняла' : '—'}
          </li>
          {a.applied_at && (
            <li className={a.check_result?.verdict === 'ok' ? 'ok' : a.check_result ? 'stop' : 'wait'}>
              {a.check_result?.verdict === 'ok' ? 'Результат проверен' : a.check_result ? 'Стало хуже — откат' : a.status === 'rolled_back' ? 'Откатено' : `Проверка ${date(a.check_after, true)}`}
            </li>
          )}
        </ol>
      )}
      {a.controller_note && <p className="sub" style={{ margin: '6px 0 0' }}><b>Контролёр:</b> {a.controller_note}</p>}
      {a.check_result?.explanation && <p className="sub" style={{ margin: '4px 0 0' }}><b>Проверка результата:</b> {a.check_result.explanation}</p>}
      {a.error && <p className="error" style={{ margin: '4px 0 0' }}>{a.error}</p>}
      {manager && (a.status === 'proposed' || a.status === 'applied') && (
        <div className="row" style={{ marginTop: 8 }}>
          {a.status === 'proposed' && !rec && <button className="btn primary sm" disabled={!!busy} onClick={() => act(a.id, () => api(`/api/ads/actions/${a.id}/approve`, { method: 'POST' }), 'Изменение применено. Через 2 дня контролёр проверит результат.')}>Применить</button>}
          {a.status === 'proposed' && <button className="btn sm" disabled={!!busy} onClick={() => act(a.id, () => api(`/api/ads/actions/${a.id}/reject`, { method: 'POST' }))}>{rec ? 'Понятно, скрыть' : 'Отклонить'}</button>}
          {a.status === 'applied' && <button className="btn sm" disabled={!!busy} onClick={() => confirm('Вернуть значение, которое было до изменения?') && act(a.id, () => api(`/api/ads/actions/${a.id}/rollback`, { method: 'POST' }), 'Изменение откатено')}>Откатить</button>}
        </div>
      )}
    </div>
  );
}

// ---------- Кампании ----------

function Campaigns({ data, admin, manager, reload }: { data: any; admin: boolean; manager: boolean; reload: () => void }) {
  const target = data.policy.target_roas ?? 1;
  const toggle = async (c: any) => { await api(`/api/ads/campaigns/${c.id}`, { method: 'PATCH', body: { autopilot: !c.autopilot } }); reload(); };
  const utm = async (c: any) => {
    const v = prompt(`Какая метка utm_campaign стоит в ссылках кампании «${c.name}»?\nПо ней CRM находит заказы, которые принесла кампания.`, c.utm_campaign ?? c.name);
    if (v === null) return;
    await api(`/api/ads/campaigns/${c.id}`, { method: 'PATCH', body: { utm_campaign: v } });
    reload();
  };
  return (
    <Card title="Кампании" sub="За последние 14 дней. Заказы и выручка — из CRM по метке utm_campaign; для учебного кабинета — смоделированы">
      {!data.campaigns.length ? <Empty>В подключённых кабинетах пока нет кампаний</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr>
            <th>Кампания</th><th className="num">Расход</th><th className="num">Заказы</th><th className="num">Выручка</th>
            <th className="num" title="Сколько рублей выручки принёс каждый рубль расхода">На 1 ₽ рекламы</th>
            <th className="num">Цена заказа</th><th className="num">Бюджет в день</th><th>Статус</th><th title="Разрешено ли агенту менять кампанию без вас">Автопилот</th>
          </tr></thead>
          <tbody>{data.campaigns.map((c: any) => (
            <tr key={c.id}>
              <td>
                <b style={{ opacity: c.status === 'on' ? 1 : 0.55 }}>{c.name}</b>
                <div className="sub row" style={{ gap: 6 }}>
                  <PlatformBadge p={c.platform} />
                  {c.platform !== 'demo' && (manager ? <button className="linklike" onClick={() => utm(c)} title="Изменить метку">utm: {c.utm_campaign ?? c.name}</button> : <span>utm: {c.utm_campaign ?? c.name}</span>)}
                </div>
              </td>
              <td className="num">{money(c.cost)}</td>
              <td className="num">{num(c.orders)}</td>
              <td className="num">{money(c.revenue)}</td>
              <td className="num"><b style={{ color: c.roas === null ? undefined : c.roas >= target ? 'var(--good)' : c.roas < 1 ? 'var(--bad)' : undefined }}>{roasText(c.roas)}</b>
                {c.roas !== null && <div className="sub">{c.roas >= target ? 'окупается' : c.roas < 1 ? 'в убыток' : 'ниже цели'}</div>}</td>
              <td className="num">{c.cpa ? money(c.cpa) : '—'}</td>
              <td className="num">{c.daily_budget === null ? <span className="muted">без лимита</span> : money(c.daily_budget)}</td>
              <td>{c.status === 'on' ? <span className="badge good">работает</span> : <span className="badge">выключена</span>}</td>
              <td>{c.can_act ? (
                <label className="switch" title={c.autopilot ? 'Агент может менять кампанию сам (в рамках правил)' : 'Агент только предлагает — решаете вы'}>
                  <input type="checkbox" checked={c.autopilot} disabled={!admin} onChange={() => toggle(c)} /> {c.autopilot ? 'вкл' : 'выкл'}
                </label>
              ) : <span className="sub" title="У Telegram Ads нет API — агент только советует">только советы</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

// ---------- Правила ----------

function PolicyCard({ policy, admin, onSaved }: { policy: any; admin: boolean; onSaved: () => void }) {
  const [f, setF] = useState(policy);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => setF(policy), [policy]);
  const set = (k: string, v: any) => { setF({ ...f, [k]: v }); setSaved(false); };
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    const { tenant_id: _t, updated_at: _u, ...body } = f;
    try { await api('/api/ads/policy', { method: 'PUT', body }); setSaved(true); onSaved(); } catch { setErr('Проверьте значения'); }
  };
  return (
    <Card title="Правила для агента" sub="Жёсткие рамки: их проверяет код, ИИ не может их обойти">
      <form className="form" onSubmit={save}>
        <div className="seg" role="group" aria-label="Режим">
          {([['off', 'Выключен'], ['suggest', 'Только советы'], ['autopilot', 'Автопилот']] as const).map(([k, l]) => (
            <button type="button" key={k} disabled={!admin} className={f.mode === k ? 'on' : ''} onClick={() => set('mode', k)}>{l}</button>
          ))}
        </div>
        <p className="sub" style={{ margin: 0 }}>{f.mode === 'autopilot' ? 'Изменения, прошедшие правила и контролёра, применяются сразу. Остальные ждут вас.' : f.mode === 'suggest' ? 'Агент анализирует и предлагает, но ничего не меняет без вашего «Применить».' : 'Агент не запускается. Статистика продолжает обновляться.'}</p>
        <fieldset disabled={!admin} className="form cols" style={{ border: 0, padding: 0, margin: 0 }}>
          <label className="field">Шаг изменения бюджета за раз, %<input type="number" min={1} max={100} value={f.max_change_pct} onChange={(e) => set('max_change_pct', Number(e.target.value))} /></label>
          <label className="field">Не трогать кампанию после изменения, ч<input type="number" min={12} max={720} value={f.cooldown_hours} onChange={(e) => set('cooldown_hours', Number(e.target.value))} /></label>
          <label className="field">Потолок бюджета одной кампании в день<input inputMode="decimal" placeholder="без потолка" value={f.max_campaign_budget ?? ''} onChange={(e) => set('max_campaign_budget', numOrNull(e.target.value))} /></label>
          <label className="field">Потолок всех кампаний в день<input inputMode="decimal" placeholder="без потолка" value={f.max_total_budget ?? ''} onChange={(e) => set('max_total_budget', numOrNull(e.target.value))} /></label>
          <label className="field">Цель: выручка на 1 ₽ рекламы<input inputMode="decimal" placeholder="например, 3" value={f.target_roas ?? ''} onChange={(e) => set('target_roas', numOrNull(e.target.value))} /></label>
          <label className="field">Цель: цена заказа не выше<input inputMode="decimal" placeholder="не задана" value={f.max_cpa ?? ''} onChange={(e) => set('max_cpa', numOrNull(e.target.value))} /></label>
          <label className="field">Не делать выводов, если кликов за 14 дней меньше<input type="number" min={0} value={f.min_clicks} onChange={(e) => set('min_clicks', Number(e.target.value))} /></label>
          <label className="field">Откатить, если стало хуже на, %<input type="number" min={5} max={100} value={f.rollback_threshold_pct} onChange={(e) => set('rollback_threshold_pct', Number(e.target.value))} /></label>
        </fieldset>
        <label className="check"><input type="checkbox" disabled={!admin} checked={f.allow_pause} onChange={(e) => set('allow_pause', e.target.checked)} /> Разрешить агенту выключать кампании, которые не приносят продаж</label>
        <label className="check"><input type="checkbox" disabled={!admin} checked={f.controller_enabled} onChange={(e) => set('controller_enabled', e.target.checked)} /> Контролёр перепроверяет каждое решение (рекомендуем не выключать)</label>
        {err && <div className="error">{err}</div>}
        {admin && <div className="row"><button className="btn primary">Сохранить правила</button>{saved && <span className="sub" style={{ color: 'var(--good)' }}>✓ Сохранено</span>}</div>}
      </form>
    </Card>
  );
}

// ---------- Подключение кабинетов ----------

function ConnectForm({ onClose, onDone }: { onClose: () => void; onDone: (acc?: any) => void }) {
  const [p, setP] = useState<'yandex' | 'vk' | 'google' | 'telegram'>('yandex');
  const [f, setF] = useState<Record<string, string>>({ name: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api('/api/ads/accounts', { method: 'POST', body: { platform: p, ...f } });
      if (r.sync_error) alert(`Кабинет сохранён, но загрузить кампании не удалось:\n${r.sync_error}\n\nПроверьте токен и нажмите «Обновить».`);
      onDone(r);
    } catch { setErr('Проверьте поля: токен целиком, ID клиента Google в формате 123-456-7890'); } finally { setBusy(false); }
  };
  const help: Record<string, ReactNode> = {
    yandex: <>1. Получите OAuth-токен с доступом к API Директа (приложение на oauth.yandex.ru с правом «Использование API Яндекс Директа» и одобренная заявка на доступ к API в кабинете Директа).<br />2. Для агентского аккаунта укажите логин клиента.</>,
    vk: <>1. В VK Рекламе: Настройки → Доступ к API — создайте ключ с правом управления кампаниями.<br />2. Скопируйте токен доступа.</>,
    google: <>Нужны данные разработчика Google Ads у администратора сервера и refresh-токен вашего аккаунта. <b>Важно:</b> с 2022 года Google Ads не показывает рекламу в России — подойдёт, если вы рекламируетесь за рубежом.</>,
    telegram: <>У Telegram Ads нет открытого API, поэтому агент не может менять бюджеты. Загружайте выгрузку статистики (CSV) из кабинета — агент учтёт расходы в анализе и даст рекомендации.</>,
  };
  return (
    <Modal title="Подключить рекламный кабинет" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="seg" role="group" style={{ flexWrap: 'wrap' }}>
          {(['yandex', 'vk', 'google', 'telegram'] as const).map((k) => <button type="button" key={k} className={p === k ? 'on' : ''} onClick={() => setP(k)}>{PLATFORM[k].label}</button>)}
        </div>
        <div className="sub" style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.6 }}>{help[p]}</div>
        <label className="field">Название (для себя)<input required value={f.name} onChange={set('name')} placeholder={`${PLATFORM[p].label} — основной`} /></label>
        {(p === 'yandex' || p === 'vk') && <label className="field">Токен доступа<input required autoComplete="off" value={f.token ?? ''} onChange={set('token')} /></label>}
        {p === 'yandex' && <label className="field">Логин клиента (только для агентств)<input value={f.login ?? ''} onChange={set('login')} /></label>}
        {p === 'google' && <>
          <label className="field">ID клиента (customer ID)<input required placeholder="123-456-7890" value={f.login ?? ''} onChange={set('login')} /></label>
          <label className="field">Refresh-токен<input required autoComplete="off" value={f.refresh_token ?? ''} onChange={set('refresh_token')} /></label>
          <label className="field">ID управляющего аккаунта (если есть)<input placeholder="123-456-7890" value={f.login_customer_id ?? ''} onChange={set('login_customer_id')} /></label>
        </>}
        <p className="sub" style={{ margin: 0 }}>Токены хранятся в зашифрованном виде и показываются только в сокращённом.</p>
        {err && <div className="error">{err}</div>}
        <div className="row"><button className="btn primary" disabled={busy}>{busy ? 'Подключаем…' : 'Подключить'}</button><button type="button" className="btn" onClick={onClose}>Отмена</button></div>
      </form>
    </Modal>
  );
}

function CsvImport({ account, onClose, onDone }: { account: any; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [err, setErr] = useState('');
  const file = async (e: React.ChangeEvent<HTMLInputElement>) => { const fl = e.target.files?.[0]; if (fl) setCsv(await fl.text()); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try { const r = await api('/api/ads/telegram/import', { method: 'POST', body: { account_id: account.id, csv } }); alert(`Загружено строк: ${r.rows}`); onDone(); }
    catch { setErr('Не нашли нужные столбцы: дата, кампания, расход (показы и клики — по желанию)'); }
  };
  return (
    <Modal title={`Статистика Telegram Ads — ${account.name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="sub" style={{ margin: 0 }}>Выгрузите статистику по дням из кабинета Telegram Ads и загрузите файл. Нужны столбцы: дата, кампания (или объявление), расход; показы и клики — по желанию.
          В ссылках объявлений используйте utm_campaign = название кампании — тогда CRM посчитает продажи.</p>
        <input type="file" accept=".csv,text/csv" onChange={file} />
        <textarea rows={6} placeholder={'Date;Campaign;Views;Clicks;Spent\n01.11.2026;Канал про ремонт;12000;140;3500'} value={csv} onChange={(e) => setCsv(e.target.value)} />
        {err && <div className="error">{err}</div>}
        <div className="row"><button className="btn primary" disabled={csv.length < 10}>Загрузить</button><button type="button" className="btn" onClick={onClose}>Отмена</button></div>
      </form>
    </Modal>
  );
}
