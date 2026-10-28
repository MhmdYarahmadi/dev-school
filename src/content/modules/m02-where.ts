import type { Module } from '../types';

export const m02: Module = {
  id: 'm02',
  number: 2,
  title: 'Filtering rows',
  tagline: 'WHERE keeps only the rows you care about: comparisons, AND/OR, IN, BETWEEN, LIKE and NULL.',
  games: ['lineup'],
  concepts: [
    {
      id: 'm02-where',
      title: 'WHERE and comparisons',
      card: `SELECT chooses **columns**; **WHERE** chooses **rows**. It comes right after FROM:

\`\`\`sql
SELECT title, price
FROM books
WHERE price > 20;
\`\`\`

Postgres checks the condition for **each row** and keeps the rows where it's **true**.

| Operator | Meaning |
|---|---|
| \`=\` | equal (just one \`=\`!) |
| \`<>\` or \`!=\` | not equal |
| \`<\` \`>\` \`<=\` \`>=\` | less / greater (or equal) |`,
      predict: {
        sql: 'SELECT title, price FROM books WHERE price > 20;',
        question: 'Most books cost under €20. How many rows do you expect?',
        choices: ['0', '3', '27', '30'],
        answer: 1,
        why: 'Only three books cost more than €20: 1Q84, Sapiens and Homo Deus. WHERE drops every other row.',
      },
      example: { sql: 'SELECT title, published_year\nFROM books\nWHERE published_year >= 2000;', note: 'Books from this century.' },
      cheat: { syntax: 'SELECT … FROM t WHERE price > 20;', note: 'Keep only rows where the condition is true. = <> < > <= >=' },
    },
    {
      id: 'm02-text',
      title: 'Comparing text',
      card: `Text values go in **single quotes**:

\`\`\`sql
SELECT title FROM books WHERE genre = 'Mystery';
\`\`\`

Two traps:
1. **Double quotes** mean a *column name* in SQL. \`genre = "Mystery"\` looks for a column called Mystery and fails.
2. \`=\` is **case-sensitive**: \`'mystery'\` ≠ \`'Mystery'\`.

Dates are written as text too, like \`'2024-06-30'\`, and compare the way you'd expect: \`order_date < '2024-06-01'\`.`,
      predict: {
        sql: "SELECT title FROM books WHERE genre = 'mystery';",
        question: 'There are 3 Mystery books (genre is stored as \'Mystery\'). What happens?',
        choices: ['3 rows', '0 rows', 'An error'],
        answer: 1,
        why: "Comparison with = is case-sensitive. 'mystery' doesn't equal 'Mystery', so no rows match. It isn't an error, just zero rows. That's why this kind of bug is sneaky.",
      },
      example: { sql: "SELECT order_id, order_date, status\nFROM orders\nWHERE status = 'pending';", note: 'Text in single quotes.' },
      cheat: { syntax: "WHERE genre = 'Mystery'", note: "Text and dates in 'single quotes'. Case-sensitive." },
    },
    {
      id: 'm02-andor',
      title: 'AND, OR, NOT',
      card: `Combine conditions:

- \`a AND b\`: both must be true
- \`a OR b\`: at least one must be true
- \`NOT a\`: flips true and false

⚠️ **AND is evaluated before OR**, just as × comes before + in maths. So

\`\`\`sql
WHERE genre = 'Mystery' OR genre = 'Classic' AND price < 8
\`\`\`

means \`Mystery OR (Classic AND price < 8)\`. **Use parentheses** to say what you mean:

\`\`\`sql
WHERE (genre = 'Mystery' OR genre = 'Classic') AND price < 8
\`\`\``,
      predict: {
        sql: "SELECT title, genre, price FROM books\nWHERE genre = 'Mystery' OR genre = 'Classic' AND price < 8;",
        question: 'There are 3 Mystery books (all over €10) and 4 Classics (one under €8). How many rows?',
        choices: ['1', '4', '7'],
        answer: 1,
        why: "AND binds first: all 3 Mysteries (whatever their price) OR Classics under €8 (just Beowulf) gives 4 rows. With parentheses around the OR you'd get only 1.",
      },
      example: { sql: "SELECT title, genre, price\nFROM books\nWHERE (genre = 'Mystery' OR genre = 'Classic')\n  AND price < 11;", note: 'Parentheses make the intent clear.' },
      cheat: { syntax: "WHERE (a OR b) AND NOT c", note: 'AND before OR. Use parentheses when you mix them.' },
    },
    {
      id: 'm02-in-between',
      title: 'IN and BETWEEN',
      card: `Two shortcuts:

\`\`\`sql
WHERE country IN ('Japan', 'China', 'South Korea')
-- same as: country = 'Japan' OR country = 'China' OR country = 'South Korea'

WHERE price BETWEEN 10 AND 12
-- same as: price >= 10 AND price <= 12  (both ends INCLUDED)
\`\`\`

\`NOT IN\` and \`NOT BETWEEN\` work too.`,
      predict: {
        sql: 'SELECT title, price FROM books WHERE price BETWEEN 10 AND 12;',
        question: '"The Left Hand of Darkness" costs exactly 12.00. Is it in the result?',
        choices: ['Yes', 'No'],
        answer: 0,
        why: 'BETWEEN includes both ends: it means >= 10 AND <= 12.',
      },
      example: { sql: "SELECT first_name, last_name, country\nFROM customers\nWHERE country IN ('Japan', 'China', 'South Korea');", note: 'Three ORs in one short list.' },
      cheat: { syntax: "WHERE x IN ('a','b')  /  WHERE x BETWEEN 1 AND 5", note: 'IN = a list of ORs. BETWEEN includes both ends.' },
    },
    {
      id: 'm02-like',
      title: 'Patterns: LIKE and ILIKE',
      card: `To match *part* of some text, use **LIKE** with wildcards:

- \`%\` matches any text (including none)
- \`_\` matches exactly one character

\`\`\`sql
WHERE title LIKE 'The%'     -- starts with "The"
WHERE title LIKE '%Night%'  -- contains "Night"
WHERE last_name LIKE 'S_ith' -- Smith, Sxith…
\`\`\`

LIKE is case-sensitive. Postgres also has **ILIKE**, which ignores case. Handy!`,
      predict: {
        sql: "SELECT title FROM books WHERE title LIKE '%the%';",
        question: 'Will "The Dispossessed" be in the result?',
        choices: ['Yes, it contains "The"', 'No'],
        answer: 1,
        why: "LIKE is case-sensitive: 'The' with a capital T doesn't match '%the%'. Titles like \"Kafka on the Shore\" do match. Use ILIKE to ignore case.",
      },
      example: { sql: "SELECT title\nFROM books\nWHERE title ILIKE '%the%';", note: 'ILIKE: case-insensitive.' },
      cheat: { syntax: "WHERE title ILIKE '%night%'", note: '% = any text, _ = one character. ILIKE ignores case.' },
    },
    {
      id: 'm02-null',
      title: 'NULL: the missing value',
      card: `**NULL** means "unknown / missing". Two books have unknown \`pages\`, and some customers have no \`email\`.

NULL is not zero and not empty text, and it never equals anything, **not even another NULL**. So \`pages = NULL\` is never true!

Use these instead:

\`\`\`sql
WHERE pages IS NULL
WHERE email IS NOT NULL
\`\`\``,
      predict: {
        sql: 'SELECT title FROM books WHERE pages = NULL;',
        question: 'Two books have NULL pages. How many rows does this return?',
        choices: ['2', '0', '28', 'An error'],
        answer: 1,
        why: '`pages = NULL` is "unknown" for every row, never true, so no rows come back, and there\'s no error to warn you. Use `IS NULL`.',
      },
      example: { sql: 'SELECT first_name, last_name\nFROM customers\nWHERE email IS NULL;', note: 'Customers without an email.' },
      cheat: { syntax: 'WHERE col IS NULL / IS NOT NULL', note: 'Never use = NULL. It is never true.' },
    },
  ],
  practice: [
    {
      id: 'm02-p1',
      kind: 'parsons',
      conceptIds: ['m02-where'],
      prompt: 'Build a query listing the **title** and **price** of books cheaper than €10.',
      blocks: ['SELECT title, price', 'FROM books', 'WHERE price < 10;'],
      distractors: ['WHERE price > 10;', 'WHERE price = < 10;'],
      wrongOrder: ['SELECT title, price', 'WHERE price < 10;', 'FROM books'],
      hints: ['The order of clauses is SELECT → FROM → WHERE.', '"Cheaper than" means less than: <'],
      explanation: 'WHERE always comes after FROM.',
    },
    {
      id: 'm02-p2',
      kind: 'fillBlank',
      conceptIds: ['m02-text'],
      prompt: 'Show the first and last names of customers from the **United Kingdom**.',
      starterSql: 'SELECT first_name, last_name\nFROM customers\nWHERE country = ___;',
      solution: "SELECT first_name, last_name FROM customers WHERE country = 'United Kingdom';",
      wrongExample: "SELECT first_name, last_name FROM customers WHERE country = 'United States';",
      hints: ['Text values need quotes. Which kind?', "Single quotes: 'United Kingdom'"],
      explanation: "Text goes in single quotes and must match exactly, including capitals.",
    },
    {
      id: 'm02-p3',
      kind: 'write',
      conceptIds: ['m02-where'],
      prompt: 'Show the **title** and **published_year** of books published **before 1900**.',
      solution: 'SELECT title, published_year FROM books WHERE published_year < 1900;',
      wrongExample: 'SELECT title, published_year FROM books WHERE published_year > 1900;',
      hints: ['Use WHERE with a comparison on published_year.', 'Before 1900 → published_year < 1900'],
      explanation: '`<` keeps rows with a smaller value.',
      variants: [
        {
          id: 'm02-p3-v1',
          prompt: 'Show the **name** and **salary** of employees earning **more than 80000**.',
          solution: 'SELECT name, salary FROM employees WHERE salary > 80000;',
          wrongExample: 'SELECT name, salary FROM employees WHERE salary < 80000;',
          hints: ['WHERE salary > …'],
          explanation: 'A simple numeric comparison.',
        },
      ],
    },
    {
      id: 'm02-p4',
      kind: 'write',
      conceptIds: ['m02-andor'],
      prompt: 'Show the **title** and **price** of **Mystery** books that cost **less than €11**.',
      solution: "SELECT title, price FROM books WHERE genre = 'Mystery' AND price < 11;",
      wrongExample: "SELECT title, price FROM books WHERE genre = 'Mystery' OR price < 11;",
      hints: ['Both conditions must be true at the same time.', "WHERE genre = 'Mystery' AND …"],
      explanation: 'AND requires both conditions. OR would also include every cheap non-mystery book.',
      variants: [
        {
          id: 'm02-p4-v1',
          prompt: 'Show the **name** of employees in the **Technology** department earning **less than 85000**.',
          solution: "SELECT name FROM employees WHERE department = 'Technology' AND salary < 85000;",
          wrongExample: "SELECT name FROM employees WHERE department = 'Technology' OR salary < 85000;",
          hints: ['Two conditions joined with AND.'],
          explanation: 'Both must hold.',
        },
      ],
    },
    {
      id: 'm02-p5',
      kind: 'fixBug',
      conceptIds: ['m02-text'],
      prompt: 'This should list **Fantasy** books, but it fails with *column "Fantasy" does not exist*. Fix it.',
      starterSql: 'SELECT title\nFROM books\nWHERE genre = "Fantasy";',
      solution: "SELECT title FROM books WHERE genre = 'Fantasy';",
      wrongExample: "SELECT title FROM books WHERE genre = 'fantasy';",
      hints: ['Double quotes mean something special in SQL.', 'Text values use single quotes.'],
      explanation: '"Double quotes" are for column and table names. \'Single quotes\' are for text values.',
    },
    {
      id: 'm02-p6',
      kind: 'write',
      conceptIds: ['m02-in-between'],
      prompt: 'Show the **first_name** and **country** of customers from **Japan, China or South Korea**. Use IN.',
      solution: "SELECT first_name, country FROM customers WHERE country IN ('Japan', 'China', 'South Korea');",
      wrongExample: "SELECT first_name, country FROM customers WHERE country IN ('Japan');",
      hints: ["IN takes a list in parentheses: IN ('a', 'b', 'c')"],
      explanation: 'IN is a compact way to write several ORs.',
    },
    {
      id: 'm02-p7',
      kind: 'write',
      conceptIds: ['m02-in-between'],
      prompt: 'Show the **title** and **published_year** of books published from **1950 to 1970, inclusive**.',
      solution: 'SELECT title, published_year FROM books WHERE published_year BETWEEN 1950 AND 1970;',
      wrongExample: 'SELECT title, published_year FROM books WHERE published_year > 1950 AND published_year < 1970;',
      hints: ['"Inclusive" means 1950 and 1970 themselves count.', 'BETWEEN 1950 AND 1970 includes both ends.'],
      explanation: "BETWEEN includes both ends. Using > and < would miss I, Robot (1950).",
    },
    {
      id: 'm02-p8',
      kind: 'write',
      conceptIds: ['m02-like'],
      prompt: 'Find every book whose **title contains the word "of"** anywhere, in any capitalisation. Show the title.',
      solution: "SELECT title FROM books WHERE title ILIKE '%of%';",
      wrongExample: "SELECT title FROM books WHERE title LIKE 'of%';",
      hints: ['"Anywhere" means wildcards on both sides.', "Use ILIKE '%of%' to ignore case."],
      explanation: '`%` on both sides means "anything before, anything after". ILIKE ignores case.',
    },
    {
      id: 'm02-p9',
      kind: 'write',
      conceptIds: ['m02-null'],
      prompt: 'Which customers have **no email**? Show their **first_name** and **last_name**.',
      solution: 'SELECT first_name, last_name FROM customers WHERE email IS NULL;',
      wrongExample: 'SELECT first_name, last_name FROM customers WHERE email = NULL;',
      hints: ['A missing value is NULL.', 'Comparing with = NULL never works. There is a special operator.'],
      explanation: 'Use IS NULL. `= NULL` is never true.',
      variants: [
        {
          id: 'm02-p9-v1',
          prompt: 'Which books have a **known** page count? Show **title** and **pages**.',
          solution: 'SELECT title, pages FROM books WHERE pages IS NOT NULL;',
          wrongExample: 'SELECT title, pages FROM books WHERE pages != NULL;',
          hints: ['The opposite of IS NULL.'],
          explanation: 'IS NOT NULL keeps rows with a value.',
        },
      ],
    },
    {
      id: 'm02-p10',
      kind: 'readQuery',
      conceptIds: ['m02-andor'],
      prompt: 'Which query returns **cheap (under €10) books that are Classic or Dystopian**?',
      choices: [
        "`WHERE genre = 'Classic' OR genre = 'Dystopian' AND price < 10`",
        "`WHERE (genre = 'Classic' OR genre = 'Dystopian') AND price < 10`",
        "`WHERE genre = 'Classic' AND genre = 'Dystopian' AND price < 10`",
        "`WHERE genre IN ('Classic' AND 'Dystopian') AND price < 10`",
      ],
      answer: 1,
      hints: [],
      explanation: 'Without parentheses, AND binds first, so every Classic would be included whatever its price. Option 3 is never true (a genre can\'t be two things at once).',
    },
    {
      id: 'm02-p11',
      kind: 'fixBug',
      conceptIds: ['m02-andor'],
      prompt: 'We want **Science Fiction or Fantasy** books that cost **less than €10**. This returns too many rows. Fix it.',
      starterSql: "SELECT title, genre, price\nFROM books\nWHERE genre = 'Science Fiction' OR genre = 'Fantasy' AND price < 10;",
      solution: "SELECT title, genre, price FROM books WHERE (genre = 'Science Fiction' OR genre = 'Fantasy') AND price < 10;",
      wrongExample: "SELECT title, genre, price FROM books WHERE genre = 'Science Fiction' OR genre = 'Fantasy' AND price < 10;",
      hints: ['Which runs first: AND or OR?', 'Put parentheses around the two genre conditions.'],
      explanation: 'AND binds tighter than OR, so the price limit only applied to Fantasy. Parentheses fix it.',
    },
    {
      id: 'm02-p12',
      kind: 'write',
      conceptIds: ['m02-where', 'm02-text'],
      prompt: 'Show the **order_id** and **status** of every order that is **not delivered**.',
      solution: "SELECT order_id, status FROM orders WHERE status <> 'delivered';",
      wrongExample: "SELECT order_id, status FROM orders WHERE status = 'delivered';",
      hints: ['"Not equal" is <> (or !=).'],
      explanation: "`<>` means not equal. `NOT status = 'delivered'` works too.",
    },
  ],
  test: [
    {
      id: 'm02-t1',
      kind: 'write',
      conceptIds: ['m02-andor'],
      prompt: 'Show the **name** of authors from the **United States** born **after 1930**.',
      solution: "SELECT name FROM authors WHERE country = 'United States' AND birth_year > 1930;",
      wrongExample: "SELECT name FROM authors WHERE country = 'United States';",
      hints: [],
      explanation: 'Two conditions with AND.',
    },
    {
      id: 'm02-t2',
      kind: 'write',
      conceptIds: ['m02-like'],
      prompt: 'Show the **first_name** and **last_name** of customers whose last name **starts with "S"**.',
      solution: "SELECT first_name, last_name FROM customers WHERE last_name LIKE 'S%';",
      wrongExample: "SELECT first_name, last_name FROM customers WHERE last_name ILIKE '%s%';",
      hints: [],
      explanation: "'S%' means S followed by anything.",
    },
    {
      id: 'm02-t3',
      kind: 'readQuery',
      conceptIds: ['m02-null'],
      prompt: '`SELECT * FROM customers WHERE email <> NULL;` How many rows does it return?',
      choices: ['All customers with an email', 'All customers', '0 rows', 'An error'],
      answer: 2,
      hints: [],
      explanation: 'Any comparison with NULL is unknown, never true. Use IS NOT NULL.',
    },
    {
      id: 'm02-t4',
      kind: 'write',
      conceptIds: ['m02-in-between'],
      prompt: 'Show the **order_id** and **status** of orders that are **pending or shipped**.',
      solution: "SELECT order_id, status FROM orders WHERE status IN ('pending', 'shipped');",
      wrongExample: "SELECT order_id, status FROM orders WHERE status = 'pending';",
      hints: [],
      explanation: 'IN with two values.',
    },
    {
      id: 'm02-t5',
      kind: 'fixBug',
      conceptIds: ['m02-null'],
      prompt: 'Fix this so it lists the **title** of books with an **unknown** page count.',
      starterSql: 'SELECT title FROM books WHERE pages = NULL;',
      solution: 'SELECT title FROM books WHERE pages IS NULL;',
      wrongExample: 'SELECT title FROM books WHERE pages = 0;',
      hints: [],
      explanation: 'IS NULL, never = NULL.',
    },
    {
      id: 'm02-t6',
      kind: 'write',
      conceptIds: ['m02-in-between', 'm02-text'],
      prompt: 'Show **order_id** and **order_date** for orders placed in **the first quarter of 2024** (January 1st to March 31st inclusive).',
      solution: "SELECT order_id, order_date FROM orders WHERE order_date BETWEEN '2024-01-01' AND '2024-03-31';",
      wrongExample: "SELECT order_id, order_date FROM orders WHERE order_date < '2024-03-01';",
      hints: [],
      explanation: "Dates are compared like text in quotes: 'YYYY-MM-DD'.",
    },
  ],
};
