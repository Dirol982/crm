import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Loading, Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { stageLabel } from '../lib/labels';
import { useFetch, useStore } from '../lib/store';

export default function Deals() {
  const { me, can } = useStore();
  const { data, setData, reload } = useFetch<any[]>('/api/deals');
  const [over, setOver] = useState<string | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const stages = me?.tenant.deal_stages ?? [];

  const move = async (dealId: string, stage: string) => {
    setData((d) => d && d.map((x) => (x.id === dealId ? { ...x, stage } : x)));
    await api(`/api/deals/${dealId}`, { method: 'PATCH', body: { stage } }).catch(reload);
  };

  if (!data) return <><PageHeader title="Сделки" filters={false} /><Loading /></>;
  const open = data.filter((d) => !['won', 'lost'].includes(d.stage));
  return (
    <div className="stack">
      <PageHeader title="Сделки" filters={false}>
        <span className="sub">В работе: {open.length} на {money(open.reduce((s, d) => s + d.amount, 0))}</span>
        {can('manager') && <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" size={15} /> Новая сделка</button>}
      </PageHeader>
      <div className="kanban">
        {stages.map((st) => {
          const items = data.filter((d) => d.stage === st);
          return (
            <div key={st} className={`column${over === st ? ' over' : ''}`}
              onDragOver={(e) => { if (can('manager')) { e.preventDefault(); setOver(st); } }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, st); }}>
              <div className="column-head"><span>{stageLabel(st)} · {items.length}</span><span className="sub">{money(items.reduce((s, d) => s + d.amount, 0), { compact: true })}</span></div>
              {items.map((d) => (
                <div key={d.id} className="deal" draggable={can('manager')} onDragStart={(e) => e.dataTransfer.setData('text/plain', d.id)} onClick={() => can('manager') && setEdit(d)}>
                  <b>{d.title}</b>
                  <div className="row"><span>{money(d.amount)}</span><span className="spacer" />
                    {d.contact_id && <Link to={`/contacts/${d.contact_id}`} className="sub" onClick={(e) => e.stopPropagation()}>{d.contact_name}</Link>}</div>
                  {d.owner_name && <div className="sub">{d.owner_name}</div>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <p className="sub">Перетаскивайте карточки между этапами. Этапы воронки настраиваются в разделе «Настройки».</p>
      {edit && <DealForm deal={edit} stages={stages} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function DealForm({ deal, stages, onClose, onDone }: { deal: any; stages: string[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: deal.title ?? '', amount: String(deal.amount ?? ''), stage: deal.stage ?? stages[0] });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...f, amount: Number(f.amount || 0) };
    if (deal.id) await api(`/api/deals/${deal.id}`, { method: 'PATCH', body });
    else await api('/api/deals', { method: 'POST', body });
    onDone();
  };
  const remove = async () => { if (confirm('Удалить сделку?')) { await api(`/api/deals/${deal.id}`, { method: 'DELETE' }); onDone(); } };
  return (
    <Modal title={deal.id ? 'Сделка' : 'Новая сделка'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">Название<input required value={f.title} onChange={set('title')} /></label>
        <div className="form cols">
          <label className="field">Сумма<input type="number" min="0" value={f.amount} onChange={set('amount')} /></label>
          <label className="field">Этап<select value={f.stage} onChange={set('stage')}>{stages.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}</select></label>
        </div>
        <div className="row">{deal.id && <button type="button" className="btn danger" onClick={remove}>Удалить</button>}<span className="spacer" /><button type="button" className="btn" onClick={onClose}>Отмена</button><button className="btn primary">Сохранить</button></div>
      </form>
    </Modal>
  );
}
