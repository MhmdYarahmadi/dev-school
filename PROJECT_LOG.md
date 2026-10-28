# pgschool — Project Log

A running record of everything done on this project: what was decided, what was built, problems hit and how they were solved. Newest entries are at the bottom of each day.

The full approved plan is in `~/.claude/plans/i-want-to-create-fluttering-sedgewick.md`.

---

## 2026-10-04

### 1. Planning
- **Goal:** an interactive tool for learning SQL. The user's answers then refined this to a *complete PostgreSQL course for a complete beginner*, with these features:
  - guided lessons
  - a free playground
  - progress tracking
  - hints and solutions
- **Format decision:** a local web app (Vite + React + TypeScript) that runs **real PostgreSQL in the browser through PGlite**, which is Postgres compiled to WebAssembly.
  - Why: Docker and Postgres aren't installed on this machine. PGlite needs no server, still gives genuine Postgres behaviour (JSONB, arrays, window functions, `EXPLAIN`), and lets every exercise run in `BEGIN … ROLLBACK` so the sample data can't be broken.
  - Rejected: a published Artifact page, because its sandbox blocks the WASM and data files PGlite needs to fetch.
- **First revision ("make it more fun"):** added **one mini-game per module**, alongside the training exercises and tests. Each module now follows Learn → Practice → Play → Test. The games are:
  - Snapshot
  - Suspect Lineup
  - Podium Rush
  - Formula Forge
  - Warehouse Sort
  - Bridge Builder
  - Case Files
  - Data Doctor
  - Gatekeeper
  - Rank Race + Index Racer
  - a finale mystery after module 10
- **Second revision ("re-evaluate the teaching methods"):** added these, based on established learning research:
  - Predict, then run: guess the result before running a query.
  - Worked examples, then less support step by step: Parsons puzzles (drag-and-drop) → fill in the blank → write from scratch.
  - A query execution visualizer that steps through FROM → WHERE → GROUP BY → … in order.
  - Diagnostic feedback: a row diff, plus a rule-based detector for common mistakes.
  - A spaced-repetition review queue (SM-2) and cumulative tests.
  - Read-the-query and fix-the-bug exercises.
  - Confidence ratings after each answer.
  - Hints that don't give the answer away, with a variant exercise after you view a solution.
  - Real-world projects.
  - A personal cheat sheet.
  - Test-out, to skip modules you already know.
- The plan was approved.

### 2. Environment check
- Node v22.22.1 and npm 9.2.0 are available. Docker and `psql` are not installed.

### 3. Problem: npm couldn't reach the registry
- **Symptom:** `npm view` / `npm install` failed with `ETIMEDOUT`, even though `curl` to the registry worked.
- **Diagnosis:** a raw Node TCP test showed IPv6 → `ENETUNREACH` and IPv4 → OK. Node was trying IPv6 first, and this machine can't route IPv6.
- **Fix:** run npm with:
  ```
  NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"
  ```
  **Use this for every npm command on this machine.**

### 4. Scaffolding
- Created `pgschool/` and ran `npm init`.
- Installed these runtime dependencies:
  - `react@18`, `react-dom@18`
  - `@electric-sql/pglite`
  - `@uiw/react-codemirror`, `@codemirror/lang-sql`
  - `react-markdown`
  - `framer-motion`
  - `react-router-dom`
- Dev dependencies:
  - `vite`, `@vitejs/plugin-react`
  - `typescript`, `@types/react@18`, `@types/react-dom@18`
  - `vitest`

### 5. Probing how PGlite behaves (before writing the checker)
Ran a throwaway script against PGlite in Node to learn its result format:
- `numeric` columns come back as **strings** (`'9.99'`). Integers and bigints come back as JS numbers, `date`/`timestamp` as JS `Date`, and `jsonb` and arrays already parsed.
- Error objects carry `code`, `message`, `position`, `detail` and `hint`, just like real Postgres.
- `exec(sql, { rowMode: 'array' })` returns one result per statement, and keeps duplicate column names (`SELECT 1 a, 2 a`).
- Timing: a fresh database takes about 1.2s to start and seeding about 15ms. **Cloning from a dump takes about 0.2s.**

**Consequence:** the checker normalises values before comparing them (`src/db/values.ts`). For example, `19.98` and `'19.980'` are equal, and numbers are rounded to 4 decimals so two ways of writing an `AVG()` still match.

## 2026-10-05

### 6. Dependency install: clean retry
- The session was interrupted, and repeated failed installs had left half-extracted folders behind, which made npm fail with `ENOTEMPTY`.
- **Fix:** deleted `node_modules` and `package-lock.json`, then did one clean install with `--maxsockets=4 --fetch-retries=6` (plus the IPv4 `NODE_OPTIONS`). It succeeded.
- Installed versions: Vite 8.3, Vitest 5.0, TypeScript 5.9 (pinned to 5 rather than the new native TS 7, for stability), plugin-react 6.1.
- Added the npm scripts: `dev`, `build` (`tsc && vite build`), `test` (`vitest run`) and `typecheck`.

### 7. Database core (`src/db/`)
| File | What it does |
|---|---|
| `seed.sql` | The bookstore schema and data: 13 authors, 30 books, 20 customers, 32 orders, 49 order items, 12 employees. It deliberately includes NULLs and orphans (an author with no books, books with no author, a customer with no orders, a book never ordered) so lessons can teach `IS NULL` and `LEFT JOIN`. |
| `engine.ts` | Creates the databases: a shared in-memory **lesson DB**, a **playground DB** saved in IndexedDB (re-seeded if empty, plus a reset function), and `createSeededDb()`, which clones from a cached dump. It also has a small mutex so two sandboxed runs can't interleave. |
| `statements.ts` | A SQL statement splitter that respects quotes, dollar-quoting and comments. `usesTransactionControl()` detects `BEGIN`/`COMMIT`/… |
| `runQuery.ts` | `inSandbox()` wraps work in `BEGIN … ROLLBACK`, with a `SAVEPOINT` per step so one failed statement doesn't abort the rest. **If the learner's SQL manages its own transactions** (a `COMMIT` would escape our rollback), it runs on a **throwaway clone** instead. |
| `values.ts` | Display formatting (like psql) and canonical comparison values. |
| `checker.ts` | Compares the learner's result with the reference answer. It ignores column names (aliases) and row order unless `orderMatters` is set. INSERT/UPDATE/DELETE/DDL exercises are compared through a `checkQuery`. Expected results are cached. Feedback is specific, for example "30 rows; expected 3", "1 column vs 2", or "right rows, wrong order". |
| `friendlyErrors.ts` | Plain-English explanations for about 20 common Postgres errors. |

### 8. Teaching engine (`src/pedagogy/`)
| File | What it does |
|---|---|
| `rowDiff.ts` | A multiset diff between your rows and the expected rows: which are missing (red) and which are extra (yellow). |
| `misconceptions.ts` | 13 rule-based detectors with targeted explanations: `= NULL`, an aggregate in WHERE, HAVING without GROUP BY, a non-grouped column, double quotes around text, AND/OR precedence, a join with no condition, UPDATE/DELETE with no WHERE, a SELECT alias used in WHERE, LIKE with no wildcard, COUNT(col) vs COUNT(*), what DISTINCT applies to, and integer division. |
| `visualizer.ts` | Splits a SELECT into the clauses at the top level of the query (not inside brackets), respecting strings and comments. It then builds one runnable query per logical step: FROM/JOIN → WHERE → GROUP BY (group keys + row counts) → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT. CTEs are supported. |
| `review.ts` | SM-2 spaced repetition. Correct-but-guessed answers come back sooner, and misses come back in 10 minutes. |

### 9. Progress store (`src/progress/store.ts`)
- Saved in localStorage. It records: exercises (attempts, hints used, whether you saw the solution, your last SQL), which concepts you've seen, your predictions, test scores, game stars, project tasks, review cards, the variant queue, XP, badges, the daily streak, playground history, and "continue where you left off".
- It notifies React through `useSyncExternalStore`.
- XP rules:
  - solving an exercise: 10, or 15 with no hints (2 if you viewed the solution)
  - each new game star: 20
  - passing a test: 50, or 80 for testing out
  - each project task: 30
  - each badge: 25
- 9 level titles, from "Intern" up to "Query Wizard".

### 10. Content model (`src/content/types.ts`)
- `Concept`: an explanation card, a predict-then-run prompt, a worked example, and a cheat-sheet entry.
- Exercise kinds: `write`, `fillBlank`, `fixBug`, `parsons` (drag blocks into order; the assembled SQL is *run*, so any valid order passes), and `readQuery` (multiple choice).
- Every SQL item has both a `solution` and a `wrongExample`. Tests assert that the solution passes and the wrong example fails.

### 11. First tests: `tests/core.test.ts`, 24 tests
- These cover the statement splitter, sandbox rollback (including a user `COMMIT`), the checker (aliases and order ignored, row-count feedback, column count, friendly errors, `orderMatters`, DML through a `checkQuery`), each misconception rule (positive and negative cases), the visualizer (step order, and that every step query actually runs), and SM-2.
- **Bug found by the tests:** the visualizer rejected `WHERE title <> 'a; b'` as "multiple statements", because it looked for `;` in the raw text. **Fixed** by checking the masked text, where literals are blanked out. Result: 24/24 passing.

### 12. App UI (`src/App.tsx`, `src/pages/`, `src/components/`)
- **Shell:** a top bar with navigation (Course / Review / Cheat sheet / Playground), level/XP bar, streak and a theme toggle (system → dark → light). Uses a hash router, so it works from any static host. Toasts show XP and badges. An **error boundary** stops one broken page from blanking the app.
- **Home:** the course map (module cards showing Learn %, Practice %, game stars, test score and lock state), a "Continue where you left off" button, the review count due, level/XP/streak, the badge shelf, and progress export (downloads a .json), import and reset (each with an on-page confirmation).
- **Module page**, with tabs for Learn / Practice / Play / Test (+ Project):
  - **Learn:** concept list → markdown card → **predict-then-run** prompt (the worked example stays dimmed until you predict) → runnable example → 🔍 step-through.
  - **Practice:** the exercise list with checkmarks, plus queued 🔁 variants.
  - **Play:** game cards with stars and best score.
  - **Test** (`TestRunner.tsx`): no hints, about 30% of questions from earlier modules, an 80% pass mark, a results review with answers for the misses, misses fed into spaced review, and test-out when the module is locked.
- **ExerciseCard:** one component for every exercise kind (write / fill-in / fix-bug / Parsons / read-query). It has Run, Check and Step through buttons, the row diff, misconception call-outs, escalating hints (the solution unlocks after all hints or 2 failed tries, with an on-page confirmation, and viewing it queues a variant), and a confidence check after a correct answer.
- **Review page:** due SM-2 cards plus queued variants. Only the first attempt counts for scheduling.
- **Cheat sheet:** a card appears for each concept once you solve an exercise that uses it. It's searchable.
- **Playground:** a persistent IndexedDB database, schema browser (click to insert a name), query history, step-through, and a reset (with confirmation).
- **Projects** (`ProjectView` + `content/projectCheck.ts`): the learner's SELECT is stored as a temp table `answer`, then requirement queries return true/false, so any valid approach passes.
- **Game framework** (`src/games/kit.tsx`): `GameShell` (intro → play → results with animated stars; records stars and XP), `Hud`, `useCountdown`, and `starsFor` (★★★ ≥85%, ★★ ≥60%, ★ >20%).
- **Game 1, Snapshot:** 8 rounds of "reproduce this result grid", with each round getting shorter.

### 13. Content: Module 1 and its validation test
- Module 1, "First queries": 4 concepts (tables, choosing columns, calculations + AS, DISTINCT), 9 practice items covering all 5 exercise kinds, and 6 test questions. The data facts behind the predict questions (genre counts, etc.) were checked against the real database with a helper script, `scripts/q.sh "SQL|||SQL"`.
- `tests/solutions.test.ts` checks: unique ids, concept references, that every example/predict query runs, that **every solution passes**, that **every wrongExample fails**, and that fill-in/fix-bug starter SQL is *not* already correct. 22/22 passing for Module 1.

### 14. Checked in a real browser (Chrome) — bugs found and fixed
- ✅ Home renders, and dark mode works.
- 🐛→✅ **Predict prompt vanished after answering.** Saving the prediction to progress made the component think it was "already predicted" and hide itself, so the learner never saw the feedback. **Fix:** record "already predicted" once, when the card opens. Re-tested: the wrong guess shows red, the right answer green, then the explanation and the real result (30 rows, 2 ms).
- ✅ Parsons with the wrong blocks → "Your result has 10 columns, but the answer has 2", plus the expected vs your columns.
- ✅ Write exercise without DISTINCT → "returned 20 rows; expected 15. 5 rows shouldn't be there", with the duplicate rows highlighted yellow in a side-by-side diff.
- ✅ The correct answer → explanation → confidence check → XP 3 → 43 (+15 no-hint solve, +25 "First Query" badge), and the sidebar checkmark and 1/9 counter update.
- 🐛→✅ **Snapshot round 2 showed no target grid.** framer-motion's `AnimatePresence mode="wait"` got stuck on the exit animation. **Fix:** dropped the exit animation and kept the entrance one. Re-tested OK.
- Production build OK (`vite build`). PGlite's WASM (~10 MB) and data (~6 MB) are emitted as assets. The "direct eval" warnings come from PGlite's own code and are harmless.

