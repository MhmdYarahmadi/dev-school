/* Index Racer (Module 10): get EXPLAIN's estimated cost under a target. */

export const EVENTS_SETUP = `
CREATE TABLE events AS
SELECT g AS event_id,
       g % 5000 AS user_id,
       (ARRAY['view', 'click', 'purchase', 'signup'])[1 + g % 4] AS kind,
       timestamp '2024-01-01' + g * interval '5 minutes' AS created_at,
       'user' || (g % 5000) || '@Example.com' AS email,
       (g % 997) * 1.5 AS amount
FROM generate_series(1, 100000) AS g;
ALTER TABLE events ADD PRIMARY KEY (event_id);
ANALYZE events;`;

export interface RaceLevel {
  title: string;
  brief: string;
  /** The slow query. */
  query: string;
  /** If true, the player may rewrite the query (it must return the same rows). */
  rewrite: boolean;
  targetCost: number;
  /** Reference fix used by the tests (DDL and/or the rewritten query). */
  referenceDdl: string;
  referenceQuery?: string;
  hint: string;
}

export const RACE_LEVELS: RaceLevel[] = [
  {
    title: 'Find one user',
    brief: 'The app looks up a user\'s events constantly. Make this fast.',
    query: 'SELECT * FROM events WHERE user_id = 42',
    rewrite: false,
    targetCost: 200,
    referenceDdl: 'CREATE INDEX events_user_idx ON events (user_id);',
    hint: 'CREATE INDEX … ON events (user_id);',
  },
  {
    title: 'Latest activity',
    brief: 'The dashboard shows the 10 newest events.',
    query: 'SELECT * FROM events ORDER BY created_at DESC LIMIT 10',
    rewrite: false,
    targetCost: 50,
    referenceDdl: 'CREATE INDEX events_created_idx ON events (created_at);',
    hint: 'An index on created_at lets Postgres read the newest rows straight from the end of the index.',
  },
  {
    title: 'Case-insensitive login',
    brief: 'Logins compare emails in lower case.',
    query: "SELECT * FROM events WHERE lower(email) = 'user42@example.com'",
    rewrite: false,
    targetCost: 300,
    referenceDdl: 'CREATE INDEX events_email_lower_idx ON events (lower(email));',
    hint: 'A plain index on email won\'t help a query on lower(email). Index the expression: ON events (lower(email)).',
  },
  {
    title: 'Big purchases',
    brief: 'Finance counts the big purchases (amount over 1400) every few minutes. Can one index cover both conditions?',
    query: "SELECT count(*) FROM events WHERE kind = 'purchase' AND amount > 1400",
    rewrite: false,
    targetCost: 1900,
    referenceDdl: 'CREATE INDEX events_kind_amount_idx ON events (kind, amount);',
    hint: 'A multi-column index: ON events (kind, amount). The equality column goes first, the range column second.',
  },
  {
    title: 'The sneaky rewrite',
    brief: 'This query wraps the column in a function, so a plain index on created_at can\'t be used. **Rewrite it** so it returns the same rows but can use an index.',
    query: "SELECT count(*) FROM events WHERE date_trunc('day', created_at) = '2024-03-01'",
    rewrite: true,
    targetCost: 100,
    referenceDdl: 'CREATE INDEX IF NOT EXISTS events_created_idx ON events (created_at);',
    referenceQuery: "SELECT count(*) FROM events WHERE created_at >= '2024-03-01' AND created_at < '2024-03-02'",
    hint: "Compare the bare column with a range: created_at >= '2024-03-01' AND created_at < '2024-03-02' (plus an index on created_at).",
  },
];

/** Total estimated cost of a query's plan. */
export function explainSql(query: string): string {
  return `EXPLAIN (FORMAT JSON) ${query}`;
}

export function costFromExplain(value: unknown): number {
  const plan = typeof value === 'string' ? JSON.parse(value) : value;
  return Number((plan as { Plan: { 'Total Cost': number } }[])[0].Plan['Total Cost']);
}
