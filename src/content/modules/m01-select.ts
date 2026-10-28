import type { Module } from '../types';

export const m01: Module = {
  id: 'm01',
  number: 1,
  title: 'First queries',
  tagline: 'Tables, rows and columns. Ask the database your first questions with SELECT.',
  games: ['snapshot'],
  concepts: [
    {
      id: 'm01-tables',
      title: 'What is a database table?',
      card: `A **database** stores data in **tables**. A table is like a spreadsheet:

- each **column** has a name and a type (\`title\` is text, \`price\` is a number…)
- each **row** is one thing, for example one book

Our practice database is a small online **bookstore** with six tables: \`books\`, \`authors\`, \`customers\`, \`orders\`, \`order_items\` and \`employees\`.

To *read* data you write a **query** in **SQL**. The simplest one is:

\`\`\`sql
SELECT * FROM books;
\`\`\`

Read it as: "**select** every column (\`*\`) **from** the books table".`,
      predict: {
        sql: 'SELECT * FROM authors;',
        question: 'The authors table stores an id, a name, a country and a birth year for each author. How many columns will the result have?',
        choices: ['1', '4', '13', 'It depends on the authors'],
        answer: 1,
        why: '`*` means "all columns", and the authors table has 4: author_id, name, country and birth_year. (13 is the number of *rows*: one per author.)',
      },
      example: { sql: 'SELECT * FROM books;', note: 'Every column of every book. Scroll sideways to see them all.' },
      cheat: { syntax: 'SELECT * FROM table_name;', note: 'All columns, all rows.' },
    },
    {
      id: 'm01-columns',
      title: 'Choosing columns',
      card: `\`*\` is handy, but usually you only want *some* columns. List them after SELECT, **separated by commas**:

\`\`\`sql
SELECT title, price FROM books;
\`\`\`

Good to know:
- The columns come out **in the order you list them**.
- SQL keywords aren't case-sensitive: \`select\` = \`SELECT\`. Writing keywords in CAPITALS is just a convention that makes queries easier to read.
- The \`;\` marks the end of a statement.
- Line breaks don't matter, so you can spread a query over several lines.`,
      predict: {
        sql: 'SELECT title FROM books;',
        question: 'There are 30 books. How many rows will this return?',
        choices: ['1 row containing all the titles', '30 rows, one per book', 'Only the first title'],
        answer: 1,
        why: 'Choosing columns never removes rows. You still get one row per book, just with fewer columns.',
      },
      example: { sql: 'SELECT title, genre, price\nFROM books;', note: 'Three columns, in the order we asked for them.' },
      cheat: { syntax: 'SELECT col1, col2 FROM table_name;', note: 'Pick columns, separated by commas.' },
    },
    {
      id: 'm01-alias',
      title: 'Calculations and aliases (AS)',
      card: `A SELECT column can be a **calculation**, not just a stored column:

\`\`\`sql
SELECT title, price, price * 2 FROM books;
\`\`\`

Postgres calls that computed column \`?column?\`, which isn't helpful. Give it a name with **AS** (an *alias*):

\`\`\`sql
SELECT title, price * 2 AS double_price FROM books;
\`\`\`

Aliases only rename the column **in the result**. The table itself doesn't change. You can use \`+ - * /\` and parentheses as usual.`,
      predict: {
        sql: 'SELECT title, pages / 100 AS hundreds FROM books LIMIT 3;',
        question: 'Pride and Prejudice has 432 pages. What will "hundreds" be for it?',
        choices: ['4.32', '4', '432', 'An error'],
        answer: 1,
        why: '`pages` is an integer, and integer ÷ integer **drops the remainder** in Postgres: 432 / 100 = 4. To get 4.32, make one side a decimal, for example `pages / 100.0`.',
      },
      example: { sql: 'SELECT title, price, price * 1.2 AS price_with_tax\nFROM books;', note: 'A computed column with a readable name.' },
      cheat: { syntax: 'SELECT price * 1.2 AS with_tax FROM books;', note: 'Compute a value and name it with AS.' },
    },
    {
      id: 'm01-distinct',
      title: 'Removing duplicates: DISTINCT',
      card: `Many books share a genre. To see each value only **once**, add **DISTINCT** after SELECT:

\`\`\`sql
SELECT DISTINCT genre FROM books;
\`\`\`

⚠️ DISTINCT applies to the **whole row**. \`SELECT DISTINCT genre, author_id\` removes duplicate *(genre, author_id) pairs*, so the same genre can still appear several times.`,
      predict: {
        sql: 'SELECT DISTINCT genre FROM books;',
        question: 'There are 30 books spread across a few genres. How many rows come back?',
        choices: ['30', '7', '1'],
        answer: 1,
        why: 'There are 7 different genres (Classic, Dystopian, Literary, Science Fiction, Mystery, Fantasy, Non-fiction). DISTINCT keeps one row for each.',
      },
      example: { sql: 'SELECT DISTINCT country\nFROM customers;', note: 'Each country that has at least one customer, listed once.' },
      cheat: { syntax: 'SELECT DISTINCT col FROM table_name;', note: 'Remove duplicate rows (the whole row must match).' },
    },
  ],
  practice: [
    {
      id: 'm01-p1',
      kind: 'parsons',
      conceptIds: ['m01-columns'],
      prompt: 'Build a query that shows the **title** and **published_year** of every book.',
      blocks: ['SELECT title, published_year', 'FROM books;'],
      distractors: ['FROM authors;', 'SELECT *'],
      wrongOrder: ['FROM books;', 'SELECT title, published_year'],
      hints: ['Every query here starts with SELECT, followed by the columns you want.', 'After the columns comes FROM and the table name.'],
      explanation: 'SELECT says *which columns*, FROM says *which table*. That order is fixed.',
    },
    {
      id: 'm01-p2',
      kind: 'fillBlank',
      conceptIds: ['m01-columns'],
      prompt: 'Show each author\'s **name** and **country**. Replace the `___`.',
      starterSql: 'SELECT name, ___\nFROM authors;',
      solution: 'SELECT name, country FROM authors;',
      wrongExample: 'SELECT name, birth_year FROM authors;',
      hints: ['The blank needs a column name from the authors table.', 'The column holding where an author is from is called `country`.'],
      explanation: 'Two columns, separated by a comma. You get one row per author.',
    },
    {
      id: 'm01-p3',
      kind: 'write',
      conceptIds: ['m01-tables'],
      prompt: 'Show **everything** (all columns, all rows) from the `customers` table.',
      solution: 'SELECT * FROM customers;',
      wrongExample: 'SELECT first_name, last_name FROM customers;',
      hints: ['There is a shortcut that means "all columns".', 'SELECT * FROM …'],
      explanation: '`SELECT *` returns all columns. Handy for exploring a table.',
      variants: [
        {
          id: 'm01-p3-v1',
          prompt: 'Show **everything** from the `employees` table.',
          solution: 'SELECT * FROM employees;',
          wrongExample: 'SELECT name FROM employees;',
          hints: ['Use the "all columns" shortcut.'],
          explanation: '`SELECT *` returns every column.',
        },
      ],
    },
    {
      id: 'm01-p4',
      kind: 'parsons',
      conceptIds: ['m01-alias'],
      prompt: 'Show each book\'s **title** and its price with 20% tax, in a column named **price_with_tax**.',
      blocks: ['SELECT title,', 'price * 1.2 AS price_with_tax', 'FROM books;'],
      distractors: ['price_with_tax AS price * 1.2', 'FROM price;'],
      wrongOrder: ['SELECT title,', 'price * 1.2 AS price_with_tax'],
      hints: ['The alias comes *after* the expression: `expression AS name`.', 'Don\'t forget the FROM line.'],
      explanation: '`price * 1.2 AS price_with_tax` computes a value and names the column.',
    },
    {
      id: 'm01-p5',
      kind: 'write',
      conceptIds: ['m01-distinct'],
      prompt: 'Which **countries** do our customers come from? List each country **once**.',
      solution: 'SELECT DISTINCT country FROM customers;',
      wrongExample: 'SELECT country FROM customers;',
      hints: ['Without anything extra, countries with several customers appear several times.', 'Put one keyword between SELECT and the column.', 'SELECT DISTINCT …'],
      explanation: 'DISTINCT collapses duplicate rows, so you get 15 countries instead of 20 customer rows.',
      variants: [
        {
          id: 'm01-p5-v1',
          prompt: 'List each **department** in the `employees` table **once**.',
          solution: 'SELECT DISTINCT department FROM employees;',
          wrongExample: 'SELECT department FROM employees;',
          hints: ['Use DISTINCT.'],
          explanation: 'DISTINCT removes repeated departments.',
        },
      ],
    },
    {
      id: 'm01-p6',
      kind: 'readQuery',
      conceptIds: ['m01-distinct'],
      prompt: 'What does this query return?',
      sql: 'SELECT DISTINCT genre, author_id FROM books;',
      choices: [
        'Each genre once (7 rows)',
        'Each different (genre, author_id) combination once',
        'An error: DISTINCT only works with one column',
        'Every book (30 rows)',
      ],
      answer: 1,
      hints: [],
      explanation: 'DISTINCT applies to the whole row. A genre with books by several authors appears once per author.',
    },
    {
      id: 'm01-p7',
      kind: 'fixBug',
      conceptIds: ['m01-columns'],
      prompt: 'This should show each book\'s **title and price**, but it only shows **one column, called "price"**, which contains titles! Fix it.',
      starterSql: 'SELECT title price\nFROM books;',
      solution: 'SELECT title, price FROM books;',
      wrongExample: 'SELECT title price FROM books;',
      hints: ['Look closely at what separates the two column names.', 'Without a comma, `title price` means "title, renamed to price" (AS is optional!).'],
      explanation: 'Columns need commas between them. `title price` is read as an alias: `title AS price`. A sneaky bug, because no error appears!',
    },
    {
      id: 'm01-p8',
      kind: 'fixBug',
      conceptIds: ['m01-columns'],
      prompt: 'This query fails with a syntax error. Fix it so it shows each customer\'s **first_name** and **last_name**.',
      starterSql: 'SELECT first_name, last_name,\nFROM customers;',
      solution: 'SELECT first_name, last_name FROM customers;',
      wrongExample: 'SELECT first_name FROM customers;',
      hints: ['Look at the end of the first line.', 'A comma must be followed by another column. Remove the trailing comma.'],
      explanation: 'A trailing comma before FROM is one of the most common SQL syntax errors.',
    },
    {
      id: 'm01-p9',
      kind: 'write',
      conceptIds: ['m01-alias'],
      prompt: 'Show each book\'s **title** and how many books of that title we could buy with €100, as **books_per_100**. That is `100 / price`.',
      solution: 'SELECT title, 100 / price AS books_per_100 FROM books;',
      wrongExample: 'SELECT title, price / 100 AS books_per_100 FROM books;',
      hints: ['The calculation goes in the SELECT list, like a column.', 'Divide 100 by the price, then add AS books_per_100.'],
      explanation: 'Any expression can be a column. price is numeric, so the division keeps its decimals.',
    },
  ],
  test: [
    {
      id: 'm01-t1',
      kind: 'write',
      conceptIds: ['m01-columns'],
      prompt: 'Show the **name** and **job_title** of every employee.',
      solution: 'SELECT name, job_title FROM employees;',
      wrongExample: 'SELECT name FROM employees;',
      hints: [],
      explanation: 'Two columns from employees.',
    },
    {
      id: 'm01-t2',
      kind: 'write',
      conceptIds: ['m01-distinct'],
      prompt: 'List every **city** our customers live in, each **only once**.',
      solution: 'SELECT DISTINCT city FROM customers;',
      wrongExample: 'SELECT city FROM customers;',
      hints: [],
      explanation: 'DISTINCT removes the repeated cities (London and New York appear twice).',
    },
    {
      id: 'm01-t3',
      kind: 'readQuery',
      conceptIds: ['m01-alias'],
      prompt: 'What is the name of the second column in the result?',
      sql: 'SELECT title, price * 2 AS doubled FROM books;',
      choices: ['price', 'price * 2', 'doubled', '?column?'],
      answer: 2,
      hints: [],
      explanation: 'AS sets the column name in the result.',
    },
    {
      id: 'm01-t4',
      kind: 'write',
      conceptIds: ['m01-alias'],
      prompt: 'Show each book\'s **title** and its **price in cents** (price × 100) as **price_cents**.',
      solution: 'SELECT title, price * 100 AS price_cents FROM books;',
      wrongExample: 'SELECT title, price AS price_cents FROM books;',
      hints: [],
      explanation: 'Multiply in the SELECT list and alias the result.',
    },
    {
      id: 'm01-t5',
      kind: 'fixBug',
      conceptIds: ['m01-columns'],
      prompt: 'Fix this query so it shows each book\'s **title** and **genre**.',
      starterSql: 'FROM books\nSELECT title, genre;',
      solution: 'SELECT title, genre FROM books;',
      wrongExample: 'SELECT title FROM books;',
      hints: [],
      explanation: 'SELECT always comes before FROM.',
    },
    {
      id: 'm01-t6',
      kind: 'readQuery',
      conceptIds: ['m01-columns'],
      prompt: 'How many rows does `SELECT name FROM authors;` return, given there are 13 authors?',
      choices: ['1', '4', '13', '0'],
      answer: 2,
      hints: [],
      explanation: 'Choosing columns never removes rows: one row per author.',
    },
  ],
};
