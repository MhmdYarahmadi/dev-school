import { Suspense, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { course } from '../shared/course';
import { setLast } from '../progress/store';

export default function GamePage() {
  const { gameId = '' } = useParams();
  const meta = course().games[gameId];
  const Game = course().ui.games[gameId];
  useEffect(() => {
    if (meta) setLast(`/game/${gameId}`, `${meta.icon} ${meta.title}`);
  }, [gameId, meta]);
  if (!meta) return <p>Unknown game. <Link to="/">Back to the course</Link></p>;
  if (!Game) return <p>{meta.icon} {meta.title} is coming soon. <Link to={`/module/${meta.moduleId}/play`}>Back</Link></p>;
  return (
    <Suspense key={gameId} fallback={<div className="loading">Loading game…</div>}>
      <Game />
    </Suspense>
  );
}
