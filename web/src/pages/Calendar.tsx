import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Card, Loading } from '../components/ui';
import { api, qs } from '../lib/api';
import { isoDay } from '../lib/format';
import { POST_STATUS } from '../lib/labels';
import { useFetch, useStore } from '../lib/store';

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monthName = (d: Date) => { const m = new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(d); return `${m[0].toUpperCase()}${m.slice(1)} ${d.getFullYear()}`; };
const hhmm = (iso: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export default function Calendar() {
  const { site, can } = useStore();
  const nav = useNavigate();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [over, setOver] = useState<string | null>(null);

  // Сетка: с понедельника недели, в которую попадает 1-е число, 6 недель
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((month.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);
  const from = isoDay(days[0]), to = isoDay(days[41]);
  const { data, setData, reload } = useFetch<any[]>(`/api/posts/calendar${qs({ from, to, site })}`);

  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const p of data ?? []) { const k = isoDay(new Date(p.date)); (m.get(k) ?? m.set(k, []).get(k)!).push(p); }
    return m;
  }, [data]);

  // Перенос: сохраняем время, меняем дату. Опубликованное не двигаем.
  const move = async (postId: string, day: string) => {
    const p = data?.find((x) => x.id === postId);
    if (!p || p.status === 'published') return;
    const old = new Date(p.date);
    const [y, mo, d] = day.split('-').map(Number);
    const next = new Date(y, mo - 1, d, old.getHours(), old.getMinutes());
    if (p.status === 'scheduled' && next <= new Date()) return alert('Нельзя запланировать на прошедшее время');
    setData((list) => list && list.map((x) => (x.id === postId ? { ...x, date: next.toISOString() } : x)));
    await api(`/api/posts/${postId}`, { method: 'PATCH', body: { publish_at: next.toISOString() } }).catch(reload);
  };

  const today = isoDay(new Date());
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const planned = (data ?? []).filter((p) => p.status !== 'published' && isoDay(new Date(p.date)) >= today).length;

  return (
    <div className="stack">
      <PageHeader title="Календарь публикаций" filters={false}>
        <span className="sub">Впереди: {planned}</span>
        <div className="seg">
          <button onClick={() => shift(-1)} aria-label="Предыдущий месяц">←</button>
          <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Сегодня</button>
          <button onClick={() => shift(1)} aria-label="Следующий месяц">→</button>
        </div>
      </PageHeader>
      <Card title={monthName(month)}
        action={<div className="chart-legend">{Object.entries(POST_STATUS).filter(([k]) => k !== 'archived').map(([k, v]) => <span key={k}><i style={{ background: v.color, borderRadius: '50%' }} />{v.label}</span>)}</div>}>
        {!data ? <Loading /> : (
          <>
            <div className="cal-head">{WEEK.map((w) => <div key={w}>{w}</div>)}</div>
            <div className="cal">
              {days.map((d) => {
                const k = isoDay(d);
                const items = byDay.get(k) ?? [];
                const out = d.getMonth() !== month.getMonth();
                return (
                  <div key={k} className={`cal-day${out ? ' out' : ''}${k === today ? ' today' : ''}${over === k ? ' over' : ''}${items.length ? '' : ' empty'}`}
                    onDragOver={(e) => { if (can('manager')) { e.preventDefault(); setOver(k); } }}
                    onDragLeave={() => setOver(null)}
                    onDrop={(e) => { setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, k); }}>
                    <span className="cal-num">{d.getDate()}</span>
                    {can('manager') && k >= today && <button className="cal-add" title="Запланировать на этот день" onClick={() => nav(`/content/new?date=${k}`)}>+</button>}
                    {items.map((p) => (
                      <a key={p.id} className="chip" draggable={can('manager') && p.status !== 'published'}
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)}
                        onClick={() => nav(`/content/${p.id}`)} title={`${p.title} — ${POST_STATUS[p.status]?.label}`}>
                        <span className="dot" style={{ background: POST_STATUS[p.status]?.color }} />
                        <time>{hhmm(p.date)}</time>
                        <span>{p.title}</span>
                      </a>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
      <p className="sub">Нажмите «+» в дне, чтобы запланировать материал. Перетащите карточку на другой день, чтобы перенести (время сохранится). Опубликованные материалы не переносятся.</p>
    </div>
  );
}
