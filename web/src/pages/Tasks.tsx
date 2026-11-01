import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Card, Empty, Loading } from '../components/ui';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { useFetch, useStore } from '../lib/store';

export default function Tasks() {
  const { can } = useStore();
  const [mine, setMine] = useState(false);
  const { data, reload, setData } = useFetch<any[]>(`/api/tasks${mine ? '?mine=true' : ''}`);
  const { data: team } = useFetch<any[]>('/api/team');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await api('/api/tasks', { method: 'POST', body: { title, due_at: due ? new Date(due + 'T18:00:00').toISOString() : null, assignee_id: assignee || undefined } });
    setTitle(''); setDue(''); reload();
  };
  const toggle = async (t: any) => {
    setData((d) => d && d.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)));
    await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { done: !t.done } });
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="stack">
      <PageHeader title="Задачи" filters={false}>
        <div className="seg"><button className={!mine ? 'on' : ''} onClick={() => setMine(false)}>Все</button><button className={mine ? 'on' : ''} onClick={() => setMine(true)}>Мои</button></div>
      </PageHeader>
      {can('manager') && (
        <Card>
          <form className="row" onSubmit={add}>
            <input placeholder="Что нужно сделать?" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: '1 1 260px' }} />
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Срок" />
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Исполнитель">
              <option value="">Мне</option>
              {team?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button className="btn primary">Добавить</button>
          </form>
        </Card>
      )}
      <Card>
        {!data ? <Loading /> : !data.length ? <Empty>Задач нет</Empty> : (
          <div className="table-wrap"><table>
            <tbody>{data.map((t) => {
              const overdue = !t.done && t.due_at && t.due_at.slice(0, 10) < today;
              return (
                <tr key={t.id}>
                  <td style={{ width: 32 }}><input type="checkbox" checked={t.done} disabled={!can('manager')} onChange={() => toggle(t)} aria-label="Выполнено" /></td>
                  <td style={{ textDecoration: t.done ? 'line-through' : undefined, color: t.done ? 'var(--muted)' : undefined }}>
                    {t.title}{t.contact_id && <> · <Link to={`/contacts/${t.contact_id}`}>{t.contact_name}</Link></>}
                  </td>
                  <td className="sub">{t.assignee_name}</td>
                  <td className="num" style={{ color: overdue ? 'var(--bad)' : undefined, whiteSpace: 'nowrap' }}>{overdue && '⚠ '}{t.due_at ? date(t.due_at) : '—'}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
