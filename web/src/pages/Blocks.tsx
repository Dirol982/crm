import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Card, Empty, Loading, Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { RichEditor } from '../components/RichEditor';
import { api } from '../lib/api';
import { date, fromLocalInput, toLocalInput } from '../lib/format';
import { useFetch, useStore } from '../lib/store';

function blockState(b: any) {
  const now = Date.now();
  if (!b.active) return { label: 'Выключен', color: 'var(--muted)' };
  if (b.starts_at && Date.parse(b.starts_at) > now) return { label: 'Запланирован', color: 'var(--accent)' };
  if (b.ends_at && Date.parse(b.ends_at) <= now) return { label: 'Завершён', color: 'var(--muted)' };
  return { label: 'Показывается', color: 'var(--good)' };
}

export default function Blocks() {
  const { can } = useStore();
  const { data, reload } = useFetch<any[]>('/api/blocks');
  const [edit, setEdit] = useState<any | null>(null);

  return (
    <div className="stack">
      <PageHeader title="Блоки сайта" filters={false}>
        {can('manager') && <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" size={15} /> Новый блок</button>}
      </PageHeader>
      <p className="sub" style={{ margin: 0 }}>Баннеры, объявления, режим работы, акции — всё, что меняется на сайте без программиста. Можно включить показ по расписанию.</p>
      <Card>
        {!data ? <Loading /> : !data.length ? <Empty>Блоков пока нет</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Блок</th><th>Код для сайта</th><th>Статус</th><th>Показ</th></tr></thead>
            <tbody>{data.map((b) => {
              const st = blockState(b);
              return (
                <tr key={b.id} className={can('manager') ? 'clickable' : ''} onClick={() => can('manager') && setEdit(b)}>
                  <td><b>{b.title}</b><div className="sub">{b.site_name}</div></td>
                  <td><code>&lt;div data-crm-block="{b.key}"&gt;&lt;/div&gt;</code></td>
                  <td><span className="badge"><span className="dot" style={{ background: st.color }} />{st.label}</span></td>
                  <td className="sub" style={{ whiteSpace: 'nowrap' }}>{b.starts_at || b.ends_at ? `${b.starts_at ? 'с ' + date(b.starts_at, true) : ''} ${b.ends_at ? 'до ' + date(b.ends_at, true) : ''}` : 'всегда'}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
      {edit && <BlockForm block={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function BlockForm({ block, onClose, onDone }: { block: any; onClose: () => void; onDone: () => void }) {
  const { sites, site } = useStore();
  const [f, setF] = useState({
    site_id: block.site_id ?? (site || sites[0]?.id), key: block.key ?? '', title: block.title ?? '', html: block.html ?? '',
    active: block.active ?? true, starts_at: toLocalInput(block.starts_at), ends_at: toLocalInput(block.ends_at),
  });
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...f, starts_at: fromLocalInput(f.starts_at), ends_at: fromLocalInput(f.ends_at) };
    try {
      if (block.id) await api(`/api/blocks/${block.id}`, { method: 'PATCH', body });
      else await api('/api/blocks', { method: 'POST', body });
      onDone();
    } catch (e: any) { setErr(e.message === 'key_taken' ? 'Блок с таким кодом уже есть на этом сайте' : 'Код: только латиница, цифры, - и _'); }
  };
  const remove = async () => { if (confirm('Удалить блок? На сайте он перестанет показываться.')) { await api(`/api/blocks/${block.id}`, { method: 'DELETE' }); onDone(); } };
  return (
    <Modal title={block.id ? 'Блок сайта' : 'Новый блок'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="form cols">
          <label className="field">Название<input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Баннер акции" /></label>
          <label className="field">Код (для разметки сайта)<input required pattern="[A-Za-z0-9_\-]{1,50}" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="top-banner" /></label>
          {sites.length > 1 && <label className="field">Сайт<select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <label className="field">Показывать с<input type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></label>
          <label className="field">Показывать до<input type="datetime-local" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></label>
        </div>
        <label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Включён</label>
        <RichEditor value={f.html} onChange={(html) => setF({ ...f, html })} placeholder="Текст блока" />
        {f.key && <div className="sub">Вставьте на сайт: <code>&lt;div data-crm-block="{f.key}"&gt;&lt;/div&gt;</code></div>}
        {err && <div className="error">{err}</div>}
        <div className="row">{block.id && <button type="button" className="btn danger" onClick={remove}>Удалить</button>}<span className="spacer" /><button type="button" className="btn" onClick={onClose}>Отмена</button><button className="btn primary">Сохранить</button></div>
      </form>
    </Modal>
  );
}
