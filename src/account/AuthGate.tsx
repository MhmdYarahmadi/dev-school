import { useEffect, useState, type ReactNode } from 'react';
import { course } from '../shared/course';
import { t } from '../shared/i18n';
import { login, refreshFromServer, signup, useSession } from './api';

/** Everything except the admin page requires an account, so progress can be tracked. */
export function AuthGate({ children }: { children: ReactNode }) {
  const user = useSession();
  useEffect(() => {
    if (user) refreshFromServer().catch(() => undefined);
    // Only on first load / login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  if (user) return <>{children}</>;
  return <AuthScreen />;
}

function AuthScreen() {
  const c = course();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(username, password);
      else await signup(username, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = { padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', width: '100%' } as const;

  return (
    <div style={{ maxWidth: 420, margin: '40px auto' }}>
      <div className="card stack">
        <h1 style={{ margin: 0 }}>{c.brand[0]}<span style={{ color: 'var(--accent)' }}>{c.brand[1]}</span> {c.icon}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t('Log in with your Dev School account. One account works for every course.')}
        </p>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')} type="button">{t('Log in')}</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')} type="button">{t('Create account')}</button>
        </div>
        <form className="stack" onSubmit={submit}>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small">{t('Username')}</span>
            <input style={input} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={32} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small">{t('Password')}</span>
            <input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={6} />
          </label>
          {error && <div className="callout bad small">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy}>{busy ? '…' : mode === 'login' ? t('Log in') : t('Create account')}</button>
        </form>
        <div className="small muted">{t('Your progress is saved to your account, so you can continue on any device.')} <a href="/">{t('All courses')}</a></div>
      </div>
    </div>
  );
}
