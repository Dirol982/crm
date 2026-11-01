import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Card, Kpi, Loading, BarCell, Empty } from '../components/ui';
import { Funnel, TimeChart } from '../components/Charts';
import { qs } from '../lib/api';
import { dur, money, num, pct } from '../lib/format';
import { sourceLabel } from '../lib/labels';
import { useFetch, useStore } from '../lib/store';

type Metric = 'revenue' | 'sessions' | 'orders' | 'bounce_rate';
const METRICS: [Metric, string][] = [['revenue', 'Выручка'], ['sessions', 'Визиты'], ['orders', 'Заказы'], ['bounce_rate', 'Отказы']];

export default function Dashboard() {
  const { site, range } = useStore();
  const q = qs({ site, from: range.from, to: range.to });
  const { data } = useFetch<any>(`/api/analytics/overview${q}`);
  const { data: sources } = useFetch<any[]>(`/api/analytics/sources${q}`);
  const { data: pages } = useFetch<any>(`/api/analytics/pages${q}`);
  const { data: live } = useFetch<any>(`/api/analytics/realtime${qs({ site })}`);
  const [metric, setMetric] = useState<Metric>('revenue');

  if (!data) return <><PageHeader title="Сводка" /><Loading /></>;
  const c = data.current, p = data.previous;
  const fmtFor = (m: Metric) => (m === 'revenue' ? (v: number) => money(v, { compact: true }) : m === 'bounce_rate' ? (v: number) => pct(v, 0) : (v: number) => num(v));
  const topSources = (sources ?? []).slice().sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  const maxRev = Math.max(...topSources.map((s) => s.revenue), 1);

  return (
    <div className="stack">
      <PageHeader title="Сводка">
        {live && (
          <span className="badge" title="Активны за последние 5 минут">
            <span className="dot" style={{ background: 'var(--good)' }} /> Сейчас на сайте: {live.visitors}
          </span>
        )}
      </PageHeader>

      <div className="grid g-4 kpis">
        <Kpi label="Выручка" value={money(c.revenue)} cur={c.revenue} prev={p.revenue} />
        <Kpi label="Заказы" value={num(c.orders)} cur={c.orders} prev={p.orders} />
        <Kpi label="Конверсия в заказ" value={pct(c.conversion, 2)} cur={c.conversion} prev={p.conversion} hint="Заказы / визиты" />
        <Kpi label="Средний чек" value={money(c.aov)} cur={c.aov} prev={p.aov} />
        <Kpi label="Визиты" value={num(c.sessions)} cur={c.sessions} prev={p.sessions} />
        <Kpi label="Посетители" value={num(c.visitors)} cur={c.visitors} prev={p.visitors} />
        <Kpi label="Отказы" value={pct(c.bounce_rate)} cur={c.bounce_rate} prev={p.bounce_rate} invert hint="Визит из одной страницы без действий" />
        <Kpi label="Время на сайте" value={dur(c.avg_duration)} cur={c.avg_duration} prev={p.avg_duration} />
      </div>

      <Card
        title={METRICS.find(([m]) => m === metric)![1] + ' по дням'}
        action={
          <div className="seg">
            {METRICS.map(([m, l]) => <button key={m} className={metric === m ? 'on' : ''} onClick={() => setMetric(m)}>{l}</button>)}
          </div>
        }
      >
        <TimeChart data={data.daily} dataKey={metric} name={METRICS.find(([m]) => m === metric)![1]} fmt={fmtFor(metric)} height={260} kind={metric === 'orders' ? 'bar' : 'area'} />
      </Card>

      <div className="grid g-2">
        <Card title="Воронка" sub="От визита до оплаченного заказа">
          <Funnel steps={[
            { label: 'Визиты', value: c.sessions, fmt: num(c.sessions) },
            { label: 'Вовлечённые', value: c.engaged, fmt: num(c.engaged) },
            { label: 'Заявки', value: c.leads, fmt: num(c.leads) },
            { label: 'Заказы', value: c.orders, fmt: num(c.orders) },
          ]} />
        </Card>
        <Card title="Откуда приходят деньги" action={<Link to="/traffic">Все источники →</Link>}>
          {topSources.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Источник</th><th className="num">Визиты</th><th className="num">Конв.</th><th className="num">Выручка</th></tr></thead>
              <tbody>{topSources.map((s) => (
                <tr key={s.source + s.medium}>
                  <td className="trunc">{sourceLabel(s.source, s.medium)}</td>
                  <td className="num">{num(s.sessions)}</td>
                  <td className="num">{s.sessions ? pct(s.conversion, 1) : '—'}</td>
                  <td className="num"><BarCell value={s.revenue} max={maxRev} label={money(s.revenue, { compact: true })} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty />}
        </Card>
      </div>

      <Card title="Где уходят с сайта" sub="Страницы, на которых чаще всего заканчивается визит" action={<Link to="/behavior">Подробнее →</Link>}>
        {pages?.exit?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Страница</th><th className="num">Выходы</th><th className="num">Просмотры</th><th className="num">Доля выходов</th></tr></thead>
            <tbody>{pages.exit.slice(0, 6).map((r: any) => (
              <tr key={r.path}><td className="trunc">{r.path}</td><td className="num">{num(r.exits)}</td><td className="num">{num(r.views)}</td>
                <td className="num"><BarCell value={r.exit_rate} max={1} label={pct(r.exit_rate)} /></td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty />}
      </Card>
    </div>
  );
}
