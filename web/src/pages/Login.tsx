import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { ForgotForm } from './AuthPages';

const ERRORS: Record<string, string> = {
  invalid_credentials: 'Неверный email или пароль',
  email_taken: 'Этот email уже зарегистрирован',
  validation: 'Проверьте поля. Пароль — минимум 8 символов',
  session_expired: 'Пароль был изменён — войдите заново',
  signup_disabled: 'Регистрация закрыта',
};

export default function Login() {
  const { login } = useStore();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>(sp.get('mode') === 'signup' ? 'signup' : 'login');
  const [f, setF] = useState({ company: '', name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api<{ token: string }>(`/api/auth/${mode}`, { method: 'POST', body: mode === 'login' ? { email: f.email, password: f.password } : f });
      await login(r.token);
      nav(mode === 'signup' ? '/integrations' : '/');
    } catch (e: any) {
      setErr(ERRORS[e.message] ?? 'Не удалось выполнить запрос');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <div className="card">
        <div className="brand" style={{ padding: '0 0 8px' }}>
          <div className="brand-logo"><svg width="18" height="18" viewBox="0 0 32 32"><path d="M8 22V14M14 22V9M20 22v-6M26 22V12" stroke="white" strokeWidth="3.2" strokeLinecap="round" /></svg></div>
          Пульс CRM
        </div>
        <p className="sub" style={{ marginTop: 0 }}>Продажи, посещаемость и клиенты вашего бизнеса в одном месте</p>
        {mode !== 'forgot' && <div className="tabs">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Вход</button>
          <button className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>Регистрация</button>
        </div>}
        {mode === 'forgot' ? <ForgotForm onBack={() => setMode('login')} /> : (
        <form className="form" onSubmit={submit}>
          {mode === 'signup' && <>
            <label className="field">Название компании<input required value={f.company} onChange={set('company')} /></label>
            <label className="field">Ваше имя<input required value={f.name} onChange={set('name')} /></label>
          </>}
          <label className="field">Email<input type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></label>
          <label className="field">Пароль<input type="password" required minLength={mode === 'signup' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={set('password')} /></label>
          {err && <div className="error">{err}</div>}
          <button className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>{mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
          {mode === 'login' && <button type="button" className="btn" style={{ justifyContent: 'center', border: 0 }} onClick={() => setMode('forgot')}>Забыли пароль?</button>}
        </form>
        )}
      </div>
    </div>
  );
}
