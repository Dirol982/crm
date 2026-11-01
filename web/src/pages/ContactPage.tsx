import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, Empty, Kpi, Loading } from '../components/ui';
import { api } from '../lib/api';
import { date, dur, money, num } from '../lib/format';
import { DEVICE_LABELS, sourceLabel, stageLabel } from '../lib/labels';
import { useFetch, useStore } from '../lib/store';
import { ContactForm } from './Contacts';
import { StatusBadge } from './Sales';

export default function ContactPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useStore();
  const { data, reload, error } = useFetch<any>(`/api/contacts/${id}`);
  const [editing, setEditing] = useState(false);

  if (error) return <Empty>Клиент не найден</Empty>;
  if (!data) return <Loading />;
  const c = data.contact;
  const paid = data.orders.filter((o: any) => o.status === 'paid');
  const ltv = paid.reduce((s: number, o: any) => s + o.amount, 0);
  const remove = async () => {
    if (!confirm('Удалить клиента? Заказы останутся, но без привязки.')) return;
    await api(`/api/contacts/${c.id}`, { method: 'DELETE' });
    nav('/contacts');
  };

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <Link to="/contacts" className="sub">← Клиенты</Link>
          <h1>{c.name || c.email || 'Без имени'}</h1>
          <div className="sub">{[c.company, c.email, c.phone].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="row">
          {can('manager') && <button className="btn" onClick={() => setEditing(true)}>Редактировать</button>}
          {can('admin') && <button className="btn danger" onClick={remove}>Удалить</button>}
        </div>
      </div>
      <div className="grid g-4 kpis">
        <Kpi label="Сумма покупок" value={money(ltv)} />
        <Kpi label="Заказы" value={num(paid.length)} />
        <Kpi label="Средний чек" value={money(paid.length ? ltv / paid.length : 0)} />
        <Kpi label="Первый источник" value={c.source ? sourceLabel(c.source) : '—'} />
      </div>
      {c.notes && <Card title="Заметки"><div style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</div></Card>}
      <div className="grid g-2">
        <Card title="Заказы">
          {data.orders.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Дата</th><th>Источник</th><th>Статус</th><th className="num">Сумма</th></tr></thead>
              <tbody>{data.orders.map((o: any) => <tr key={o.id}><td>{date(o.created_at, true)}</td><td className="trunc">{o.source ? sourceLabel(o.source, o.medium) : '—'}</td><td><StatusBadge status={o.status} /></td><td className="num">{money(o.amount)}</td></tr>)}</tbody>
            </table></div>
          ) : <Empty>Заказов нет</Empty>}
        </Card>
        <Card title="Сделки и задачи">
          {data.deals.map((d: any) => <div key={d.id} className="row" style={{ padding: '6px 0' }}><b>{d.title}</b><span className="badge">{stageLabel(d.stage)}</span><span className="spacer" />{money(d.amount)}</div>)}
          {data.tasks.map((t: any) => <div key={t.id} className="row" style={{ padding: '6px 0' }}><span>{t.done ? '✓' : '○'} {t.title}</span><span className="spacer" /><span className="sub">{date(t.due_at)}</span></div>)}
          {!data.deals.length && !data.tasks.length && <Empty>Пока пусто</Empty>}
        </Card>
      </div>
      <Card title="История визитов на сайт" sub="Как клиент приходил и что смотрел">
        {data.sessions.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Когда</th><th>Источник</th><th>Вход</th><th>Выход</th><th className="num">Страниц</th><th className="num">Время</th><th>Устройство</th></tr></thead>
            <tbody>{data.sessions.map((s: any) => (
              <tr key={s.id}><td>{date(s.started_at, true)}</td><td className="trunc">{sourceLabel(s.source, s.medium)}{s.campaign && <div className="sub">{s.campaign}</div>}</td>
                <td className="trunc">{s.landing_page}</td><td className="trunc">{s.exit_page}</td><td className="num">{s.pageviews}</td><td className="num">{dur(s.duration_sec)}</td><td>{DEVICE_LABELS[s.device] ?? s.device}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>Визиты появятся, когда клиент оставит заявку или купит на сайте с подключённым трекером</Empty>}
      </Card>
      {editing && <ContactForm initial={c} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} />}
    </div>
  );
}
