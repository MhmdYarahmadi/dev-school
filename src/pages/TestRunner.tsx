import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { course, h, PASS_MARK } from '../shared/course';
import type { Exercise, Module } from '../content/types';
import { recordReview, recordTest, recordTestAnswers, useProgress } from '../progress/store';

function answerText(e: Exercise): string {
  if (e.kind === 'readQuery') return e.choices[e.answer];
  if (e.kind === 'parsons') return e.blocks.join('\n');
  return e.solution;
}

export function TestRunner({ m, testOut }: { m: Module; testOut: boolean }) {
  const { ExerciseCard } = course().ui;
  const p = useProgress();
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [given, setGiven] = useState<(string | undefined)[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const items = useMemo(() => h().composeTest(m, Date.now() + attempt), [m, attempt]);
  const finished = answers.length === items.length && started;
  const score = answers.filter(Boolean).length / items.length;
  const record = p.tests[m.id];
  const next = h().modules.find((x) => x.number === m.number + 1);

  const restart = () => {
    setAttempt((a) => a + 1);
    setIdx(0);
    setAnswers([]);
    setGiven([]);
    setSubmitted(false);
    setStarted(true);
  };

  if (!started) {
    const earlier = items.filter((e) => !e.id.startsWith(m.id)).length;
    return (
      <div className="card stack" style={{ maxWidth: 720 }}>
        <h2 style={{ margin: 0 }}>{testOut ? '⏭️ Test out of' : '📝 Test:'} {m.title}</h2>
        <ul>
          <li><b>{items.length} questions</b>: {items.length - earlier} on this module{earlier > 0 && <>, {earlier} from earlier modules (to keep old skills fresh)</>}.</li>
          <li><b>No hints</b> and no "Run" button. Think it through, then submit.</li>
          <li>You need <b>{Math.round(PASS_MARK * 100)}%</b> to pass. You can retake it as often as you like, and the questions get shuffled.</li>
          {testOut && <li>Passing marks this module complete and unlocks the next one, so you can skip material you already know.</li>}
        </ul>
        {record && <div className="small muted">Best so far: {Math.round(record.best * 100)}% · {record.attempts} attempt{record.attempts === 1 ? '' : 's'}{record.passed ? ' · ✓ passed' : ''}</div>}
        <div><button className="btn primary" onClick={restart}>Start the test</button></div>
      </div>
    );
  }

  if (finished) {
    const passed = score >= PASS_MARK;
    return (
      <div className="stack" style={{ maxWidth: 860 }}>
        <div className={`card callout ${passed ? 'good' : 'warn'}`}>
          <h2 style={{ marginTop: 0 }}>{passed ? '🎉 Passed!' : 'Not quite yet'} · {Math.round(score * 100)}%</h2>
          <p>{answers.filter(Boolean).length} of {items.length} correct. {passed ? (next ? `Module ${next.number} is unlocked.` : 'You\'ve completed the course!') : `You need ${Math.round(PASS_MARK * 100)}%. The questions you missed have been added to your review deck.`}</p>
          <div className="row">
            <button className="btn" onClick={restart}>Retake test</button>
            {passed && next && <Link className="btn primary" to={`/module/${next.id}/learn`}>Start Module {next.number} →</Link>}
            {!passed && <Link className="btn primary" to={`/module/${m.id}/practice`}>Back to practice</Link>}
          </div>
        </div>
        <h3>Review your answers</h3>
        {items.map((e, i) => (
          <div key={e.id} className="card">
            <div className="row"><span className={`tag ${answers[i] ? 'good' : 'bad'}`}>{answers[i] ? '✓ correct' : '✗ wrong'}</span><span className="small muted">Question {i + 1}</span></div>
            <p style={{ margin: '6px 0' }}>{e.prompt.replace(/\*\*/g, '')}</p>
            {!answers[i] && (
              <>
                <div className="small muted">Answer:</div>
                <pre>{answerText(e)}</pre>
                <div className="small">{e.explanation}</div>
              </>
            )}
          </div>
        ))}
      </div>
    );
  }

  const cur = items[idx];
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <div className="row">
        <b>Question {idx + 1} of {items.length}</b>
        <div className="progressbar grow"><div style={{ width: `${(idx / items.length) * 100}%`, background: 'var(--accent)' }} /></div>
        {!cur.id.startsWith(m.id) && <span className="tag">from an earlier module</span>}
      </div>
      <ExerciseCard
        key={`${attempt}-${cur.id}`}
        exercise={cur}
        mode="test"
        onDone={(correct, _confidence, answer) => {
          setSubmitted(true);
          const nextGiven = [...given, answer];
          setGiven(nextGiven);
          // Test answers feed spaced review: misses come back soon.
          recordReview(cur.id, correct, correct ? 'confident' : 'unsure');
          const nextAnswers = [...answers, correct];
          if (nextAnswers.length === items.length) {
            const finalScore = nextAnswers.filter(Boolean).length / items.length;
            recordTestAnswers(m.id, finalScore, items.map((it, k) => ({ id: it.id, correct: nextAnswers[k], answer: nextGiven[k] })));
            recordTest(m.id, finalScore, PASS_MARK, testOut);
          }
          setAnswers(nextAnswers);
        }}
      />
      {submitted && answers.length < items.length && (
        <div className="row"><div className="grow" />
          <button className="btn primary" onClick={() => { setIdx(idx + 1); setSubmitted(false); }}>Next question →</button>
        </div>
      )}
    </div>
  );
}
