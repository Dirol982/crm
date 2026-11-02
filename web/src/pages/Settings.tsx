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
  const { data: invites, reload: reloadInvites } = useFetch<any[]>('/api/team/invitations');
  const [notice, setNotice] = useState('');
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
      <Profile />
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
      <Card title="Сотрудники" action={admin && <button className="btn primary" onClick={() => setInviting(true)}><Icon name="plus" size={15} /> Пригласить</button>}>
        {!team ? <Loading /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>С нами с</th><th></th></tr></thead>
            <tbody>{team.map((u) => (
              <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{ROLE_LABELS[u.role]}</td><td>{date(u.created_at)}</td>
                <td className="num">{admin && u.role !== 'owner' && <button className="btn sm danger" onClick={() => removeMember(u.id)}>Убрать</button>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        {notice && <div className="sub" style={{ color: 'var(--good)', marginTop: 8 }}>✓ {notice}</div>}
        {!!invites?.length && (
          <>
            <h3 style={{ marginTop: 16 }}>Ожидают ответа</h3>
            <div className="table-wrap"><table>
              <tbody>{invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.name || <span className="muted">—</span>}</td><td>{i.email}</td><td>{ROLE_LABELS[i.role]}</td>
                  <td className="sub">{i.expired ? 'приглашение истекло' : `отправлено ${date(i.created_at)}`}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{admin && <>
                    <button className="btn sm" onClick={async () => { await api(`/api/team/invitations/${i.id}/resend`, { method: 'POST' }); reloadInvites(); setNotice('Приглашение отправлено ещё раз'); }}>Отправить ещё раз</button>{' '}
                    <button className="btn sm danger" onClick={async () => { await api(`/api/team/invitations/${i.id}`, { method: 'DELETE' }); reloadInvites(); }}>Отменить</button>
                  </>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </>
        )}
        <p className="sub">Роли: владелец и администратор управляют настройками и сайтами; менеджер работает с клиентами, сделками и продажами; наблюдатель только смотрит.</p>
      </Card>
      {inviting && <Invite onClose={() => setInviting(false)} onDone={(st) => {
        setInviting(false); reload(); reloadInvites();
        setNotice(st === 'added' ? 'Сотрудник добавлен — у него уже был аккаунт, письмо отправлено' : 'Приглашение отправлено на почту');
        setTimeout(() => setNotice(''), 4000);
      }} />}
    </div>
  );
}

function Invite({ onClose, onDone }: { onClose: () => void; onDone: (status: string) => void }) {
  const [f, setF] = useState({ name: '', email: '', role: 'manager' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api('/api/team', { method: 'POST', body: f }); onDone(r.status); }
    catch (e: any) { setErr(e.message === 'already_member' ? 'Этот сотрудник уже в компании' : e.message === 'plan_limit' ? 'Достигнут лимит сотрудников на вашем тарифе' : 'Проверьте email'); setBusy(false); }
  };
  return (
    <Modal title="Пригласить сотрудника" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">Email<input type="email" required autoFocus value={f.email} onChange={set('email')} /></label>
        <label className="field">Имя (необязательно)<input value={f.name} onChange={set('name')} /></label>
        <label className="field">Роль<select value={f.role} onChange={set('role')}>{['admin', 'manager', 'viewer'].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
        <p className="sub" style={{ margin: 0 }}>Сотрудник получит письмо со ссылкой и сам задаст пароль. Если у него уже есть аккаунт в Пульсе — он сразу появится в компании.</p>
        {err && <div className="error">{err}</div>}
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Отмена</button><button className="btn primary" disabled={busy}>Пригласить</button></div>
      </form>
    </Modal>
  );
}

/** Имя, пароль, еженедельный отчёт */
function Profile() {
  const { me, login, refresh } = useStore();
  const [name, setName] = useState(me!.user.name);
  const [digest, setDigest] = useState<boolean>((me!.user as any).email_digest ?? true);
  const [pw, setPw] = useState({ current: '', password: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const save = async (body: any) => { await api('/api/me', { method: 'PATCH', body }); await refresh(); setMsg('Сохранено ✓'); setTimeout(() => setMsg(''), 2000); };
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      const r = await api('/api/auth/password', { method: 'POST', body: pw });
      await login(r.token); setPw({ current: '', password: '' }); setMsg('Пароль изменён ✓');
    } catch (e: any) { setErr(e.message === 'wrong_password' ? 'Текущий пароль неверный' : 'Новый пароль — минимум 8 символов'); }
  };
  return (
    <Card title="Профиль" sub={me!.user.email}>
      <div className="grid g-2">
        <div className="form">
          <label className="field">Имя<div className="row"><input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
            {name !== me!.user.name && <button className="btn sm" onClick={() => save({ name })}>Сохранить</button>}</div></label>
          <label className="row" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={digest} onChange={(e) => { setDigest(e.target.checked); save({ email_digest: e.target.checked }); }} />
            Еженедельный отчёт на почту — по понедельникам утром: выручка, заказы и источники за неделю
          </label>
          {msg && <span className="sub">{msg}</span>}
        </div>
        <form className="form" onSubmit={changePassword}>
          <label className="field">Текущий пароль<input type="password" required autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label className="field">Новый пароль<input type="password" required minLength={8} autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></label>
          {err && <div className="error">{err}</div>}
          <div className="row"><button className="btn">Сменить пароль</button><span className="sub">Другие устройства потребуют входа заново</span></div>
        </form>
      </div>
    </Card>
  );
}
