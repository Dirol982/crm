import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useStore, presetRange, type Preset } from '../lib/store';
import { DEMO } from '../lib/api';
import { ROLE_LABELS } from '../lib/labels';
import { Icon } from './Icon';

const NAV: [string, string, string][][] = [
  [['/', 'Сводка', 'dashboard'], ['/traffic', 'Источники', 'traffic'], ['/behavior', 'Поведение', 'behavior'], ['/sales', 'Продажи', 'sales']],
  [['/contacts', 'Клиенты', 'contacts'], ['/deals', 'Сделки', 'deals'], ['/tasks', 'Задачи', 'tasks']],
  [['/integrations', 'Подключение', 'integrations'], ['/settings', 'Настройки', 'settings']],
];
const SECTIONS = ['Аналитика', 'CRM', 'Компания'];

export function Layout() {
  const { me, logout } = useStore();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  return (
    <div className="app">
      <aside className={`sidebar${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand">
          <div className="brand-logo">
            <svg width="18" height="18" viewBox="0 0 32 32"><path d="M8 22V14M14 22V9M20 22v-6M26 22V12" stroke="white" strokeWidth="3.2" strokeLinecap="round" /></svg>
          </div>
          Пульс CRM
        </div>
        {NAV.map((items, i) => (
          <nav className="nav" key={i}>
            <div className="nav-section">{SECTIONS[i]}</div>
            {items.map(([to, label, icon]) => (
              <NavLink key={to} to={to} end={to === '/'}>
                <Icon name={icon} /> {label}
              </NavLink>
            ))}
          </nav>
        ))}
        <div className="sidebar-foot">
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>{me?.tenant.name}</div>
            <div>{me?.user.name} · {ROLE_LABELS[me?.role ?? 'viewer']}</div>
          </div>
          {!DEMO && <button className="btn sm" onClick={logout}><Icon name="logout" size={14} /> Выйти</button>}
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <div className="mobile-bar">
          <button className="btn sm" aria-label="Меню" onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <b>Пульс CRM</b>
        </div>
        <main className="main" key={loc.pathname}>
          {DEMO && (
            <div className="demo-banner">
              <b>Демо-версия.</b> Данные сгенерированы для примера, изменения не сохраняются.
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const PRESETS: [Preset, string][] = [['7d', '7 дней'], ['30d', '30 дней'], ['90d', '90 дней'], ['month', 'Этот месяц']];

/** Заголовок страницы аналитики с фильтрами сайта и периода (одна строка над графиками) */
export function PageHeader({ title, filters = true, children }: { title: string; filters?: boolean; children?: ReactNode }) {
  const { sites, site, setSite, range, setRange } = useStore();
  return (
    <div className="topbar">
      <h1>{title}</h1>
      <div className="filters">
        {children}
        {filters && sites.length > 1 && (
          <select value={site} onChange={(e) => setSite(e.target.value)} aria-label="Сайт">
            <option value="">Все сайты</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {filters && (
          <div className="seg" role="group" aria-label="Период">
            {PRESETS.map(([p, label]) => (
              <button key={p} className={range.preset === p ? 'on' : ''} onClick={() => setRange(presetRange(p))}>{label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
