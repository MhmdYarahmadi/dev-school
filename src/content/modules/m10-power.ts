import type { Module } from '../types';

export const m10: Module = {
  id: 'm10',
  number: 10,
  title: 'Postgres power features',
  tagline: 'Window functions, arrays, JSONB, generate_series, and making queries fast with indexes and EXPLAIN.',
  games: ['rankrace', 'indexracer', 'finale'],
  concepts: [
    {
      id: 'm10-window',
      title: 'Window functions',
      card: `GROUP BY collapses rows. **Window functions** compute across related rows **while keeping every row**:

\`\`\`sql
SELECT title, genre, price,
       avg(price) OVER (PARTITION BY genre) AS genre_avg
FROM books;
\`\`\`

- \`OVER (…)\` turns an aggregate (or a ranking function) into a window function
- \`PARTITION BY\` = "per group" (like GROUP BY, but rows are not merged)
- \`ORDER BY\` inside OVER = the order within each window

Every book keeps its row and gains a column with its genre's average.`,
      predict: {
        sql: 'SELECT title, genre, price,\n       avg(price) OVER (PARTITION BY genre) AS genre_avg\nFROM books;',
        question: 'How many rows?',
        choices: ['7 (one per genre)', '30 (one per book)', '1'],
        answer: 1,
        why: 'Window functions never remove rows. Each of the 30 books gets its genre\'s average next to it.',
      },
      example: { sql: 'SELECT title, genre, price,\n       round(avg(price) OVER (PARTITION BY genre), 2) AS genre_avg,\n       price - avg(price) OVER (PARTITION BY genre) AS vs_genre\nFROM books\nORDER BY genre, price DESC;', note: 'Compare each book with its own genre.' },
      cheat: { syntax: 'agg(x) OVER (PARTITION BY g ORDER BY o)', note: 'Compute across rows without collapsing them.' },
    },
    {
      id: 'm10-ranking',
      title: 'Ranking: row_number, rank, dense_rank',
      card: `Three ways to number rows in order:

| price | row_number | rank | dense_rank |
|---|---|---|---|
| 19.99 | 1 | 1 | 1 |
| 17.00 | 2 | 2 | 2 |
| 17.00 | 3 | 2 | 2 |
| 16.99 | 4 | **4** | **3** |

- \`row_number()\`: always unique
- \`rank()\`: ties share a rank, then it **skips** numbers
- \`dense_rank()\`: ties share a rank, **no gaps**

Classic use: **top N per group**. Rank inside a subquery or CTE, then filter:

\`\`\`sql
WITH ranked AS (
  SELECT title, genre, price,
         row_number() OVER (PARTITION BY genre ORDER BY price DESC) AS rn
  FROM books
)
SELECT * FROM ranked WHERE rn <= 2;
\`\`\``,
      predict: {
        sql: 'SELECT title, price,\n       rank() OVER (ORDER BY price DESC) AS r,\n       dense_rank() OVER (ORDER BY price DESC) AS d\nFROM books\nORDER BY price DESC\nLIMIT 8;',
        question: 'Two books tie at €17.00 in 6th place. Kafka on the Shore (€16.99) comes next. What are its r and d?',
        choices: ['r = 7, d = 7', 'r = 8, d = 7', 'r = 8, d = 8'],
        answer: 1,
        why: 'rank() skips past the tie (6, 6, then 8), and dense_rank() doesn\'t (6, 6, then 7).',
      },
      example: { sql: 'WITH ranked AS (\n  SELECT title, genre, price,\n         row_number() OVER (PARTITION BY genre ORDER BY price DESC) AS rn\n  FROM books\n)\nSELECT genre, rn, title, price\nFROM ranked\nWHERE rn <= 2\nORDER BY genre, rn;', note: 'The 2 most expensive books in each genre.' },
      cheat: { syntax: 'row_number() / rank() / dense_rank() OVER (PARTITION BY g ORDER BY x)', note: 'Filter on the rank in an outer query (WHERE can\'t see window results).' },
    },
    {
      id: 'm10-running',
      title: 'Running totals, LAG and LEAD',
      card: `With ORDER BY inside OVER, aggregates become **running**:

\`\`\`sql
SELECT order_date, sum(daily_total) OVER (ORDER BY order_date) AS running_total …
\`\`\`

**LAG** and **LEAD** look at the previous or next row:

\`\`\`sql
SELECT customer_id, order_date,
       lag(order_date) OVER (PARTITION BY customer_id ORDER BY order_date) AS previous_order,
       order_date - lag(order_date) OVER (PARTITION BY customer_id ORDER BY order_date) AS days_between
FROM orders;
\`\`\``,
      predict: {
        sql: 'SELECT order_id, order_date,\n       lag(order_date) OVER (ORDER BY order_date) AS prev\nFROM orders\nORDER BY order_date\nLIMIT 3;',
        question: 'What is prev on the very first row?',
        choices: ['The same date', 'NULL', '0'],
        answer: 1,
        why: 'The first row has no previous row, so lag() returns NULL. You can give a default as a third argument: lag(x, 1, …).',
      },
      example: { sql: 'SELECT o.order_date,\n       sum(i.quantity * i.unit_price) AS order_total,\n       sum(sum(i.quantity * i.unit_price)) OVER (ORDER BY o.order_date) AS running_revenue\nFROM orders o\nJOIN order_items i ON i.order_id = o.order_id\nGROUP BY o.order_id, o.order_date\nORDER BY o.order_date;', note: 'A window over a GROUP BY result: revenue so far.' },
      cheat: { syntax: 'sum(x) OVER (ORDER BY d) · lag(x) OVER (…) · lead(x) OVER (…)', note: 'Running totals and previous/next row.' },
    },
    {
      id: 'm10-arrays-json',
      title: 'Arrays and JSONB',
      card: `Postgres can store **lists** and **documents** in a column.

**Arrays** (\`books.tags\` is \`text[]\`):
\`\`\`sql
WHERE 'romance' = ANY (tags)            -- contains the value
WHERE tags @> ARRAY['history', 'war']   -- contains all of these
SELECT unnest(tags) …                   -- one row per element
SELECT array_agg(title) … GROUP BY …    -- rows → array
\`\`\`

**JSONB** (\`books.details\`):
\`\`\`sql
details -> 'awards'            -- JSON value
details ->> 'format'           -- as text
details @> '{"format": "hardcover"}'    -- contains
jsonb_array_length(details -> 'awards')
\`\`\``,
      predict: {
        sql: "SELECT title, details ->> 'format' AS format\nFROM books\nWHERE details @> '{\"format\": \"hardcover\"}';",
        question: 'What does @> check here?',
        choices: ['That format is greater than "hardcover"', 'That the JSON document contains format = hardcover', 'That details is not NULL'],
        answer: 1,
        why: '@> means "contains": the details document must include the key/value pair. 7 books are hardcovers.',
      },
      example: { sql: "SELECT tag, count(*) AS books\nFROM books, unnest(tags) AS tag\nGROUP BY tag\nORDER BY books DESC, tag\nLIMIT 5;", note: 'The most common tags: unnest turns arrays into rows.' },
      cheat: { syntax: "'x' = ANY(arr) · unnest(arr) · array_agg(x) · j ->> 'key' · j @> '{…}'", note: 'Lists and documents inside a column.' },
    },
    {
      id: 'm10-series',
      title: 'generate_series',
      card: `\`generate_series\` creates rows out of thin air, which is handy for test data and for filling gaps:

\`\`\`sql
SELECT generate_series(1, 5);                         -- 1..5
SELECT generate_series('2024-01-01'::date, '2024-12-01', interval '1 month');  -- every month
\`\`\`

A classic: list **every month**, including months with **zero** orders, by LEFT JOINing the real data onto a generated calendar.`,
      predict: {
        sql: 'SELECT * FROM generate_series(1, 10, 3);',
        question: 'The third argument is the step. Which numbers come out?',
        choices: ['1, 4, 7, 10', '1, 3, 6, 9', '1, 2, 3'],
        answer: 0,
        why: 'Start at 1 and add 3 while the value is ≤ 10: 1, 4, 7, 10.',
      },
      example: { sql: "SELECT m::date AS month, count(o.order_id) AS orders\nFROM generate_series('2024-10-01'::date, '2025-06-01', interval '1 month') AS m\nLEFT JOIN orders o ON date_trunc('month', o.order_date) = m\nGROUP BY m\nORDER BY m;", note: 'Oct 2024 to Jun 2025, including the months with no orders.' },
      cheat: { syntax: "generate_series(1, n) · generate_series(d1, d2, interval '1 day')", note: 'Make rows. Great for calendars and test data.' },
    },
    {
      id: 'm10-indexes',
      title: 'Indexes and EXPLAIN',
      card: `Without help, Postgres finds rows by reading the **whole table** (a *Seq Scan*). An **index** is like a book's index: a sorted lookup structure that jumps straight to the matching rows.

\`\`\`sql
CREATE INDEX books_genre_idx ON books (genre);
\`\`\`

**EXPLAIN** shows the plan Postgres will use, and its estimated **cost**:

\`\`\`sql
EXPLAIN SELECT * FROM books WHERE genre = 'Mystery';
\`\`\`

- Indexes speed up WHERE, JOIN and ORDER BY on the indexed columns
- They cost disk space and slow down writes a little
- On tiny tables Postgres may ignore an index, because scanning 30 rows is already instant
- Primary keys and UNIQUE constraints get an index automatically

You'll race with indexes on a 200,000-row table in **Index Racer**.`,
      predict: {
        sql: "EXPLAIN SELECT * FROM books WHERE genre = 'Mystery';",
        question: 'There is no index on genre. What kind of scan will the plan show?',
        choices: ['Index Scan', 'Seq Scan (read every row)', 'No scan, the answer is cached'],
        answer: 1,
        why: 'Without an index, the only option is to read every row and filter it: a Seq Scan.',
      },
      example: { sql: "CREATE TABLE big AS\n  SELECT g AS id, (g % 1000) AS bucket, md5(g::text) AS payload\n  FROM generate_series(1, 100000) AS g;\nANALYZE big;\nEXPLAIN SELECT * FROM big WHERE bucket = 42;\nCREATE INDEX big_bucket_idx ON big (bucket);\nEXPLAIN SELECT * FROM big WHERE bucket = 42;", note: 'The same query before and after the index. Compare the plans and costs (only the last plan is shown).' },
      cheat: { syntax: 'CREATE INDEX name ON t (col); EXPLAIN SELECT …', note: 'An index speeds up lookups. EXPLAIN shows the plan.' },
    },
  ],
  practice: [
    {
      id: 'm10-p1',
      kind: 'write',
      conceptIds: ['m10-window'],
      prompt: 'Show each employee\'s **name**, **department**, **salary**, and the **average salary of their department** (a window function, so every employee keeps their row).',
      solution: 'SELECT name, department, salary, avg(salary) OVER (PARTITION BY department) FROM employees;',
      wrongExample: 'SELECT name, department, salary, avg(salary) OVER () FROM employees;',
      hints: ['avg(salary) OVER (PARTITION BY …)'],
      explanation: 'PARTITION BY department computes the average per department without collapsing rows.',
    },
    {
      id: 'm10-p2',
      kind: 'write',
      conceptIds: ['m10-ranking'],
      prompt: 'Rank all books by **price, most expensive first**, using **dense_rank**. Show **title**, **price** and the rank.',
      solution: 'SELECT title, price, dense_rank() OVER (ORDER BY price DESC) FROM books;',
      wrongExample: 'SELECT title, price, rank() OVER (ORDER BY price DESC) FROM books;',
      hints: ['dense_rank() OVER (ORDER BY price DESC)'],
      explanation: 'dense_rank leaves no gaps after ties.',
    },
    {
      id: 'm10-p3',
      kind: 'write',
      conceptIds: ['m10-ranking'],
      prompt: 'Find the **best-paid employee in each department**. Show **department**, **name** and **salary**. (No department has a tie for first place.)',
      solution: 'WITH r AS (SELECT department, name, salary, row_number() OVER (PARTITION BY department ORDER BY salary DESC) AS rn FROM employees) SELECT department, name, salary FROM r WHERE rn = 1;',
      wrongExample: 'SELECT department, max(name), max(salary) FROM employees GROUP BY department;',
      hints: ['Number the rows within each department by salary, highest first.', 'You can\'t filter on a window function in WHERE, so wrap it in a CTE and filter outside.'],
      explanation: 'The top-N-per-group pattern: row_number in a CTE, then WHERE rn = 1.',
      variants: [
        {
          id: 'm10-p3-v1',
          prompt: 'Find the **cheapest book in each genre** (the 2 Non-fiction books differ in price, and the cheapest is never tied). Show **genre**, **title**, **price**.',
          solution: 'WITH r AS (SELECT genre, title, price, row_number() OVER (PARTITION BY genre ORDER BY price) AS rn FROM books) SELECT genre, title, price FROM r WHERE rn = 1;',
          wrongExample: 'WITH r AS (SELECT genre, title, price, row_number() OVER (PARTITION BY genre ORDER BY price DESC) AS rn FROM books) SELECT genre, title, price FROM r WHERE rn = 1;',
          hints: ['Same pattern, ascending order.'],
          explanation: 'row_number per group, keep rn = 1.',
        },
      ],
    },
    {
      id: 'm10-p4',
      kind: 'write',
      conceptIds: ['m10-running'],
      prompt: 'For **every order**, show **customer_id**, **order_id**, **order_date** and the **date of that customer\'s previous order** (NULL for their first).',
      solution: 'SELECT customer_id, order_id, order_date, lag(order_date) OVER (PARTITION BY customer_id ORDER BY order_date) FROM orders;',
      wrongExample: 'SELECT customer_id, order_id, order_date, lag(order_date) OVER (ORDER BY order_date) FROM orders;',
      hints: ['lag(order_date) looks one row back.', 'The window must be per customer (PARTITION BY) and in date order.'],
      explanation: 'Without PARTITION BY, lag would look at *anyone\'s* previous order.',
    },
    {
      id: 'm10-p5',
      kind: 'write',
      conceptIds: ['m10-running'],
      prompt: 'Show each employee\'s **name**, **hire_date** and a **running count** of how many people had been hired up to and including that date (ordered by hire_date).',
      solution: 'SELECT name, hire_date, count(*) OVER (ORDER BY hire_date) FROM employees;',
      wrongExample: 'SELECT name, hire_date, count(*) OVER () FROM employees;',
      hints: ['count(*) OVER (ORDER BY hire_date) is a running count.'],
      explanation: 'An ORDER BY inside OVER makes the aggregate cumulative.',
    },
    {
      id: 'm10-p6',
      kind: 'write',
      conceptIds: ['m10-arrays-json'],
      prompt: "Show the **title** of every book tagged **'magic realism'**.",
      solution: "SELECT title FROM books WHERE 'magic realism' = ANY (tags);",
      wrongExample: "SELECT title FROM books WHERE genre = 'magic realism';",
      hints: ['tags is an array. Use = ANY (tags).'],
      explanation: "`value = ANY(array)` checks membership. `tags @> ARRAY['magic realism']` works too.",
    },
    {
      id: 'm10-p7',
      kind: 'write',
      conceptIds: ['m10-arrays-json'],
      prompt: 'Show the **title** and the **number of awards** of books that won **at least one award** (`details -> \'awards\'` is a JSON array).',
      solution: "SELECT title, jsonb_array_length(details -> 'awards') FROM books WHERE jsonb_array_length(details -> 'awards') > 0;",
      wrongExample: "SELECT title, jsonb_array_length(details -> 'awards') FROM books;",
      hints: ["jsonb_array_length(details -> 'awards')", 'Filter with the same expression > 0.'],
      explanation: '-> gets the JSON array, and jsonb_array_length counts its items.',
    },
    {
      id: 'm10-p8',
      kind: 'write',
      conceptIds: ['m10-arrays-json'],
      prompt: 'For each **genre**, show the genre and an **array of its titles** (any order inside the array is fine… but to match exactly, order the titles alphabetically).',
      solution: 'SELECT genre, array_agg(title ORDER BY title) FROM books GROUP BY genre;',
      wrongExample: 'SELECT genre, count(title) FROM books GROUP BY genre;',
      hints: ['array_agg(title ORDER BY title)'],
      explanation: 'array_agg collects the values of a group into an array.',
    },
    {
      id: 'm10-p9',
      kind: 'write',
      conceptIds: ['m10-series'],
      prompt: 'Show **every month from January to June 2025** (as a date) with the **number of orders** placed in that month, **including months with 0**.',
      solution: "SELECT m::date, count(o.order_id) FROM generate_series('2025-01-01'::date, '2025-06-01', interval '1 month') AS m LEFT JOIN orders o ON date_trunc('month', o.order_date) = m GROUP BY m;",
      wrongExample: "SELECT date_trunc('month', order_date)::date, count(*) FROM orders WHERE order_date >= '2025-01-01' GROUP BY 1;",
      hints: ["Generate the 6 months: generate_series('2025-01-01'::date, '2025-06-01', interval '1 month')", 'LEFT JOIN orders onto the months using date_trunc(\'month\', order_date), and count a column from orders.'],
      explanation: 'Only January 2025 has orders. Grouping the orders alone would give one row, and the generated calendar plus a LEFT JOIN supplies the five empty months as 0.',
    },
    {
      id: 'm10-p10',
      kind: 'write',
      conceptIds: ['m10-indexes'],
      prompt: 'Create an **index** on the **genre** column of **books** (any name).',
      solution: 'CREATE INDEX books_genre_idx ON books (genre);',
      wrongExample: 'CREATE INDEX books_title_idx ON books (title);',
      checkQuery: "SELECT count(*) FROM pg_indexes WHERE tablename = 'books' AND indexdef ~* '\\(genre\\)'",
      hints: ['CREATE INDEX some_name ON table (column);'],
      explanation: 'Now lookups by genre can use the index (on a big enough table).',
    },
    {
      id: 'm10-p11',
      kind: 'readQuery',
      conceptIds: ['m10-ranking'],
      prompt: 'Why does this fail?',
      sql: 'SELECT title, row_number() OVER (ORDER BY price DESC) AS rn\nFROM books\nWHERE rn <= 3;',
      expectError: true,
      choices: [
        'row_number needs PARTITION BY',
        'WHERE runs before window functions are computed, so rn doesn\'t exist yet',
        'You cannot alias a window function',
        'LIMIT is required',
      ],
      answer: 1,
      hints: [],
      explanation: 'Window functions are computed at the SELECT stage, after WHERE. Wrap the query in a CTE/subquery and filter outside (or use ORDER BY … LIMIT 3 here).',
    },
  ],
  test: [
    {
      id: 'm10-t1',
      kind: 'write',
      conceptIds: ['m10-window'],
      prompt: 'Show each book\'s **title**, **genre** and **how many books are in its genre** (a window count, so every book keeps its row).',
      solution: 'SELECT title, genre, count(*) OVER (PARTITION BY genre) FROM books;',
      wrongExample: 'SELECT title, genre, count(*) OVER () FROM books;',
      hints: [],
      explanation: 'count(*) OVER (PARTITION BY genre).',
    },
    {
      id: 'm10-t2',
      kind: 'write',
      conceptIds: ['m10-ranking'],
      prompt: 'Show the **2 most recently hired** employees **in each department**: department, name, hire_date.',
      solution: 'WITH r AS (SELECT department, name, hire_date, row_number() OVER (PARTITION BY department ORDER BY hire_date DESC) AS rn FROM employees) SELECT department, name, hire_date FROM r WHERE rn <= 2;',
      wrongExample: 'SELECT department, name, hire_date FROM employees ORDER BY hire_date DESC LIMIT 2;',
      hints: [],
      explanation: 'Top N per group.',
    },
    {
      id: 'm10-t3',
      kind: 'readQuery',
      conceptIds: ['m10-ranking'],
      prompt: 'Scores 90, 80, 80, 70. What does **rank()** (highest first) give the 70?',
      choices: ['3', '4', '2'],
      answer: 1,
      hints: [],
      explanation: 'rank() skips after ties: 1, 2, 2, 4.',
    },
    {
      id: 'm10-t4',
      kind: 'write',
      conceptIds: ['m10-arrays-json'],
      prompt: "Show the **title** of every **hardcover** book (`details ->> 'format'`).",
      solution: "SELECT title FROM books WHERE details ->> 'format' = 'hardcover';",
      wrongExample: "SELECT title FROM books WHERE details ->> 'format' = 'paperback';",
      hints: [],
      explanation: "->> returns text. `details @> '{\"format\":\"hardcover\"}'` works too.",
    },
    {
      id: 'm10-t5',
      kind: 'write',
      conceptIds: ['m10-series'],
      prompt: 'Produce the **even numbers from 2 to 20** with generate_series.',
      solution: 'SELECT generate_series(2, 20, 2);',
      wrongExample: 'SELECT generate_series(2, 20);',
      hints: [],
      explanation: 'The third argument is the step.',
    },
    {
      id: 'm10-t6',
      kind: 'readQuery',
      conceptIds: ['m10-indexes'],
      prompt: 'Which statement about indexes is **true**?',
      choices: [
        'Every column should have an index',
        'Indexes speed up lookups but add work to every INSERT/UPDATE',
        'Postgres always uses an index if one exists',
        'Indexes change query results',
      ],
      answer: 1,
      hints: [],
      explanation: 'Indexes are a trade-off. The planner chooses whether to use one, and results never change.',
    },
  ],
  project: {
    id: 'proj2',
    title: 'Project: customer insights',
    story: `The marketing team wants to **re-engage customers**. You have every tool now: joins, CTEs and window functions. As before, there's no single right query, only requirements.`,
    tasks: [
      {
        id: 'proj2-t1',
        prompt: '**Customer lifetime value.** For **every customer** (including those with no orders), compute their total spending on **non-cancelled** orders (0 if none). Return **customer_id**, **first_name** and **total_spent**.',
        requirements: [
          { label: 'Has columns customer_id, first_name, total_spent', sql: "SELECT count(*) = 3 FROM information_schema.columns WHERE table_name = 'answer' AND column_name IN ('customer_id', 'first_name', 'total_spent')" },
          { label: 'Every customer appears exactly once', sql: 'SELECT count(*) = 20 AND count(DISTINCT customer_id) = 20 FROM answer' },
          { label: 'Totals are right (cancelled orders excluded, 0 instead of NULL)', sql: "SELECT NOT EXISTS (SELECT 1 FROM answer a WHERE a.total_spent IS DISTINCT FROM (SELECT coalesce(sum(i.quantity * i.unit_price), 0) FROM orders o JOIN order_items i ON i.order_id = o.order_id WHERE o.customer_id = a.customer_id AND o.status <> 'cancelled'))" },
        ],
        referenceSolution: "SELECT c.customer_id, c.first_name,\n       coalesce(sum(i.quantity * i.unit_price), 0) AS total_spent\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id AND o.status <> 'cancelled'\nLEFT JOIN order_items i ON i.order_id = o.order_id\nGROUP BY c.customer_id, c.first_name\nORDER BY total_spent DESC;",
        discussion: 'Two traps: the cancelled filter must go in the **ON** of the LEFT JOIN (in WHERE it would drop customers), and sum() over no rows is NULL, so coalesce it to 0. A CTE that computes totals first and is then LEFT JOINed to customers works just as well.',
        hints: ['Start from customers and LEFT JOIN orders and order_items.', 'Where must the status filter go so customers without orders survive?'],
      },
      {
        id: 'proj2-t2',
        prompt: '**Gone quiet.** Find customers whose **most recent order** was **before 2024-10-01** (they have ordered, but not lately). Return **customer_id** and **last_order** (the date of their latest order).',
        requirements: [
          { label: 'Has columns customer_id and last_order', sql: "SELECT count(*) = 2 FROM information_schema.columns WHERE table_name = 'answer' AND column_name IN ('customer_id', 'last_order')" },
          { label: 'Exactly the right customers', sql: "SELECT (SELECT array_agg(customer_id ORDER BY customer_id) FROM answer) = (SELECT array_agg(customer_id ORDER BY customer_id) FROM (SELECT customer_id FROM orders GROUP BY customer_id HAVING max(order_date) < '2024-10-01') t)" },
          { label: 'last_order is each customer\'s latest order date', sql: 'SELECT NOT EXISTS (SELECT 1 FROM answer a WHERE a.last_order <> (SELECT max(order_date) FROM orders o WHERE o.customer_id = a.customer_id))' },
        ],
        referenceSolution: "SELECT customer_id, max(order_date) AS last_order\nFROM orders\nGROUP BY customer_id\nHAVING max(order_date) < '2024-10-01'\nORDER BY last_order;",
        discussion: 'GROUP BY + HAVING max(…) is the most direct approach. A window function (row_number per customer, ordered by date DESC, keep rn = 1) also works, and lets you show more details of that last order.',
        hints: ['The latest order per customer is max(order_date).', 'Filter on that maximum, so HAVING.'],
      },
      {
        id: 'proj2-t3',
        prompt: '**Favourite genre.** For each customer who bought something, find the **genre they bought the most copies of**. Ties may be broken any way you like. Return **customer_id**, **genre** and **copies**.',
        requirements: [
          { label: 'Has columns customer_id, genre, copies', sql: "SELECT count(*) = 3 FROM information_schema.columns WHERE table_name = 'answer' AND column_name IN ('customer_id', 'genre', 'copies')" },
          { label: 'One row per buying customer', sql: 'SELECT count(*) = count(DISTINCT customer_id) AND count(*) = (SELECT count(DISTINCT o.customer_id) FROM orders o JOIN order_items i ON i.order_id = o.order_id) FROM answer' },
          { label: 'copies is right for that customer and genre', sql: 'SELECT NOT EXISTS (SELECT 1 FROM answer a WHERE a.copies <> (SELECT sum(i.quantity) FROM orders o JOIN order_items i ON i.order_id = o.order_id JOIN books b ON b.book_id = i.book_id WHERE o.customer_id = a.customer_id AND b.genre = a.genre))' },
          { label: 'It really is their top genre (no genre with more copies)', sql: 'SELECT NOT EXISTS (SELECT 1 FROM answer a WHERE a.copies < (SELECT max(s) FROM (SELECT sum(i.quantity) AS s FROM orders o JOIN order_items i ON i.order_id = o.order_id JOIN books b ON b.book_id = i.book_id WHERE o.customer_id = a.customer_id GROUP BY b.genre) t))' },
        ],
        referenceSolution: 'WITH per_genre AS (\n  SELECT o.customer_id, b.genre, sum(i.quantity) AS copies\n  FROM orders o\n  JOIN order_items i ON i.order_id = o.order_id\n  JOIN books b ON b.book_id = i.book_id\n  GROUP BY o.customer_id, b.genre\n), ranked AS (\n  SELECT *, row_number() OVER (PARTITION BY customer_id ORDER BY copies DESC, genre) AS rn\n  FROM per_genre\n)\nSELECT customer_id, genre, copies\nFROM ranked\nWHERE rn = 1;',
        discussion: 'Aggregate (copies per customer and genre), then pick the top row per customer with row_number(). Postgres also has `DISTINCT ON (customer_id) … ORDER BY customer_id, copies DESC`, a handy shortcut for "first row per group".',
        hints: ['Step 1: copies per (customer, genre), joining 3 tables.', 'Step 2: keep the top genre per customer with row_number() in a second CTE.'],
      },
    ],
  },
};
