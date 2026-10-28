import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import type { Concept, Module } from '../content/types';
import { PredictPrompt } from '../components/PredictPrompt';
import { course, h } from '../shared/course';
import { completeVariant, getProgress, markConceptSeen, recordPrediction, setLast, useProgress } from '../progress/store';
import { Stars } from './Home';
import { TestRunner } from './TestRunner';

const STAGES = [
  { id: 'learn', label: '📖 Learn' },
  { id: 'practice', label: '✍️ Practice' },
  { id: 'play', label: '🎮 Play' },
  { id: 'test', label: '📝 Test' },
] as const;

export default function ModulePage() {
  const { moduleId = '', stage = 'learn' } = useParams();
  const m = h().getModule(moduleId);
  const p = useProgress();
  if (!m) return <p>Module not found. <Link to="/">Back to the course</Link></p>;
  const unlocked = h().isUnlocked(m, p.tests);
  const { ProjectView } = course().ui;
  const base = m.games.length ? STAGES : STAGES.filter((s) => s.id !== 'play');
  const stages = m.project ? [...base, { id: 'project', label: '🧪 Project' } as const] : base;

  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <Link to="/" className="small">← Course</Link>
      </div>
      <div className="row">
        <span className="module-num">Module {m.number}</span>
        {p.tests[m.id]?.passed && <span className="tag good">✓ Complete</span>}
      </div>
      <h1 style={{ marginTop: 2 }}>{m.title}</h1>
      <nav className="tabs">
        {stages.map((s) => (
          <NavLink key={s.id} to={`/module/${m.id}/${s.id}`} className={() => (stage === s.id ? 'active' : '')}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      {!unlocked && stage !== 'test' && (
        <div className="callout warn" style={{ marginBottom: 14 }}>
          <p>
            🔒 This module unlocks when you pass the <b>Module {m.number - 1} test</b>. Already know this material?{' '}
            <Link to={`/module/${m.id}/test`}>Test out</Link> to skip ahead. You can still look around.
          </p>
        </div>
      )}
      {stage === 'learn' && <LearnTab m={m} />}
      {stage === 'practice' && <PracticeTab m={m} />}
      {stage === 'play' && m.games.length > 0 && <PlayTab m={m} />}
      {stage === 'test' && <TestRunner m={m} testOut={!unlocked} />}
      {stage === 'project' && m.project && <ProjectView project={m.project} />}
    </div>
  );
}

function LearnTab({ m }: { m: Module }) {
  const p = useProgress();
  const [idx, setIdx] = useState(() => {
    const firstUnseen = m.concepts.findIndex((c) => !p.conceptsSeen[c.id]);
    return firstUnseen === -1 ? 0 : firstUnseen;
  });
  const concept = m.concepts[Math.min(idx, m.concepts.length - 1)];
  const navigate = useNavigate();
  useEffect(() => setLast(`/module/${m.id}/learn`, `M${m.number} · ${concept.title}`), [m, concept]);

  return (
    <div className="sidebar-layout">
      <aside className="card navlist">
        {m.concepts.map((c, i) => (
          <button key={c.id} className={i === idx ? 'active' : ''} onClick={() => setIdx(i)}>
            <span className={`check ${p.conceptsSeen[c.id] ? 'on' : ''}`}>{p.conceptsSeen[c.id] ? '✓' : i + 1}</span>
            {c.title}
          </button>
        ))}
      </aside>
      <ConceptView
        key={concept.id}
        concept={concept}
        isLast={idx === m.concepts.length - 1}
        onNext={() => {
          markConceptSeen(concept.id);
          if (idx < m.concepts.length - 1) setIdx(idx + 1);
          else navigate(`/module/${m.id}/practice`);
        }}
      />
    </div>
  );
}

function ConceptView({ concept, onNext, isLast }: { concept: Concept; onNext: () => void; isLast: boolean }) {
  // Captured once on mount: answering updates progress, but the prompt must stay
  // visible so the learner sees the feedback and the real result.
  const [alreadyPredicted] = useState(() => concept.id in getProgress().predictions);
  const [predicted, setPredicted] = useState(!concept.predict || alreadyPredicted);
  const { ExampleRunner } = course().ui;

  return (
    <div className="stack">
      <div className="card md">
        <h2 style={{ marginTop: 0 }}>{concept.title}</h2>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{concept.card}</ReactMarkdown>
      </div>
      {concept.predict && !alreadyPredicted && (
        <PredictPrompt
          predict={concept.predict}
          env={concept.env}
          onAnswered={(ok) => {
            recordPrediction(concept.id, ok);
            setPredicted(true);
          }}
        />
      )}
      <div className="card stack" style={{ opacity: predicted ? 1 : 0.5 }}>
        <div className="row"><span className="tag good">Worked example</span><span className="small muted">{concept.example.note}</span></div>
        {!predicted && <span className="small muted">Make your prediction above first!</span>}
        <ExampleRunner code={concept.example.sql} disabled={!predicted} env={concept.env} />
      </div>
      <div className="row">
        <div className="grow" />
        <button className="btn primary" onClick={onNext} disabled={!predicted}>
          {isLast ? 'Got it. On to practice →' : 'Got it. Next concept →'}
        </button>
      </div>
    </div>
  );
}

function PracticeTab({ m }: { m: Module }) {
  const p = useProgress();
  const { findItem } = h();
  const { ExerciseCard } = course().ui;
  const variantIds = p.variantQueue.filter((v) => findItem(v)?.module.id === m.id);
  const list = [
    ...m.practice.map((e) => ({ id: e.id, item: e, isVariant: false })),
    ...variantIds.map((id) => ({ id, item: findItem(id)!.item, isVariant: true })),
  ];
  const [idx, setIdx] = useState(() => {
    const firstOpen = list.findIndex((x) => !p.exercises[x.id]?.done);
    return firstOpen === -1 ? 0 : firstOpen;
  });
  const cur = list[Math.min(idx, list.length - 1)];
  const done = m.practice.filter((e) => p.exercises[e.id]?.done).length;
  useEffect(() => setLast(`/module/${m.id}/practice`, `M${m.number} · Practice ${idx + 1}`), [m, idx]);
  const navigate = useNavigate();

  const variantsOf = (id: string) => {
    const it = findItem(id)?.item as { variants?: unknown[] } | undefined;
    return it?.variants?.length ?? 0;
  };

  return (
    <div className="sidebar-layout">
      <aside className="card">
        <div className="small muted" style={{ marginBottom: 6 }}>{done}/{m.practice.length} solved</div>
        <div className="progressbar" style={{ marginBottom: 10 }}><div style={{ width: `${(done / m.practice.length) * 100}%` }} /></div>
        <div className="navlist">
          {list.map((x, i) => (
            <button key={x.id} className={i === idx ? 'active' : ''} onClick={() => setIdx(i)}>
              <span className={`check ${p.exercises[x.id]?.done ? 'on' : ''}`}>{p.exercises[x.id]?.done ? '✓' : i + 1}</span>
              <span className="small">{x.isVariant ? '🔁 Try again (variant)' : (course().itemLabel?.(x.item) ?? course().kindLabels?.[x.item.kind] ?? KIND_SHORT[x.item.kind])}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="stack">
        <ExerciseCard
          key={cur.id}
          exercise={cur.item}
          progressId={cur.id}
          variantCount={cur.isVariant ? 0 : variantsOf(cur.id)}
          onDone={(correct) => {
            if (correct && cur.isVariant) completeVariant(cur.id);
          }}
        />
        <div className="row">
          <button className="btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Previous</button>
          <div className="grow" />
          {idx < list.length - 1 ? (
            <button className="btn primary" onClick={() => setIdx(idx + 1)}>Next exercise →</button>
          ) : (
            m.games.length ? (
              <button className="btn primary" onClick={() => navigate(`/module/${m.id}/play`)}>On to the game 🎮 →</button>
            ) : (
              <button className="btn primary" onClick={() => navigate(`/module/${m.id}/test`)}>On to the test 📝 →</button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

const KIND_SHORT: Record<string, string> = {
  write: 'Write a query',
  fillBlank: 'Fill in the blanks',
  fixBug: 'Fix the bug',
  parsons: 'Build the query',
  readQuery: 'Read the query',
};

function PlayTab({ m }: { m: Module }) {
  const p = useProgress();
  const practiced = m.practice.filter((e) => p.exercises[e.id]?.done).length / m.practice.length;
  return (
    <div className="stack">
      {practiced < 0.5 && (
        <div className="callout info small">
          Tip: the game is more fun once you've done some practice ({Math.round(practiced * 100)}% so far). It's open anyway, so jump in if you're curious!
        </div>
      )}
      <div className="game-grid">
        {m.games.map((g) => {
          const meta = course().games[g];
          const gp = p.games[g];
          return (
            <Link key={g} to={`/game/${g}`} className="card module-card">
              <div style={{ fontSize: '2.2rem' }}>{meta.icon}</div>
              <h3 style={{ margin: 0 }}>{meta.title}</h3>
              <div className="small">{meta.pitch}</div>
              <div className="small muted">Skills: {meta.skills}</div>
              <div className="row"><Stars n={gp?.stars ?? 0} />{gp && <span className="small muted">best {gp.bestScore} pts · played {gp.plays}×</span>}</div>
              <span className="btn primary" style={{ alignSelf: 'start' }}>{gp ? 'Play again' : 'Play'} →</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
