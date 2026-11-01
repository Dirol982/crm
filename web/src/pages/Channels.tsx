import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Card, Empty, Loading, Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { DeliveryStatus } from '../components/DeliveryStatus';
import { api } from '../lib/api';
import { date, num } from '../lib/format';
import { useFetch, useStore } from '../lib/store';

export const NETWORK: Record<string, { label: string; color: string }> = {
  telegram: { label: 'Telegram', color: '#2aabee' },
  vk: { label: 'ВКонтакте', color: '#0077ff' },
};

export function NetworkBadge({ type }: { type: string }) {
  const n = NETWORK[type];
  return <span className="badge"><span className="dot" style={{ background: n?.color }} />{n?.label ?? type}</span>;
}

export default function Channels() {
  const { can } = useStore();
  const { data, reload } = useFetch<any[]>('/api/channels');
  const { data: log, reload: reloadLog } = useFetch<any[]>('/api/deliveries');
  const [edit, setEdit] = useState<any | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string } | 'busy'>>({});
  const admin = can('admin');

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: 'busy' }));
    const r = await api(`/api/channels/${id}/test`, { method: 'POST' }).catch(() => ({ ok: false, error: 'Не удалось выполнить проверку' }));
    setTests((t) => ({ ...t, [id]: { ok: r.ok, text: r.ok ? `Подключено: ${r.info}` : r.error } }));
  };
  const toggle = async (c: any) => { await api(`/api/channels/${c.id}`, { method: 'PATCH', body: { active: !c.active } }); reload(); };
  const retry = async (id: string) => { await api(`/api/deliveries/${id}/retry`, { method: 'POST' }); setTimeout(reloadLog, 1500); reloadLog(); };

  return (
    <div className="stack">
      <PageHeader title="Соцсети" filters={false}>
        {admin && <button className="btn primary" onClick={() => setEdit({ type: 'telegram' })}><Icon name="plus" size={15} /> Подключить</button>}
      </PageHeader>
      <p className="sub" style={{ margin: 0 }}>
        Публикации из CRM автоматически дублируются в Telegram-каналы и сообщества ВКонтакте в момент выхода на сайте — сразу или по расписанию.
        Куда отправлять, выбирается в редакторе публикации.
      </p>

      <Card title="Подключённые каналы">
        {!data ? <Loading /> : !data.length ? (
          <Empty>Пока ничего не подключено. {admin ? 'Нажмите «Подключить» — понадобится токен бота Telegram или ключ доступа сообщества VK.' : 'Попросите администратора подключить каналы.'}</Empty>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Канал</th><th>Сеть</th><th>Адрес</th>{admin && <th>Токен</th>}<th className="num">Отправлено</th><th className="num">Ошибки</th><th>Последний пост</th><th></th></tr></thead>
            <tbody>{data.map((c) => {
              const t = tests[c.id];
              return (
                <tr key={c.id}>
                  <td><b style={{ opacity: c.active ? 1 : 0.5 }}>{c.name}</b>{!c.active && <span className="badge" style={{ marginLeft: 6 }}>выключен</span>}
                    {t && t !== 'busy' && <div className="sub" style={{ color: t.ok ? 'var(--good)' : 'var(--bad)' }}>{t.ok ? '✓ ' : '⚠ '}{t.text}</div>}</td>
                  <td><NetworkBadge type={c.type} /></td>
                  <td><code>{c.type === 'vk' ? `vk.com/club${c.target}` : c.target}</code></td>
                  {admin && <td><code className="muted">{c.secret_mask}</code></td>}
                  <td className="num">{num(c.sent)}</td>
                  <td className="num" style={{ color: c.failed ? 'var(--bad)' : undefined }}>{num(c.failed)}</td>
                  <td>{c.last_sent_at ? date(c.last_sent_at, true) : <span className="muted">—</span>}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    {admin && <>
                      <button className="btn sm" disabled={t === 'busy'} onClick={() => test(c.id)}>{t === 'busy' ? 'Проверка…' : 'Проверить'}</button>{' '}
                      <button className="btn sm" onClick={() => toggle(c)}>{c.active ? 'Выключить' : 'Включить'}</button>{' '}
                      <button className="btn sm" onClick={() => setEdit(c)}>Изменить</button>
                    </>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>

      <Card title="Журнал отправок" sub="Последние 100 постов в соцсетях">
        {!log ? <Loading /> : !log.length ? <Empty>Отправок пока не было</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Публикация</th><th>Канал</th><th>Статус</th><th>Когда</th><th></th></tr></thead>
            <tbody>{log.map((d) => (
              <tr key={d.id}>
                <td className="trunc"><Link to={`/content/${d.post_id}`}>{d.post_title}</Link></td>
                <td><span className="dot" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: NETWORK[d.type]?.color, marginRight: 6 }} />{d.channel_name}</td>
                <td><DeliveryStatus d={d} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{d.sent_at ? date(d.sent_at, true) : d.post_status === 'scheduled' ? `выйдет ${date(d.publish_at, true)}` : <span className="muted">—</span>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {d.external_url && <a href={d.external_url} target="_blank" rel="noreferrer">Открыть пост ↗</a>}
                  {d.status === 'failed' && can('manager') && <button className="btn sm" onClick={() => retry(d.id)}>Повторить</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {edit && <ChannelForm channel={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function ChannelForm({ channel, onClose, onDone }: { channel: any; onClose: () => void; onDone: () => void }) {
  const isNew = !channel.id;
  const [f, setF] = useState({ type: channel.type, name: channel.name ?? '', target: channel.target ? (channel.type === 'vk' ? `club${channel.target}` : channel.target) : '', secret: '' });
  const [err, setErr] = useState('');
  const tg = f.type === 'telegram';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = { name: f.name, target: f.target };
    if (f.secret) body.secret = f.secret;
    try {
      if (isNew) {
        const c = await api('/api/channels', { method: 'POST', body: { ...body, type: f.type } });
        const r = await api(`/api/channels/${c.id}/test`, { method: 'POST' }).catch(() => null);
        if (r && !r.ok) alert(`Канал сохранён, но проверка не прошла:\n${r.error}\n\nИсправьте настройки через «Изменить».`);
      } else await api(`/api/channels/${channel.id}`, { method: 'PATCH', body });
      onDone();
    } catch { setErr(isNew ? 'Заполните все поля (токен — не короче 10 символов)' : 'Не удалось сохранить'); }
  };
  const remove = async () => {
    if (!confirm('Отключить канал? История отправок в него будет удалена, уже опубликованные посты в соцсети останутся.')) return;
    await api(`/api/channels/${channel.id}`, { method: 'DELETE' });
    onDone();
  };
  return (
    <Modal title={isNew ? 'Подключить соцсеть' : 'Настройки канала'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {isNew && (
          <div className="seg" role="group">
            <button type="button" className={tg ? 'on' : ''} onClick={() => setF({ ...f, type: 'telegram' })}>Telegram-канал</button>
            <button type="button" className={!tg ? 'on' : ''} onClick={() => setF({ ...f, type: 'vk' })}>Сообщество ВКонтакте</button>
          </div>
        )}
        <div className="sub" style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.6 }}>
          {tg ? (<>
            <b>Как подключить Telegram:</b><br />
            1. Создайте бота у <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> командой /newbot и скопируйте токен.<br />
            2. Добавьте бота в администраторы канала с правом «Публикация сообщений».<br />
            3. Укажите адрес канала: @имя или ссылку t.me/имя (для закрытого канала — числовой id вида -100…).
          </>) : (<>
            <b>Как подключить ВКонтакте:</b><br />
            1. В сообществе: Управление → Работа с API → Ключи доступа → Создать ключ, отметьте «Управление сообществом» и «Стена».<br />
            2. Скопируйте ключ (начинается с vk1.a…).<br />
            3. Укажите ссылку на сообщество или его числовой id (vk.com/club123456).
          </>)}
        </div>
        <label className="field">Название (для себя)<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tg ? 'Канал магазина' : 'Группа ВКонтакте'} /></label>
        <label className="field">{tg ? 'Канал' : 'Сообщество'}<input required value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder={tg ? '@myshop или https://t.me/myshop' : 'https://vk.com/club123456'} /></label>
        <label className="field">{tg ? 'Токен бота' : 'Ключ доступа сообщества'}
          <input type="password" autoComplete="off" required={isNew} value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} placeholder={isNew ? (tg ? '123456789:AA…' : 'vk1.a.…') : `Сейчас: ${channel.secret_mask} — оставьте пустым, чтобы не менять`} />
          <span className="sub">Хранится в зашифрованном виде и не показывается полностью.</span>
        </label>
        {err && <div className="error">{err}</div>}
        <div className="row">{!isNew && <button type="button" className="btn danger" onClick={remove}>Отключить</button>}<span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Отмена</button><button className="btn primary">{isNew ? 'Подключить и проверить' : 'Сохранить'}</button></div>
      </form>
    </Modal>
  );
}
