import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './account/AuthGate';
import { logout, useSession, useSyncState } from './account/api';
import { Toasts } from './components/Toasts';
import { levelFor, useProgress } from './progress/store';
import Home from './pages/Home';
import ModulePage from './pages/ModulePage';
import ReviewPage from './pages/ReviewPage';
import CheatSheetPage from './pages/CheatSheetPage';
import { course } from './shared/course';
import { applyUpdate, useUpdateReady } from './shared/offline';
import { hasLangSwitch, lang, setLang, t } from './shared/i18n';

const GamePage = lazy(() => import('./pages/GamePage'));

/** The admin dashboard moved to /admin/ (shared by all courses). */
function AdminRedirect() {
  useEffect(() => {
    window.location.replace('/admin/');
  }, []);
  return <div className="loading">{t('Opening the admin dashboard…')}</div>;
}

function AccountChip() {
  const user = useSession();
  const sync = useSyncState();
  if (!user) return null;
  const label = { idle: '', saving: t('⏳ saving…'), saved: t('☁️ saved'), offline: t('📴 offline · saved on this device') }[sync];
  return (
    <div className="row small" style={{ gap: 6 }}>
      {label && <span className="muted" title={t('Progress is saved to your account')}>{label}</span>}
      <span>👤 <b>{user.username}</b></span>
      <button className="btn ghost small" onClick={() => logout()}>{t('Log out')}</button>
    </div>
  );
}

/** A new version was downloaded in the background (see shared/offline.ts). */
function UpdateBanner() {
  if (!useUpdateReady()) return null;
  return (
    <div className="callout row small" role="status">
      <span>{t('✨ A new version of the course is ready.')}</span>
      <button className="btn small" onClick={applyUpdate}>{t('Reload')}</button>
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('pgschool-theme') ?? 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('pgschool-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const next = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
  const icon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️';
  return (
    <button className="btn ghost small" onClick={() => setTheme(next)} title={`Theme: ${theme} (click for ${next})`}>
      {icon}
    </button>
  );
}

/** EN / فا, on courses that have a translation (the Git course). */
function LangSwitch() {
  if (!hasLangSwitch()) return null;
  const fa = lang() === 'fa';
  return (
    <button className="btn ghost small" onClick={() => setLang(fa ? 'en' : 'fa')} title={fa ? 'English' : 'فارسی'} lang={fa ? 'en' : 'fa'}>
      {fa ? 'EN' : 'فا'}
    </button>
  );
}

export default function App() {
  const c = course();
  const p = useProgress();
  const lvl = levelFor(p.xp, c.levels);
  const location = useLocation();
  if (location.pathname.startsWith('/admin')) return <AdminRedirect />;
  return (
    <AuthGate>
      <header className="topbar">
        <a href="/" className="brand" title={t('All courses')}>{c.brand[0]}<span>{c.brand[1]}</span></a>
        <nav className="topnav">
          <NavLink to="/" end>{t('Course')}</NavLink>
          <NavLink to="/review">{t('Review')}</NavLink>
          <NavLink to="/cheatsheet">{t('Cheat sheet')}</NavLink>
          {c.ui.extraPages?.map((x) => <NavLink key={x.path} to={x.path}>{t(x.label)}</NavLink>)}
        </nav>
        <div className="spacer" />
        <div className="xpchip" title={lvl.next ? t('{n} XP to {level}', { n: lvl.next.xp - p.xp, level: lvl.next.title }) : t('Max level!')}>
          {p.streak.count > 1 && <span>🔥 {p.streak.count}</span>}
          <span>{t('Lv {n}', { n: lvl.level })} · <b style={{ color: 'var(--text)' }}>{lvl.title}</b></span>
          <div className="xpbar"><div style={{ width: `${lvl.progress * 100}%` }} /></div>
          <span>{p.xp} XP</span>
        </div>
        <AccountChip />
        <LangSwitch />
        <ThemeToggle />
      </header>
      <main className="page">
        <UpdateBanner />
        <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<div className="loading">{t('Loading…')}</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/module/:moduleId" element={<ModulePage />} />
            <Route path="/module/:moduleId/:stage" element={<ModulePage />} />
            <Route path="/game/:gameId" element={<GamePage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/cheatsheet" element={<CheatSheetPage />} />
            {c.ui.extraPages?.map((x) => <Route key={x.path} path={x.path} element={<x.Component />} />)}
            <Route path="*" element={<p>{t('Page not found.')} <NavLink to="/">{t('Go home')}</NavLink></p>} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      <Toasts />
    </AuthGate>
  );
}
