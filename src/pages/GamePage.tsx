import { Suspense, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { course } from '../shared/course';
import { setLast } from '../progress/store';
import { t } from '../shared/i18n';

export default function GamePage() {
  const { gameId = '' } = useParams();
  const meta = course().games[gameId];
  const Game = course().ui.games[gameId];
  useEffect(() => {
    if (meta) setLast(`/game/${gameId}`, `${meta.icon} ${meta.title}`);
  }, [gameId, meta]);
  if (!meta) return <p>{t('Unknown game.')} <Link to="/">{t('Back to the course')}</Link></p>;
  if (!Game) return <p>{meta.icon} {t('{title} is coming soon.', { title: meta.title })} <Link to={`/module/${meta.moduleId}/play`}>{t('Back')}</Link></p>;
  return (
    <Suspense key={gameId} fallback={<div className="loading">{t('Loading game…')}</div>}>
      <Game />
    </Suspense>
  );
}
