import type { QueryLevel } from '../QueryRounds';

/* ------------------------------------------------------------------ */
/* Podium Rush (Module 3): racers sorted into a target leaderboard.    */
/* ------------------------------------------------------------------ */

export const RACERS_SETUP = `
CREATE TABLE racers (name text PRIMARY KEY, team text NOT NULL, points integer NOT NULL, wins integer NOT NULL, best_lap numeric(5,2));
INSERT INTO racers VALUES
  ('Ada', 'Comet', 182, 4, 81.20), ('Bo', 'Nova', 175, 3, 80.95), ('Cleo', 'Comet', 160, 2, NULL),
  ('Dev', 'Pulsar', 199, 5, 80.40), ('Eli', 'Nova', 120, 0, 82.10), ('Fay', 'Pulsar', 143, 1, 81.75),
  ('Gus', 'Comet', 98, 0, NULL), ('Hana', 'Nova', 151, 2, 81.05), ('Ivo', 'Pulsar', 133, 1, 82.40),
  ('Juno', 'Nova', 188, 4, 80.70);`;

export const PODIUM_LEVELS: QueryLevel[] = [
  { prompt: '🏆 Show the **top 3** racers by **points** (name and points), highest first.', solution: 'SELECT name, points FROM racers ORDER BY points DESC LIMIT 3', setupSql: RACERS_SETUP, orderMatters: true, hint: 'ORDER BY points DESC LIMIT 3', starter: 'SELECT name, points\nFROM racers\n' },
  { prompt: '🐢 The **slowest best laps first**: name and best_lap, **largest** best_lap first, racers **without a lap time at the end** (those sorted by name).', solution: 'SELECT name, best_lap FROM racers ORDER BY best_lap DESC NULLS LAST, name', setupSql: RACERS_SETUP, orderMatters: true, hint: 'DESC puts NULLs first in Postgres. Add NULLS LAST, then name to break the tie.' },
  { prompt: '🎌 Team standings: **team A→Z**, and within each team **most points first**. Show team, name, points.', solution: 'SELECT team, name, points FROM racers ORDER BY team, points DESC', setupSql: RACERS_SETUP, orderMatters: true, hint: 'ORDER BY team, points DESC' },
  { prompt: '📄 The leaderboard (by points, highest first) shows 3 per page. Show **page 2**: name and points.', solution: 'SELECT name, points FROM racers ORDER BY points DESC LIMIT 3 OFFSET 3', setupSql: RACERS_SETUP, orderMatters: true, hint: 'Skip the first page: OFFSET 3' },
  { prompt: '🥇 Rank by **wins** (most first); ties broken by **points** (most first). Show name, wins, points, **top 5 only**.', solution: 'SELECT name, wins, points FROM racers ORDER BY wins DESC, points DESC LIMIT 5', setupSql: RACERS_SETUP, orderMatters: true, hint: 'ORDER BY wins DESC, points DESC LIMIT 5' },
  { prompt: '⏱ **Fastest 4 laps**: name and best_lap, fastest (smallest) first. Racers without a time don\'t count.', solution: 'SELECT name, best_lap FROM racers WHERE best_lap IS NOT NULL ORDER BY best_lap LIMIT 4', setupSql: RACERS_SETUP, orderMatters: true, hint: 'Ascending puts NULLs last anyway, but LIMIT 4 never reaches them. Filtering them out is cleaner.' },
];

/* ------------------------------------------------------------------ */
/* Warehouse Sort (Module 5): GROUP BY into buckets.                   */
/* ------------------------------------------------------------------ */