### 15. Course content: all 10 modules written and validated
| # | Module | Concepts | Practice | Test | Notes |
|---|---|---|---|---|---|
| 1 | First queries | 4 | 9 | 6 | SELECT, aliases, DISTINCT |
| 2 | Filtering rows | 6 | 12 | 6 | WHERE, text, AND/OR precedence, IN/BETWEEN, LIKE/ILIKE, NULL |
| 3 | Sorting & paging | 4 | 10 | 6 | ORDER BY, multi-column, LIMIT/OFFSET, NULLS FIRST/LAST |
| 4 | Expressions & functions | 5 | 10 | 6 | text functions, numbers/casting, CASE, COALESCE/NULLIF, dates |
| 5 | Aggregation | 5 | 11 | 6 | aggregates, COUNT variants, GROUP BY, HAVING + **Project 1** (quarterly report) |
| 6 | Joins | 5 | 11 | 6 | INNER, aliases, LEFT/anti-join, multi-table, self join |
| 7 | Subqueries & CTEs | 6 | 9 | 6 | scalar, IN and the NOT IN + NULL trap, EXISTS, WITH, RECURSIVE, UNION/INTERSECT/EXCEPT |
| 8 | Changing data | 6 | 10 | 6 | INSERT, UPDATE, DELETE + foreign keys, RETURNING, upsert, transactions |
| 9 | Designing tables | 5 | 10 | 5 | CREATE TABLE, types (float vs numeric), keys, constraints, ALTER |
| 10 | Power features | 6 | 11 | 6 | window functions, ranking, LAG/running totals, arrays/JSONB, generate_series, indexes/EXPLAIN + **Project 2** (customer insights) |

**How the content was made trustworthy:**
- Every fact a predict question depends on was checked against the real database first (`scripts/q.sh`), for example: 28 books join to an author; a LEFT JOIN from authors gives 29 rows; `NOT IN` against a list containing NULL returns 0 rows; `rank()` jumps from 6 to 8 after the €17.00 tie while `dense_rank()` goes to 7; `0.1::float8 + 0.2 = 0.3` is false. The collation turned out to be byte order (C-like), so "1984" < "1Q84" < "A Wizard…".
- **Orderings are always deterministic** wherever order matters: prompts specify tie-breakers (for example "equal salaries by name") so a correct answer can't fail on how ties happen to come out.
- **New infrastructure for Module 9:** `src/content/ddlCheck.ts`, `behaviourCheck()`. Table designs are graded by behaviour, not by spelling. A temporary plpgsql function `pg_temp.try_all()` runs a list of INSERT/UPDATE/DELETE statements, each in its own sub-transaction, and records `accepted` or `rejected: <SQLSTATE>`. So the *right* constraint has to fire (23505 unique, 23502 not-null, 23503 foreign key, 23514 check). Any design that behaves like the reference passes.
- **The `expectError` flag:** some lesson queries are *meant* to fail (an ambiguous column, a subquery returning more than one row, a foreign-key violation on DELETE, a WHERE referring to a window alias). The tests assert those really do error.
- **Project checks are tested too:** each reference solution must meet every requirement, and a junk answer must fail at least one.

