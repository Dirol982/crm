import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useStore, presetRange, type Preset } from '../lib/store';
import { api, DEMO } from '../lib/api';
import { ROLE_LABELS } from '../lib/labels';
import { Icon } from './Icon';

const NAV: [string, string, string][][] = [
  [['/', 'Сводка', 'dashboard'], ['/traffic', 'Источники', 'traffic'], ['/behavior', 'Поведение', 'behavior'], ['/sales', 'Продажи', 'sales']],
  [['/contacts', 'Клиенты', 'contacts'], ['/deals', 'Сделки', 'deals'], ['/tasks', 'Задачи', 'tasks']],
  [['/content', 'Публикации', 'content'], ['/calendar', 'Календарь', 'calendar'], ['/blocks', 'Блоки сайта', 'blocks'], ['/channels', 'Соцсети', 'share']],
  [['/integrations', 'Подключение', 'integrations'], ['/billing', 'Тариф и оплата', 'card'], ['/settings', 'Настройки', 'settings']],
];
const SECTIONS = ['Аналитика', 'CRM', 'Сайт', 'Компания', 'Владелец'];

export function Layout() {
  const { me, logout, login } = useStore();
  const switchTo = async (tenantId: string) => {
    const r = await api('/api/auth/switch', { method: 'POST', body: { tenantId } });
    await login(r.token);
    location.hash = '#/';
  };
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
        {[...NAV, ...(me?.is_superadmin ? [[['/platform', 'Платформа', 'platform']]] : [])].map((items, i) => (
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
            {(me?.workspaces.length ?? 0) > 1 ? (
              <select value={me!.tenant.id} onClick={(e) => e.stopPropagation()} onChange={(e) => switchTo(e.target.value)} aria-label="Компания" style={{ width: '100%', fontWeight: 600, marginBottom: 4 }}>
                {me!.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            ) : <div style={{ fontWeight: 600, color: 'var(--text)' }}>{me?.tenant.name}</div>}
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
          <BillingBanner />
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

/** Напоминание об оплате: заканчивается пробный период / оплата, превышен срок */
function BillingBanner() {
  const { me, can } = useStore();
  const loc = useLocation();
  const b = me?.billing;
  if (!b || loc.pathname === '/billing') return null;
  let text = '';
  if (b.status === 'trial' && (b.days_left ?? 99) <= 3) text = `Пробный период заканчивается через ${b.days_left} дн.`;
  else if (b.status === 'grace') text = `Оплата закончилась. Доступ сохранится ещё ${b.days_left} дн.`;
  if (!text) return null;
  return (
    <div className="demo-banner" style={{ borderColor: 'var(--warn)' }}>
      <b>{text}</b> {can('admin') ? <NavLink to="/billing">Выбрать тариф →</NavLink> : 'Попросите владельца продлить тариф.'}
    </div>
  );
}
