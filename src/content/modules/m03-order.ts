import type { Module } from '../types';

export const m03: Module = {
  id: 'm03',
  number: 3,
  title: 'Sorting & paging',
  tagline: 'ORDER BY puts rows in order; LIMIT and OFFSET give you the top N and page through results.',
  games: ['podium'],
  concepts: [
    {
      id: 'm03-orderby',
      title: 'ORDER BY',
      card: `Without ORDER BY, rows come back in **no guaranteed order**. Postgres returns whatever order is convenient for it.

To sort, add **ORDER BY** at the end:

\`\`\`sql
SELECT title, price FROM books ORDER BY price;        -- cheapest first (ASC is the default)
SELECT title, price FROM books ORDER BY price DESC;   -- most expensive first
\`\`\`

ORDER BY runs **after** SELECT, so it can use an alias: \`ORDER BY double_price\`.`,
      predict: {
        sql: 'SELECT title, price FROM books ORDER BY price DESC;',
        question: 'Which book is on the first row?',
        choices: ['Beowulf (€6.99)', '1Q84 (€24.99)', 'Pride and Prejudice (it was added first)'],
        answer: 1,
        why: 'DESC means descending, largest first, and 1Q84 is the most expensive book.',
      },
      example: { sql: 'SELECT title, published_year\nFROM books\nORDER BY published_year DESC;', note: 'Newest books first.' },
      cheat: { syntax: 'ORDER BY price DESC', note: 'ASC (default) = small→large / A→Z. DESC = the reverse.' },
    },
    {
      id: 'm03-multisort',
      title: 'Sorting by several columns',
      card: `List several columns. The second one breaks ties in the first, and so on:

\`\`\`sql
SELECT country, last_name, first_name
FROM customers
ORDER BY country, last_name;
\`\`\`

Each column gets its own direction: \`ORDER BY genre ASC, price DESC\` sorts by genre A→Z, then by price high→low within each genre.`,
      predict: {
        sql: 'SELECT genre, title, price FROM books\nORDER BY genre, price DESC;',
        question: 'What is the very first row?',
        choices: ['The cheapest Classic', 'The most expensive Classic', 'The most expensive book overall'],
        answer: 1,
        why: '"Classic" comes first alphabetically. Within Classics, price DESC puts the most expensive (The Arabian Nights, €11.99) first.',
      },
      example: { sql: 'SELECT department, name, salary\nFROM employees\nORDER BY department, salary DESC;', note: 'Grouped by department, the best paid first in each.' },
      cheat: { syntax: 'ORDER BY a ASC, b DESC', note: 'Later columns break ties in earlier ones.' },
    },
    {
      id: 'm03-limit',
      title: 'LIMIT and OFFSET',
      card: `**LIMIT n** keeps only the first n rows. Together with ORDER BY it gives you a "top N":

\`\`\`sql
SELECT title, price FROM books ORDER BY price DESC LIMIT 3;  -- 3 most expensive
\`\`\`

**OFFSET n** skips n rows first, which is useful for pages:

\`\`\`sql
-- page 2, 5 per page: skip 5, take 5
SELECT title FROM books ORDER BY title LIMIT 5 OFFSET 5;
\`\`\`

⚠️ LIMIT without ORDER BY gives you "some" rows, not the "first" ones.`,
      predict: {
        sql: 'SELECT title FROM books ORDER BY title LIMIT 2 OFFSET 1;',
        question: 'Sorted by title, the first three titles are "1984", "1Q84", "A Wizard of Earthsea". What comes back?',
        choices: ['"1984", "1Q84"', '"1Q84", "A Wizard of Earthsea"', 'Only "1Q84"'],
        answer: 1,
        why: 'OFFSET 1 skips "1984", then LIMIT 2 takes the next two.',
      },
      example: { sql: 'SELECT title, price\nFROM books\nORDER BY price\nLIMIT 5;', note: 'The 5 cheapest books.' },
      cheat: { syntax: 'ORDER BY x LIMIT 10 OFFSET 20', note: 'Skip 20 rows, then take 10. Always pair with ORDER BY.' },
    },
    {
      id: 'm03-nulls',
      title: 'Where do NULLs go?',
      card: `In Postgres, NULL sorts as if it were **larger than every value**:

- \`ORDER BY pages\` (ASC): NULLs come **last**
- \`ORDER BY pages DESC\`: NULLs come **first**!

You can choose explicitly:

\`\`\`sql
ORDER BY pages DESC NULLS LAST
ORDER BY birth_year NULLS FIRST
\`\`\``,
      predict: {
        sql: 'SELECT title, pages FROM books ORDER BY pages DESC LIMIT 3;',
        question: 'We want the longest books. 1Q84 has 925 pages, the most of any book. What is on row 1?',
        choices: ['1Q84', 'A book with NULL pages', 'An error'],
        answer: 1,
        why: 'In descending order NULLs come first in Postgres, so Beowulf and The Arabian Nights (unknown pages) top the list. Add NULLS LAST to fix that.',
      },
      example: { sql: 'SELECT title, pages\nFROM books\nORDER BY pages DESC NULLS LAST\nLIMIT 5;', note: 'The real longest books.' },
      cheat: { syntax: 'ORDER BY pages DESC NULLS LAST', note: 'NULLs are "biggest": last in ASC, first in DESC.' },
    },
  ],
  practice: [
    {
      id: 'm03-p1',
      kind: 'parsons',
      conceptIds: ['m03-orderby'],
      prompt: 'List the **title** and **price** of all books, **cheapest first**.',
      blocks: ['SELECT title, price', 'FROM books', 'ORDER BY price;'],
      distractors: ['ORDER BY price DESC;', 'SORT BY price;'],
      orderMatters: true,
      wrongOrder: ['SELECT title, price', 'FROM books', 'ORDER BY price DESC;'],
      hints: ['Ascending (small → large) is the default.', 'There is no SORT BY in SQL.'],
      explanation: 'ORDER BY price sorts ascending by default.',
    },
    {
      id: 'm03-p2',
      kind: 'write',
      conceptIds: ['m03-orderby'],
      prompt: 'List each employee\'s **name** and **hire_date**, **most recently hired first**.',
      solution: 'SELECT name, hire_date FROM employees ORDER BY hire_date DESC;',
      wrongExample: 'SELECT name, hire_date FROM employees ORDER BY hire_date;',
      orderMatters: true,
      hints: ['Most recent = the largest date.', 'Use DESC.'],
      explanation: 'Later dates are "larger", so DESC puts the newest first.',
      variants: [
        {
          id: 'm03-p2-v1',
          prompt: 'List the **name** and **birth_year** of authors born in a known year, **oldest first**.',
          solution: 'SELECT name, birth_year FROM authors WHERE birth_year IS NOT NULL ORDER BY birth_year;',
          wrongExample: 'SELECT name, birth_year FROM authors WHERE birth_year IS NOT NULL ORDER BY birth_year DESC;',
          orderMatters: true,
          hints: ['Oldest = smallest birth year = ascending.'],
          explanation: 'Ascending puts the smallest year first.',
        },
      ],
    },
    {
      id: 'm03-p3',
      kind: 'fillBlank',
      conceptIds: ['m03-orderby'],
      prompt: 'Show employees from the **highest salary to the lowest**.',
      starterSql: 'SELECT name, salary\nFROM employees\nORDER BY salary ___;',
      solution: 'SELECT name, salary FROM employees ORDER BY salary DESC;',
      wrongExample: 'SELECT name, salary FROM employees ORDER BY salary ASC;',
      orderMatters: true,
      hints: ['Highest first = descending.'],
      explanation: 'DESC = descending.',
    },
    {
      id: 'm03-p4',
      kind: 'write',
      conceptIds: ['m03-multisort'],
      prompt: 'List customers\' **country**, **last_name** and **first_name**, sorted by **country**, then by **last_name**, then by **first_name**.',
      solution: 'SELECT country, last_name, first_name FROM customers ORDER BY country, last_name, first_name;',
      wrongExample: 'SELECT country, last_name, first_name FROM customers ORDER BY last_name, country, first_name;',
      orderMatters: true,
      hints: ['List the sort columns in priority order, separated by commas.'],
      explanation: 'The first ORDER BY column matters most, and later columns break ties.',
    },
    {
      id: 'm03-p5',
      kind: 'write',
      conceptIds: ['m03-limit'],
      prompt: 'Show the **title** and **price** of the **3 most expensive** books.',
      solution: 'SELECT title, price FROM books ORDER BY price DESC LIMIT 3;',
      wrongExample: 'SELECT title, price FROM books ORDER BY price LIMIT 3;',
      orderMatters: true,
      hints: ['First sort so the most expensive come first.', 'Then LIMIT 3.'],
      explanation: '"Top N" = ORDER BY … DESC LIMIT N.',
      variants: [
        {
          id: 'm03-p5-v1',
          prompt: 'Show the **name** and **salary** of the **2 lowest-paid** employees. (Their salaries tie, so show just those two rows. Any order between them is fine.)',
          solution: 'SELECT name, salary FROM employees ORDER BY salary LIMIT 2;',
          wrongExample: 'SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 2;',
          hints: ['Lowest first, then LIMIT.'],
          explanation: 'ORDER BY salary ASC LIMIT 2.',
        },
      ],
    },
    {
      id: 'm03-p6',
      kind: 'write',
      conceptIds: ['m03-limit'],
      prompt: 'Books are listed alphabetically by **title**, **5 per page**. Show the **titles on page 3**.',
      solution: 'SELECT title FROM books ORDER BY title LIMIT 5 OFFSET 10;',
      wrongExample: 'SELECT title FROM books ORDER BY title LIMIT 5 OFFSET 15;',
      orderMatters: true,
      hints: ['Page 1 = rows 1–5, page 2 = rows 6–10…', 'To reach page 3 you skip 2 pages × 5 rows.'],
      explanation: 'OFFSET = (page − 1) × page size = 10.',
    },
    {
      id: 'm03-p7',
      kind: 'fixBug',
      conceptIds: ['m03-limit'],
      prompt: 'This should show the **5 newest books** (title and year), but it errors. Fix it.',
      starterSql: 'SELECT title, published_year\nFROM books\nLIMIT 5\nORDER BY published_year DESC;',
      solution: 'SELECT title, published_year FROM books ORDER BY published_year DESC LIMIT 5;',
      wrongExample: 'SELECT title, published_year FROM books ORDER BY published_year LIMIT 5;',
      hints: ['Clause order matters: ORDER BY comes before LIMIT.'],
      explanation: 'The order is …WHERE → ORDER BY → LIMIT → OFFSET.',
    },
    {
      id: 'm03-p8',
      kind: 'write',
      conceptIds: ['m03-nulls'],
      prompt: 'Show the **title** and **pages** of the **5 longest books**. Books with unknown page counts must not be in the list.',
      solution: 'SELECT title, pages FROM books ORDER BY pages DESC NULLS LAST LIMIT 5;',
      wrongExample: 'SELECT title, pages FROM books ORDER BY pages DESC LIMIT 5;',
      orderMatters: true,
      hints: ['Try it without anything special first. Where do the NULLs go?', 'Add NULLS LAST (or filter with WHERE pages IS NOT NULL).'],
      explanation: 'In DESC order NULLs come first in Postgres. NULLS LAST (or WHERE pages IS NOT NULL) fixes it.',
    },
    {
      id: 'm03-p9',
      kind: 'readQuery',
      conceptIds: ['m03-limit'],
      prompt: 'What can you say about the result of `SELECT title FROM books LIMIT 3;`?',
      choices: [
        'It returns the 3 oldest books',
        'It returns the first 3 titles alphabetically',
        'It returns some 3 books, and which ones is not guaranteed',
        'It is an error without ORDER BY',
      ],
      answer: 2,
      hints: [],
      explanation: 'Without ORDER BY, Postgres may return rows in any order, so "first 3" means nothing. Always sort before LIMIT.',
    },
    {
      id: 'm03-p10',
      kind: 'write',
      conceptIds: ['m03-multisort', 'm03-orderby'],
      prompt: 'Show the **genre**, **title** and **price** of all books, sorted by **genre A→Z**, and within each genre **most expensive first**, and for equal prices by **title A→Z**.',
      solution: 'SELECT genre, title, price FROM books ORDER BY genre, price DESC, title;',
      wrongExample: 'SELECT genre, title, price FROM books ORDER BY genre, price, title;',
      orderMatters: true,
      hints: ['Three sort columns, each with its own direction.'],
      explanation: 'ORDER BY genre ASC, price DESC, title ASC.',
    },
  ],
  test: [
    {
      id: 'm03-t1',
      kind: 'write',
      conceptIds: ['m03-orderby'],
      prompt: 'List all **customer last names** and **first names**, sorted alphabetically by **last_name** then **first_name**.',
      solution: 'SELECT last_name, first_name FROM customers ORDER BY last_name, first_name;',
      wrongExample: 'SELECT last_name, first_name FROM customers ORDER BY first_name, last_name;',
      orderMatters: true,
      hints: [],
      explanation: 'Two sort columns.',
    },
    {
      id: 'm03-t2',
      kind: 'write',
      conceptIds: ['m03-limit'],
      prompt: 'Show the **title** and **in_stock** of the **4 books with the most copies in stock**.',
      solution: 'SELECT title, in_stock FROM books ORDER BY in_stock DESC LIMIT 4;',
      wrongExample: 'SELECT title, in_stock FROM books ORDER BY in_stock LIMIT 4;',
      orderMatters: true,
      hints: [],
      explanation: 'Top N pattern.',
    },
    {
      id: 'm03-t3',
      kind: 'readQuery',
      conceptIds: ['m03-nulls'],
      prompt: 'In `SELECT name, birth_year FROM authors ORDER BY birth_year;`, where does Elena Ferrante (birth_year NULL) appear?',
      choices: ['First', 'Last', 'She is left out', 'It is an error'],
      answer: 1,
      hints: [],
      explanation: 'NULLs sort last in ascending order in Postgres.',
    },
    {
      id: 'm03-t4',
      kind: 'write',
      conceptIds: ['m03-orderby', 'm03-limit'],
      prompt: 'Show the **order_id** and **order_date** of the **3 oldest orders**.',
      solution: 'SELECT order_id, order_date FROM orders ORDER BY order_date LIMIT 3;',
      wrongExample: 'SELECT order_id, order_date FROM orders ORDER BY order_date DESC LIMIT 3;',
      orderMatters: true,
      hints: [],
      explanation: 'Oldest = smallest date, ascending.',
    },
    {
      id: 'm03-t5',
      kind: 'fixBug',
      conceptIds: ['m03-multisort'],
      prompt: 'Should list employees by **department A→Z**, highest **salary** first within each department (equal salaries by **name** A→Z). Fix the sort.',
      starterSql: 'SELECT department, name, salary\nFROM employees\nORDER BY department DESC, salary;',
      solution: 'SELECT department, name, salary FROM employees ORDER BY department, salary DESC, name;',
      wrongExample: 'SELECT department, name, salary FROM employees ORDER BY salary DESC, department, name;',
      orderMatters: true,
      hints: [],
      explanation: 'Each ORDER BY column has its own direction.',
    },
    {
      id: 'm03-t6',
      kind: 'write',
      conceptIds: ['m03-limit'],
      prompt: 'Products are shown 4 per page ordered by **book_id**. Show the **book_id** and **title** on **page 2**.',
      solution: 'SELECT book_id, title FROM books ORDER BY book_id LIMIT 4 OFFSET 4;',
      wrongExample: 'SELECT book_id, title FROM books ORDER BY book_id LIMIT 4 OFFSET 8;',
      orderMatters: true,
      hints: [],
      explanation: 'OFFSET (2 − 1) × 4 = 4.',
    },
  ],
};