**Bugs in the content that the validator caught (and were fixed):**
1. m02-t2: the wrong answer `LIKE '%S%'` equalled the right one `LIKE 'S%'`, because capital S only appears at the start of these surnames. Changed it to `ILIKE '%s%'`.
2. m06/m07: the "deliberately failing" queries were flagged as broken, which is what led to the `expectError` flag.
3. m07-t4: the wrong answer (which forgets to exclude cancelled orders) passed at the €50 threshold, because no cancelled order pushes anyone over €50. At €20 it changes the result (customer 6's only order, €22, was cancelled).
4. m08-p8 (upsert): book 22 had 0 in stock, so "overwrite" and "add" gave the same result. Switched to book 21 (6 in stock → 12).
5. m10-p9 (calendar gap-filling): 2024 has orders in *every* month, so the exercise couldn't show a difference. Switched to Jan–Jun 2025, where only January has orders.

**Test status:** 270/270 (24 core + 246 content).

### 16. All 12 games built
- **Shared loop** (`src/games/QueryRounds.tsx`): round → target result → player's query → Run (preview) / Submit, with a timer bonus, hints that cost points, and skip. Used by Podium Rush, Warehouse Sort, Bridge Builder and Rank Race. Each game supplies its own visualisation.
- **Level data** lives in `src/games/levels/*.ts`, separate from the UI, so it can be tested.

| Game | Module | How it works |
|---|---|---|
| 📸 Snapshot | 1 | Reproduce a result grid before the timer runs out (8 rounds) |
| 🕵️ Suspect Lineup | 2 | 30 suspect cards. Your WHERE clause runs live (debounced) and knocks cards out. Clues arrive every 20s. Accuse when exactly 1 is left (3 cases) |
| 🏆 Podium Rush | 3 | Leaderboard rows slide into your ORDER BY order (framer-motion `layout`) next to the target (6 rounds) |
| ⚒️ Formula Forge | 4 | Write one expression. Each row glows green when its output matches (9 levels) |
| 📦 Warehouse Sort | 5 | Bucket bars: the target is dashed, yours is filled; ✅/❌/👻 per bucket (7 rounds) |
| 🌉 Bridge Builder | 6 | An SVG river: each result row draws a bridge, and NULL sides are shown as ⚑ stranded (6 rounds) |
| 🗂️ Case Files | 7 | A 5-step mystery (IN, scalar subquery, NOT EXISTS, CTE, recursive) with a detective's notebook, then accuse |
| 🩺 Data Doctor | 8 | A **persistent per-game database**: 7 symptoms, a health meter, and **collateral damage** detection (rows changed that shouldn't have been) |
| 🛡️ Gatekeeper | 9 | Write a CREATE TABLE, then rows "charge the gate" one by one (accepted ✅ / bounced 🛡️) using `ddlCheck.tryAllQuery` (4 waves) |
| 🏁 Rank Race | 10 | Window-function rounds. Any `driver, lap, value` result drives an animated race |
| ⚡ Index Racer | 10 | A 100k-row `events` table. Add indexes (or rewrite the query) until the `EXPLAIN (FORMAT JSON)` total cost is below the target. Rewrites must return identical rows |
| 🎬 The Final Case | finale | The same engine as Case Files: an account-takeover mystery using joins, GROUP BY/HAVING, windows (lag) and CASE |

**`tests/games.test.ts` (64 tests)** checks:
- every query-round level is solvable, and ordered levels have no ties
- every Lineup case narrows to exactly the culprit, while each single clue (and all clues but the last) leaves several suspects
- no Forge level is solved by the raw input column
- every mystery step runs, and Case Files really narrows to Ravi
- Data Doctor starts with every symptom sick, the reference cure heals all of them with 0 collateral damage, and a careless `UPDATE` without WHERE is detected
- every Gatekeeper reference table gives exactly the expected accept/reject pattern, while the naive starter lets bad rows in
- every Index Racer level is above target before the fix and at or below it after

**Index Racer tuning:** the measured costs (before → after) were:
- user lookup: 2338 → 77
- latest-10: 4249 → 0.7
- lower(email): 2588 → 77
- big purchases: 2592 → 1215
- rewrite: 2589 → 18

The "big purchases" target was moved from 1500 to **1900** to leave a safe margin, because ANALYZE samples randomly. Building the 100k-row table takes about 0.2s.

**Bugs fixed while building:**
- Podium Rush: React keys were taken from the first column, which repeats on the team-sort level. They're now unique per row.
- Data Doctor: the database was closed twice (once in a state update, once in an effect cleanup). It's now closed only in the cleanup.
- Gatekeeper: a type error on the outcomes state.

### 17. Status at the end of this step
- `tsc`: clean. **`npm test`: 334/334 passing** (24 core + 246 content + 64 games). `vite build`: OK.
- The dev server compiles all 13 game modules (each returns HTTP 200).
- Checked in the browser earlier: Learn (predict), Practice (Parsons, row diff, success + confidence + XP), and Snapshot.
- ⚠️ **Not yet clicked through in a browser:** the 11 newer games, Review, Cheat sheet, Test runner and Projects. The Chrome extension was disconnected in this session, so this is the next verification step.
- Added `README.md`, covering how to run, the commands and the layout.

## 2026-10-05 (continued)

### 18. Hosting plan and the VPS investigation
- The user asked how to host the app on their VPS. It's a static site, so it can be served from `dist/` with Caddy or nginx. One requirement: `.wasm` files must be served as `application/wasm`.
- **SSH setup:** the private keys in `~/.ssh` were world-readable (644), and SSH refuses to use keys like that. I set them to 600. I created `~/.ssh/config` with `Host vps` (89.44.243.19, user mohyar, key `zilber_vps_ed25519`, `IdentitiesOnly`). A test login succeeded.
- **The VPS (read-only inspection):** Ubuntu 26.04, no Node on the host, sudo needs a password, the user is in the `docker` group. Apps are compose stacks in `/opt/stacks/` (odoo, processmaker, proxy). **Caddy runs as a container** on the external `proxy` network, with its Caddyfile at `/opt/stacks/proxy/Caddyfile` (erp.zilber.tech → odoo-app:8069, pm.zilber.tech → pm-app).

### 19. Learner tracking: accounts, server-side progress, admin dashboard
**Requirement:** "know how far each user has gotten." The user chose:
- **username + password** accounts
- a dashboard showing a **per-learner overview**, **struggle spots** and **each learner's answers**

**Decision recorded:** the user asked for passwords to be stored **unhashed**. I explained the risk (password reuse, leaks through backups or breaches) and offered hashing plus an admin password-reset button instead. **The user confirmed plain text.** Mitigations:
- the sign-up form warns "use a new password, the admin can see it"
- the database and `.env` stay private
- the README warns that backups contain passwords

**Backend: `server/index.mjs`**, with **no dependencies** (Node `http` + the built-in `node:sqlite`):
- Tables:
  - `users`: username (unique, case-insensitive), password, created_at, last_active, progress JSON
  - `sessions`: random 256-bit bearer tokens
- `POST /api/signup` and `/api/login` (rate limited: 30 per 10 minutes per IP), `POST /api/logout`, `GET /api/me`, `PUT /api/progress` (max 2 MB, must be version 1)
- Admin: `POST /api/admin/login` (checks `ADMIN_PASSWORD` from the environment and issues a 12-hour token), `GET /api/admin/users`, `POST /api/admin/users/:id/password` (also ends that user's sessions), `DELETE /api/admin/users/:id`
- Also serves `dist/` with the correct MIME types (`.wasm` → `application/wasm`) and long-lived caching for hashed assets. Path traversal is blocked (tested with `../`, `%2e%2e`, `..%2f`: each just gets index.html).

**Frontend:**
- `src/account/api.ts`: session token in localStorage.
  - **Background sync:** the progress store notifies → a 2-second debounce → `PUT /api/progress`. Drafts sync after 5 seconds. Failures retry every 15 seconds. A best-effort `keepalive` save runs when the tab closes.
  - **On login, the server copy wins.** A brand-new account adopts this browser's progress.
  - **Logout clears local progress**, so the next person on a shared PC starts clean.
- `src/account/AuthGate.tsx`: login / create-account screen (including the password warning). The whole app requires an account, except `/#/admin`.
- The header shows the username, the sync state (⏳ saving / ☁️ saved / ⚠️ offline) and a log-out button.
- **Test answers are now recorded too:** `ExerciseCard.onDone` passes the submitted SQL or the chosen option, and `TestRunner` stores the latest attempt per module in `progress.testAnswers`.
- `src/admin/analytics.ts` (pure, unit-tested):
  - `summarize`: level, XP, current module, modules passed, exercises solved, stars, streak, struggles
  - `struggleSpots`: per exercise, across learners. Score = failed tries + 3 × solutions seen + 2 × test misses + hints.
  - `answersOf`: latest practice SQL plus the latest test answers
- `src/pages/AdminPage.tsx` (`/#/admin`):
  - admin login
  - totals (learners, active in the last 7 days, modules passed, exercises solved)
  - **Learners** table (click a row for details): per-module progress, the password (hidden until "Show"), set a new password, delete the account (with confirmation), and every answer filterable by module
  - **Struggle spots**: the 50 hardest exercises
  - auto-refreshes every 30 seconds

**Dev:** Vite proxies `/api` to `localhost:8787`. Run `npm run server` (with `ADMIN_PASSWORD=…`) and `npm run dev`.

**Tests: `tests/server.test.ts` (10 tests)** spawn the real server on a temporary database and cover:
- sign-up validation, including duplicate usernames regardless of case
- login with the wrong and right password
- saving and loading progress, rejecting a bad format, and requiring authentication
- logout invalidating the token
- admin authentication, the admin listing passwords and progress
- password reset ending old sessions
- account deletion
- the dashboard calculations

Also added `@types/node` (and `node` in the tsconfig types) so the tests typecheck. **Total: 344/344 passing**, and the build is OK.

### 20. Deployment files (`deploy/`)
- `Dockerfile`: `node:22-alpine`, copies `server/` and `dist/`, runs as the non-root `node` user, data in `/data`, with a healthcheck.
- `docker-compose.yml`: the `pgschool-app` container on the external `proxy` network, the `pgschool_data` volume, and `.env` for `ADMIN_PASSWORD`.
- `Caddyfile.snippet`: `pg.zilber.tech { encode zstd gzip; reverse_proxy pgschool-app:8787 }`
- `deploy.sh`: test → build → rsync `dist/` + `server/` + the Docker files to `/opt/stacks/pgschool` → `docker compose up -d --build` → health check. It refuses to run if `.env` is missing.
- `README.md`: first-time steps (DNS, `.env`, deploy, the Caddy block), updates, URLs, backups.
- **Nothing has been changed on the VPS yet.** That's waiting for the user's go-ahead, and DNS for pg.zilber.tech isn't set up yet.

### 21. Deployed to the VPS
1. **Admin password:** 24 random characters, generated locally and saved to **`~/.config/pgschool/admin-password.txt`** on this PC (mode 600, folder 700). It was sent over SSH stdin into `/opt/stacks/pgschool/.env` (mode 600) and never printed in the session.
2. **Deploy:** the first `deploy/deploy.sh` run built the `pgschool:latest` image on the VPS (node:22-alpine), created the `pgschool_data` volume, and started `pgschool-app` on the `proxy` network. Health: `{"ok":true}`.
3. **The user asked to remove the "don't reuse your password" warning** from the sign-up form. Removed it, updated the server comment, and redeployed. Health OK.
4. **Checks:** the Caddy container reaches `pgschool-app:8787` (health OK; `/` serves text/html), and admin login with the saved password returns a token.
5. **Caddy:**
   - backed up to `/opt/stacks/proxy/Caddyfile.bak.20261005-112029`
   - appended the `pg.zilber.tech { encode zstd gzip; reverse_proxy pgschool-app:8787 }` block
   - `caddy validate` passed, then `caddy reload` (the script would have restored the backup automatically if validation had failed)
   - afterwards, erp.zilber.tech (303) and pm.zilber.tech (302) still respond normally, and a request with `Host: pg.zilber.tech` to the VPS IP gets Caddy's HTTPS redirect (308)
6. **DNS still to do (the user):** `pg.zilber.tech` currently resolves to **45.159.149.232** (probably a wildcard or parking record), not the VPS. It needs an A record pointing to **89.44.243.19**. Caddy will then get the HTTPS certificate automatically.

**URLs once DNS is live:** learners at `https://pg.zilber.tech`, the admin dashboard at `https://pg.zilber.tech/#/admin`.
**Updates:** `deploy/deploy.sh`.

### 22. Admin guide + backup tooling
- The user asked whether they have an admin account. Answer: no. There's one admin password (in `~/.config/pgschool/admin-password.txt`), used at `/#/admin`. Learner accounts are separate.
- **Added `server/backup.mjs`:** `VACUUM INTO /data/backup.db` makes a consistent copy while the server keeps running. Redeployed.
- **Tested on the live VPS** (while the database held no learners):
  1. backup inside the container → copy to the VPS → clean up
  2. **restore:** stop the container → a temporary alpine container (mounting the volume) removes the `-wal`/`-shm` files, copies the backup into place and chowns it to 1000 → start → health OK
  3. the backup-to-PC pipe `docker cp pgschool-app:/data/backup.db - | tar -xO > file.db` produces a valid "SQLite format 3" file
- **Wrote `ADMIN_GUIDE.txt`** (plain text) covering: the essentials (URLs, password location, DNS), how it works, the admin login, the dashboard explained column by column, common tasks (forgotten password, deleting a learner, starting over, username rules, rate limit), privacy and security (plain-text passwords), changing the admin password, updating, backup and restore (the tested commands), server checks, troubleshooting (including undoing the Caddy change), and where everything lives. The guide contains no secrets.
- At the user's request, the **admin password was written into `ADMIN_GUIDE.txt`** (section 1). It was copied from the password file by a script, never shown in the session. The guide is now mode 600 and listed in `.gitignore`. Section 7 now reminds you to update the guide when the password changes.

### 23. Domains: y.zilber.tech (briefly), then school.zilber.tech with a course home page
- The user asked to use `y.zilber.tech` for now (its DNS already pointed at the VPS). I renamed the Caddy block (backup `Caddyfile.bak.20261005-122020`).
- 🐛 **Mistake + fix:** the rename used `sed -i`, which writes a *new* file. The Caddyfile is a **single-file, read-only bind mount**, so the container kept the old file: the reload said "config is unchanged", and Caddy kept failing to get a certificate for pg.zilber.tech (whose DNS points elsewhere).
  - **Fix without downtime:** `docker cp Caddyfile caddy:/tmp/Caddyfile.current`, then validate and reload from that path. The certificate was issued and the site was live over HTTPS.
  - Restarting the caddy container would also have worked, but it would have briefly interrupted ERP and PM.
  - Documented in ADMIN_GUIDE §11, deploy/README and memory.
- **The user then switched to `school.zilber.tech`**, planning more courses there later. They asked for the first page to list courses: PostgreSQL, plus Docker as "coming soon".
  - pgschool now lives at **`/pg/`**: Vite `base: '/pg/'`, and the API client uses `${BASE_URL}api` (also for the keepalive save). The dev proxy rewrites `/pg/api` → `/api`. The server is unchanged, because Caddy's `handle_path` strips the `/pg` prefix.
  - **New project `~/claude-projects/school-home/`**: `site/index.html` is the home page (self-contained, no external resources, light/dark aware, phone-friendly). It has a 🐘 PostgreSQL card linking to `/pg/` and a 🐳 Docker card marked "coming soon". `docker-compose.yml` runs `nginx:1.27-alpine` serving `./site` read-only on the `proxy` network as container `school-home`. Updates go through `deploy.sh`.
  - **Caddy** (backup `Caddyfile.bak.20261005-122912`): replaced the y block with `school.zilber.tech { encode; redir /pg /pg/; handle_path /pg/* → pgschool-app:8787; handle → school-home:80 }`. Edited in place, then loaded via the in-container copy. The Let's Encrypt certificate was obtained.
  - **Verified live:**
    - the home page returns 200 ("Zilber School")
    - `/pg` redirects (308) to `/pg/`
    - pgschool returns 200, and its JS and WASM have the right types
    - `/pg/api/health` is OK, and a sign-up works (the test account was then deleted through the admin API)
    - the y block is gone, and ERP/PM are unaffected
- **ADMIN_GUIDE.txt updated** (new URLs, the two-container layout, home page editing, the safe Caddyfile procedure, troubleshooting, locations), along with deploy/README and the Caddyfile snippet.

### 24. ProcessMaker stopped (VPS housekeeping, at the user's request)
- First I checked that all of ProcessMaker's data lives outside the containers: named volumes `processmaker_pm_storage`, `processmaker_pm_db_data` and `processmaker_pm_redis_data`, plus the bind mount `/opt/stacks/processmaker/data`. The restart policy is `unless-stopped`.
- Ran `docker compose stop` in `/opt/stacks/processmaker`, which stopped pm-app, pm-mysql and pm-redis. **Nothing was deleted**, and they stay stopped after a reboot. To bring it back: `cd /opt/stacks/processmaker && docker compose start`.
- **Resources, before → after:**
  - RAM used: 4021 → 2513 MB (**−1.5 GB**). Available: 3.9 → 5.4 GB.
  - Processes: 458 → 340.
  - Idle CPU: about 2.2% less (pm-app 0.7% + pm-mysql 0.8% + pm-redis 0.8%).
  - Disk: unchanged (the data is kept).
- Afterwards: pm.zilber.tech returns 502 (its Caddy block is still there), erp.zilber.tech is OK, school.zilber.tech is OK.

### 25. Review of the two Docker prototypes (user-supplied HTML files)
- `Docker learning project.html`: a 10-section lesson plus a simulated Docker terminal. Good content and engine. Problems:
  - "Try it doesn't count" isn't enforced, because the challenges only check the end state
  - `docker run alpine` wrongly stays up
  - dark only, 10–12px text, low contrast
- `deepseek_html_….html`: Break-It scenarios, a Dockerfile analyser and a Compose visualiser. Bugs found:
  - the apt-merge warning never fires: the regex lacks the `m` flag. I verified this by running its own code, which counted 0 apt RUN lines where there are 3.
  - the network scenario hint suggests a `restart` that doesn't exist in the simulation
  - unescaped user input in innerHTML
  - a fragile Compose parser (exact 2/4-space indentation only)
  - `-it alpine` is treated as exiting
  - no persistence
- **The user chose the "full option":** a complete Docker course in pgschool's format. Decisions (asked up front):
  - **one shared account** for all courses
  - **full size**, like pgschool
  - **an accurate simulation** of Docker, "if the simulation is accurate", so accuracy will be proven against real Docker 29.7.2 on the VPS with golden tests
- The approved plan has 6 stages: platform → engine + golden tests → framework + M1–3 → M4–6 → M7–9 → dashboard and wrap-up. The full plan is in `~/.claude/plans/i-want-to-create-fluttering-sedgewick.md`.

### 26. Stage 1: multi-course platform (DONE, deployed)
**Code:**
- `src/shared/course.ts`:
  - the course model: `CourseContent` is pure data (title, brand, path, hero text, modules, games, levels, badges); `CourseUI` holds the components (ExerciseCard, ExampleRunner, PredictResult, ProjectView, games, extraPages)
  - `makeHelpers(modules)`: findItem / allItems / allConcepts / isUnlocked / composeTest / masteredConcepts. Variants are now generic for any exercise kind.
  - `setCourse()` / `course()` / `h()`, `PASS_MARK`, `commonBadges()`
- The PostgreSQL course is now a plug-in:
  - `src/courses/pg/content.ts`: data only, importable by the admin page without PGlite
  - `src/courses/pg/course.tsx`: the UI, wiring in the existing components and 12 games
  - `src/courses/pg/PgExample.tsx`: Run / Step through / predict result, moved out of ModulePage and PredictPrompt
- The shared pages now ask `course()` / `h()` instead of importing PostgreSQL content: Home, ModulePage, TestRunner, ReviewPage, CheatSheetPage, GamePage, GameShell, PredictPrompt and App (the brand, nav extras and level titles come from the course).
  - `src/content/index.ts` keeps its exports (built on `makeHelpers`), so the tests are unchanged.
  - `GameId` is now `string`.
  - `levelFor(xp, levels)`.
  - `configureProgress(key)`: the PostgreSQL course keeps `pgschool-progress-v1`, so local progress survives.
- **Accounts:** `configureSync(course)`. Progress syncs to `/api/progress/<course>`. Login and `/api/me` return `courses: { pg, docker, … }`. **Logout clears local progress for every course.** The login screen says "Zilber School account, one account for every course".
- **Server:**
  - new table `progress(user_id, course, data, updated_at)`, plus a **one-time migration** from `users.progress` (tested with an old-format database)
  - `PUT /api/progress/:course` (course id validated); `PUT /api/progress` and `/pg/api/*` still work as aliases
  - admin `users[].courses`; deleting a learner also deletes their progress
  - serves the whole `dist/`, with each section (`/pg/`, `/admin/`, later `/docker/`) falling back to its own index.html
  - **a missing `/assets/*` file now returns 404**, instead of the home page with "200 OK". After a deploy, a stale page would otherwise get HTML where it expected JavaScript.
- **Vite multi-page build:**
  - `index.html` = the home page (moved in from `school-home`)
  - `pg/index.html` → `src/entries/pg.tsx`
  - `admin/index.html` → `src/entries/admin.tsx`
  - The admin bundle is about 330 KB with **no PGlite** (checked).
- **Admin dashboard:** course tabs plus an **"All courses"** table (each learner's level, XP and modules per course, "not started" where relevant). The per-course views (learners, details, answers, struggle spots) are the earlier ones, parameterised by course. `analytics.ts` functions take a course.
- **Tests:** 348/348. The server tests now cover:
  - per-course progress
  - bad course ids
  - the old addresses
  - login returning every course
  - the "not started" flag
  - migration from the old database

**Deployment:**
- The container was renamed `pgschool-app` → **`school-app`**: same stack folder (`/opt/stacks/pgschool`, so the `.env` stays put) and same volume (`pgschool_data`). `deploy.sh` now uses `--remove-orphans`, and its health check uses school-app.
- **Caddy** (backup `Caddyfile.bak.20261005-130418`): `school.zilber.tech { encode zstd gzip; reverse_proxy school-app:8787 }`, applied with the in-container copy method; validated and reloaded.
- **Retired the `school-home` container** (`docker compose down`; its files remain in `/opt/stacks/school-home`).
- **Live checks:**
  - `/`, `/pg/`, a `/pg/` deep link, `/admin/`, `/api/health` and `/pg/api/health` all return 200, and erp is OK
  - a test account signed up once and saved progress for **pg and docker**; the admin saw both courses; the account was then deleted (0 learners)
- Updated ADMIN_GUIDE.txt (dashboard at `/admin/`, the one-container layout, editing the home page, troubleshooting, locations) and memory.
- Testing gotcha: `pkill -f "server/index.mjs"` killed my own shell, because the command line contained the same words. Use the server's PID (`$!`) instead.

### 27. Stage 2 started: Docker engine + calibration
- **Calibration run on real Docker 29.7.2** (VPS, with the user's OK):
  - script: `scratchpad/zscal.sh`, 120 recorded commands
  - isolated: only `zscal-*` names / the `zscal=1` label / compose project `zscal`; ports on 127.0.0.1, apart from one alpine container that listens on nothing
  - full cleanup afterwards: 0 leftover containers, networks or volumes; only newly pulled images were removed (busybox, nginx, redis)
  - output saved as `tests/fixtures-docker-29.txt`
- **Key facts learned:**
  - Docker 29's `docker images` columns are IMAGE / ID / DISK USAGE / CONTENT SIZE / EXTRA (U = in use)
  - a port conflict or a missing network still **creates** the container (it stays in "Created")
  - `sleep` containers exit with 137 on stop, while nginx, redis and postgres exit with 0
  - postgres without a password exits with 1 and prints its error text
  - `on-failure:2` ends as Exited after 2 restarts; `always` shows "Restarting (n)"
  - the exact error texts and exit codes (125 vs 1)
  - the BuildKit plain output and `CACHED` behaviour, and the build error format
  - Compose v5.5.0 output and naming (`zscal_default`, `zscal-db-1`, `zscal_dbdata`)
  - DNS by name only on user-defined networks ("ping: bad address 'x'")
  - table spacing = Go tabwriter (minwidth 10, padding 3; size columns right-aligned)
- **Engine files written so far** (not yet wired up or tested): `src/courses/docker/engine/types.ts` (data model), `util.ts` (tables, sizes, time phrases, shell splitting, ids, paths), `catalog.ts` (13 images with calibrated sizes, commands, files, logs, required env, data dirs, tool lists).
- Installed `yaml` 2.9.1 and `@codemirror/legacy-modes` 6.5.4.

### 28. school.zilber.tech DISABLED (user request: "disable for now, easy to restore")
- New scripts:
  - `deploy/school-disable.sh`:
    1. backs up the Caddyfile
    2. saves the current `school.zilber.tech` block to `/opt/stacks/proxy/school.caddy.enabled`
    3. replaces it with a block that returns a small HTML "temporarily unavailable" page (503)
    4. validates, then reloads (in-container copy method)
    5. stops the `school-app` container
  - `deploy/school-enable.sh`: does the reverse. It starts the container, waits for the health check, puts the saved block back, validates and reloads.
- **Run:** Caddy backup `Caddyfile.bak.20261005-135505`. school.zilber.tech `/` and `/pg/` return 503 with the maintenance page; erp is OK (303); `school-app` is stopped; the `pgschool_data` volume is kept.
- 🐛 **Found while stopping:** `school-app` exited with **137**. Node as PID 1 ignored SIGTERM, so Docker force-killed it after 10 s. **Fixed in `server/index.mjs`:** a SIGTERM/SIGINT handler closes the server and the database and exits 0 (verified locally: exit 0). This takes effect on the next deploy/enable (the image needs rebuilding: run `deploy/deploy.sh`, then `school-enable.sh` if it's still disabled).
- The admin guide (§5) now covers going offline and back, and memory notes the disabled status.
- **Docker course work is paused partway through Stage 2.** The engine core, golden replay tests, then Stages 3–6 are still to do.
- **Re-enabled the same day** (user: "reenable it for now and continue"): `deploy/deploy.sh` (ships the SIGTERM fix), then `deploy/school-enable.sh` (Caddy backup `Caddyfile.bak.20261005-135648`; the saved block was restored and then removed). `/`, `/pg/`, `/admin/` and `/api/health` return 200, and erp is OK. A `docker compose restart` afterwards was clean.

### 29. Stage 2 done: the Docker engine, proven against real Docker
**Files** (`src/courses/docker/engine/`):
- `types.ts`: images, containers (status, process, ports, mounts, per-network IPs and aliases, restart policy, health, writable layer), volumes (with file contents), networks
- `util.ts`: Docker-exact tables (Go tabwriter: minwidth 10, padding 3, right-aligned size columns), go-units sizes, "About a minute" style durations, shell splitting/quoting, deterministic ids
- `catalog.ts`: 13 images: alpine, busybox, ubuntu, debian, hello-world, nginx, httpd, redis, postgres, mysql, node, python, traefik/whoami. Sizes, default commands, files, logs, required env (postgres/mysql), data dirs, per-image tools and per-tag history.
- `shell.ts`: inside containers:
  - the filesystem: image files + volumes + bind mounts + writable layer, deletions, read-only mounts
  - commands: ls, cat, echo with `>`/`>>`, env, hostname, ping, getent, nslookup, curl, wget, mkdir, rm, pg_isready, redis-cli…
  - `sh -c` scripts with `;` `&&` `||` `|`
  - main processes: servers with ports and docroots, built node/python apps parsed for port and response, `sleep N` timers, idle shells
  - healthchecks
- `engine.ts`: the Docker CLI:
  - containers: run/create/start/stop/kill/restart/rm/ps/logs/exec/inspect/port
  - images: pull/images/rmi/tag/history
  - volume/network/container/system subcommands
  - Docker-style flag parsing, Go-template `--format`, and the host shell (cd, ls, cat, echo, curl, sleep = time passes, pipes to head/tail/grep/wc)
- `dockerfile.ts`: parser (continuations, exec/shell form), **BuildKit-style builder** (step numbering, CACHED, chained cache keys, multi-stage, `COPY --from`, .dockerignore, ARG/ENV substitution, build errors with source context), RUN simulation (apt/apk/npm/pip with realistic failures), and a **linter** (with the prototype's apt bug fixed)
- `compose.ts`: YAML via the `yaml` package; validation (typos, undefined services/volumes/networks, cycles); up/down/ps/logs/config/build/pull/start/stop/restart/exec/rm; v5 naming and output; `depends_on` conditions with healthchecks

**Golden test** (`tests/docker-golden.test.ts`): replays **all 117 recorded commands** from the real Docker 29.7.2 session and compares output and exit codes, normalising only noise (ids, digests, times, IPs, PIDs, column widths that depend on time-phrase lengths, YAML-parser wording). **117/117 match; the list of known differences is empty.**
- Real bugs found by the replay and fixed:
  1. the flag parser stored `--network` under `--net`, so `--network` was silently ignored
  2. endpoint and sort order (Docker sorts by byte order: `-` before `_`)
  3. BuildKit step order for first vs cached builds
  4. two missing export lines
  5. the host shell passed `2>&1` to docker as an argument
  6. `compose logs web` included dependencies
  7. Compose's concurrent create-line order
  8. per-tag base layers (alpine:3.20)

**Behaviour tests** (`tests/docker-engine.test.ts`, 22 tests): -it vs exit, sleep timers, --rm, a missing binary leaving the container Created (127), unless-stopped vs a manual stop, nginx on a published port, a wrong container port giving "connection reset", bind mounts (live edits, read-only), volume persistence vs the writable layer, postgres initialising into its volume, DNS only on user-defined networks plus `network connect`, HTTP by service name (not localhost), building and serving a real Node app, a missing COPY giving "Cannot find module", apt on alpine, install without -y, npm ci without a lock file, layer cache invalidation, .dockerignore, multi-stage size and serving, compose DNS, `down -v`, typos, unhealthy dependencies, and the linter.
- Bugs fixed while writing these tests: an empty-string truthiness check made `npm` look missing in builds; app response detection only accepted the variable name `res`.

**VPS hygiene:** the calibration's before/after image comparison missed `alpine:latest` and `hello-world:latest` (pulled by the run). I removed them, plus the superseded `pgschool:latest` image (replaced by `zilber-school:latest`). Only the owner's images remain, and all services are up.

## 30. Stage 3 (in progress): Docker course framework, modules 1–3 and their games

- **Checker** (`src/courses/docker/check.ts`): runs the learner's answer and the reference on identical simulated machines. It compares containers, images, volumes, networks and command output, and gives specific feedback (wrong name, swapped `-p`, missing `-d`, …). Containers Docker named itself are matched by image and command.
- **Misconception detector**: covers 17 common mix-ups.
- **UI**:
  - `DockerExerciseCard` (editor, Run, Check, scratch terminal, hints, engine view)
  - live example terminals
  - a Playground page
- **Content**: modules d01 (Images & containers), d02 (Lifecycle), d03 (Ports). In total: 16 concepts, 31 practice items, 18 test items.
- **Games**: Engine Match, Lifecycle Rush and Port Traffic Control, on a shared mission framework (par, hints, timer).
- **Simulator fixes**: `$(…)` substitution, options after the image go to the entrypoint (redis config error), realistic whoami replies, `mkdir` with empty directories, a side-effect-free `probe()`.
- **Platform**: `/docker/` entry, Docker added to `COURSES`, course-specific exercise-kind labels, the home-page Docker card is live ("early access"), prediction explanations render markdown.
- **Tests**: docker-content (60) and docker-games (26), plus new engine tests. Added happy-dom and testing-library. All 580 pass; the build is OK.
- **Local browser check**: the home page, Learn tab and predictions work.
  - Fixed: double-spaced terminal lines (class clash, `term-out` renamed to `term-screen`).
  - Seen twice and not reproduced: Chrome hung right after a login.
- **Browser walkthrough (2026-10-06, local)**: a wrong practice answer (`-p 80:8080`) got specific feedback and the HOST:CONTAINER tip; the corrected answer passed. Port Traffic Control lanes showed "connection reset", then green; scored 70 pts (3 commands, par 1). The module 1 test runs. Long text in read-and-decide items now wraps.
- **Deployed 2026-10-06** with `deploy/deploy.sh`. Live: `/`, `/pg/`, `/docker/`, `/admin/` and `/api/health` all return 200; the home page links to `/docker/` ("early access"); erp.zilber.tech unaffected. The scratch test account was deleted with its local database.
- **Stage 3 complete.** Next: Stage 4 (modules 4–6, Project A, games Data Rescue, Network Switchboard, Dockerfile Kitchen).

## 31. Stage 4 (started): simulator checks for volumes, networks, builds

Before writing modules 4–6, I compared the simulator against real Docker for volumes and networks. Already correct:
- named volumes keep data across containers, and `volume prune` only removes anonymous volumes
- bind mounts work, and read-only mounts give dash's "Read-only file system" error
- DNS works only on user-defined networks
- `network connect`/`disconnect`, `nslookup`, and network rm blocked while containers are attached

Fixed:
- Go templates now support `{{range}}…{{end}}`, `{{.}}`, `index` and `len` (e.g. `docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"`).
- `-f/--format` works on `docker volume inspect` and `docker network inspect`.
- Inside double quotes, `\` is kept unless it escapes `$`, `` ` ``, `"`, `\` or a newline, as in bash. So `--format "{{.Names}}\t{{.Status}}"` prints a tab.
- whoami answers busybox `wget` with `User-Agent: Wget` / `Connection: close` (curl keeps its own headers).
- `--network none`: pinging an IP address gives "Network unreachable". On the bridge, outside addresses such as 8.8.8.8 answer.
- `--network host`: the app's port is reachable directly on the host.

Engine tests: 235 Docker tests pass.

Next: write modules d04 (Data), d05 (Networks) and d06 (Dockerfile basics), Project A ("Run a 3-container app by hand"), and the games Data Rescue, Network Switchboard and Dockerfile Kitchen. Use the same patterns as d01–d03 and the mission framework in `src/courses/docker/games/missions.ts`. Then validate, walk through in the browser, and deploy.

## 32. Stage 4 complete: modules 4–6, Project A, three games (deployed 2026-10-06)

**Content**
- **Module 4, Data** (`d04-data.ts`): containers forget; named volumes; database volumes; bind mounts; `:ro`; cleaning up volumes. 11 practice items, 6 test items.
- **Module 5, Networks** (`d05-networks.ts`): default bridge (IPs, no names); user-defined networks; connect by name, not localhost; isolation between networks; connect/disconnect; host and none. 11 practice, 6 test.
- **Module 6, Dockerfile basics** (`d06-dockerfile.ts`): build and tag; RUN; COPY + WORKDIR; ENV + EXPOSE; CMD exec vs shell form; ENTRYPOINT + CMD. 11 practice, 6 test (Dockerfile exercises are built and run).
- **Project A** (`projectA.ts`, attached to module 5, not module 4 as planned, because it needs networks): "Run a 3-container app by hand" (network + Redis with a volume; API; read-only website on :8080; upgrade Redis without losing data; tear down but keep the data). Each requirement is a real command with an expected-output pattern. `DockerProjectView` replaces the stub: requirements with ✅/❌ and a "why?" button showing the check and its output, Run/Check, hints, our approach.
- **Games**: Data Rescue (6 missions), Network Switchboard (6, with a live board of which connections work), Dockerfile Kitchen (6 orders, its own screen: write a Dockerfile, "Build & taste", par = 1 build).
- New misconception rules: run-vs-cmd, exec-form-vars, kill-loses-redis. Badges: Data Keeper, Switchboard Operator, Image Chef, Shop Builder. Home card: "6 of 9 modules ready", "6 games · 1 project".
- Lesson cards now render Markdown tables (added `remark-gfm`); the module 1 table was showing as raw text too.

**Simulator accuracy fixes** (found while writing and checking the lessons)
- Images that declare `VOLUME` (postgres, redis, mysql, Dockerfile `VOLUME`) get an anonymous volume; `rm -v`/`--rm` remove only volumes created for that container.
- A new, empty named volume is first filled with the image's files at that path (copy-up).
- Bind paths are made absolute; `-v` creates a missing host folder, `--mount` refuses it.
- **Redis keeps data in memory**: written to `/data` on `SAVE`, on `docker stop` (with the real shutdown log lines), or on every write with `--appendonly yes`. `docker rm -f`/`kill` lose unsaved changes. Lessons and Project A teach "stop, don't kill".
- `redis-cli -h`, `pg_isready -h`, `nc -z`, `psql` (connects; says it doesn't run SQL), `date`, `curl --version`, `wc -l FILE`, `< file` input.
- Host shell: `$VAR` expands like bash (`$PWD`, `$HOME`, `$USER`; unknown → empty), so `sh -c "echo $X"` behaves as in real life (the course now uses single quotes there); `cmd > file`, `>>`, `>/dev/null`; plain `ls` in an empty folder.
- `docker cp` (both ways, works on stopped containers), `--volumes-from`, `docker start -a`, `volume prune -a` with combined flags, `network ls`/`volume ls --format`.
- Networks: a stopped container doesn't block `network rm` but then fails to start ("network … not found"); `--network host` discards `-p` with Docker's warning and shows no PORTS.
- Alpine variants (`node:22-alpine`, `redis:alpine`, `nginx:alpine`…) are really Alpine: busybox tools, `apk`, no bash, Alpine base layer in `docker history`; layer sizes add up to the tag's size.
- Node/Python scripts that don't start a server print and exit (console.log/print with env lookups); `python3 -c`, `node -e`.
- Go templates: `{{range $k, $v := …}}` and `$` variables.
- Checker feedback shows the most telling line (the error line, or `exec: "Ada": executable file not found`) and merges network differences into one sentence.

**Checks**: 689 tests pass (engine, golden, content incl. project validation, games incl. traps). Build OK. Local browser walkthrough: module 4 bind-mount prediction runs; Project A task 1 with a missing volume shows 5/6 met and a "why?" with the inspect output; Kitchen order 1 (RUN instead of CMD fails tasting, CMD passes, 85 pts for 2 builds); Switchboard round 1 lights the line, 100 pts. Temporary helpers `tests/_explore.test.ts`/`_show.test.ts` and the scratch database/test account were deleted.
**Deployed** with `deploy/deploy.sh`: `/`, `/pg/`, `/docker/`, `/admin/`, `/api/health` all 200; erp.zilber.tech unaffected.

Next: Stage 5 (modules 7 Better images, 8 Compose, 9 Production & troubleshooting; Project B; games Layer Diet, Compose Architect, Break It; finale Production Incident).

## 33. Stage 5 complete: modules 7–9, Project B, four games incl. the finale (deployed 2026-10-06)

**Content** (the Docker course now has all 9 modules, 10 games and 2 projects)
- **Module 7, Better images** (`d07-images.ts`): layers and the build cache; ordering for the cache; `.dockerignore`; smaller bases and cleaning up in the same RUN; multi-stage builds; non-root USER and pinned tags. 11 practice, 6 test.
- **Module 8, Docker Compose** (`d08-compose.ts`): compose.yaml + up/ps/down; ports/environment/build and `${VAR:-default}` from `.env`; volumes (down vs down -v); networks and isolation; depends_on + healthcheck; logs/exec/re-running up. 11 practice, 6 test.
- **Module 9, Production & troubleshooting** (`d09-production.ts`): restart policies and crash loops; healthchecks; memory/CPU limits and OOM kills; exit codes (0/1/125/126/127/137/143, PID 1 and `--init`); a troubleshooting routine; df and prune. 11 practice, 6 test.
- **Project B** (`projectB.ts`, after module 9): "Containerise and compose an app", 4 tasks: the production Dockerfile (checked for non-root, size, cached install, no .env inside); the compose stack with a healthy-db dependency and the password from `.env`; hardening (limits, a cache service); a 3 a.m. OOM incident fixed by editing compose.yaml. Project tasks can now take a Dockerfile or compose.yaml as the answer (`docker.target`, `tag`, `starter`); the editor switches mode accordingly.
- **Games**: Layer Diet (6 diets: size target, cache-hit after a code change, .dockerignore editor, analyser with size bar/heaviest layers/rebuild report), Compose Architect (6 blueprints, deploy + live topology view), Break It (8 on-call incidents on the mission framework), and the finale **Production Incident** (one machine, six acts in 20 minutes: find the crash loop, fix the OOM, the wrong port, the wrong data path, clean the disk, make it reboot-proof).
- Checker: `rebuild` (edit a file, rebuild, required steps must be CACHED) and `user` checks for Dockerfile answers; listings with a few extra/missing lines are named ("also shows `.env`, `.git`"); build and compose failures quote the real error.
- Misconceptions: layers-only-add, user-before-root, user-missing, oom-137, restart-not-a-fix, compose-healthy, compose-bind-dot; copy-order now also covers pip. Badges: Lean Machine, Compose Captain, On Call, Shipped It. Home card: "9 modules", "10 games · 2 projects".

**Simulator accuracy** (calibrated on the VPS's real Docker 29.7.2 where marked ✓; isolated `zscal` run, cleaned up, the pulled alpine image removed again)
- ✓ `--memory`/`--cpus` (HostConfig.Memory/NanoCpus), "Minimum memory limit allowed is 6MB"; a process over its limit is OOM-killed: exit 137, `State.OOMKilled=true`, no output. Memory model: idle footprints per image; Node/Python scripts add what they allocate (`Buffer.alloc(N * 1024 * 1024)`).
- ✓ `docker stats` (table and `--format`), `docker update` (restart policy, limits).
- ✓ Crash loops: RestartCount grows with Docker's back-off (0.1 s, doubling, max 1 min); each attempt repeats its log lines; `update --restart no` ends the loop.
- ✓ Healthcheck `FailingStreak`; `--health-interval/-retries/-timeout/-start-period` accepted.
- ✓ Unknown tag of a known image: "failed to resolve reference … not found" (pull, run, build FROM).
- ✓ Unknown USER: "unable to find user app: no matching entries in passwd file" (exit 125, left Created); `-u 1000` works, `whoami` says "unknown uid". `id`/`whoami` now use /etc/passwd (image users, `adduser`/`useradd` in builds with real uid rules). After USER, `apk`/`apt-get`/`adduser` in RUN fail with permission errors.
- ✓ Compose: "Recreate → Recreated"; re-running `up -d` after a rebuild recreates the service (it didn't before: `up -d --build` kept the old container). Also new: `.env` + `${VAR}`, `${VAR:-x}`, `${VAR:?err}`, `$$` interpolation with the real "variable is not set" warning; `env_file`; `mem_limit`/`cpus`/`deploy.resources.limits`; `init`; `ps --format`; `down --rmi local|all`; "services.X must be a mapping".
- A Node/Python app as PID 1 ignores SIGTERM: `docker stop` ends in 137; with `--init` it's 143.
- Dangling images are kept as `<none>:<none>` after a rebuild takes their tag (they were silently deleted before), so `image prune` has something to do.
- `system prune` parses combined flags (`-af`), `--volumes`, the `-a` warning text, and lists untagged images; exit 126 for running a non-program file; `logs -t`; host `sed -i 's/…/…/' FILE` (incl. `\n` in the replacement).
- Build-step parsing helper `buildSteps()` for cache checks (used by the checker, Layer Diet and Project B).

**Other**: after a deploy, an open tab that can't load a renamed code chunk now reloads once instead of showing "Something went wrong" (found during the walkthrough).

**Incident note**: a careless multi-line search/replace in engine.ts (anchor text that appeared twice) deleted `cmdContainerGroup`'s prune, `system df` and the new `stats` command mid-session; restored from Claude Code's file history and re-applied. Edits since then use a helper that refuses non-unique anchors.

**Checks**: 774 tests pass (every new exercise's solution passes and wrong example fails, every project task's reference meets all requirements, every game level solvable within par and unsolved at the start, traps). Every predict question in modules 7–9 was replayed and matches its stated answer. Build OK. Local browser walkthrough: module 7 prediction (cache), Layer Diet round 1 (100 pts, analyser + rebuild report), Production Incident act 1 → 2, Project B task 1 "why?" output, Compose Architect round 1 with topology. Scratch tests, local server and test account removed.
**Deployed** with `deploy/deploy.sh`: `/`, `/pg/`, `/docker/`, `/admin/`, `/api/health` 200; new game chunks served; erp.zilber.tech unaffected (303 to login). No server code changed in this stage.

Next: Stage 6 (admin dashboard verification for the Docker course, ADMIN_GUIDE update, final deploy and full walkthrough).

## 34. Stage 6 complete: admin dashboard for the Docker course, guide, final deploy (2026-10-06)

**Admin dashboard: verified with Docker data, one gap fixed.**
- **Gap fixed:** project answers were never saved, only a done/not-done flag. Both courses now save them.
  - `progress/store.ts` gains `projectAnswers` (latest answer, time, ok, number of checks) and `recordProjectCheck()`, which replaces `recordProjectTask`.
  - Both ProjectViews (PG and Docker) record every check, including failed ones.
- `admin/analytics.ts`: `answersOf()` now also returns `projects`.
- `AdminPage.tsx`, learner details:
  - a "Project" column ("1/4 tasks") in the per-module table
  - a "Projects (latest checked answer per task)" section with done / not done yet, task number, checks and "latest check failed"
- Everything else was already per course: switcher, summaries, struggle spots. Docker answers (commands, Dockerfiles, compose files) show in the same `<pre>` blocks.
- **Tests:** two new tests in `tests/server.test.ts`:
  - Docker analytics: summary, struggle spots, practice and project answers
  - a server render of `LearnerDetail` for a Docker learner
- All 776 tests pass; the build is clean.
- **Local browser walkthrough** (throwaway server and account, deleted afterwards):
  - signed up, checked Project B task 1 twice (starter fails, reference passes)
  - progress synced and the admin API showed the answer
  - Viewing the admin UI in the browser was skipped: putting the admin token into the browser was blocked by a permission check. The render test covers the view instead.

**ADMIN_GUIDE.txt (mode 600, password section untouched):**
- §2: Docker is a browser simulation, no longer "being built"
- §4: modules out of 10 / 9, Docker answer types, the project column and answers, which modules have projects, and that project answers exist from 2026-10-06 on

**Home page:** the Docker badge "New · early access" is now "New".

**Deployed twice** with `deploy/deploy.sh`.
- `/`, `/pg/`, `/docker/`, `/admin/` and `/api/health` return 200; erp.zilber.tech is unaffected (303).
- **Live round trip:** a test account signed up, saved pg and docker progress (with a project answer); the admin API showed both courses and the answer; the account was then deleted. 0 learners are left on the live site.
- A browser check of the live home page, `/docker/` and `/admin/` was OK.

**The plan (Stages 1–6) is complete.**

## 35. New course planned: System Design (2026-10-10)
**The user asked for a third Zilber School course: a full interactive course on system design.**
- **Decisions:** for working developers (practical; interview-style designs as capstone projects); build-and-simulate (learners build architectures on a canvas and run simulated traffic and failures); full size (~10 modules, ~6 scenario games + a finale, 3 projects).
- **Games:** the user asked whether games make sense here. Answer: yes, as scenario challenges on the same simulator (survive a spike, fix an outage, hit a target for the least money), but not one per module for symmetry.
- **Plan:** `~/.claude/plans/foamy-marinating-beacon.md`. Course id `sd`, served at `/design/`. A deterministic discrete-event simulation engine whose accuracy is proven by tests against queueing theory (M/M/c, Little's law, Che's LRU approximation, redundancy, retries, token bucket, queue drain).
- **Stages:** 1 engine + theory tests · 2 framework (canvas, YAML view, run panel, exercise kinds) · 3 modules 1–4 · 4 modules 5–7 + Projects A/B · 5 modules 8–10 + Project C + finale · 6 admin, guide, launch.

## 36. System Design Stage 1 complete: the simulation engine (2026-10-10)
**`src/courses/sd/engine/`**: a deterministic discrete-event simulator for architectures. Pure TypeScript, no DOM, seeded.
- **Kernel** (`kernel.ts`): virtual clock, binary heap, generator-based processes (`yield` a Signal), FIFO resources with time-weighted stats. Timeouts of one length share a FIFO line instead of heap entries (keeps the heap small).
- **Model** (`types.ts`, `defaults.ts`): client, cdn, ratelimiter, lb, app, cache, db, queue, worker, objectstore, external; edges carry timeout/retries/backoff/jitter/breaker/bulkhead/optional. Defaults and rounded cloud prices are documented in `defaults.ts`.
- **Mechanics** (`simulate.ts`), all emergent rather than scripted:
  - app: threads, CPU cores, per-instance DB pool, local/shared sessions, single-flight, cache-aside / write-through / write-back, writes via a queue, autoscaling with boot time
  - LB: round robin / least-conn / random / sticky, health checks (hung instances need timeouts)
  - cache: real LRU per node, key-hash sharding, single thread (hot keys), TTL, flush
  - db: work slots, connection limits, read replicas fed by an **ordered replication stream** with a single apply thread (lag grows under write load), semi-sync replicas, failover (lost acknowledged writes counted), sharding (hash / range / consistent ring, by key or by user), scatter-gather queries, leaderless quorums (n, w, r), shard add with migration load
  - queue/topic: at-least-once with visibility timeout, redelivery after worker crash, poison messages, DLQ, idempotent workers
  - failures: kill, hang, slow, flush, AZ down/up, partitions, random MTBF/MTTR
  - truth tracking: versions per key → stale reads, read-your-writes violations, lost writes, duplicates
  - results: p50/p95/p99, errors by type and origin, per-node utilisation (and hottest instance), cost per month, phases, time series, any window
- **Also:** `validate.ts` (plain-language design errors), `requirements.ts` ("p99 < 200ms", "during outage: errors < 1%", "util(db) < 70%" + a diagnosis that names the cause), `yaml.ts` (design ⇄ YAML with per-field checks), `theory.ts` (Erlang C, M/M/c, Che, availability, retries, drain, moved keys), `run.ts` + `worker.ts` (runs in a Web Worker).
- **Proof of accuracy** (`tests/sd-theory.test.ts`, 15 tests): M/M/1 mean and p99, M/M/4 and M/M/8 (Erlang C), utilisation, Little's law, overload rejection rate, LRU hit ratio vs Che's approximation (3 skews), MTBF/MTTR availability for 1–3 instances, retry amplification, token bucket, queue drain time, keys moved (mod-N vs consistent hashing). Across seeds the simulator is unbiased (within ~1%).
- **Behaviour tests** (`tests/sd-engine.test.ts`, 42 tests) for every component and failure type, incl. a metastable-failure case (huge queue + retries never recovers; a bounded queue does). `tests/sd-requirements.test.ts` (6 tests).
- **Bugs found by the tests and fixed:**
  - the LB's round-robin counter was shared with the code picking the LB instance, so with zero network delay every request went to the same server (regression test added)
  - failover counted unacknowledged writes as lost
  - replication could reorder writes, so the "most up-to-date" replica was ambiguous
  - local sessions let a user keep a session on every server
- **Deviation from the plan:** speed is ~130k requests/s (a 5k req/s × 60 s run of a full web stack takes ~2.3 s), not the <1 s target. The planned "fluid mode" was dropped: instead a run is capped at 400 000 requests (clear error message), lessons use modest rates, and runs happen in a Web Worker.
- **Checks:** all 839 tests pass (776 existing + 63 new); build OK. Nothing user-facing yet, so no deploy for this stage.

## 37. System Design Stage 2 complete: the course framework (2026-10-10)
**The course now runs at `/design/`** (course id `sd`). The home page shows a "Coming soon" card, not yet a link.
- **Platform wiring:**
  - `design/index.html`, `src/entries/design.tsx` (progress key `zs-progress-sd-v1`, sync target `sd`), a `design` input in `vite.config.ts`, `sdContent` in `COURSES` (the admin dashboard lists it).
  - No server change.
- **Small shared additions:**
  - `CodeEditor` moved from the Docker course to `src/components/` (the Docker imports were updated).
  - `CourseUI.PredictSetup` (what a learner sees before predicting; the default is still the code as text).
  - `CourseContent.itemLabel` (per-item names in the practice list).
  - Content types: `SdSpec` (`sd` on exercises), and `verify` on predictions and choice items (facts about a real run that prove the stated answer).
- **Exercise kinds:**
  - The course reuses the platform kinds, the way Docker did:
    - `write` = design it
    - `fixBug` = fix the design, or with `tuneOnly`, tune it (settings only; changed topology is rejected)
    - `fillBlank` = YAML with `___`
    - `readQuery` with a scenario in `sql` = diagnose (the run is shown as evidence)
    - `parsons` = put steps in order
  - Estimates are `write` + `sd.target: 'estimate'`:
    - they accept "1.2k", "3.5 million", "86 400"
    - the tolerance is 25% by default
    - feedback says "2.5× too low" or "1 order of magnitude too high"
- **Scenario format** (`engine/scenario.ts`): one YAML for a design plus traffic, run settings, events, phases and requirements.
  - Times can have units: `20s`, `500ms`, `2m`.
  - Errors are in plain language.
  - It round-trips with `scenarioToYaml`.
- **Checking** (`check.ts`):
  - A design passes by meeting its requirements when run, not by matching a diagram.
  - Blanks, broken YAML and changed topology are caught before running.
  - The run happens in the Web Worker; tests run it on the spot.
- **Misconception detector** (`misconceptions.ts`), shown under a failed check:
  - p99 vs average
  - caching writes
  - local sessions behind a load balancer
  - retries without backoff
  - single point of failure
  - read-your-writes from a replica
  - hot shard
  - idempotency
  - instances × pool > the database's connection limit
- **UI** (`ui/`):
  - **Canvas** (React Flow `@xyflow/react`, pinned at 12.11.6):
    - a palette and drag-to-connect; connection rules give plain feedback ("drag from the caller")
    - nodes coloured by how busy they were in the last run, with stats
    - edge labels for timeouts and retries
    - auto layout from left to right
    - it fits itself once measured and whenever it is resized
  - **Settings panel:** every setting with a one-line explanation and its default; grouped settings (autoscale, quorum, breaker, health checks).
  - **YAML tab:** the same design as text, kept in sync, for keyboard and screen-reader users and for copy/paste.
  - **Run panel:**
    - a requirements checklist
    - headline numbers
    - SVG charts (latency p50/p99, succeeded vs failed per second, backlog, instances, hit ratio) with failure events and phases marked
    - the simulator's diagnosis and a per-component table
  - **Learning pages:**
    - worked examples are editable and re-runnable
    - predictions show the design first, then run it
    - project view
  - **`/sandbox`:** 5 presets, a free design plus a traffic/failures/requirements editor, kept in this browser.
- **Draft module 1 (Foundations):**
  - 4 concepts, 7 practice items (one of every kind) and 3 test items.
  - It exercises the whole framework; Stage 3 completes it.
- **Engine change:** connections from a load balancer to app servers now honour `timeoutMs`, `retries`, `backoffMs` and `jitter`.
  - Before, they were silently ignored.
  - A retry goes to a different backend.
  - A breaker, maxConcurrent or optional setting there gives a warning.
  - Found during the walkthrough: the "Survive a crash" preset leaked ~6% errors until health checks caught up.
- **Tests:**
  - `tests/sd-content.test.ts`:
    - every reference design meets its requirements; every wrong example and starter fails
    - every prediction and diagnose question is backed by `verify` facts from a real run
    - estimate solutions parse
    - every sandbox preset meets its own requirements
  - `tests/sd-framework.test.ts`: scenario YAML, estimates, checking, canvas edits, misconceptions.
  - 3 new engine tests for load balancer connection settings.
  - The content tests caught that bandwidth counts toward the monthly bill, so the cost limits were raised to match.
- **Local browser walkthrough** (throwaway server and account, deleted afterwards):
  - The prediction ran in the worker, and the charts and busy bars showed.
  - An edited example re-ran.
  - "Tune it" failed with the starter (63% errors), then passed with 4 instances.
  - The diagnose question auto-ran and showed the database in red.
  - An estimate: "100" was rejected, and "12 req/s" was accepted.
  - A sandbox preset ran.
  - Fixed during the walkthrough:
    - the canvas fitted before it was measured (it showed up tiny)
    - failed requirements were listed twice
    - load balancers showed a meaningless "0% busy"
    - two presets didn't meet their own requirements
- **Checks:** 884 tests pass. Build OK. The design page loads neither PGlite nor the Docker engine, and the simulator is its own worker file.
- **Deployed** with `deploy/deploy.sh`:
  - `/`, `/pg/`, `/docker/`, `/design/`, `/admin/` and `/api/health` return 200; the home page shows the "Coming soon" card.
  - Live round trip: a test account signed up and saved `sd` progress, the admin API showed it under the `sd` course, and the account was deleted (no test accounts left).
  - erp.zilber.tech is unaffected (its usual redirect to login).

## 38. System Design Stage 3 complete: modules 1–4 and three games

- **Content** (`src/courses/sd/content/`):
  - **Module 1, Foundations:** completed. Adds a "latency numbers" lesson, 3 practice items (including the first build-from-scratch design) and 3 test items. Totals: 5 lessons, 10 practice, 6 test.
  - **Module 2, Back-of-the-envelope** (`s02-estimation.ts`): requests per second and peaks, storage, bandwidth and its bill, cache sizing, server counts. 5 lessons, 10 practice, 6 test.
  - **Module 3, Scaling compute** (`s03-compute.ts`): scale up vs out, stateless servers, load-balancing algorithms, health checks and retries, autoscaling. 5 lessons, 10 practice, 6 test.
  - **Module 4, Caching** (`s04-caching.ts`): cache-aside, invalidation and TTL, memory and eviction, write-through vs write-back, stampedes, CDNs. 6 lessons, 10 practice, 6 test.
  - Every number in the lessons comes from a real simulator run: the content tests check each prediction's `verify` facts, each diagnose question, each solution (passes), and each wrong example and starter (fail).
- **Games** (`src/courses/sd/games/`):
  - **Napkin Math** (module 2): 10 estimates from 12 templates with fresh numbers each play. Points for accuracy (10%, 25%, 50%) and speed (full marks for the first 15 s).
  - **Traffic Surge** (module 3, 5 levels): morning rush, logged-out users, slow requests, a crash at the peak, TV-ad waves with autoscaling.
  - **Cache Me If You Can** (module 4, 6 levels): a cache too small, a bigger database or a cache, stale prices, the home-page stampede, a cache restart, images through a CDN.
  - The scenario games share `SdRounds.tsx` and `rounds.ts`, and later games will reuse them. Passing a level scores 70; 30 more for cost (full at or under par, none at 1.5× par); a hint costs 20.
- **Tests:** `tests/sd-games.test.ts`.
  - Every level's starter fails, and its reference solution passes at or under par.
  - Each par is tight (within 15% of the solution's cost).
  - Every Napkin template's answer matches its worked steps; scoring is checked.
- **Platform fixes** (shared by all courses):
  - **Modules without a game** (1, and later 5, 8 and 10): no Play tab or Play pill. Their progress counts Learn, Practice and Test (before, it divided by zero). The last practice item leads to the test.
  - **"Game Master" badge:** needs 30 stars, or every star when a course has fewer than 30 to offer.
  - **Admin table:** shows "–" for a module without games.
- **Calibration findings** (from probe runs, so the lessons say what really happens):
  - **Bandwidth often dominates the bill.** Some exercises set `readKb` low so that server choices matter.
  - **Cost is per core whatever the size:** 8 small, 4 medium, 2 large and 1 xlarge cost the same.
  - **Autoscaling** with the defaults (60 s boot, a check every 15 s) can't follow a 10-second ramp. The lessons teach boot time and check interval.
- **Local browser walkthrough** (throwaway server on port 8799, test account; the server was stopped and its data deleted afterwards):
  - Napkin Math scored an answer and showed the worked steps.
  - Traffic Surge level 1 passed at $354/month (par $360) for 100 points.
  - The next level loaded. Fixed: the page now scrolls to the top for a new level.
  - The module 4 lesson page rendered.
  - Module 1 now shows Learn, Practice and Test only.
- **Checks:** 957 tests pass. Build OK. The games are separate lazy chunks.
- **Deployed** with `deploy/deploy.sh`:
  - `/`, `/pg/`, `/docker/`, `/design/`, `/admin/` and `/api/health` return 200.
  - The live bundle matches the build.
  - The home card still says "Coming soon".
  - erp.zilber.tech is unaffected (303 to login).

## 39. System Design Stage 4 complete: modules 5–7, Projects A and B, two more games (2026-10-20)

**Content** (all calibrated against simulator runs, checked by `tests/sd-content.test.ts`):
- `s05-databases.ts` — Databases at scale: SQL vs NoSQL, read replicas, replication lag, read-your-writes, connection pools. 5 concepts, 10 practice, 6 test. No game.
- `projectA.ts` — URL shortener (zil.ink): 2 estimates (redirects/s, storage), launch design (4,000 req/s, < $1,100), read-your-writes with replicas, a viral link (2,000 → 6,000 req/s, 70% on one link; passes with a CDN caching redirects or ~9 app servers).
- `s06-partitioning.ts` — Partitioning: why shard, hash vs range (increasing ids → hot last shard), hot keys (12 shards still fail; a cache fixes it), consistent hashing (hash mod N moves 80% of keys going 4 → 5, consistent ~21%), choosing the partition key (scatter-gather vs shardBy user). Game: Shard Shuffle.
- `s07-async.ts` — Async & messaging: queues for slow work, backlogs and backpressure, queue vs topic, retries / poison messages / DLQ, at-least-once and idempotency. Game: Queue Pressure.
- `projectB.ts` — News feed (Chirp): fan-out estimate, fan-out on read (replicas), fan-out on write (queue + workers + cache), the celebrity (2,000 fan-out jobs must drain in 30 s; more workers alone make reads slow, a bigger DB or 2 shards works).

**Games:** `shards.ts` (5 levels: shard count, range → hash, viral product → cache, consistent hashing, shardBy user) and `queues.ts` (5 levels: CPU-bound workers, I/O-bound concurrency, flash sale with a bounded queue, poison pill → DLQ, double charges → visibility timeout + idempotency). Both use SdRounds; registered in `registry.ts`, `levels.ts`, `course.tsx`.

**Badges:** Replica Wrangler, Link Shrinker (Project A), Shard Shaper, Queue Tamer, Feed Builder (Project B).

**Engine changes:**
- LRU cache rewritten as map + linked list: a hit no longer deletes and re-inserts into a JS Map. A 10-app, 1M-key run went from 4.2 s to 0.87 s with identical results (same event count).
- Topic subscribers no longer count as duplicates: side effects are tracked per worker group.
- Workers have 2 CPU cores (they're billed as small instances); `concurrency` only sets messages in progress. Before, concurrency 200 meant 200 free cores. Theory test (queue drain) and one engine test updated; sandbox "Queue + workers" preset now uses 4 workers.
- New requirement measure `keysMoved` (alias `moved`), shown in the run panel as "keys moved between shards".
- New tests: topic duplicates = 0, worker CPU limited by cores, keysMoved parsing.

**Checks:** 1,026 tests pass; build OK (ShardShuffle and QueuePressure are lazy chunks). Local walkthrough on a throwaway server: module 5 page (Learn/Practice/Test/Project, no Play), Project A estimate accepted, task 5 starter fails with "app servers overloaded", Shard Shuffle level 1 passed at $971 (par $1,000) for 100 pts, Queue Pressure level 1 starter fails ("workers are the bottleneck"); no console errors. Server, data and test credentials deleted.

**Deploy:** all pages 200, `/api/health` ok, live bundle `design-hJj6Zto7.js` matches the build; home card still "Coming soon"; erp.zilber.tech unaffected (303).

## 40. System Design Stage 5 complete: modules 8–10, Project C, Chaos Day and Launch Night (2026-10-21)

**Content** (calibrated against simulator runs, checked by `tests/sd-content.test.ts`):
- `s08-consistency.ts` — Consistency: CAP (a quorum store across 3 zones with zone c cut off: w2/r2 fails the c side, w1/r1 answers with stale reads), quorums and eventual consistency (R + W > N), PACELC (W = 3 waits for the slowest copy: p99 151 ms vs 77 ms), leaders/failover/elections (split brain, fencing), failover without losing writes (async loses ~100 confirmed writes; one sync replica loses none). 5 concepts, 10 practice, 6 test. No game.
- `s09-reliability.ts` — Reliability: no single point of failure (zone outage), timeouts and graceful degradation (`optional`), retries/backoff/jitter (storm 74% vs calm 21% errors in a 3 s blip), circuit breakers and bulkheads, rate limiting and load shedding (per-user vs global limit, bounded queues vs metastable failure), SLOs and error budgets. 6 concepts, 10 practice, 6 test. Game: Chaos Day.
- `s10-together.ts` — Putting it together: observability (RED/USE/traces; the error shows at the app, the cause is the saturated DB), capacity planning (N + 1), cost (right-sizing an 8× large + xlarge setup from $1,900 to ~$360), a design-review method. 4 concepts, 10 practice, 6 test. Game: Launch Night (finale).
- `projectC.ts` — Flash sale (Gigz): spike estimate (≈ 42,000 req/s), a waiting line (purchases queued, workers charge at the payment provider's 100 calls/s; no bigger database helps), never oversell (stale seat reads = 0: sync replicas or one large primary), a zone outage at the peak (3 zones, 2 replicas, 1 sync, failover, primary reads; with 2 zones the promoted replica has nobody to sync to).

**Games:** `chaos.ts` (5 levels: stuck payment provider → timeout + breaker, zone a goes dark, the queue that never empties → maxQueue, the scraper → per-user limit, chaos hour) and `launch.ts` (5 acts: traffic ramp, cold cache → read replica, primary dies → failover + sync replica, recommendations fail → optional + timeout, the whole night with a 1% error budget, where a 3 s failover alone fails it). `ChaosDay.tsx`, `LaunchNight.tsx`; registered in `registry.ts`, `levels.ts`, `course.tsx`.

**Badges:** Consistency Keeper (s08 test), Chaos Survivor (s09 test), Sold Out (Project C), Principal Architect (s10 test).

**Engine changes:**
- Sync replication: the first `syncReplicas` replicas that are up are synchronous (PostgreSQL `FIRST n`) and apply each write before it is confirmed, with no lag; the others lag. Before, the ack waited for the lagging replication stream (~1 s with a 200 ms lag), so `syncReplicas` overloaded everything. Module 5 texts updated (sync replicas cost a millisecond or two; the catch is availability). s05-p9 now also accepts 3 replicas + syncReplicas 3.
- Load balancer nodes skip backends they can't reach during a partition.
- `cpu()` no longer releases a core it never got (instance died while waiting): utilisation could go negative and dead workers gained phantom cores. One engine test relied on that and was fixed (cpuMs 50 → 10).
- New traffic option `abuser: { share, from, to }`: one client sends that share of requests; they load the system but aren't counted in the results.
- External APIs are billed per service (`g.handled`), not all external calls each, with a new `pricePerMillion` (default 5; 0 for your own service). The rate limiter is now a fixed $20/month (a proxy feature), not $1 per million checks.
- New engine tests: sync replicas, partition-aware LB, abuser, utilisation after a kill, per-service external billing.

**Framework:** prediction questions are rendered as markdown (bold showed as `**` in every module; Docker's `*inside*` too). The sandbox now has the promised "What this simulator simplifies" card (`ui/Simplifies.tsx`), which was missing.

**Checks:** 1,097 tests pass; build OK. Local walkthrough on a throwaway server: module 8 prediction and example (1,965 stale reads, matches the tests), markdown in questions, Chaos Day round 1 passed at $1,035 (par $1,050) for 100 pts by setting a timeout and breaker in the settings panel, module 10 tabs (Learn/Practice/Play/Test/Project), Project C task 2 starter fails with "pay rejected requests over its rate limit", sandbox card present; no console errors. Server and data deleted.

**Deploy:** all pages 200, `/api/health` ok, live bundle `design-CzZn2-he.js` matches the build and the live content chunk has Launch Night; home card still "Coming soon"; erp.zilber.tech unaffected (303).

## 41. System Design Stage 6: launch (2026-10-21)
The System Design course is live and listed on the home page.
- **Home page:** the System Design card is now a link to `/design/` with the "New" badge (was "Coming soon"); the unused `.card.soon` style was removed. The `--sd` colour token already existed for light and dark mode.
- **Admin:** estimate answers (stored as a bare number) are shown with their unit, e.g. "1200 requests/s", in practice, project and test answers (`withUnit` in `src/pages/AdminPage.tsx`). Designs already show as YAML in the existing `<pre>` blocks.
- **Tests:** two new tests in `tests/server.test.ts` ("dashboard analytics: System Design"): `summarize`/`answersOf` for an sd learner, and a `LearnerDetail` render with a design answer, an estimate with its unit, a multiple-choice answer, a project answer and a test answer. 1,099 tests pass; build OK.
- **ADMIN_GUIDE.txt:** added the System Design course (what runs in the browser, the `/design/` route, modules out of 10, how designs and estimates appear in answers, its three projects and how they're checked). Password section untouched; mode still 600.
- **Deployed** with `deploy/deploy.sh`. Live checks: `/`, `/pg/`, `/docker/`, `/design/`, `/admin/`, `/api/health` all 200; the home page links to `/design/`; erp.zilber.tech still 303.
- **Live round trip** (throwaway account `zz_sdcheck_…`): signup 201 → PUT `/api/progress/sd` 200 → admin login → `/api/admin/users` shows the sd exercise and project answers → delete 200 → the account is gone.
- **Browser:** the live home page shows three cards; clicking System Design opens the course map with no console errors.

## 42. Works offline: installable web app (2026-10-24)
After one online visit, all three courses open and work with no connection; progress made offline is merged into the account when back online.
- **Service worker** (`offline/sw.js`, filled in at build time by the Vite plugin `offline/plugin.ts`): precaches 61 files (~20 MB, incl. PGlite's wasm/data and the SD simulator worker; not the admin dashboard or PGlite's unused fs chunks). Pages: network first (3 s timeout), then the cached section page; `/assets/*`: cache first; `/api/*` and `/admin` never touched. The version is a hash of the file list + pages; old caches are deleted on activate.
- **Registration** in the three course entries (`src/shared/offline.ts`, production only) and the home page. Updates wait for the learner: "A new version of the course is ready · Reload" (`UpdateBanner` in `App.tsx`).
- **Installable:** `public/manifest.webmanifest` + icons (`public/icons/`, generated with PIL), manifest/theme/apple-touch tags on the four pages, and a "Works offline" box on the home page with "Install app" (beforeinstallprompt), an iPhone hint, and "✓ Ready to use offline on this device". Server: `.webmanifest` MIME type.
- **Safe offline progress** (`src/account/api.ts`, `src/progress/store.ts`):
  - `mergeProgress(local, server, syncedXp)`: solved stays solved, best scores win, newest answers kept, XP earned offline is added to the server's.
  - `zs-sync-<course>` marks unsynced local work (with the last synced XP and user id); `/api/me` and login now merge instead of overwriting it, then upload.
  - Push on the `online` event; logout asks before discarding unsynced progress; top bar: "📴 offline · saved on this device".
  - Fixed: after a failed save, the retry fired every 500 ms instead of 15 s.
- **Tests:** `tests/offline.test.ts` (9): precache list, sw.js version, merge rules, the XP baseline, sync after offline (with a fake server), and the server's manifest/sw.js headers. 1,108 tests pass; build OK.
- **Local walkthrough** (throwaway server and account, deleted): first visit cached 61 files; with the server killed, `/pg/`, `/docker/` and `/design/` opened, a real PostgreSQL query ran, a System Design simulation ran, and a concept was learned offline; after restarting the server the offline work of both courses reached the database. The update banner → reload swapped the cache. No console errors.
- **Not deployed:** the VPS went down (SSH and HTTPS unreachable; the deploy failed at its first ssh, so nothing changed there). For now the site runs locally: `bash deploy/local.sh start|stop|status|rebuild` → http://localhost:8787, data in `~/.local/share/zilber-school` (separate from the VPS database). When the VPS is back: `bash deploy/deploy.sh`.
- **Deployed 2026-10-26** once the VPS was back (the user reported no install option on Android: the phone was on the old live build). Before deploying, checked usage via the admin API: 2 accounts, none active in the last 24 h. Live checks: all pages and `/api/health` 200; `/sw.js` is JavaScript, `no-cache`, identical to `dist/sw.js`; `/manifest.webmanifest` is `application/manifest+json`; icons 200; the home page links the manifest; erp.zilber.tech 303. The live browser check was skipped (the Chrome extension was disconnected after a reboot); the same build passed the local browser walkthrough.

## 43. New course planned: Git (2026-10-26)
**The user asked what course to build next.** I recommended Git; the user agreed and asked whether learners would learn about repositories. Yes: local repositories, remotes and a simulated GitHub-style hub run through the whole course.
- **Decisions:** complete beginners; the full team workflow (clone/fetch/pull/push, pull requests, review, a teammate pushing at the same time); **compact** size (6 modules, 4 games, 1 project; the user compared it with a 10-module version and chose compact). Not covered: reset/reflog, amend, rebase, cherry-pick, stash, tags, bisect, forks.
- **The user's idea: a live commit graph** on every terminal: an auto-updating DAG with branch labels, HEAD and merge nodes, animating each operation from an event list the engine records per command (rebase-style replays are supported by the event model for later).
- **Engine:** our own synchronous TypeScript simulator, like Docker's (the user asked; isomorphic-git has no CLI or Git-style output, needs an HTTP server for remotes, lacks revert/restore and is async). Real SHA-1 objects, so hashes match real Git. Proven by a golden session recorded on real Git 2.53 and a fuzz test comparing random histories against real `git`.
- **Plan:** `~/.claude/plans/foamy-marinating-beacon.md`. Course id `git`, served at `/git/`. Stages: 1 engine + golden/fuzz tests · 2 framework (wiring, terminal, live graph, areas view, hub page, checking) · 3 modules 1–3 + Stage Manager, Branch Runner · 4 modules 4–6 + Conflict Doctor, Push/Pull Race, project, admin, launch.

## 44. Git Stage 1 complete: the engine, proven against real Git (2026-10-26)
**`src/courses/git/engine/`**: a deterministic Git simulator in TypeScript (no new dependencies). The user asked about using wasm-git or another engine; we compared (wasm-git = libgit2 sample programs, not Git's CLI or output; isomorphic-git = no CLI/revert/restore, HTTP-only remotes, async; real Git in a v86 VM = exact but 30+ MB, slow boot, slow checks) and the user chose to keep our own engine.
- **Objects** (`objects.ts`, `sha1.ts`): blobs, trees and commits serialised byte for byte like Git, so every hash is the real one.
- **Diff and merge** (`diff.ts`): ports of Git's xdiff: Myers with Git's preprocessing (trimming, discarding unmatched/multi-matched lines) + the indent heuristic for `git diff`; histogram + "zealous" conflict refinement and conflict merging for merges (merge-ort's defaults). Hunk headers include Git's default function-name context.
- **Repository and working tree** (`repo.ts`, `worktree.ts`, `merge.ts`): refs, HEAD (incl. detached), index with conflict stages, merge/revert in progress, .gitignore rules, status (renames, untracked folders, paths relative to the cwd), safe checkout (local changes carried or refused like Git).
- **Commands** (`git.ts`): init, status (-s), add, rm, mv, restore, commit (-a, -m, editor-less), log (--oneline, --graph via a port of Git's graph.c, --all, -n, --stat, -p, ranges), show (incl. rev:path), diff (incl. --staged, --stat and the combined `diff --cc` during conflicts), branch (-v, -vv, -a, -r, -d/-D, -m, -u), switch, checkout, merge (ff, ort-style 3-way, conflicts, --abort), revert (incl. conflicts, --continue/--abort, "Reapply"), config, remote, clone, fetch, pull, push (rejections, -u, --delete, --force), ls-files.
- **The hub** (`hub.ts`): https://hub.zilber.tech/ with bare repositories, protected branches (`@hub protect … [--require-approval]`), pull requests with reviews/comments, merge commits "Merge pull request #n from team/branch", and `gh pr create/list/view/diff/checkout/comment/review/merge/close`, `gh repo clone/view`.
- **The machine** (`machine.ts`): the learner and teammate Sam (`@sam …` lines), a bash-like shell (quotes, $VARS, ~, globs, `>`/`>>`/`<`, pipes, here-documents, `&&`/`||`/`;`; echo, printf, cat, ls, cd, pwd, mkdir, touch, rm, mv, cp, head, tail, wc, grep, sort), a read-only virtual `.git` folder (`cat .git/HEAD`), `rm -rf .git` forgets the repo. A clock that moves 60 s per command.
- **Events per command** for the live graph: commit, ref (with fast-forward), head, transfer (clone/fetch/push), conflict, repo, pr.
- **Proof against real Git 2.53:**
  - `scripts/record-git-golden.mjs` records sessions (`tests/git-golden-sessions.txt` → `tests/fixtures-git.txt`, 345 commands in 8 sessions) with separate stdout/stderr. The hub is served to real Git under its real https URL by a stand-in `git-remote-https` (→ `git-remote-ext` → local upload/receive-pack), so URLs in merge messages and output are genuine.
  - `tests/git-golden.test.ts`: every command's stdout, stderr, exit code and hash match; KNOWN_DIFFERENCES is empty.
  - `tests/git-fuzz.test.ts`: 300 random diffs (3,000 once with another seed), 150 random merges with conflicts, and 30 random histories run command by command on both (200 more histories, ~6,000 commands, once with another seed) — all identical.
  - Bugs the comparisons found and fixed: line-match counting over the whole file (diff), `Reapply "…"` for reverting a revert, local changes shown on "Already on", fetch listing the merge branch first, `origin/HEAD` created by fetch (Git 2.48+), an empty fast-forward printing a stat line, and more.
- **Behaviour tests** (`tests/git-engine.test.ts`, 11): events, protected main + PR flow, reviews blocking/approving, a conflicting PR fixed by merging main, `gh pr checkout`, push rejected then fixed by pull, the shell, the `.git` folder, a machine without an identity.
- **Checks:** 1,130 tests pass; type check clean. Nothing user-facing yet.

## 45. Git Stage 2 complete: the course framework (2026-10-26)
**The course runs at `/git/`** (course id `git`, progress key `zs-progress-git-v1`, sync target `git`); the home page has a "Coming soon" Git card (`--git` colour token in light and dark), not yet a link.
- **Wiring:** `git/index.html`, `src/entries/git.tsx`, a `git` input in `vite.config.ts`, `gitContent` in `COURSES` (admin dashboard and sync), `git` in the service worker's `SECTIONS` (works offline). No server change.
- **Content type:** `GitSpec` in `src/content/types.ts` (setup/files, `target` commands or a file, `after`, `compare`: repo, messages, staging, files, hub, stdout); `ProjectTask.git`.
- **Checking** (`src/courses/git/check.ts`): the learner's and the reference answer run on identical machines; results are compared by what matters (branches, HEAD, each commit's files and parents with hashes/times/messages ignored unless asked, upstreams, remote-tracking branches, merge in progress, staging area, working folder incl. leftover conflict markers, the hub's branches and pull requests, printed output). Plain-language feedback, e.g. "`main` has 1 commit, but it should have 2", "The newest commit on `main` is missing `style.css`". `setupErrors()` for content tests (a setup line ending in `# fails` may fail). Here-documents stay one command.
- **Misconceptions** (`misconceptions.ts`, 12): commit without add, add isn't save, branch doesn't switch, wrong branch, conflict markers left, commit during conflict, push before pull, fetch doesn't merge, first push needs -u, restore vs revert, rm vs git rm, init in the wrong place.
- **UI** (`src/courses/git/ui/`):
  - **Live commit graph** (`graphLayout.ts` + `GraphView.tsx`): lanes and rows from the commit DAG, SVG edges with one path shape so they animate, merge commits as rings, branch chips (filled), remote-tracking chips (dashed), `HEAD → main`, detached HEAD, MERGE_HEAD as a dashed red edge during a conflict; framer-motion: new commits pop in, chips slide between commits (shared layout ids), pushed/fetched commits fly in from the other panel; your repository and the hub's side by side; "+N older" beyond 40 commits.
  - **"What the last command did"** caption from the engine's events, with **▶ Replay** (shows the graph before the command, then plays the change slowly).
  - **Areas** panel: working folder → staging area → repository, with file states.
  - **Hub** page: branches (🔒 protected), clone URL, pull requests with reviews/comments, a "new pull request" form and Merge/View/Files changed buttons, all of which run the matching `gh` command in the terminal (so they're part of the answer).
  - **Files** panel: edit a file; saving runs `cat > file <<'EOF'` in the terminal.
  - **Terminal**: prompt like `~/shop (main|MERGING) $`, Git-style colours (diff, status, hashes; stderr is only red for real problems), tab completion of commands, branches and files.
  - **Exercise card**: "write" exercises are done in a live terminal; the commands typed are the answer (Check / Start over); fill-in-the-blank and fix-the-bug use the editor with Run; read-and-decide shows the commands' output and graph.
  - Examples, predictions (shows the starting graph first), projects (terminal + requirement checks), and a Playground with three starting points (empty folder, project with history, team repository with Sam).
- **Module 1 written** (`content/g01-basics.ts`, 6 concepts, 10 practice, 6 test) as the sample proving every exercise kind.
- **Tests:** `tests/git-content.test.ts` (reference passes, wrong example and starter fail, setups clean, predictions' `verify` patterns match the real output). 1,154 tests pass; build OK.
- **Local browser walkthrough** (throwaway server and account, deleted afterwards): playground merge with graph and caption; team start: branch, push -u (both graphs update, commit flies to the hub), PR created from the hub form, merged with the button (merge commit on the hub graph); module 1 prediction + live result; practice 1 wrong answer gives "There's no Git repository in ~/notes", then correct; the admin API shows the typed commands as the answer; no console errors.
- **Deployed** (`deploy/deploy.sh`): `/`, `/pg/`, `/docker/`, `/design/`, `/git/`, `/admin/`, `/api/health` 200; live `sw.js` precaches `/git/`; home card "Coming soon"; erp.zilber.tech 303.

## 46. Git Stage 3 complete: modules 2–3 and the first two games (2026-10-26)
- **Module 2, "History and simple undo"** (`content/g02-history.ts`: 6 concepts, 10 practice, 7 test): log (`--oneline`, `-3`, `--stat`), naming commits (hash, HEAD, HEAD~1) with `show`, `diff` / `diff --staged` / between commits, `.gitignore`, `restore` and `restore --staged`, `revert`.
- **Module 3, "Branches and merging"** (`content/g03-branches.ts`: 6 concepts, 10 practice, 6 test): a branch is a label, `switch` / `switch -c`, fast-forward, merge commits, `branch -d` / `-D`, switching with uncommitted changes (carried along or refused).
- **Games** (`src/courses/git/games/`), mission levels like the Docker course's, played in the full workspace (terminal, graph, areas, files) with live goals, a timer, par and hints:
  - `missions.ts`: goal helpers (new commits, what each commit changed, kept out, draft kept, author, clean, HEAD on), `isFree` (looking, editing files and non-git commands don't count against par), and **target graphs**: the reference solution's graph is drawn (hashes hidden, new `GraphData.anonymous`) and each branch must have the same *shape* (`shapeKey`: commits from the start are themselves, new ones are "a commit on these parents"), plus "no other branches" and "HEAD on …".
  - **🎭 Stage Manager** (module 1, 6 levels): clean desk, one change per commit, the late edit, leave the draft, a brand-new project, new laptop (identity).
  - **🏃 Branch Runner** (module 3, 5 levels): sprout, catch up (fast-forward), join the paths (merge commit), side quest, two features.
  - `tests/git-games.test.ts`: every level unsolved at the start, solved by its solution within par, target graph drawn; traps (e.g. `git add .` takes the notes, `commit -am` commits the draft, merging the wrong way round, branching footer off header) don't pass.
- **Checking:** new `GitSpec.exactOutput` for "only…" tasks (feedback: "Your commands show more than was asked: … 2 lines, yours printed 3").
- **Misconceptions** +3 (15): unstaging needs `--staged`, merge into the branch you're on, `-d` protects unmerged work; new tests feed real wrong answers through them.
- **Checks:** 1,221 tests pass; build OK. Local browser walkthrough (throwaway server and account, deleted afterwards): Branch Runner level 1 solved at par (target graph, goals turning green), level 2's fast-forward target; Stage Manager level 1 trap then recovery (85 pts); module 2 lesson; module 2 practice 1 exact-output feedback; no console errors.
- **Not deployed yet:** the deploy command was blocked by the permission check this time; run `bash deploy/deploy.sh` (the home card stays "Coming soon").

## 47. Git Stage 4: modules 4–6, the last two games, the project, launch-ready (2026-10-26)
- **Module 4, "Conflicts"** (`content/g04-conflicts.ts`: 5 concepts, 10 practice, 6 test): why conflicts happen (same lines vs different lines), reading markers, resolve = edit + `git add` + `git commit`, `git status` during a merge, `git merge --abort`. "Write the file" exercises resolve a conflict in the editor.
- **Module 5, "Remotes"** (`content/g05-remotes.ts`: 6 concepts, 10 practice, 6 test): the hub and `clone`/`origin`, `push` and `-u`, `origin/main` as a bookmark (status says "up to date" until you fetch), `fetch`, `pull` = fetch + merge, rejected pushes (pull, then push; never `--force`).
- **Module 6, "Team workflow: pull requests"** (`content/g06-team.ts`: 6 concepts, 10 practice, 6 test) on a protected `main` needing one approval: feature branches, `gh pr create`, reviews (commit and push to the same branch), merging the PR and cleaning up, protected branches, good commit messages.
- **Project "Ship a feature with a team"** (5 tasks): join (clone + branch), build the contact page, open the PR, answer a review while Sam's merged change conflicts with the branch (merge main in, resolve, push; Sam's approval must make it mergeable), ship it (merge, update main, delete the branch here and on the hub). Tests also check other valid routes (fetch + merge, tidying up by hand) pass and classic mistakes fail.
- **Games:** 🩺 **Conflict Doctor** (module 4, 5 levels: first aid, best of both, two patients, wrong turn, price check) and 🏁 **Push/Pull Race** (module 5, 5 levels: share it, Sam was faster, busy Sam, same line, your branch and the team's main). New mission field `teammate`: Sam pulls, commits and pushes right after the learner's n-th counted command, announced with 📣 messages; missions now show the 🌐 Hub tab. New goals: merge done / not merged, committed file says…, no markers, pushed to the hub, Sam's work kept, in sync, tracks upstream, hub file says…. Traps tested (commit with markers, `--force` deleting Sam's commit, no final pull, pushing without `-u`).
- **Engine:** `git branch --show-current`. **Misconceptions:** + protected main (16 rules), with tests for conflicts, remotes and PR mistakes.
- **Admin:** Git learner test in `tests/server.test.ts` (summary, struggles, commands and file answers on the learner page, project tasks). ADMIN_GUIDE.txt: Git course, `/git/`, how Git answers appear, the project.
- **Home page:** the Git card is now a live link with the "New" badge.
- **Checks:** 1,317 tests pass; `tsc` + build OK; `dist/sw.js` precaches `/git/`.
- **Local server check** (throwaway server and account, deleted afterwards): `/`, `/git/`, `/pg/`, `/docker/`, `/design/`, `/admin/`, `/api/health` 200; home page links to `/git/`; both new game chunks built. **No browser walkthrough** this time (the Chrome extension wasn't connected).
- **Not deployed yet:** run `bash deploy/deploy.sh`.
- **Deploy attempt (2026-10-27):** tests and build passed, then SSH to the VPS was reset during upload (`Connection reset … port 22`). Nothing changed on the server; SSH works again, so re-run `bash deploy/deploy.sh`.

## 48. Project on GitHub (2026-10-28)
- **Repo:** private, https://github.com/mohyarp/pgschool, branch `main` tracking `origin/main`.
- **Auth:** `gh` (apt) logged in by the user via the browser; `gh auth setup-git` lets git push over HTTPS. The token stays in gh's keyring.
- **Identity (this repo only):** `mohyarp` with the GitHub no-reply email, so the Gmail address stays out of the history.
- **Kept out of git:** `ADMIN_GUIDE.txt` (has the admin password), `.env`, `data/`, `dist/`, `node_modules/`; added `*.log` and `.claude/` to `.gitignore`. Before the first commit, I checked that the admin password isn't in any staged file.
- **Deploy is unchanged:** `deploy/deploy.sh` still rsyncs from this folder, so GitHub is a backup and history, not the deploy source.
- **From now on:** commit and push after each step (`git add -A && git commit && git push`).

## 49. Renamed to zilber-school (2026-10-28)
- **Renamed:** the GitHub repo is now https://github.com/mohyarp/zilber-school (GitHub redirects the old URL), the git remote is updated, `package.json` is named `zilber-school`, and the README now covers all four courses (it was PostgreSQL-only).
- **Kept as `pgschool` on purpose:** the local folder, `/opt/stacks/pgschool` on the VPS, the `pgschool_data` Docker volume and `pgschool.db` (live learner data), and `~/.config/pgschool`. Renaming these would mean migrating the live volume.
