import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Card, Empty, Kpi, Loading, Modal } from '../components/ui';
import { TimeChart } from '../components/Charts';
import { Icon } from '../components/Icon';
import { api, qs } from '../lib/api';
import { date, money, num } from '../lib/format';
import { STATUS_LABELS, sourceLabel } from '../lib/labels';
import { useFetch, useStore } from '../lib/store';

const STATUS_COLOR: Record<string, string> = { paid: 'var(--good)', pending: 'var(--warn)', cancelled: 'var(--muted)', refunded: 'var(--bad)' };

export function StatusBadge({ status }: { status: string }) {
  return <span className="badge"><span className="dot" style={{ background: STATUS_COLOR[status] }} />{STATUS_LABELS[status] ?? status}</span>;
}

export default function Sales() {
  const { site, range, can } = useStore();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const { data: ov } = useFetch<any>(`/api/analytics/overview${qs({ site, from: range.from, to: range.to })}`);
  const { data, reload } = useFetch<any>(`/api/orders${qs({ status, q: search, limit: 50, offset: page * 50 })}`);

  const updateStatus = async (id: string, st: string) => { await api(`/api/orders/${id}`, { method: 'PATCH', body: { status: st } }); reload(); };

  return (
    <div className="stack">
      <PageHeader title="Продажи" />
      {ov ? (
        <div className="grid g-4 kpis">
          <Kpi label="Выручка" value={money(ov.current.revenue)} cur={ov.current.revenue} prev={ov.previous.revenue} />
          <Kpi label="Оплаченные заказы" value={num(ov.current.orders)} cur={ov.current.orders} prev={ov.previous.orders} />
          <Kpi label="Средний чек" value={money(ov.current.aov)} cur={ov.current.aov} prev={ov.previous.aov} />
          <Kpi label="Покупатели" value={num(ov.current.customers)} cur={ov.current.customers} prev={ov.previous.customers} />
        </div>
      ) : <Loading />}
      {ov && <Card title="Выручка по дням"><TimeChart data={ov.daily} dataKey="revenue" name="Выручка" fmt={(v) => money(v, { compact: true })} kind="bar" /></Card>}

      <Card
        title="Заказы"
        sub="Все заказы компании, за всё время"
        action={can('manager') && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Добавить продажу</button>}
      >
        <div className="row" style={{ marginBottom: 12 }}>
          <input placeholder="Поиск: номер, клиент, email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={{ flex: '1 1 220px' }} />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            <option value="">Все статусы</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {!data ? <Loading /> : !data.items.length ? <Empty>Заказов пока нет</Empty> : (
          <>
            <div className="table-wrap"><table>
              <thead><tr><th>Дата</th><th>Номер</th><th>Клиент</th><th>Источник</th><th>Статус</th><th className="num">Сумма</th></tr></thead>
              <tbody>{data.items.map((o: any) => (
                <tr key={o.id}>
                  <td>{date(o.created_at, true)}</td>
                  <td>{o.external_id ?? <span className="muted">—</span>}</td>
                  <td className="trunc">{o.contact_id ? <Link to={`/contacts/${o.contact_id}`}>{o.contact_name || o.contact_email}</Link> : <span className="muted">—</span>}</td>
                  <td className="trunc">{o.source ? sourceLabel(o.source, o.medium) : <span className="muted">не определён</span>}</td>
                  <td>
                    {can('manager') ? (
                      <select value={o.status} onChange={(e) => updateStatus(o.id, e.target.value)} aria-label="Статус">
                        {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    ) : <StatusBadge status={o.status} />}
                  </td>
                  <td className="num"><b>{money(o.amount)}</b></td>
                </tr>
              ))}</tbody>
            </table></div>
            <div className="row" style={{ marginTop: 12 }}>
              <span className="sub">Всего: {num(data.total)}</span><span className="spacer" />
              <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← Назад</button>
              <button className="btn sm" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>Вперёд →</button>
            </div>
          </>
        )}
      </Card>
      {adding && <AddOrder onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function AddOrder({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: '', external_id: '', name: '', email: '', phone: '', status: 'paid' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const customer = f.email || f.phone ? { name: f.name || undefined, email: f.email || undefined, phone: f.phone || undefined } : undefined;
      await api('/api/orders', { method: 'POST', body: { amount: Number(f.amount), status: f.status, external_id: f.external_id || undefined, customer } });
      onDone();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title="Новая продажа" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="form cols">
          <label className="field">Сумма *<input type="number" min="0" step="0.01" required value={f.amount} onChange={set('amount')} /></label>
          <label className="field">Номер заказа<input value={f.external_id} onChange={set('external_id')} /></label>
          <label className="field">Имя клиента<input value={f.name} onChange={set('name')} /></label>
          <label className="field">Email<input type="email" value={f.email} onChange={set('email')} /></label>
          <label className="field">Телефон<input value={f.phone} onChange={set('phone')} /></label>
          <label className="field">Статус<select value={f.status} onChange={set('status')}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        {err && <div className="error">{err}</div>}
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Отмена</button><button className="btn primary">Сохранить</button></div>
      </form>
    </Modal>
  );
}
