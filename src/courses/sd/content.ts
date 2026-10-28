import { commonBadges, type CourseContent } from '../../shared/course';
import { sdShortLabel } from './ui/labels';
import { SD_MODULES } from './content/index';
import { SD_GAMES } from './games/registry';

/** System Design course: data only, so the admin dashboard can import it. */
export const sdContent: CourseContent = {
  id: 'sd',
  title: 'System Design',
  brand: ['design', 'school'],
  icon: '🏗️',
  path: '/design/',
  heroTitle: 'Learn system design by building 🏗️',
  heroText:
    'Build architectures on a canvas and run them on a **simulator** in your browser: real traffic, real queueing, real failures. Every design is checked by running it against requirements, so any design that works, passes. Each module goes **Learn → Practice → Play → Test**, and three projects take you through classic interview designs.',
  modules: SD_MODULES,
  games: SD_GAMES,
  levels: [
    { xp: 0, title: 'Request Tracer' },
    { xp: 100, title: 'Napkin Mathematician' },
    { xp: 300, title: 'Load Balancer' },
    { xp: 600, title: 'Cache Keeper' },
    { xp: 1000, title: 'Replica Wrangler' },
    { xp: 1600, title: 'Shard Shaper' },
    { xp: 2400, title: 'Queue Tamer' },
    { xp: 3400, title: 'Consistency Keeper' },
    { xp: 4800, title: 'Chaos Survivor' },
    { xp: 6500, title: 'Principal Architect' },
  ],
  badges: [
    ...commonBadges(SD_MODULES),
    { id: 'Replica Wrangler', icon: '🪞', name: 'Replica Wrangler', how: 'Pass the Databases at scale test', earned: (p) => !!p.tests.s05?.passed },
    { id: 'Link Shrinker', icon: '🔗', name: 'Link Shrinker', how: 'Finish every task of Project A', earned: (p) => ['sda-1', 'sda-2', 'sda-3', 'sda-4', 'sda-5'].every((t) => p.projects[t]) },
    { id: 'Shard Shaper', icon: '🧩', name: 'Shard Shaper', how: 'Pass the Partitioning test', earned: (p) => !!p.tests.s06?.passed },
    { id: 'Queue Tamer', icon: '📬', name: 'Queue Tamer', how: 'Pass the Async & messaging test', earned: (p) => !!p.tests.s07?.passed },
    { id: 'Feed Builder', icon: '📰', name: 'Feed Builder', how: 'Finish every task of Project B', earned: (p) => ['sdb-1', 'sdb-2', 'sdb-3', 'sdb-4'].every((t) => p.projects[t]) },
    { id: 'Consistency Keeper', icon: '⚖️', name: 'Consistency Keeper', how: 'Pass the Consistency test', earned: (p) => !!p.tests.s08?.passed },
    { id: 'Chaos Survivor', icon: '🧯', name: 'Chaos Survivor', how: 'Pass the Reliability test', earned: (p) => !!p.tests.s09?.passed },
    { id: 'Sold Out', icon: '🎟️', name: 'Sold Out', how: 'Finish every task of Project C', earned: (p) => ['sdc-1', 'sdc-2', 'sdc-3', 'sdc-4'].every((t) => p.projects[t]) },
    { id: 'Principal Architect', icon: '🏛️', name: 'Principal Architect', how: 'Pass the Putting it together test', earned: (p) => !!p.tests.s10?.passed },
  ],
  kindLabels: { write: 'Design it', fillBlank: 'Fill in the blanks', fixBug: 'Fix the design', parsons: 'Put in order', readQuery: 'Read and decide' },
  itemLabel: sdShortLabel,
};
