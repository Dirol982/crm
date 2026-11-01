import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Card, Empty, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import { PostStatus } from '../components/PostStatus';
import { qs } from '../lib/api';
import { date, num } from '../lib/format';
import { POST_STATUS } from '../lib/labels';
import { useFetch, useStore } from '../lib/store';

export default function Content() {
  const { sites, site, setSite, can } = useStore();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [type, setType] = useState<'post' | 'page'>(sp.get('type') === 'page' ? 'page' : 'post');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { data } = useFetch<any[]>(`/api/posts${qs({ type, status, site, q: search })}`);

  const counts = (data ?? []).reduce<Record<string, number>>((a, p) => ({ ...a, [p.status]: (a[p.status] ?? 0) + 1 }), {});
  const upcoming = (data ?? []).filter((p) => p.status === 'scheduled').sort((a, b) => a.publish_at.localeCompare(b.publish_at))[0];

  return (
    <div className="stack">
      <PageHeader title="Публикации" filters={false}>
        <Link className="btn" to="/calendar">Календарь</Link>
        {can('manager') && <button className="btn primary" onClick={() => nav(`/content/new?type=${type}`)}><Icon name="plus" size={15} /> {type === 'post' ? 'Новая публикация' : 'Новая страница'}</button>}
      </PageHeader>

      {upcoming && type === 'post' && (
        <div className="demo-banner">
          <b>Следующая публикация:</b> <Link to={`/content/${upcoming.id}`}>{upcoming.title}</Link> — {date(upcoming.publish_at, true)}
        </div>
      )}

      <Card>
        <div className="tabs">
          <button className={type === 'post' ? 'on' : ''} onClick={() => setType('post')}>Блог и новости</button>
          <button className={type === 'page' ? 'on' : ''} onClick={() => setType('page')}>Страницы сайта</button>
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <input placeholder="Поиск по заголовку" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: '1 1 220px' }} />
          {sites.length > 1 && (
            <select value={site} onChange={(e) => setSite(e.target.value)} aria-label="Сайт">
              <option value="">Все сайты</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус">
            <option value="">Все статусы</option>
            {Object.entries(POST_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}{!status && counts[k] ? ` · ${counts[k]}` : ''}</option>)}
          </select>
        </div>
        {!data ? <Loading /> : !data.length ? (
          <Empty>{type === 'post' ? 'Публикаций пока нет. Создайте первую — она появится в блоге на сайте.' : 'Страниц пока нет. Например: «О компании», «Доставка», «Контакты».'}</Empty>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th></th><th>Заголовок</th><th>Статус</th><th>Дата</th>{sites.length > 1 && <th>Сайт</th>}<th className="num">Просмотры</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => nav(`/content/${p.id}`)}>
                <td style={{ width: 64 }}>{p.cover_url ? <img className="post-row-cover" src={p.cover_url} alt="" /> : <span className="post-row-cover" />}</td>
                <td className="trunc"><b>{p.title}</b><div className="sub">/{p.slug}{p.tags?.length ? ` · ${p.tags.join(', ')}` : ''}</div></td>
                <td><PostStatus status={p.status} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{p.status === 'published' ? date(p.published_at) : p.publish_at ? date(p.publish_at, true) : <span className="muted">—</span>}</td>
                {sites.length > 1 && <td className="trunc">{p.site_name}</td>}
                <td className="num">{p.status === 'published' && type === 'post' ? num(p.views) : <span className="muted">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
