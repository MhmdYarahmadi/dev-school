import ReactMarkdown from 'react-markdown';
import { GameShell } from '../../../games/kit';
import { t } from '../../../shared/i18n';
import { MissionRounds } from './MissionRounds';
import { CONFLICT_DOCTOR } from './missions';

export default function ConflictDoctor() {
  return (
    <GameShell
      gameId="conflictdoctor"
      intro={
        <>
          <ReactMarkdown>{t('Every patient is a merge with a conflict. Each case says what the final files must say: read the markers, write exactly that, and finish the merge.')}</ReactMarkdown>
          <ReactMarkdown>{t("Edit files in the ✏️ Files tab (or with `echo`/`printf`). Looking and editing is free; git commands count against par. A merge isn't healed until it's committed with no markers left.")}</ReactMarkdown>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={CONFLICT_DOCTOR} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
