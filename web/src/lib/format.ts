let currency = 'RUB';
export const setCurrency = (c: string) => { currency = c || 'RUB'; };

export const money = (v: number, opts: { compact?: boolean } = {}) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency, maximumFractionDigits: opts.compact || Math.abs(v) >= 1000 ? 0 : 2,
    notation: opts.compact && Math.abs(v) >= 100000 ? 'compact' : 'standard',
  }).format(v || 0);

export const num = (v: number, compact = false) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, notation: compact && Math.abs(v) >= 10000 ? 'compact' : 'standard' }).format(v || 0);

export const pct = (v: number, digits = 1) => `${((v || 0) * 100).toFixed(digits).replace('.', ',')}%`;

export const dur = (sec: number) => {
  const s = Math.round(sec || 0);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин ${s % 60} с`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
};

export const date = (v: string | Date | null | undefined, withTime = false) =>
  v ? new Intl.DateTimeFormat('ru-RU', withTime ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(v)) : '—';

export const dayLabel = (iso: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(iso + 'T00:00:00'));

export const isoDay = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

/** Изменение к прошлому периоду */
export const change = (cur: number, prev: number) => (prev ? (cur - prev) / prev : cur ? 1 : 0);

/** ISO → значение для <input type="datetime-local"> в локальном времени */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
