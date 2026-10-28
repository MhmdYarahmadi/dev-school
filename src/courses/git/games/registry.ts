import type { GameMeta } from '../../../shared/course';

/** Git course games. */
export const GIT_GAMES: Record<string, GameMeta> = {
  stagemanager: { id: 'stagemanager', title: 'Stage Manager', icon: '🎭', moduleId: 'g01', pitch: 'Only the right changes go on stage. Get exactly what each mission asks for into commits: no stray files, no lost drafts, one story per commit.', skills: 'init, add, commit, -am, status, config' },
  branchrunner: { id: 'branchrunner', title: 'Branch Runner', icon: '🏃', moduleId: 'g03', pitch: 'A target commit graph appears. Branch, commit, switch and merge until your graph has the same shape, in as few commands as you can.', skills: 'branch, switch -c, merge, fast-forward, branch -d' },
  conflictdoctor: { id: 'conflictdoctor', title: 'Conflict Doctor', icon: '🩺', moduleId: 'g04', pitch: 'Merges arrive with conflicts. Read the markers, write exactly what each case calls for, and get every patient out of surgery: no markers left, merge committed.', skills: 'merge, conflict markers, add, commit, merge --abort' },
  pushpull: { id: 'pushpull', title: 'Push/Pull Race', icon: '🏁', moduleId: 'g05', pitch: 'Sam is pushing all day. Get your commits onto the hub without ever losing Sam\'s, and end in sync, before the clock runs out.', skills: 'push, pull, fetch, -u, rejected pushes, conflicts' },
};
