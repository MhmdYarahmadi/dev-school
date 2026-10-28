import { commonBadges, type CourseContent } from '../../shared/course';
import { DOCKER_MODULES } from './content/index';
import { DOCKER_GAMES } from './games/registry';

/** Docker course: data only, so the admin dashboard can import it. */
export const dockerContent: CourseContent = {
  id: 'docker',
  title: 'Docker',
  brand: ['docker', 'school'],
  icon: '🐳',
  path: '/docker/',
  heroTitle: 'Learn Docker by doing 🐳',
  heroText:
    'Every command you type runs on a **simulated Docker machine** in your browser, calibrated against real Docker 29. Nothing to install and nothing to break. Each module goes **Learn → Practice → Play → Test**. Predict before you run, use hints when you\'re stuck, and come back daily for review.',
  modules: DOCKER_MODULES,
  games: DOCKER_GAMES,
  levels: [
    { xp: 0, title: 'Deckhand' },
    { xp: 100, title: 'Image Puller' },
    { xp: 300, title: 'Container Wrangler' },
    { xp: 600, title: 'Port Pilot' },
    { xp: 1000, title: 'Volume Keeper' },
    { xp: 1600, title: 'Network Navigator' },
    { xp: 2400, title: 'Dockerfile Chef' },
    { xp: 3400, title: 'Compose Captain' },
    { xp: 4800, title: 'Container Admiral' },
  ],
  badges: [
    ...commonBadges(DOCKER_MODULES),
    { id: 'First Container', icon: '📦', name: 'First Container', how: 'Solve your first Docker exercise', earned: (p) => Object.entries(p.exercises).some(([id, e]) => e.done && id.startsWith('d01')) },
    { id: 'Port Master', icon: '🚦', name: 'Port Master', how: 'Pass the Ports test', earned: (p) => !!p.tests.d03?.passed },
    { id: 'Data Keeper', icon: '🛟', name: 'Data Keeper', how: 'Pass the Data test', earned: (p) => !!p.tests.d04?.passed },
    { id: 'Switchboard Operator', icon: '🔌', name: 'Switchboard Operator', how: 'Pass the Networks test', earned: (p) => !!p.tests.d05?.passed },
    { id: 'Image Chef', icon: '👩‍🍳', name: 'Image Chef', how: 'Pass the Dockerfile basics test', earned: (p) => !!p.tests.d06?.passed },
    { id: 'Shop Builder', icon: '🏪', name: 'Shop Builder', how: 'Finish every task of Project A', earned: (p) => ['dpa-1', 'dpa-2', 'dpa-3', 'dpa-4', 'dpa-5'].every((t) => p.projects[t]) },
    { id: 'Lean Machine', icon: '🥗', name: 'Lean Machine', how: 'Pass the Better images test', earned: (p) => !!p.tests.d07?.passed },
    { id: 'Compose Captain', icon: '📐', name: 'Compose Captain', how: 'Pass the Docker Compose test', earned: (p) => !!p.tests.d08?.passed },
    { id: 'On Call', icon: '🧯', name: 'On Call', how: 'Pass the Production & troubleshooting test', earned: (p) => !!p.tests.d09?.passed },
    { id: 'Shipped It', icon: '🚢', name: 'Shipped It', how: 'Finish every task of Project B', earned: (p) => ['dpb-1', 'dpb-2', 'dpb-3', 'dpb-4'].every((t) => p.projects[t]) },
  ],
  kindLabels: { write: 'Write it', fillBlank: 'Fill in the blanks', fixBug: 'Fix the bug', parsons: 'Put in order', readQuery: 'Read and decide' },
};