export const WAREHOUSE_LEVELS: QueryLevel[] = [
  { prompt: '📦 Sort the **books** into buckets by **genre**: return genre and the **number of books**.', solution: 'SELECT genre, count(*) FROM books GROUP BY genre', hint: 'GROUP BY genre with count(*)', starter: 'SELECT genre, count(*)\nFROM books\n' },
  { prompt: '📦 Now weigh each bucket: per **genre**, the **total copies in stock** (sum of in_stock).', solution: 'SELECT genre, sum(in_stock) FROM books GROUP BY genre', hint: 'sum(in_stock) instead of count(*)' },
  { prompt: '🚚 Orders by **status**: return status and how many orders have it.', solution: 'SELECT status, count(*) FROM orders GROUP BY status', hint: 'GROUP BY status' },
  { prompt: '🧹 Clear out the small buckets! Only **genres with at least 3 books**, with their counts.', solution: 'SELECT genre, count(*) FROM books GROUP BY genre HAVING count(*) >= 3', hint: 'HAVING count(*) >= 3' },
  { prompt: '🌍 Customers per **country**, but only countries with **more than one** customer.', solution: 'SELECT country, count(*) FROM customers GROUP BY country HAVING count(*) > 1', hint: 'GROUP BY country HAVING count(*) > 1' },
  { prompt: '💶 Revenue per **order_id** (sum of quantity × unit_price), only orders worth **more than €35**.', solution: 'SELECT order_id, sum(quantity * unit_price) FROM order_items GROUP BY order_id HAVING sum(quantity * unit_price) > 35', hint: 'HAVING sum(quantity * unit_price) > 35' },
  { prompt: '🏢 Per **department**: the department and its **average salary rounded to a whole number**, only departments averaging **over 60000**.', solution: 'SELECT department, round(avg(salary)) FROM employees GROUP BY department HAVING avg(salary) > 60000', hint: 'round(avg(salary)) … HAVING avg(salary) > 60000' },
];

/* ------------------------------------------------------------------ */
/* Bridge Builder (Module 6): heroes on one bank, guilds on the other. */
/* ------------------------------------------------------------------ */

export const BRIDGE_SETUP = `
CREATE TABLE guilds (guild_id integer PRIMARY KEY, guild text NOT NULL, city_id integer);
CREATE TABLE heroes (hero_id integer PRIMARY KEY, hero text NOT NULL, guild_id integer, mentor_id integer);
CREATE TABLE cities (city_id integer PRIMARY KEY, city text NOT NULL);
INSERT INTO cities VALUES (1, 'Ashford'), (2, 'Brightwater'), (3, 'Coldpeak');
INSERT INTO guilds VALUES (10, 'Archers', 1), (20, 'Bards', 2), (30, 'Clerics', 1), (40, 'Druids', NULL);
INSERT INTO heroes VALUES
  (1, 'Aria', 10, NULL), (2, 'Bram', 20, 1), (3, 'Cass', 10, 1), (4, 'Dax', NULL, 2),
  (5, 'Edda', 30, NULL), (6, 'Finn', 99, 5), (7, 'Gwen', 20, 5);`;

export const BRIDGE_LEVELS: QueryLevel[] = [
  { prompt: '🌉 Build a bridge from every hero to their guild. **Only heroes who have a real guild.** Return **hero_id, guild_id** (from guilds).', solution: 'SELECT h.hero_id, g.guild_id FROM heroes h JOIN guilds g ON g.guild_id = h.guild_id', setupSql: BRIDGE_SETUP, hint: 'INNER JOIN on guild_id. Dax (no guild) and Finn (guild 99 doesn\'t exist) stay stranded.', starter: 'SELECT h.hero_id, g.guild_id\nFROM heroes h\n' },
  { prompt: '🛶 Leave **no hero behind**: every hero, with their guild_id **from guilds** (NULL if they have no real guild).', solution: 'SELECT h.hero_id, g.guild_id FROM heroes h LEFT JOIN guilds g ON g.guild_id = h.guild_id', setupSql: BRIDGE_SETUP, hint: 'LEFT JOIN keeps every hero.' },
  { prompt: '🏚 Which **guilds have no heroes**? Return **NULL, guild_id**, i.e. `SELECT h.hero_id, g.guild_id` with only the unmatched guilds.', solution: 'SELECT h.hero_id, g.guild_id FROM guilds g LEFT JOIN heroes h ON h.guild_id = g.guild_id WHERE h.hero_id IS NULL', setupSql: BRIDGE_SETUP, hint: 'guilds LEFT JOIN heroes … WHERE h.hero_id IS NULL' },
  { prompt: '🌊 Everyone on both banks: **all heroes and all guilds**, matched where possible. Return hero_id, guild_id (from guilds).', solution: 'SELECT h.hero_id, g.guild_id FROM heroes h FULL JOIN guilds g ON g.guild_id = h.guild_id', setupSql: BRIDGE_SETUP, hint: 'FULL JOIN keeps unmatched rows from both sides.' },
  { prompt: '🧙 Mentors: connect each hero to their **mentor** (another hero). Return **hero_id, mentor\'s hero_id**, only for heroes who have one.', solution: 'SELECT h.hero_id, m.hero_id FROM heroes h JOIN heroes m ON m.hero_id = h.mentor_id', setupSql: BRIDGE_SETUP, hint: 'A self join: heroes h JOIN heroes m ON m.hero_id = h.mentor_id' },
  { prompt: '🏰 Final bridge across three banks: each hero\'s **hero name** and the **city** of their guild, for heroes whose guild has a city.', solution: 'SELECT h.hero, c.city FROM heroes h JOIN guilds g ON g.guild_id = h.guild_id JOIN cities c ON c.city_id = g.city_id', setupSql: BRIDGE_SETUP, hint: 'heroes → guilds → cities: two JOINs.' },
];

