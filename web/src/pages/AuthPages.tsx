import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { ROLE_LABELS } from '../lib/labels';

export function AuthCard({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <div className="auth">
      <div className="card">
        <div className="brand" style={{ padding: '0 0 8px' }}>
          <div className="brand-logo"><svg width="18" height="18" viewBox="0 0 32 32"><path d="M8 22V14M14 22V9M20 22v-6M26 22V12" stroke="white" strokeWidth="3.2" strokeLinecap="round" /></svg></div>
          Пульс CRM
        </div>
        {subtitle && <p className="sub" style={{ marginTop: 0 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

/** «Забыли пароль?» — ответ одинаковый для любого адреса */
export function ForgotForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    await api('/api/auth/forgot', { method: 'POST', body: { email } }).catch(() => null);
    setSent(true); setBusy(false);
  };
  if (sent) {
    return (
      <div className="form">
        <p style={{ margin: 0 }}>Если адрес <b>{email}</b> зарегистрирован, на него придёт письмо со ссылкой для нового пароля. Ссылка действует 1 час.</p>
        <p className="sub" style={{ margin: 0 }}>Письма нет — проверьте «Спам» или запросите ещё раз через минуту.</p>
        <button className="btn" onClick={onBack} style={{ justifyContent: 'center' }}>Вернуться ко входу</button>
      </div>
    );
  }
  return (
    <form className="form" onSubmit={submit}>
      <p style={{ margin: 0 }}>Укажите почту, с которой входите, — пришлём ссылку для нового пароля.</p>
      <label className="field">Email<input type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <button className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>Отправить ссылку</button>
      <button type="button" className="btn" onClick={onBack} style={{ justifyContent: 'center' }}>Назад</button>
    </form>
  );
}

export function ResetPassword() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { login } = useStore();
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [err, setErr] = useState('');
  const token = sp.get('token') ?? '';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd !== pwd2) return setErr('Пароли не совпадают');
    try {
      const r = await api('/api/auth/reset', { method: 'POST', body: { token, password: pwd } });
      if (r.token) { await login(r.token); nav('/', { replace: true }); } else nav('/login', { replace: true });
    } catch (e: any) {
      setErr(e.message === 'invalid_token' ? 'Ссылка устарела или уже использована. Запросите новую на странице входа.' : 'Пароль — минимум 8 символов');
    }
  };
  return (
    <AuthCard subtitle="Новый пароль">
      <form className="form" onSubmit={submit}>
        <label className="field">Новый пароль<input type="password" required minLength={8} autoFocus autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></label>
        <label className="field">Ещё раз<input type="password" required minLength={8} autoComplete="new-password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} /></label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary" style={{ justifyContent: 'center' }}>Сохранить и войти</button>
        <p className="sub" style={{ margin: 0 }}>После смены пароля вход на других устройствах потребуется заново.</p>
        <Link to="/login" className="sub">Ко входу</Link>
      </form>
    </AuthCard>
  );
}

export function AcceptInvite() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { login } = useStore();
  const token = sp.get('token') ?? '';
  const [inv, setInv] = useState<any | null>(null);
  const [state, setState] = useState<'loading' | 'invalid' | 'form' | 'existing'>('loading');
  const [f, setF] = useState({ name: '', password: '' });
  const [err, setErr] = useState('');

  useEffect(() => {
    api(`/api/invitations/${token}`)
      .then((r) => { setInv(r); setF((x) => ({ ...x, name: r.name ?? '' })); setState('form'); })
      .catch(() => setState('invalid'));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api('/api/invitations/accept', { method: 'POST', body: { token, ...(inv.existing_user ? {} : f) } });
      if (r.token) { await login(r.token); nav('/', { replace: true }); } else setState('existing');
    } catch { setErr('Имя обязательно, пароль — минимум 8 символов'); }
  };

  if (state === 'loading') return <AuthCard><p className="sub">Загрузка…</p></AuthCard>;
  if (state === 'invalid') {
    return <AuthCard subtitle="Приглашение"><p>Приглашение устарело или уже принято. Попросите администратора отправить новое.</p><Link to="/login">Ко входу</Link></AuthCard>;
  }
  if (state === 'existing') {
    return <AuthCard subtitle="Приглашение принято"><p>Вы добавлены в «{inv.company}». Войдите своим обычным паролем.</p><Link className="btn primary" to="/login">Войти</Link></AuthCard>;
  }
  return (
    <AuthCard subtitle={`Приглашение в «${inv.company}»`}>
      <form className="form" onSubmit={submit}>
        <p style={{ margin: 0 }}>Вас пригласили в Пульс CRM компании <b>«{inv.company}»</b>. Роль: {ROLE_LABELS[inv.role]?.toLowerCase()}.</p>
        <label className="field">Email<input value={inv.email} disabled /></label>
        {inv.existing_user ? (
          <p className="sub" style={{ margin: 0 }}>У вас уже есть аккаунт с этой почтой — примите приглашение и войдите своим паролем.</p>
        ) : (
          <>
            <label className="field">Ваше имя<input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field">Придумайте пароль<input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
          </>
        )}
        {err && <div className="error">{err}</div>}
        <button className="btn primary" style={{ justifyContent: 'center' }}>Принять приглашение</button>
      </form>
    </AuthCard>
  );
}
