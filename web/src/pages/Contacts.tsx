import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Card, Empty, Loading, Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { api, qs } from '../lib/api';
import { date, money, num } from '../lib/format';
import { sourceLabel } from '../lib/labels';
import { useFetch, useStore } from '../lib/store';

export default function Contacts() {
  const { can } = useStore();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const { data, reload } = useFetch<any>(`/api/contacts${qs({ q: search, limit: 50, offset: page * 50 })}`);

  return (
    <div className="stack">
      <PageHeader title="Клиенты" filters={false}>
        {can('manager') && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Новый клиент</button>}
      </PageHeader>
      <Card>
        <input placeholder="Поиск по имени, email, телефону, компании" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={{ width: '100%', marginBottom: 12 }} />
        {!data ? <Loading /> : !data.items.length ? <Empty>Клиентов пока нет. Они появятся автоматически из заявок и заказов на сайте.</Empty> : (
          <>
            <div className="table-wrap"><table>
              <thead><tr><th>Имя</th><th>Контакты</th><th>Компания</th><th>Источник</th><th className="num">Заказы</th><th className="num">Сумма покупок</th><th>Добавлен</th></tr></thead>
              <tbody>{data.items.map((c: any) => (
                <tr key={c.id} className="clickable" onClick={() => nav(`/contacts/${c.id}`)}>
                  <td><b>{c.name || '—'}</b> {c.tags?.map((t: string) => <span key={t} className="badge" style={{ marginLeft: 4 }}>{t}</span>)}</td>
                  <td className="trunc">{c.email}<div className="sub">{c.phone}</div></td>
                  <td className="trunc">{c.company ?? <span className="muted">—</span>}</td>
                  <td>{c.source ? sourceLabel(c.source) : '—'}</td>
                  <td className="num">{num(c.orders_count)}</td>
                  <td className="num">{c.revenue ? money(c.revenue) : '—'}</td>
                  <td>{date(c.created_at)}</td>
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
      {adding && <ContactForm onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

export function ContactForm({ initial, onClose, onDone }: { initial?: any; onClose: () => void; onDone: (c: any) => void }) {
  const [f, setF] = useState({ name: initial?.name ?? '', email: initial?.email ?? '', phone: initial?.phone ?? '', company: initial?.company ?? '', notes: initial?.notes ?? '', tags: (initial?.tags ?? []).join(', ') });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...f, email: f.email || null, tags: f.tags.split(',').map((t: string) => t.trim()).filter(Boolean) };
    try {
      const c = initial ? await api(`/api/contacts/${initial.id}`, { method: 'PATCH', body }) : await api('/api/contacts', { method: 'POST', body });
      onDone(c);
    } catch (e: any) { setErr(e.message === 'validation' ? 'Проверьте поля формы' : e.message); }
  };
  return (
    <Modal title={initial ? 'Редактировать клиента' : 'Новый клиент'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="form cols">
          <label className="field">Имя<input required value={f.name} onChange={set('name')} /></label>
          <label className="field">Компания<input value={f.company} onChange={set('company')} /></label>
          <label className="field">Email<input type="email" value={f.email} onChange={set('email')} /></label>
          <label className="field">Телефон<input value={f.phone} onChange={set('phone')} /></label>
        </div>
        <label className="field">Теги (через запятую)<input value={f.tags} onChange={set('tags')} /></label>
        <label className="field">Заметки<textarea value={f.notes} onChange={set('notes')} /></label>
        {err && <div className="error">{err}</div>}
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Отмена</button><button className="btn primary">Сохранить</button></div>
      </form>
    </Modal>
  );
}
