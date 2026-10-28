import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../account/api';
import { answersOf, plainPrompt, progressOf, struggleSpots, summarize, timeAgo, type AdminUser } from '../admin/analytics';
import { COURSES } from '../shared/courses';
import type { CourseContent } from '../shared/course';

const ADMIN_KEY = 'pgschool-admin-token';

function useAdminToken() {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ADMIN_KEY);
    } catch {
      return null;
    }
  });
  const save = (t: string | null) => {
    try {
      if (t) sessionStorage.setItem(ADMIN_KEY, t);
      else sessionStorage.removeItem(ADMIN_KEY);
    } catch {
      /* ignore */
    }
    setToken(t);
  };
  return [token, save] as const;
}

export default function AdminPage() {
  const [token, setToken] = useAdminToken();
  if (!token) return <AdminLogin onToken={setToken} />;
  return <Dashboard token={token} onLogout={() => setToken(null)} />;
}

function AdminLogin({ onToken }: { onToken: (t: string) => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card stack"
      style={{ maxWidth: 380, margin: '40px auto' }}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await api<{ token: string }>('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
          onToken(r.token);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h2 style={{ margin: 0 }}>🔐 Admin</h2>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Admin password" autoComplete="current-password"
        style={{ padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit' }} />
      {error && <div className="callout bad small">{error}</div>}
      <button className="btn primary" type="submit">Enter dashboard</button>
    </form>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'learners' | 'struggles'>('learners');
  const [courseId, setCourseId] = useState<string>('all');
  const c = COURSES.find((x) => x.id === courseId) ?? null;
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api<{ users: AdminUser[] }>('/api/admin/users', { admin: token });
      setUsers(r.users);
      setError(null);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401) onLogout();
      setError(err.message);
    }
  }, [token, onLogout]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const summaries = useMemo(() => (c ? (users ?? []).map((u) => summarize(u, c)) : []), [users, c]);
  const struggles = useMemo(() => (c ? struggleSpots(users ?? [], c) : []), [users, c]);
  const sel = users?.find((u) => u.id === selected) ?? null;

  if (error && !users) return <div className="callout bad">{error}</div>;
  if (!users) return <div className="loading">Loading learners…</div>;

  const active7 = users.filter((u) => Date.now() - u.lastActive < 7 * 86400000).length;
  const allSummaries = COURSES.map((co) => ({ co, rows: users.map((u) => summarize(u, co)) }));

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>📊 Learner dashboard</h1>
        <div className="grow" />
        <button className="btn small" onClick={load}>↻ Refresh</button>
        <button className="btn small ghost" onClick={onLogout}>Log out</button>
      </div>
      <div className="row" style={{ gap: 14 }}>
        <div className="card"><div className="muted small">Learners</div><div className="stat">{users.length}</div></div>
        <div className="card"><div className="muted small">Active in the last 7 days</div><div className="stat">{active7}</div></div>
        {allSummaries.map(({ co, rows }) => (
          <div key={co.id} className="card">
            <div className="muted small">{co.icon} {co.title}: started / modules passed</div>
            <div className="stat">{rows.filter((r) => r.started).length} / {rows.reduce((s, x) => s + x.modulesPassed, 0)}</div>
          </div>
        ))}
      </div>

      <nav className="tabs">
        <button className={courseId === 'all' ? 'active' : ''} onClick={() => { setCourseId('all'); setSelected(null); }}>🏫 All courses</button>
        {COURSES.map((co) => (
          <button key={co.id} className={courseId === co.id ? 'active' : ''} onClick={() => { setCourseId(co.id); setSelected(null); }}>{co.icon} {co.title}</button>
        ))}
      </nav>

      {!c && <AllCourses users={users} filter={filter} setFilter={setFilter} />}

      {c && (
        <nav className="tabs" style={{ marginTop: -8 }}>
          <button className={tab === 'learners' ? 'active' : ''} onClick={() => setTab('learners')}>👩‍🎓 Learners</button>
          <button className={tab === 'struggles' ? 'active' : ''} onClick={() => setTab('struggles')}>🧗 Struggle spots</button>
        </nav>
      )}

      {c && tab === 'learners' && (
        <>
          <input type="search" placeholder="Filter by username…" value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', maxWidth: 280 }} />
          <div className="table-scroll" style={{ maxHeight: 'none' }}>
            <table className="results" style={{ fontFamily: 'var(--sans)' }}>
              <thead>
                <tr>
                  <th>Learner</th><th>Level</th><th>XP</th><th>Now on</th><th>Modules passed</th><th>Exercises</th><th>⭐</th><th>🔥</th><th>Struggles</th><th>Last active</th><th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {summaries.filter((s) => s.user.username.toLowerCase().includes(filter.toLowerCase())).map((s) => (
                  <tr key={s.user.id} onClick={() => setSelected(s.user.id === selected ? null : s.user.id)} style={{ cursor: 'pointer' }} className={s.user.id === selected ? 'matched' : ''}>
                    <td><b>{s.user.username}</b></td>
                    <td>{s.level} · {s.levelTitle}</td>
                    <td className="num">{s.xp}</td>
                    <td>{!s.started ? <span className="muted">not started</span> : s.currentModule ? `M${s.currentModule.number} ${s.currentModule.title}` : '🎓 finished'}</td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <div className="progressbar" style={{ width: 70 }}><div style={{ width: `${(s.modulesPassed / c.modules.length) * 100}%` }} /></div>
                        {s.modulesPassed}/{c.modules.length}
                      </div>
                    </td>
                    <td className="num">{s.solved}/{s.totalPractice}</td>
                    <td className="num">{s.stars}</td>
                    <td className="num">{s.streak}</td>
                    <td className="num">{s.struggles}</td>
                    <td>{timeAgo(s.user.lastActive)}</td>
                    <td>{new Date(s.user.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan={11} className="muted">No learners yet. Share the link!</td></tr>}
              </tbody>
            </table>
          </div>
          {sel && <LearnerDetail user={sel} course={c} token={token} onChanged={load} onClose={() => setSelected(null)} />}
          {!sel && users.length > 0 && <div className="small muted">Click a learner to see their progress and every answer they wrote.</div>}
        </>
      )}

      {c && tab === 'struggles' && (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            Exercises ranked by difficulty across all learners. The score is failed attempts + 3 × solutions revealed + 2 × test misses + hints used. The top rows are the topics worth re-teaching.
          </p>
          <div className="table-scroll" style={{ maxHeight: 'none' }}>
            <table className="results" style={{ fontFamily: 'var(--sans)' }}>
              <thead>
                <tr><th>#</th><th>Module</th><th>Exercise</th><th>Tried</th><th>Solved</th><th>Failed tries</th><th>Saw solution</th><th>Avg hints</th><th>Test misses</th><th>Score</th></tr>
              </thead>
              <tbody>
                {struggles.slice(0, 50).map((r, i) => (
                  <tr key={r.id}>
                    <td className="rownum">{i + 1}</td>
                    <td>M{r.module.number}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 280 }}>
                      <span className="tag" style={{ marginRight: 6 }}>{r.item.kind}</span>
                      {plainPrompt(r.item.prompt).slice(0, 140)}
                    </td>
                    <td className="num">{r.learners}</td>
                    <td className="num">{r.solved}</td>
                    <td className="num">{r.failedAttempts}</td>
                    <td className="num">{r.sawSolution}</td>
                    <td className="num">{r.avgHints.toFixed(1)}</td>
                    <td className="num">{r.testMisses}</td>
                    <td className="num"><b>{r.score}</b></td>
                  </tr>
                ))}
                {struggles.length === 0 && <tr><td colSpan={10} className="muted">No attempts recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function LearnerDetail({ user, course: c, token, onChanged, onClose }: { user: AdminUser; course: CourseContent; token: string; onChanged: () => void; onClose: () => void }) {
  const p = progressOf(user, c.id);
  const { practice, tests, projects } = answersOf(user, c);
  const hasProjects = MODULES_HAVE_PROJECT(c);
  const MODULES = c.modules;
  const [showPw, setShowPw] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [onlyMod, setOnlyMod] = useState<string>('all');

  const resetPw = async () => {
    try {
      await api(`/api/admin/users/${user.id}/password`, { method: 'POST', admin: token, body: JSON.stringify({ password: newPw }) });
      setMsg(`Password changed. ${user.username} has been logged out everywhere.`);
      setNewPw('');
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const del = async () => {
    await api(`/api/admin/users/${user.id}`, { method: 'DELETE', admin: token });
    onClose();
    onChanged();
  };

  return (
    <div className="card stack" style={{ borderColor: 'var(--accent)' }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>{user.username} <span className="muted small">· {c.icon} {c.title}</span></h2>
        <span className="tag accent">{p.xp} XP</span>
        <span className="small muted">last active {timeAgo(user.lastActive)}</span>
        <div className="grow" />
        <button className="btn small ghost" onClick={onClose}>Close</button>
      </div>

      <div className="row small">
        <span>Password: <code>{showPw ? user.password : '••••••••'}</code></span>
        <button className="btn small ghost" onClick={() => setShowPw(!showPw)}>{showPw ? 'Hide' : 'Show'}</button>
        <input value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="new password (6+ chars)"
          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit' }} />
        <button className="btn small" disabled={newPw.length < 6} onClick={resetPw}>Set password</button>
        {!confirmDelete ? (
          <button className="btn small ghost" onClick={() => setConfirmDelete(true)}>Delete account…</button>
        ) : (
          <span className="row small">Delete {user.username} and all their progress? <button className="btn small" onClick={del}>Yes, delete</button><button className="btn small ghost" onClick={() => setConfirmDelete(false)}>Cancel</button></span>
        )}
      </div>
      {msg && <div className="callout info small">{msg}</div>}

      <h3 style={{ marginBottom: 0 }}>Progress by module</h3>
      <div className="table-scroll" style={{ maxHeight: 'none' }}>
        <table className="results" style={{ fontFamily: 'var(--sans)' }}>
          <thead><tr><th>Module</th><th>Concepts seen</th><th>Practice solved</th><th>Test (best)</th><th>Game stars</th>{hasProjects && <th>Project</th>}</tr></thead>
          <tbody>
            {MODULES.map((m) => (
              <tr key={m.id}>
                <td>M{m.number} {m.title}</td>
                <td className="num">{m.concepts.filter((c) => p.conceptsSeen[c.id]).length}/{m.concepts.length}</td>
                <td className="num">{m.practice.filter((e) => p.exercises[e.id]?.done).length}/{m.practice.length}</td>
                <td>{p.tests[m.id] ? `${Math.round(p.tests[m.id].best * 100)}% ${p.tests[m.id].passed ? '✅' : '❌'} (${p.tests[m.id].attempts}×)${p.tests[m.id].testedOut ? ' tested out' : ''}` : '–'}</td>
                <td>{m.games.map((g) => `${c.games[g]?.icon ?? '🎮'}${'★'.repeat(p.games[g]?.stars ?? 0) || '–'}`).join('  ') || '–'}</td>
                {hasProjects && <td>{m.project ? `${m.project.tasks.filter((t) => p.projects[t.id]).length}/${m.project.tasks.length} tasks` : ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row">
        <h3 style={{ margin: 0 }}>Answers</h3>
        <select value={onlyMod} onChange={(e) => setOnlyMod(e.target.value)} style={{ padding: 4, borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
          <option value="all">All modules</option>
          {MODULES.map((m) => <option key={m.id} value={m.id}>M{m.number} {m.title}</option>)}
        </select>
      </div>

      <h4 style={{ margin: '4px 0' }}>Practice (latest answer per exercise)</h4>
      {practice.filter((a) => onlyMod === 'all' || a.module.id === onlyMod).length === 0 && <div className="small muted">No practice answers yet.</div>}
      {practice.filter((a) => onlyMod === 'all' || a.module.id === onlyMod).map((a) => (
        <div key={a.id} className="callout small" style={{ borderColor: 'var(--border)' }}>
          <div className="row">
            <span className={`tag ${a.done ? 'good' : 'bad'}`}>{a.done ? '✓ solved' : '✗ not solved'}</span>
            <span className="tag">M{a.module.number} · {a.item.kind}</span>
            <span className="muted">{a.attempts} tr{a.attempts === 1 ? 'y' : 'ies'} · {a.hintsUsed} hint{a.hintsUsed === 1 ? '' : 's'}{a.sawSolution ? ' · saw solution' : ''}</span>
          </div>
          <div style={{ margin: '4px 0' }}>{plainPrompt(a.item.prompt)}</div>
          {a.lastSql ? <pre style={{ margin: 0 }}>{withUnit(a.lastSql, a.item.sd)}</pre> : <span className="muted">(multiple choice, nothing written)</span>}
        </div>
      ))}

      {hasProjects && (
        <>
          <h4 style={{ margin: '8px 0 4px' }}>Projects (latest checked answer per task)</h4>
          {projects.filter((t) => (onlyMod === 'all' || t.module.id === onlyMod) && t.answer !== undefined).length === 0 && <div className="small muted">No project answers yet.</div>}
          {projects.filter((t) => (onlyMod === 'all' || t.module.id === onlyMod) && t.answer !== undefined).map((t) => (
            <div key={t.task.id} className="callout small" style={{ borderColor: 'var(--border)' }}>
              <div className="row">
                <span className={`tag ${t.done ? 'good' : 'bad'}`}>{t.done ? '✓ done' : '✗ not done yet'}</span>
                <span className="tag">M{t.module.number} · {t.project.title} · task {t.n}</span>
                <span className="muted">checked {t.checks}× · last {t.at ? timeAgo(t.at) : '?'}{t.done && !t.ok ? ' · latest check failed' : ''}</span>
              </div>
              <div style={{ margin: '4px 0' }}>{plainPrompt(t.task.prompt).slice(0, 300)}</div>
              <pre style={{ margin: 0 }}>{withUnit(t.answer, t.task.sd)}</pre>
            </div>
          ))}
        </>
      )}

      <h4 style={{ margin: '8px 0 4px' }}>Tests (latest attempt per module)</h4>
      {tests.filter((t) => onlyMod === 'all' || t.module?.id === onlyMod).length === 0 && <div className="small muted">No tests taken yet.</div>}
      {tests.filter((t) => onlyMod === 'all' || t.module?.id === onlyMod).map((t) => (
        <details key={t.module?.id} className="callout small" style={{ borderColor: 'var(--border)' }}>
          <summary><b>M{t.module?.number} {t.module?.title}</b>: {Math.round(t.score * 100)}% · {new Date(t.at).toLocaleString()}</summary>
          {t.items.map((x, i) => (
            <Fragment key={i}>
              <div className="row" style={{ marginTop: 6 }}>
                <span className={`tag ${x.correct ? 'good' : 'bad'}`}>{x.correct ? '✓' : '✗'}</span>
                <span>{x.item ? plainPrompt(x.item.prompt) : x.id}</span>
              </div>
              {x.answer ? <pre style={{ margin: '4px 0' }}>{withUnit(x.answer, x.item?.sd)}</pre> : <div className="muted">(no answer)</div>}
            </Fragment>
          ))}
        </details>
      ))}
    </div>
  );
}

const MODULES_HAVE_PROJECT = (c: CourseContent) => c.modules.some((m) => m.project);

/** One row per learner, one column group per course. */
function AllCourses({ users, filter, setFilter }: { users: AdminUser[]; filter: string; setFilter: (v: string) => void }) {
  return (
    <>
      <input type="search" placeholder="Filter by username…" value={filter} onChange={(e) => setFilter(e.target.value)}
        style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', maxWidth: 280 }} />
      <div className="table-scroll" style={{ maxHeight: 'none' }}>
        <table className="results" style={{ fontFamily: 'var(--sans)' }}>
          <thead>
            <tr>
              <th>Learner</th>
              {COURSES.map((co) => <th key={co.id}>{co.icon} {co.title}</th>)}
              <th>Last active</th><th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.filter((u) => u.username.toLowerCase().includes(filter.toLowerCase())).map((u) => (
              <tr key={u.id}>
                <td><b>{u.username}</b></td>
                {COURSES.map((co) => {
                  const s = summarize(u, co);
                  return (
                    <td key={co.id}>
                      {s.started ? `Lv ${s.level} · ${s.xp} XP · ${s.modulesPassed}/${co.modules.length} modules` : <span className="muted">not started</span>}
                    </td>
                  );
                })}
                <td>{timeAgo(u.lastActive)}</td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={COURSES.length + 3} className="muted">No learners yet. Share the link!</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="small muted">Pick a course above for per-learner details, answers and struggle spots.</div>
    </>
  );
}

/** System Design estimates are stored as a bare number; show it with its unit. */
function withUnit(answer: string | undefined, sd?: { target: string; unit?: string }): string | undefined {
  return answer && sd?.target === 'estimate' && sd.unit ? `${answer} ${sd.unit}` : answer;
}
