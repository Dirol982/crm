import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Card, Loading, Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { ROLE_LABELS, stageLabel } from '../lib/labels';
import { useFetch, useStore } from '../lib/store';

export default function Settings() {
  const { me, can, refresh } = useStore();
  const { data: team, reload } = useFetch<any[]>('/api/team');
  const [f, setF] = useState({ name: me!.tenant.name, currency: me!.tenant.currency, timezone: me!.tenant.timezone, stages: me!.tenant.deal_stages.join(', ') });
  const [saved, setSaved] = useState(false);
  const [inviting, setInviting] = useState(false);
  const admin = can('admin');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await api('/api/tenant', { method: 'PATCH', body: { name: f.name, currency: f.currency, timezone: f.timezone, deal_stages: f.stages.split(',').map((s) => s.trim()).filter(Boolean) } });
    await refresh();
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };
  const removeMember = async (id: string) => { if (confirm('Убрать сотрудника из компании?')) { await api(`/api/team/${id}`, { method: 'DELETE' }); reload(); } };

  return (
    <div className="stack">
      <PageHeader title="Настройки" filters={false} />
      <Card title="Компания">
        <form className="form" onSubmit={save}>
          <div className="form cols">
            <label className="field">Название<input disabled={!admin} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field">Валюта
              <select disabled={!admin} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                {['RUB', 'USD', 'EUR', 'KZT', 'BYN', 'UAH', 'UZS', 'GBP', 'TRY', 'AED'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">Часовой пояс
              <select disabled={!admin} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
                {['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Vladivostok', 'Asia/Almaty', 'Europe/Minsk', 'Europe/Kyiv', 'Asia/Tashkent', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'UTC'].map((z) => <option key={z}>{z}</option>)}
              </select>
            </label>
            <label className="field">Тариф<input disabled value={me!.tenant.plan} /></label>
          </div>
          <label className="field">Этапы сделок (через запятую; won и lost — закрытые)
            <input disabled={!admin} value={f.stages} onChange={(e) => setF({ ...f, stages: e.target.value })} />
            <span className="sub">Сейчас: {me!.tenant.deal_stages.map(stageLabel).join(' → ')}</span>
          </label>
          {admin && <div className="row"><button className="btn primary">Сохранить</button>{saved && <span className="sub">Сохранено ✓</span>}</div>}
        </form>
      </Card>
      <Card title="Сотрудники" action={admin && <button className="btn primary" onClick={() => setInviting(true)}><Icon name="plus" size={15} /> Добавить</button>}>
        {!team ? <Loading /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>С нами с</th><th></th></tr></thead>
            <tbody>{team.map((u) => (
              <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{ROLE_LABELS[u.role]}</td><td>{date(u.created_at)}</td>
                <td className="num">{admin && u.role !== 'owner' && <button className="btn sm danger" onClick={() => removeMember(u.id)}>Убрать</button>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="sub">Роли: владелец и администратор управляют настройками и сайтами; менеджер работает с клиентами, сделками и продажами; наблюдатель только смотрит.</p>
      </Card>
      {inviting && <Invite onClose={() => setInviting(false)} onDone={() => { setInviting(false); reload(); }} />}
    </div>
  );
}

function Invite({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', role: 'manager', password: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/api/team', { method: 'POST', body: f }); onDone(); } catch (e: any) { setErr(e.message === 'already_member' ? 'Этот сотрудник уже в компании' : 'Проверьте поля (пароль от 8 символов)'); }
  };
  return (
    <Modal title="Новый сотрудник" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">Имя<input required value={f.name} onChange={set('name')} /></label>
        <label className="field">Email<input type="email" required value={f.email} onChange={set('email')} /></label>
        <label className="field">Роль<select value={f.role} onChange={set('role')}>{['admin', 'manager', 'viewer'].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
        <label className="field">Временный пароль<input required minLength={8} value={f.password} onChange={set('password')} /></label>
        {err && <div className="error">{err}</div>}
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Отмена</button><button className="btn primary">Добавить</button></div>
      </form>
    </Modal>
  );
}
