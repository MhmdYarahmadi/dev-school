import type { Module } from '../types';

export const m04: Module = {
  id: 'm04',
  number: 4,
  title: 'Expressions & functions',
  tagline: 'Transform values: text and number functions, CASE, COALESCE, casting and dates.',
  games: ['forge'],
  concepts: [
    {
      id: 'm04-strings',
      title: 'Text functions and ||',
      card: `Glue text together with \`||\`:

\`\`\`sql
SELECT first_name || ' ' || last_name AS full_name FROM customers;
\`\`\`

Useful text functions:

| Function | Example | Result |
|---|---|---|
| \`upper(s)\` / \`lower(s)\` | \`upper('abc')\` | \`ABC\` |
| \`initcap(s)\` | \`initcap('jane doe')\` | \`Jane Doe\` |
| \`length(s)\` | \`length('SQL')\` | \`3\` |
| \`left(s, n)\` / \`right(s, n)\` | \`left('Postgres', 4)\` | \`Post\` |
| \`replace(s, a, b)\` | \`replace('a-b', '-', '+')\` | \`a+b\` |
| \`trim(s)\` | \`trim('  hi ')\` | \`hi\` |

⚠️ Anything \`|| NULL\` is **NULL**. One missing piece wipes out the whole text.`,
      predict: {
        sql: "SELECT first_name || ' <' || email || '>' AS contact\nFROM customers\nWHERE customer_id = 4;",
        question: 'Customer 4 is David, whose email is NULL. What is contact?',
        choices: ["'David <>'", "'David'", 'NULL', 'An error'],
        answer: 2,
        why: 'Concatenating with NULL gives NULL. Use `coalesce(email, \'?\')` or `concat(…)`, which treats NULL as empty text.',
      },
      example: { sql: "SELECT upper(last_name) || ', ' || first_name AS name,\n       length(email) AS email_length\nFROM customers;", note: 'Notice the NULL lengths for missing emails.' },
      cheat: { syntax: "first_name || ' ' || last_name", note: 'upper, lower, initcap, length, left, right, replace, trim. NULL || x = NULL.' },
    },
    {
      id: 'm04-numbers',
      title: 'Numbers, rounding and casting',
      card: `Arithmetic: \`+ - * /\` and \`%\` (the remainder).

- **Integer ÷ integer drops the decimals**: \`10 / 4 = 2\`
- Cast one side to keep them: \`10 / 4.0\` or \`10::numeric / 4\` → \`2.5\`
- \`round(x, 2)\` rounds to 2 decimals, \`ceil\`/\`floor\` round up or down, and \`abs\` gives the absolute value.

**Casting** converts types with \`::\` (Postgres style) or \`CAST(x AS type)\`:

\`\`\`sql
SELECT '42'::integer + 1;          -- 43
SELECT price::integer FROM books;  -- rounds to a whole number
SELECT published_year::text;       -- number → text
\`\`\``,
      predict: {
        sql: 'SELECT 10 / 4 AS a, 10 / 4.0 AS b, 10 % 4 AS c;',
        question: 'What are a, b and c?',
        choices: ['2.5, 2.5, 2', '2, 2.5, 2', '2, 2.5, 0.5', '3, 2.5, 2'],
        answer: 1,
        why: '10 / 4 with two integers is 2 (the remainder is dropped). 4.0 is a decimal, so b = 2.5. % is the remainder: 10 = 2×4 + 2.',
      },
      example: { sql: 'SELECT title, price,\n       round(price * 1.2, 2) AS with_tax,\n       price::integer AS rounded\nFROM books;', note: 'Rounding and casting.' },
      cheat: { syntax: 'round(x, 2) · x::numeric · CAST(x AS int)', note: 'int / int truncates. Cast to numeric for decimals.' },
    },
    {
      id: 'm04-case',
      title: 'CASE: if/then in SQL',
      card: `**CASE** picks a value based on conditions, checked **top to bottom**. The first true branch wins:

\`\`\`sql
SELECT title, price,
  CASE
    WHEN price < 10 THEN 'budget'
    WHEN price < 15 THEN 'standard'
    ELSE 'premium'
  END AS price_band
FROM books;
\`\`\`

With no ELSE, unmatched rows get **NULL**. CASE works anywhere a value works: SELECT, WHERE, ORDER BY…`,
      predict: {
        sql: "SELECT title, CASE WHEN price < 10 THEN 'cheap' END AS label\nFROM books WHERE book_id = 3;",
        question: '"1984" costs 12.50. What is its label?',
        choices: ["'cheap'", "'' (empty text)", 'NULL', 'An error, because ELSE is missing'],
        answer: 2,
        why: 'No branch matched and there is no ELSE, so CASE returns NULL.',
      },
      example: { sql: "SELECT title, in_stock,\n  CASE\n    WHEN in_stock = 0 THEN 'sold out'\n    WHEN in_stock < 5 THEN 'low'\n    ELSE 'ok'\n  END AS stock_status\nFROM books;", note: 'First match wins.' },
      cheat: { syntax: "CASE WHEN c1 THEN v1 WHEN c2 THEN v2 ELSE v3 END", note: 'First true branch wins. No ELSE → NULL.' },
    },
    {
      id: 'm04-coalesce',
      title: 'COALESCE and NULLIF',
      card: `**COALESCE(a, b, c…)** returns the first argument that isn't NULL. It's perfect for defaults:

\`\`\`sql
SELECT first_name, coalesce(email, '(no email)') AS email FROM customers;
SELECT title, coalesce(pages, 0) AS pages FROM books;
\`\`\`

**NULLIF(a, b)** is the opposite: it returns NULL when a = b. It's a classic guard against dividing by zero:

\`\`\`sql
SELECT price / NULLIF(in_stock, 0) FROM books;  -- NULL instead of an error
\`\`\``,
      predict: {
        sql: "SELECT coalesce(NULL, NULL, 'third', 'fourth') AS v;",
        question: 'What is v?',
        choices: ['NULL', "'third'", "'fourth'", "'third, fourth'"],
        answer: 1,
        why: 'COALESCE returns the first non-NULL argument.',
      },
      example: { sql: "SELECT name, coalesce(birth_year::text, 'unknown') AS born\nFROM authors;", note: 'The cast makes both arguments text.' },
      cheat: { syntax: "coalesce(x, 'default') · nullif(x, 0)", note: 'First non-NULL value · NULL when equal.' },
    },
    {
      id: 'm04-dates',
      title: 'Dates and times',
      card: `Postgres is excellent at dates:

| Expression | Result |
|---|---|
| \`'2024-01-31'::date + 1\` | \`2024-02-01\` (add days) |
| \`date '2024-03-01' - date '2024-02-01'\` | \`29\` (days between) |
| \`extract(year FROM order_date)\` | \`2024\` |
| \`date_trunc('month', order_date)\` | first day of that month |
| \`order_date + interval '1 month'\` | one month later |
| \`to_char(order_date, 'Mon YYYY')\` | \`Jan 2024\` |
| \`current_date\`, \`now()\` | today / right now |`,
      predict: {
        sql: "SELECT '2024-01-31'::date + 1 AS next_day;",
        question: 'What is next_day?',
        choices: ['2024-01-32', '2024-02-01', 'An error'],
        answer: 1,
        why: 'Postgres knows the calendar. Adding 1 to a date moves to the next real day.',
      },
      example: { sql: "SELECT order_id, order_date,\n       extract(year FROM order_date) AS year,\n       to_char(order_date, 'Day DD Mon') AS pretty\nFROM orders;", note: 'Picking dates apart and formatting them.' },
      cheat: { syntax: "extract(year FROM d) · d + 7 · date_trunc('month', d)", note: 'Date maths, parts and formatting.' },
    },
  ],
  practice: [
    {
      id: 'm04-p1',
      kind: 'write',
      conceptIds: ['m04-strings'],
      prompt: "Show each customer's **full name** as one column: first name, a space, last name (e.g. `Alice Johnson`).",
      solution: "SELECT first_name || ' ' || last_name AS full_name FROM customers;",
      wrongExample: 'SELECT first_name || last_name AS full_name FROM customers;',
      hints: ['Use || to glue text together.', "Don't forget the space in the middle: ' '"],
      explanation: "`||` concatenates text. The ' ' adds the space.",
      variants: [
        {
          id: 'm04-p1-v1',
          prompt: "Show each employee as `name (job_title)`, e.g. `Yuki Mori (Software Engineer)`.",
          solution: "SELECT name || ' (' || job_title || ')' FROM employees;",
          wrongExample: "SELECT name || job_title FROM employees;",
          hints: ['Concatenate four pieces.'],
          explanation: 'Text pieces glued with ||.',
        },
      ],
    },
    {
      id: 'm04-p2',
      kind: 'write',
      conceptIds: ['m04-strings'],
      prompt: 'Show the **title** of books whose title is **longer than 20 characters**.',
      solution: 'SELECT title FROM books WHERE length(title) > 20;',
      wrongExample: 'SELECT title FROM books WHERE length(title) < 20;',
      hints: ['Functions work in WHERE too.', 'length(title) > 20'],
      explanation: 'Any expression can be used in WHERE.',
    },
    {
      id: 'm04-p3',
      kind: 'fillBlank',
      conceptIds: ['m04-numbers'],
      prompt: 'Show each title with its price **including 21% VAT, rounded to 2 decimals**.',
      starterSql: 'SELECT title, ___(price * 1.21, ___) AS gross\nFROM books;',
      solution: 'SELECT title, round(price * 1.21, 2) AS gross FROM books;',
      wrongExample: 'SELECT title, price * 1.21 AS gross FROM books;',
      hints: ['The rounding function is round(value, decimals).'],
      explanation: 'round(x, 2) keeps 2 decimals.',
    },
    {
      id: 'm04-p4',
      kind: 'write',
      conceptIds: ['m04-case'],
      prompt: "Show each book's **title**, **price** and a **price_band**: `'budget'` under €10, `'standard'` under €15, otherwise `'premium'`.",
      solution: "SELECT title, price, CASE WHEN price < 10 THEN 'budget' WHEN price < 15 THEN 'standard' ELSE 'premium' END AS price_band FROM books;",
      wrongExample: "SELECT title, price, CASE WHEN price < 15 THEN 'standard' WHEN price < 10 THEN 'budget' ELSE 'premium' END AS price_band FROM books;",
      hints: ['CASE WHEN … THEN … WHEN … THEN … ELSE … END', 'Order matters! The first true branch wins, so check < 10 before < 15.'],
      explanation: "CASE checks top to bottom. If '< 15' came first, a €9 book would be 'standard'.",
    },
    {
      id: 'm04-p5',
      kind: 'write',
      conceptIds: ['m04-coalesce'],
      prompt: "Show customers' **first_name** and their **email**, but show `'no email'` when the email is missing.",
      solution: "SELECT first_name, coalesce(email, 'no email') FROM customers;",
      wrongExample: 'SELECT first_name, email FROM customers;',
      hints: ['There is a function that returns its first non-NULL argument.'],
      explanation: "coalesce(email, 'no email') swaps NULLs for a default.",
    },
    {
      id: 'm04-p6',
      kind: 'fixBug',
      conceptIds: ['m04-strings', 'm04-coalesce'],
      prompt: 'This should show every customer as `Name <email>`, but customers **without an email** show nothing at all (NULL). Make them show `Name <?>` instead.',
      starterSql: "SELECT first_name || ' <' || email || '>' AS contact\nFROM customers;",
      solution: "SELECT first_name || ' <' || coalesce(email, '?') || '>' AS contact FROM customers;",
      wrongExample: "SELECT first_name || ' <' || email || '>' AS contact FROM customers;",
      hints: ['What does text || NULL give?', "Replace the NULL email with '?' before concatenating."],
      explanation: 'NULL "infects" concatenation. COALESCE gives it a value first.',
    },
    {
      id: 'm04-p7',
      kind: 'write',
      conceptIds: ['m04-dates'],
      prompt: 'Show the **order_id** and **order_date** of all orders placed in the **year 2025**.',
      solution: 'SELECT order_id, order_date FROM orders WHERE extract(year FROM order_date) = 2025;',
      wrongExample: 'SELECT order_id, order_date FROM orders WHERE extract(month FROM order_date) = 1;',
      hints: ['extract(year FROM order_date) gives the year as a number.'],
      explanation: "`extract` pulls out a part of a date. `order_date >= '2025-01-01'` would work too.",
    },
    {
      id: 'm04-p8',
      kind: 'write',
      conceptIds: ['m04-dates'],
      prompt: 'Customers get a **30-day** return window. Show each **order_id**, its **order_date**, and the **return deadline** (order date + 30 days).',
      solution: 'SELECT order_id, order_date, order_date + 30 AS return_by FROM orders;',
      wrongExample: "SELECT order_id, order_date, order_date + interval '1 month' AS return_by FROM orders;",
      hints: ['You can add a number of days directly to a date.'],
      explanation: "date + integer adds days. (A month isn't always 30 days!)",
    },
    {
      id: 'm04-p9',
      kind: 'readQuery',
      conceptIds: ['m04-case'],
      prompt: 'What label does a book with **in_stock = 0** get?',
      sql: "SELECT title,\n  CASE\n    WHEN in_stock < 5 THEN 'low'\n    WHEN in_stock = 0 THEN 'sold out'\n    ELSE 'ok'\n  END\nFROM books;",
      choices: ["'sold out'", "'low'", "'ok'", 'NULL'],
      answer: 1,
      hints: [],
      explanation: "0 < 5 is true, and that branch comes first. 'sold out' is never reached, so the more specific case should go first.",
    },
    {
      id: 'm04-p10',
      kind: 'write',
      conceptIds: ['m04-numbers'],
      prompt: 'Each employee is paid **monthly**. Show **name** and **monthly salary** (salary / 12) **with decimals**, rounded to 2 places.',
      solution: 'SELECT name, round(salary / 12.0, 2) FROM employees;',
      wrongExample: 'SELECT name, salary / 12 FROM employees;',
      hints: ['salary is an integer, so salary / 12 throws away the decimals.', 'Divide by 12.0 (or cast salary::numeric), then round(…, 2).'],
      explanation: 'Integer ÷ integer truncates. Make one side numeric first.',
    },
  ],
  test: [
    {
      id: 'm04-t1',
      kind: 'write',
      conceptIds: ['m04-strings'],
      prompt: 'Show every book **title in UPPER CASE**.',
      solution: 'SELECT upper(title) FROM books;',
      wrongExample: 'SELECT title FROM books;',
      hints: [],
      explanation: 'upper().',
    },
    {
      id: 'm04-t2',
      kind: 'write',
      conceptIds: ['m04-case'],
      prompt: "Show each order's **order_id** and a column **is_open** that is `'yes'` for pending or shipped orders and `'no'` otherwise.",
      solution: "SELECT order_id, CASE WHEN status IN ('pending', 'shipped') THEN 'yes' ELSE 'no' END AS is_open FROM orders;",
      wrongExample: "SELECT order_id, CASE WHEN status = 'pending' THEN 'yes' ELSE 'no' END AS is_open FROM orders;",
      hints: [],
      explanation: 'CASE with IN.',
    },
    {
      id: 'm04-t3',
      kind: 'readQuery',
      conceptIds: ['m04-numbers'],
      prompt: 'What does `SELECT 7 / 2;` return in Postgres?',
      choices: ['3.5', '3', '4', 'An error'],
      answer: 1,
      hints: [],
      explanation: 'Integer division truncates.',
    },
    {
      id: 'm04-t4',
      kind: 'write',
      conceptIds: ['m04-coalesce'],
      prompt: "Show each book's **title** and **pages**, showing **0** where pages is unknown.",
      solution: 'SELECT title, coalesce(pages, 0) FROM books;',
      wrongExample: 'SELECT title, pages FROM books;',
      hints: [],
      explanation: 'coalesce for defaults.',
    },
    {
      id: 'm04-t5',
      kind: 'write',
      conceptIds: ['m04-dates'],
      prompt: 'Show **order_id** and **order_date** for orders placed in **March** (of any year).',
      solution: 'SELECT order_id, order_date FROM orders WHERE extract(month FROM order_date) = 3;',
      wrongExample: 'SELECT order_id, order_date FROM orders WHERE extract(day FROM order_date) = 3;',
      hints: [],
      explanation: 'extract(month …).',
    },
    {
      id: 'm04-t6',
      kind: 'fixBug',
      conceptIds: ['m04-strings'],
      prompt: "Should show authors' names **in lower case**, followed by their country in brackets, e.g. `jane austen (United Kingdom)`. Fix it.",
      starterSql: "SELECT lower(name) + ' (' + country + ')' FROM authors;",
      solution: "SELECT lower(name) || ' (' || country || ')' FROM authors;",
      wrongExample: "SELECT name || ' (' || country || ')' FROM authors;",
      hints: [],
      explanation: 'In SQL, text is joined with ||, not +.',
    },
  ],
};
