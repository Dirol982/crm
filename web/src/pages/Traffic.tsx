import { useMemo, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { BarCell, Card, Empty, Loading } from '../components/ui';
import { HBars } from '../components/Charts';
import { qs } from '../lib/api';
import { dur, money, num, pct } from '../lib/format';
import { MEDIUM_LABELS, sourceLabel } from '../lib/labels';
import { useFetch, useStore } from '../lib/store';

type SortKey = 'sessions' | 'bounce_rate' | 'conversion' | 'orders' | 'revenue';

export default function Traffic() {
  const { site, range } = useStore();
  const { data } = useFetch<any[]>(`/api/analytics/sources${qs({ site, from: range.from, to: range.to })}`);
  const [sort, setSort] = useState<SortKey>('sessions');

  const channels = useMemo(() => {
    const m = new Map<string, { label: string; sessions: number; revenue: number }>();
    for (const r of data ?? []) {
      const label = MEDIUM_LABELS[r.medium] ?? r.medium;
      const x = m.get(label) ?? { label, sessions: 0, revenue: 0 };
      x.sessions += r.sessions; x.revenue += r.revenue; m.set(label, x);
    }
    return [...m.values()];
  }, [data]);

  if (!data) return <><PageHeader title="Источники трафика" /><Loading /></>;
  const rows = data.slice().sort((a, b) => b[sort] - a[sort]);
  const max = (k: SortKey) => Math.max(...data.map((r) => r[k]), 0);
  const th = (k: SortKey, label: string) => (
    <th className="num clickable" onClick={() => setSort(k)} aria-sort={sort === k ? 'descending' : undefined}>{label}{sort === k ? ' ↓' : ''}</th>
  );

  return (
    <div className="stack">
      <PageHeader title="Источники трафика" />
      <div className="grid g-2">
        <Card title="Визиты по каналам">
          <HBars rows={channels.sort((a, b) => b.sessions - a.sessions).map((c) => ({ label: c.label, value: c.sessions }))} fmt={(v) => num(v)} />
        </Card>
        <Card title="Выручка по каналам" sub="Заказ привязывается к визиту, который к нему привёл">
          <HBars rows={channels.filter((c) => c.revenue > 0).sort((a, b) => b.revenue - a.revenue).map((c) => ({ label: c.label, value: c.revenue }))} fmt={(v) => money(v, { compact: true })} />
        </Card>
      </div>
      <Card title="Все источники и кампании" sub="Нажмите на заголовок столбца, чтобы отсортировать">
        {rows.length ? (
          <div className="table-wrap"><table>
            <thead><tr>
              <th>Источник</th><th>Канал</th>{th('sessions', 'Визиты')}<th className="num">Посетители</th>{th('bounce_rate', 'Отказы')}
              <th className="num">Время</th>{th('orders', 'Заказы')}{th('conversion', 'Конверсия')}{th('revenue', 'Выручка')}
            </tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.source + r.medium}>
                <td className="trunc">{sourceLabel(r.source)}</td>
                <td>{MEDIUM_LABELS[r.medium] ?? r.medium}</td>
                <td className="num"><BarCell value={r.sessions} max={max('sessions')} label={num(r.sessions)} /></td>
                <td className="num">{num(r.visitors)}</td>
                <td className="num">{r.sessions ? pct(r.bounce_rate) : '—'}</td>
                <td className="num">{r.sessions ? dur(r.avg_duration) : '—'}</td>
                <td className="num">{num(r.orders)}</td>
                <td className="num">{r.sessions ? pct(r.conversion, 2) : '—'}</td>
                <td className="num"><b>{money(r.revenue)}</b></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty />}
      </Card>
    </div>
  );
}
