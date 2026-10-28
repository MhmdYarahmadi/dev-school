import { commonBadges, type CourseContent } from '../../shared/course';
import { mark } from '../../shared/i18n';
import { GIT_MODULES } from './content/index';
import { GIT_GAMES } from './games/registry';

/** Git course: data only, so the admin dashboard can import it. */
export const gitContent: CourseContent = {
  id: 'git',
  title: 'Git',
  brand: ['git', 'school'],
  icon: '🌳',
  path: '/git/',
  heroTitle: 'Learn Git by doing 🌳',
  heroText:
    'Every command you type runs on a **simulated computer** in your browser that behaves like real Git (its output and commit hashes match Git 2.53). A **live graph** draws your history as it grows, and a shared **hub** lets you work with a teammate: push, pull, pull requests and all. Nothing to install and nothing to break. Each module goes **Learn → Practice → Play → Test**.',
  modules: GIT_MODULES,
  games: GIT_GAMES,
  levels: [
    { xp: 0, title: 'First Commit' },
    { xp: 100, title: 'Stager' },
    { xp: 300, title: 'History Reader' },
    { xp: 600, title: 'Branch Builder' },
    { xp: 1000, title: 'Conflict Solver' },
    { xp: 1600, title: 'Remote Operator' },
    { xp: 2400, title: 'Team Player' },
  ],
  badges: [
    ...commonBadges(GIT_MODULES),
    { id: 'First Commit', icon: '🌱', name: mark('First Commit'), how: mark('Solve your first Git exercise'), earned: (p) => Object.entries(p.exercises).some(([id, e]) => e.done && id.startsWith('g01')) },
  ],
  kindLabels: { write: 'In the terminal', fillBlank: 'Fill in the blanks', fixBug: 'Fix the commands', parsons: 'Put in order', readQuery: 'Read and decide' },
};
