import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { BarCell, Card, Empty, Loading } from '../components/ui';
import { HBars } from '../components/Charts';
import { qs } from '../lib/api';
import { dur, money, num, pct } from '../lib/format';
import { DEVICE_LABELS, EVENT_LABELS } from '../lib/labels';
import { useFetch, useStore } from '../lib/store';

type Tab = 'exit' | 'top' | 'entry';

export default function Behavior() {
  const { site, range } = useStore();
  const q = qs({ site, from: range.from, to: range.to });
  const { data: pages } = useFetch<any>(`/api/analytics/pages${q}`);
  const { data: tech } = useFetch<any>(`/api/analytics/tech${q}`);
  const { data: events } = useFetch<any[]>(`/api/analytics/events${q}`);
  const [tab, setTab] = useState<Tab>('exit');

  if (!pages || !tech) return <><PageHeader title="Поведение на сайте" /><Loading /></>;
  const list: any[] = pages[tab] ?? [];
  const max = (k: string) => Math.max(...list.map((r) => r[k]), 0);

  return (
    <div className="stack">
      <PageHeader title="Поведение на сайте" />
      <Card>
        <div className="tabs">
          <button className={tab === 'exit' ? 'on' : ''} onClick={() => setTab('exit')}>Страницы выхода</button>
          <button className={tab === 'top' ? 'on' : ''} onClick={() => setTab('top')}>Популярные страницы</button>
          <button className={tab === 'entry' ? 'on' : ''} onClick={() => setTab('entry')}>Страницы входа</button>
        </div>
        {!list.length ? <Empty /> : (
          <div className="table-wrap"><table>
            {tab === 'exit' && <>
              <thead><tr><th>Страница</th><th className="num">Выходы</th><th className="num">Просмотры</th><th className="num">Доля выходов</th></tr></thead>
              <tbody>{list.map((r) => <tr key={r.path}><td className="trunc">{r.path}</td><td className="num"><BarCell value={r.exits} max={max('exits')} label={num(r.exits)} /></td><td className="num">{num(r.views)}</td><td className="num">{pct(r.exit_rate)}</td></tr>)}</tbody>
            </>}
            {tab === 'top' && <>
              <thead><tr><th>Страница</th><th className="num">Просмотры</th><th className="num">Визиты</th><th className="num">Ср. время</th></tr></thead>
              <tbody>{list.map((r) => <tr key={r.path}><td className="trunc">{r.path}</td><td className="num"><BarCell value={r.views} max={max('views')} label={num(r.views)} /></td><td className="num">{num(r.sessions)}</td><td className="num">{dur(r.avg_time)}</td></tr>)}</tbody>
            </>}
            {tab === 'entry' && <>
              <thead><tr><th>Страница</th><th className="num">Входы</th><th className="num">Отказы</th></tr></thead>
              <tbody>{list.map((r) => <tr key={r.path}><td className="trunc">{r.path}</td><td className="num"><BarCell value={r.sessions} max={max('sessions')} label={num(r.sessions)} /></td><td className="num">{pct(r.bounce_rate)}</td></tr>)}</tbody>
            </>}
          </table></div>
        )}
      </Card>

      <div className="grid g-3">
        <Card title="Устройства"><HBars rows={tech.device.map((r: any) => ({ label: `${DEVICE_LABELS[r.name] ?? r.name} · отказы ${pct(r.bounce_rate, 0)}`, value: r.sessions }))} fmt={(v) => num(v)} /></Card>
        <Card title="Браузеры"><HBars rows={tech.browser.slice(0, 6).map((r: any) => ({ label: r.name, value: r.sessions }))} fmt={(v) => num(v)} /></Card>
        <Card title="Операционные системы"><HBars rows={tech.os.slice(0, 6).map((r: any) => ({ label: r.name, value: r.sessions }))} fmt={(v) => num(v)} /></Card>
      </div>

      <Card title="События и цели" sub="Заявки, добавления в корзину и ваши события из crm('event', …)">
        {events?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Событие</th><th className="num">Количество</th><th className="num">Визиты</th><th className="num">Сумма</th></tr></thead>
            <tbody>{events.map((e) => <tr key={e.name}><td>{EVENT_LABELS[e.name] ?? e.name}</td><td className="num">{num(e.count)}</td><td className="num">{num(e.sessions)}</td><td className="num">{e.value ? money(e.value) : '—'}</td></tr>)}</tbody>
          </table></div>
        ) : <Empty />}
      </Card>
    </div>
  );
}
