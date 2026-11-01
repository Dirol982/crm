import { date } from '../lib/format';

/** Статус отправки поста в соцсеть: иконка + подпись, не только цвет */
export function DeliveryStatus({ d, postStatus }: { d: any; postStatus?: string }) {
  if (d.status === 'sent') return <span className="badge"><span className="dot" style={{ background: 'var(--good)' }} />✓ Отправлено</span>;
  if (d.status === 'failed') return <span className="badge" title={d.error ?? ''}><span className="dot" style={{ background: 'var(--bad)' }} />⚠ Ошибка</span>;
  if (d.status === 'sending') return <span className="badge"><span className="dot" style={{ background: 'var(--accent)' }} />Отправляется…</span>;
  const waiting = postStatus && postStatus !== 'published';
  return (
    <span className="badge" title={d.error ? `Последняя попытка: ${d.error}` : ''}>
      <span className="dot" style={{ background: d.error ? 'var(--warn)' : 'var(--axis)' }} />
      {waiting ? 'Ждёт публикации' : d.error ? `Повтор в ${date(d.next_attempt_at, true).split(', ').pop()}` : 'В очереди'}
    </span>
  );
}
