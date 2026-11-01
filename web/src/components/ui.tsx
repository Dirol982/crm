import { useEffect, type ReactNode } from 'react';
import { change, pct } from '../lib/format';

export function Card({ title, sub, action, children, className = '' }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Плитка показателя + изменение к прошлому периоду (стрелка + знак, не только цвет) */
export function Kpi({ label, value, cur, prev, invert = false, hint }: { label: string; value: string; cur?: number; prev?: number; invert?: boolean; hint?: string }) {
  let delta: ReactNode = null;
  if (cur !== undefined && prev !== undefined) {
    const d = change(cur, prev);
    const flat = Math.abs(d) < 0.005;
    const good = invert ? d < 0 : d > 0;
    delta = (
      <span className={`delta ${flat ? 'flat' : good ? 'good' : 'bad'}`} title="К предыдущему периоду такой же длины">
        {flat ? '→' : d > 0 ? '▲' : '▼'} {d > 0 ? '+' : ''}{pct(d)}
      </span>
    );
  }
  return (
    <div className="card kpi">
      <div className="kpi-label" title={hint}>{label}</div>
      <div className="kpi-value">{value}</div>
      <div>{delta ?? <span className="delta flat">&nbsp;</span>}</div>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Значение + горизонтальная полоска относительно максимума в столбце */
export function BarCell({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div className="bar-cell">
      <span>{label}</span>
      <span className="bar" style={{ width: `${Math.max(2, (value / (max || 1)) * 80)}px` }} />
    </div>
  );
}

export function Empty({ children = 'Нет данных за выбранный период' }: { children?: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading() {
  return <div className="empty">Загрузка…</div>;
}
