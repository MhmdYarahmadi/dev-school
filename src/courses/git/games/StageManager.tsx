import ReactMarkdown from 'react-markdown';
import { GameShell } from '../../../games/kit';
import { t } from '../../../shared/i18n';
import { MissionRounds } from './MissionRounds';
import { STAGE_MANAGER } from './missions';

export default function StageManager() {
  return (
    <GameShell
      gameId="stagemanager"
      intro={
        <>
          <ReactMarkdown>{t("You're the stage manager: only the right changes go on stage (the staging area), and each commit tells one story.")}</ReactMarkdown>
          <ReactMarkdown>{t('Each mission says what belongs in the history. Get exactly that into commits before the clock runs out. Looking (`git status`, `git diff`, `git log`) and editing files is free; other git commands count against par.')}</ReactMarkdown>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={STAGE_MANAGER} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
