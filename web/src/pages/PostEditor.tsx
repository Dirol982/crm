import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Card, Empty, Loading } from '../components/ui';
import { PostStatus } from '../components/PostStatus';
import { RichEditor } from '../components/RichEditor';
import { api, uploadImage } from '../lib/api';
import { date, fromLocalInput, num, toLocalInput } from '../lib/format';
import { POST_STATUS } from '../lib/labels';
import { useStore } from '../lib/store';

const EMPTY = { title: '', slug: '', excerpt: '', content: '', cover_url: '', tags: '', status: 'draft', publish_at: '', seo_title: '', seo_description: '', site_id: '', type: 'post' };
const ERR: Record<string, string> = { publish_at_required: 'Укажите дату и время публикации', validation: 'Проверьте поля: заголовок обязателен, обложка — ссылка на картинку' };

export default function PostEditor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { sites, site, can } = useStore();
  const isNew = !id || id === 'new';
  const [f, setF] = useState<typeof EMPTY | null>(isNew ? null : null);
  const [meta, setMeta] = useState<any>(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const loc = useLocation();
  const [savedAt, setSavedAt] = useState<Date | null>((loc.state as any)?.saved ? new Date() : null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (isNew) {
      const d = sp.get('date');
      setF({ ...EMPTY, type: sp.get('type') === 'page' ? 'page' : 'post', site_id: site || sites[0]?.id || '', publish_at: d ? `${d}T10:00` : '', status: d ? 'idea' : 'draft' });
      return;
    }
    api(`/api/posts/${id}`).then((p) => {
      setMeta(p);
      setF({ title: p.title, slug: p.slug, excerpt: p.excerpt ?? '', content: p.content ?? '', cover_url: p.cover_url ?? '', tags: (p.tags ?? []).join(', '),
        status: p.status, publish_at: toLocalInput(p.publish_at), seo_title: p.seo_title ?? '', seo_description: p.seo_description ?? '', site_id: p.site_id, type: p.type });
    }).catch(() => setErr('not_found'));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Предупреждение о несохранённых изменениях
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (err === 'not_found') return <Empty>Публикация не найдена</Empty>;
  if (!f) return <Loading />;
  const set = (k: keyof typeof EMPTY) => (v: string) => { setF({ ...f, [k]: v }); setDirty(true); };
  const ro = !can('manager');

  const save = async (status?: string) => {
    setErr(''); setSaving(true);
    const st = status ?? f.status;
    const body = {
      ...f, status: st, slug: f.slug || null, cover_url: f.cover_url || null,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      publish_at: st === 'published' && !f.publish_at ? null : fromLocalInput(f.publish_at),
    };
    try {
      const p = isNew ? await api('/api/posts', { method: 'POST', body }) : await api(`/api/posts/${id}`, { method: 'PATCH', body });
      setDirty(false); setSavedAt(new Date());
      setF({ ...f, status: p.status, slug: p.slug, publish_at: toLocalInput(p.publish_at) });
      setMeta((m: any) => ({ ...m, ...p }));
      if (isNew) nav(`/content/${p.id}`, { replace: true, state: { saved: true } });
    } catch (e: any) { setErr(ERR[e.message] ?? 'Не удалось сохранить'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!confirm('Удалить безвозвратно? Можно вместо этого перенести в архив.')) return;
    await api(`/api/posts/${id}`, { method: 'DELETE' });
    setDirty(false); nav('/content');
  };
  const future = f.publish_at && new Date(f.publish_at) > new Date();
  const s = sites.find((x) => x.id === f.site_id);
  const urlHint = s?.domain ? `${s.domain}/…?post=${f.slug || '…'}` : `?post=${f.slug || '…'}`;

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <Link to={f.type === 'page' ? '/content?type=page' : '/content'} className="sub">← Публикации</Link>
          <div className="row" style={{ marginTop: 4 }}>
            <PostStatus status={f.status} />
            {meta?.published_at && f.status === 'published' && <span className="sub">опубликовано {date(meta.published_at, true)}</span>}
            {f.status === 'scheduled' && <span className="sub">выйдет {date(fromLocalInput(f.publish_at), true)}</span>}
            {meta?.views > 0 && <span className="sub">· {num(meta.views)} просмотров</span>}
          </div>
        </div>
        {!ro && (
          <div className="row">
            {savedAt && !dirty && <span className="sub">Сохранено ✓</span>}
            {dirty && <span className="sub">Есть несохранённые изменения</span>}
            <button className="btn" disabled={saving} onClick={() => save()}>Сохранить</button>
            {!['published', 'scheduled'].includes(f.status) && (future
              ? <button className="btn primary" disabled={saving} onClick={() => save('scheduled')}>Запланировать</button>
              : <button className="btn primary" disabled={saving} onClick={() => save('published')}>Опубликовать</button>)}
          </div>
        )}
      </div>
      {err && <div className="error">{err}</div>}

      <div className="editor-layout">
        <div className="card stack">
          <input className="title-input" placeholder="Заголовок" value={f.title} onChange={(e) => set('title')(e.target.value)} readOnly={ro} aria-label="Заголовок" />
          <RichEditor value={f.content} onChange={set('content')} />
        </div>

        <div className="stack">
          <Card title="Публикация">
            <div className="form">
              <label className="field">Статус
                <select value={f.status} onChange={(e) => set('status')(e.target.value)} disabled={ro}>
                  {Object.entries(POST_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label className="field">Дата и время публикации
                <input type="datetime-local" value={f.publish_at} onChange={(e) => set('publish_at')(e.target.value)} disabled={ro} />
                <span className="sub">{future ? 'Материал выйдет автоматически в это время, если статус «Запланировано»' : 'Пусто — опубликовать сразу'}</span>
              </label>
              {sites.length > 1 && (
                <label className="field">Сайт
                  <select value={f.site_id} onChange={(e) => set('site_id')(e.target.value)} disabled={ro}>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                </label>
              )}
              <label className="field">Тип
                <select value={f.type} onChange={(e) => set('type')(e.target.value)} disabled={ro}><option value="post">Публикация (блог, новости)</option><option value="page">Страница сайта</option></select>
              </label>
              {!isNew && can('manager') && (
                <div className="row">
                  {f.status !== 'archived' && <button className="btn sm" onClick={() => save('archived')}>В архив</button>}
                  <button className="btn sm danger" onClick={remove}>Удалить</button>
                </div>
              )}
            </div>
          </Card>

          <Card title="Обложка">
            <div className="form">
              {f.cover_url && <img className="cover-preview" src={f.cover_url} alt="" />}
              {!ro && (
                <div className="row">
                  <label className="btn sm">Загрузить<input type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={async (e) => { const file = e.target.files?.[0]; if (file) try { set('cover_url')(await uploadImage(file)); } catch { setErr('Нужна картинка JPG, PNG, WebP или GIF до 5 МБ'); } }} /></label>
                  {f.cover_url && <button className="btn sm" onClick={() => set('cover_url')('')}>Убрать</button>}
                </div>
              )}
              <input placeholder="или ссылка на картинку" value={f.cover_url.startsWith('data:') ? '' : f.cover_url} onChange={(e) => set('cover_url')(e.target.value)} readOnly={ro} />
            </div>
          </Card>

          <Card title="Анонс и теги">
            <div className="form">
              <label className="field">Краткое описание<textarea value={f.excerpt} onChange={(e) => set('excerpt')(e.target.value)} placeholder="Если пусто — возьмём начало текста" readOnly={ro} /></label>
              <label className="field">Теги (через запятую)<input value={f.tags} onChange={(e) => set('tags')(e.target.value)} placeholder="новости, акции" readOnly={ro} /></label>
            </div>
          </Card>

          <Card title="SEO и адрес">
            <div className="form">
              <label className="field">Адрес (slug)<input value={f.slug} onChange={(e) => set('slug')(e.target.value)} placeholder="создастся из заголовка" readOnly={ro} /><span className="sub">{urlHint}</span></label>
              <label className="field">Заголовок для поисковиков<input value={f.seo_title} onChange={(e) => set('seo_title')(e.target.value)} placeholder={f.title} maxLength={300} readOnly={ro} /></label>
              <label className="field">Описание для поисковиков<textarea value={f.seo_description} onChange={(e) => set('seo_description')(e.target.value)} maxLength={500} readOnly={ro} />
                <span className="sub">{f.seo_description.length}/160 символов видно в выдаче</span></label>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