/* ------------------------------------------------------------------ */
/* Rank Race (Module 10): window functions over lap times.             */
/* ------------------------------------------------------------------ */

export const RACE_SETUP = `
CREATE TABLE laps (driver text, lap integer, lap_time numeric(5,2), PRIMARY KEY (driver, lap));
INSERT INTO laps VALUES
  ('Ada', 1, 81.2), ('Ada', 2, 80.9), ('Ada', 3, 82.5), ('Ada', 4, 80.1), ('Ada', 5, 80.0),
  ('Bo', 1, 80.4), ('Bo', 2, 81.8), ('Bo', 3, 80.6), ('Bo', 4, 81.9), ('Bo', 5, 80.7),
  ('Cleo', 1, 82.0), ('Cleo', 2, 80.2), ('Cleo', 3, 80.3), ('Cleo', 4, 80.5), ('Cleo', 5, 81.1),
  ('Dev', 1, 81.5), ('Dev', 2, 81.0), ('Dev', 3, 81.2), ('Dev', 4, 80.8), ('Dev', 5, 79.6);`;

export const RACE_TOTALS = `SELECT driver, lap, sum(lap_time) OVER (PARTITION BY driver ORDER BY lap) AS total FROM laps`;

export const RANKRACE_LEVELS: QueryLevel[] = [
  { prompt: '🏁 For every driver and lap, the **total race time so far** (a running sum of lap_time per driver, in lap order). Return driver, lap, total.', solution: RACE_TOTALS, setupSql: RACE_SETUP, hint: 'sum(lap_time) OVER (PARTITION BY driver ORDER BY lap)', starter: 'SELECT driver, lap,\n       ___ AS total\nFROM laps' },
  { prompt: '📊 Now the **position** after each lap: rank drivers **within each lap** by their total so far (lowest total = 1st). Return driver, lap, position. *(Use the previous query as a CTE.)*', solution: `WITH t AS (${RACE_TOTALS}) SELECT driver, lap, rank() OVER (PARTITION BY lap ORDER BY total) AS position FROM t`, setupSql: RACE_SETUP, hint: 'WITH t AS (…running totals…) SELECT driver, lap, rank() OVER (PARTITION BY lap ORDER BY total) FROM t', seconds: 200 },
  { prompt: '⏳ The **gap to the leader** after each lap (your total minus the smallest total on that lap). Return driver, lap, gap.', solution: `WITH t AS (${RACE_TOTALS}) SELECT driver, lap, total - min(total) OVER (PARTITION BY lap) AS gap FROM t`, setupSql: RACE_SETUP, hint: 'total - min(total) OVER (PARTITION BY lap)', seconds: 200 },
  { prompt: '📈 Lap-on-lap: each driver\'s **change in lap time vs their previous lap** (NULL on lap 1). Return driver, lap, delta.', solution: 'SELECT driver, lap, lap_time - lag(lap_time) OVER (PARTITION BY driver ORDER BY lap) AS delta FROM laps', setupSql: RACE_SETUP, hint: 'lap_time - lag(lap_time) OVER (PARTITION BY driver ORDER BY lap)' },
  { prompt: '⚡ **Fastest lap of each driver**: return driver, lap and lap_time of each driver\'s single fastest lap.', solution: 'WITH r AS (SELECT driver, lap, lap_time, row_number() OVER (PARTITION BY driver ORDER BY lap_time) AS rn FROM laps) SELECT driver, lap, lap_time FROM r WHERE rn = 1', setupSql: RACE_SETUP, hint: 'row_number() per driver ordered by lap_time, then keep rn = 1', seconds: 200 },
];
