# pgschool 🐘

An interactive course for learning **PostgreSQL** from scratch. Every query runs on a **real Postgres database inside your browser** ([PGlite](https://pglite.dev)). There's no server to install.

## Run it

```bash
npm install     # on this machine, add NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"
npm run dev     # then open the printed URL (http://localhost:5173)
```

| Command | What it does |
|---|---|
| `npm run dev` | Start the app with hot reload |
| `npm test` | 334 tests: the engine, plus a check that every exercise, project and game level is correct and solvable |
| `npm run build` | Typecheck and build a static site into `dist/` (host it anywhere) |
| `scripts/q.sh "SQL|||SQL"` | Run ad-hoc queries against the sample bookstore database |

## What's inside

- **10 modules**, each going **Learn → Practice → Play → Test**:
  1. SELECT
  2. WHERE
  3. ORDER BY / LIMIT
  4. functions & CASE
  5. GROUP BY
  6. joins
  7. subqueries & CTEs
  8. INSERT/UPDATE/DELETE
  9. table design
  10. window functions, JSONB, indexes
- **Teaching:** predict-then-run, worked examples → Parsons puzzles → fill-in-the-blank → write from scratch, a 🔍 step-through of query execution order, row-by-row diff feedback, a common-mistake detector, escalating hints, confidence ratings, spaced-repetition **Review**, a personal **Cheat sheet**, cumulative tests and test-out.
- **12 games:** Snapshot, Suspect Lineup, Podium Rush, Formula Forge, Warehouse Sort, Bridge Builder, Case Files, Data Doctor, Gatekeeper, Rank Race, Index Racer and The Final Case.
- **2 open-ended projects** (after modules 5 and 10), checked by requirements rather than an exact answer.
- **Playground** with a persistent database, XP / levels / badges / streaks, and progress export/import.

Progress is stored in your browser (localStorage + IndexedDB).

## Layout

```
src/db/          PGlite engine, sandboxing, answer checker, friendly errors
src/pedagogy/    row diff, misconception rules, execution visualiser, SM-2 review
src/content/     course content (modules/m01…m10), projects, table-behaviour checks
src/games/       game framework (kit, QueryRounds), 12 games, level data in levels/
src/pages/       Home, Module (Learn/Practice/Play/Test), Review, Cheat sheet, Playground, Games
tests/           core.test.ts, solutions.test.ts (content), games.test.ts (levels)
```

See `PROJECT_LOG.md` for the full build history.
