import { MODULES } from '../../content';
import { GAMES } from '../../games/registry';
import { LEVELS } from '../../progress/store';
import { commonBadges, type CourseContent } from '../../shared/course';

/** PostgreSQL course: data only (no PGlite), so the admin dashboard can import it. */
export const pgContent: CourseContent = {
  id: 'pg',
  title: 'PostgreSQL',
  brand: ['pg', 'school'],
  icon: '🐘',
  path: '/pg/',
  heroTitle: 'Learn PostgreSQL by doing 🐘',
  heroText:
    'Every query you write runs on a **real PostgreSQL database** in your browser. Each module goes **Learn → Practice → Play → Test**. Predict before you run, use hints when you\'re stuck, and come back daily for review.',
  modules: MODULES,
  games: GAMES,
  levels: LEVELS,
  badges: [
    ...commonBadges(MODULES),
    { id: 'First JOIN', icon: '🌉', name: 'First JOIN', how: 'Solve a Joins exercise', earned: (p) => Object.entries(p.exercises).some(([id, e]) => e.done && id.startsWith('m06')) },
  ],
};
