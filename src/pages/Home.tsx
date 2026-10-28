import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { course, h } from '../shared/course';
import { dueCards } from '../pedagogy/review';
import { exportProgress, importProgress, levelFor, resetProgress, useProgress, type Progress } from '../progress/store';
import type { Module } from '../content/types';
import { t } from '../shared/i18n';

export function Stars({ n, max = 3 }: { n: number; max?: number }) {
  return (
    <span className="stars" aria-label={t('{n} of {max} stars', { n, max })}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < n ? '' : 'off'}>★</span>
      ))}
    </span>
  );
}

export function moduleProgress(m: Module, p: Progress) {
  const learn = m.concepts.filter((c) => p.conceptsSeen[c.id]).length / m.concepts.length;
  const practice = m.practice.filter((e) => p.exercises[e.id]?.done).length / m.practice.length;
  const stars = m.games.reduce((s, g) => s + (p.games[g]?.stars ?? 0), 0);
  const test = p.tests[m.id]?.passed ? 1 : 0;
  // some modules have no game: they count Learn, Practice and Test only
  if (!m.games.length) return { learn, practice, play: 1, test, stars, overall: (learn + practice + test) / 3 };
  const play = stars / (m.games.length * 3);
  return { learn, practice, play, test, stars, overall: (learn + practice + play + test) / 4 };
}

export default function Home() {
  const p = useProgress();
  const c = course();
  const MODULES = c.modules;
  const { isUnlocked } = h();
  const lvl = levelFor(p.xp, c.levels);
  const due = dueCards(Object.values(p.review)).length + p.variantQueue.length;
  const [ioMsg, setIoMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [exported, setExported] = useState<string | null>(null);

  const nextModule = MODULES.find((m) => isUnlocked(m, p.tests) && !p.tests[m.id]?.passed) ?? MODULES[0];

  return (
    <div>
      <div className="hero">
        <div className="card stack">
          <h1 style={{ margin: 0 }}>{c.heroTitle}</h1>
          <div className="muted md"><ReactMarkdown>{c.heroText}</ReactMarkdown></div>
          <div className="row">
            {p.last ? (
              <Link className="btn primary" to={p.last.path}>{t('▶ Continue: {label}', { label: p.last.label })}</Link>
            ) : (
              <Link className="btn primary" to={`/module/${nextModule.id}/learn`}>{t('▶ Start Module {n}', { n: nextModule.number })}</Link>
            )}
            {due > 0 && <Link className="btn" to="/review">{due === 1 ? t('🧠 1 review item due') : t('🧠 {n} review items due', { n: due })}</Link>}
          </div>
        </div>
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><div className="muted small">{t('Level {n}', { n: lvl.level })}</div><div className="stat">{lvl.title}</div></div>
            <div style={{ textAlign: 'end' }}><div className="muted small">XP</div><div className="stat">{p.xp}</div></div>
            <div style={{ textAlign: 'end' }}><div className="muted small">{t('Streak')}</div><div className="stat">🔥 {p.streak.count}</div></div>
          </div>
          <div className="progressbar" style={{ margin: '10px 0 4px' }}><div style={{ width: `${lvl.progress * 100}%`, background: 'var(--accent)' }} /></div>
          <div className="small muted">{lvl.next ? t('{n} XP to {level}', { n: lvl.next.xp - p.xp, level: lvl.next.title }) : t('Maximum level reached!')}</div>
          <div className="row" style={{ marginTop: 10, gap: 6 }}>
            {c.badges.map((b) => (
              <span key={b.id} title={`${t(b.name)}: ${t(b.how)}`} style={{ fontSize: '1.3rem', opacity: p.badges[b.id] ? 1 : 0.2, filter: p.badges[b.id] ? 'none' : 'grayscale(1)' }}>
                {b.icon}
              </span>
            ))}
          </div>
        </div>
      </div>

      <h2>{t('Course map')}</h2>
      <div className="module-grid">
        {MODULES.map((m) => {
          const unlocked = isUnlocked(m, p.tests);
          const mp = moduleProgress(m, p);
          return (
            <Link key={m.id} to={`/module/${m.id}/learn`} className={`card module-card ${unlocked ? '' : 'locked'}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="module-num">{t('Module {n}', { n: m.number })}</span>
                {p.tests[m.id]?.passed ? <span className="tag good">{t('✓ Complete')}</span> : unlocked ? null : <span className="tag">{t('🔒 Locked')}</span>}
              </div>
              <h3 style={{ margin: 0 }}>{m.title}</h3>
              <div className="small muted">{m.tagline}</div>
              <div className="stages">
                <span className={`stage-pill ${mp.learn === 1 ? 'done' : ''}`}>{t('Learn {n}%', { n: Math.round(mp.learn * 100) })}</span>
                <span className={`stage-pill ${mp.practice === 1 ? 'done' : ''}`}>{t('Practice {n}%', { n: Math.round(mp.practice * 100) })}</span>
                {m.games.length > 0 && <span className="stage-pill">{t('Play')} <Stars n={mp.stars} max={m.games.length * 3} /></span>}
                <span className={`stage-pill ${mp.test ? 'done' : ''}`}>{t('Test')} {p.tests[m.id] ? `${Math.round(p.tests[m.id].best * 100)}%` : '—'}</span>
              </div>
              <div className="progressbar"><div style={{ width: `${mp.overall * 100}%` }} /></div>
              {m.games.length > 0 && <div className="small muted">🎮 {m.games.map((g) => c.games[g]?.title ?? g).join(' + ')}</div>}
            </Link>
          );
        })}
      </div>

      <details className="card" style={{ marginTop: 24 }}>
        <summary><b>{t('Your progress data')}</b> <span className="small muted">{t('(saved in this browser only)')}</span></summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="row">
            <button
              className="btn small"
              onClick={() => {
                const json = exportProgress();
                setExported(json);
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
                a.download = `pgschool-progress-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              {t('Export…')}
            </button>
            <button className="btn small" onClick={() => fileRef.current?.click()}>{t('Import from file…')}</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  importProgress(await f.text());
                  setIoMsg(t('Progress imported.'));
                } catch (err) {
                  setIoMsg(String((err as Error).message));
                }
              }}
            />
            {!confirmReset ? (
              <button className="btn small ghost" onClick={() => setConfirmReset(true)}>{t('Reset all progress…')}</button>
            ) : (
              <span className="row small">
                {t('Really erase everything?')}
                <button className="btn small" onClick={() => { resetProgress(); setConfirmReset(false); setIoMsg(t('Progress reset.')); }}>{t('Yes, erase')}</button>
                <button className="btn small ghost" onClick={() => setConfirmReset(false)}>{t('Cancel')}</button>
              </span>
            )}
          </div>
          {ioMsg && <div className="small">{ioMsg}</div>}
          {exported && (
            <div className="stack" style={{ gap: 4 }}>
              <div className="small muted">{t('Copy this text and save it as a .json file to back up your progress:')}</div>
              <textarea readOnly value={exported} rows={6} className="mono small" style={{ width: '100%' }} onFocus={(e) => e.target.select()} />
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
