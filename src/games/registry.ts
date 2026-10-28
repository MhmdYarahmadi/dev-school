import type { GameMeta } from '../shared/course';

export type { GameMeta };

/** PostgreSQL course games. */
export const GAMES: Record<string, GameMeta> = {
  snapshot: { id: 'snapshot', title: 'Snapshot', icon: '📸', moduleId: 'm01', pitch: 'A result grid flashes up. Reproduce it exactly with a SELECT before the clock runs out.', skills: 'SELECT, aliases, DISTINCT' },
  lineup: { id: 'lineup', title: 'Suspect Lineup', icon: '🕵️', moduleId: 'm02', pitch: 'Witness clues arrive one by one. Your WHERE clause knocks suspects out of the lineup live. Find the culprit.', skills: 'WHERE, AND/OR, IN, LIKE, NULL' },
  podium: { id: 'podium', title: 'Podium Rush', icon: '🏆', moduleId: 'm03', pitch: 'Shuffled rows slide into place according to your ORDER BY. Match the target leaderboard.', skills: 'ORDER BY, LIMIT, OFFSET' },
  forge: { id: 'forge', title: 'Formula Forge', icon: '⚒️', moduleId: 'm04', pitch: 'Raw values on the left, the wanted output on the right. Forge the expression that turns one into the other.', skills: 'functions, CASE, COALESCE, casts' },
  warehouse: { id: 'warehouse', title: 'Warehouse Sort', icon: '📦', moduleId: 'm05', pitch: 'Rows fly into buckets by your GROUP BY. Match the target chart, and use HAVING to clear buckets.', skills: 'GROUP BY, aggregates, HAVING' },
  bridge: { id: 'bridge', title: 'Bridge Builder', icon: '🌉', moduleId: 'm06', pitch: 'Two tables on opposite banks. Your JOIN builds bridges between matching rows. Leave nobody stranded.', skills: 'INNER / LEFT / FULL JOIN' },
  casefiles: { id: 'casefiles', title: 'Case Files', icon: '🗂️', moduleId: 'm07', pitch: 'A multi-step mystery: each clue is a query that feeds the next. Name the culprit.', skills: 'subqueries, CTEs, recursion' },
  doctor: { id: 'doctor', title: 'Data Doctor', icon: '🩺', moduleId: 'm08', pitch: 'A sick database: typos, duplicates, wrong prices. Heal it without collateral damage.', skills: 'INSERT, UPDATE, DELETE' },
  gatekeeper: { id: 'gatekeeper', title: 'Gatekeeper', icon: '🛡️', moduleId: 'm09', pitch: 'Design a table whose constraints let good rows in and keep bad rows out.', skills: 'types, keys, constraints' },
  rankrace: { id: 'rankrace', title: 'Rank Race', icon: '🏁', moduleId: 'm10', pitch: 'Window functions power a live race leaderboard: ranks, running totals, gaps.', skills: 'window functions' },
  indexracer: { id: 'indexracer', title: 'Index Racer', icon: '⚡', moduleId: 'm10', pitch: 'A 200,000-row table. Add indexes and rewrite queries to beat the target EXPLAIN cost.', skills: 'indexes, EXPLAIN' },
  finale: { id: 'finale', title: 'The Final Case', icon: '🎬', moduleId: 'm10', pitch: 'The capstone mystery. Every skill you\'ve learned, in one investigation.', skills: 'everything' },
};
