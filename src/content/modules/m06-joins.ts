import type { Module } from '../types';

export const m06: Module = {
  id: 'm06',
  number: 6,
  title: 'Joins',
  tagline: 'Combine tables: INNER and LEFT joins, finding what is missing, multi-table and self joins.',
  games: ['bridge'],
  concepts: [
    {
      id: 'm06-inner',
      title: 'INNER JOIN',
      card: `Data is split across tables on purpose. \`books.author_id\` *points to* \`authors.author_id\`. A **JOIN** glues matching rows together:

\`\`\`sql
SELECT books.title, authors.name
FROM books
JOIN authors ON authors.author_id = books.author_id;
\`\`\`

For each book, Postgres finds the author row where the **ON condition** is true and puts them side by side.

\`JOIN\` means \`INNER JOIN\`: rows **without a match are dropped** on both sides.`,
      predict: {
        sql: 'SELECT books.title, authors.name\nFROM books\nJOIN authors ON authors.author_id = books.author_id;',
        question: 'There are 30 books, but 2 of them (Beowulf, The Arabian Nights) have author_id NULL. How many rows?',
        choices: ['30', '28', '13', '390'],
        answer: 1,
        why: 'An INNER JOIN keeps only rows with a match. NULL matches nothing, so the 2 anonymous books disappear.',
      },
      example: { sql: 'SELECT books.title, authors.name, authors.country\nFROM books\nJOIN authors ON authors.author_id = books.author_id;', note: 'Each book next to its author.' },
      cheat: { syntax: 'FROM a JOIN b ON b.a_id = a.id', note: 'INNER: only rows that match on both sides.' },
    },
    {
      id: 'm06-aliases',
      title: 'Table aliases and ambiguous columns',
      card: `Writing full table names gets long. Give each table a short **alias**:

\`\`\`sql
SELECT b.title, a.name
FROM books b
JOIN authors a ON a.author_id = b.author_id;
\`\`\`

When both tables have a column with the same name (\`author_id\` here), you **must** say which one you mean (\`b.author_id\`), otherwise Postgres complains: *column reference "author_id" is ambiguous*.`,
      predict: {
        sql: 'SELECT author_id, title, name\nFROM books b\nJOIN authors a ON a.author_id = b.author_id;',
        question: 'What happens?',
        choices: ['It works', 'An error, because author_id is ambiguous', 'It returns only author_id'],
        answer: 1,
        why: 'Both tables have author_id, so a bare `author_id` in SELECT is ambiguous. Write `b.author_id` or `a.author_id`. (title and name exist in only one table, so they\'re fine.)',
        expectError: true,
      },
      example: { sql: 'SELECT o.order_id, o.order_date, c.first_name, c.city\nFROM orders o\nJOIN customers c ON c.customer_id = o.customer_id;', note: 'Short aliases keep joins readable.' },
      cheat: { syntax: 'FROM books b JOIN authors a ON a.author_id = b.author_id', note: 'Alias tables. Prefix any shared column name.' },
    },
    {
      id: 'm06-left',
      title: 'LEFT JOIN and finding what is missing',
      card: `A **LEFT JOIN** keeps **every row from the left table**, even without a match. The right side's columns are then **NULL**:

\`\`\`sql
SELECT a.name, b.title
FROM authors a
LEFT JOIN books b ON b.author_id = a.author_id;
\`\`\`

Octavia Butler has no books here, so she appears once with \`title = NULL\`.

🔎 That gives you a classic pattern for **"which X have no Y?"**:

\`\`\`sql
SELECT a.name
FROM authors a
LEFT JOIN books b ON b.author_id = a.author_id
WHERE b.book_id IS NULL;
\`\`\`

\`RIGHT JOIN\` is the mirror image, and \`FULL JOIN\` keeps unmatched rows from both sides.`,
      predict: {
        sql: 'SELECT a.name, b.title\nFROM authors a\nLEFT JOIN books b ON b.author_id = a.author_id;',
        question: '28 books have an author. One author (Octavia Butler) has no books. How many rows?',
        choices: ['28', '29', '30', '13'],
        answer: 1,
        why: '28 matched pairs, plus 1 row for the author with no books (her title is NULL). The 2 anonymous books are not on the left side, so they don\'t appear.',
      },
      example: { sql: 'SELECT c.first_name, c.last_name\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id\nWHERE o.order_id IS NULL;', note: 'Customers who never ordered.' },
      cheat: { syntax: 'FROM a LEFT JOIN b ON … WHERE b.id IS NULL', note: 'Keep all of a. Unmatched rows get NULLs. IS NULL finds the ones missing.' },
    },
    {
      id: 'm06-multi',
      title: 'Joining three or more tables',
      card: `Joins chain. To list **who bought which book**, go customers → orders → order_items → books:

\`\`\`sql
SELECT c.first_name, b.title, i.quantity
FROM customers c
JOIN orders o       ON o.customer_id = c.customer_id
JOIN order_items i  ON i.order_id = o.order_id
JOIN books b        ON b.book_id = i.book_id;
\`\`\`

Each JOIN adds one table and needs its own ON. You can then use WHERE, GROUP BY etc. as usual.`,
      predict: {
        sql: 'SELECT count(*)\nFROM books, authors;',
        question: '30 books, 13 authors, and no join condition at all (an old-style comma join). How many rows?',
        choices: ['28', '30', '43', '390'],
        answer: 3,
        why: 'Without a condition, every book is paired with every author: 30 × 13 = 390. This is a *cross join*, and it\'s why every join needs an ON.',
      },
      example: { sql: 'SELECT c.first_name, b.title, i.quantity\nFROM customers c\nJOIN orders o      ON o.customer_id = c.customer_id\nJOIN order_items i ON i.order_id = o.order_id\nJOIN books b       ON b.book_id = i.book_id\nORDER BY c.first_name;', note: 'Four tables in one query.' },
      cheat: { syntax: 'FROM a JOIN b ON … JOIN c ON …', note: 'One ON per JOIN. No condition = every combination.' },
    },
    {
      id: 'm06-self',
      title: 'Self joins',
      card: `A table can be joined **to itself**. \`employees.manager_id\` points to another row in **employees**. Use two aliases, as if there were two copies:

\`\`\`sql
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON m.employee_id = e.manager_id;
\`\`\`

\`e\` is the employee, \`m\` is their manager. It's a LEFT JOIN so the CEO (who has no manager) stays in the list.`,
      predict: {
        sql: 'SELECT e.name, m.name\nFROM employees e\nJOIN employees m ON m.employee_id = e.manager_id;',
        question: '12 employees, and only the CEO has no manager. How many rows?',
        choices: ['12', '11', '144'],
        answer: 1,
        why: 'An INNER self join drops the CEO (manager_id is NULL), leaving 11. Use a LEFT JOIN to keep them.',
      },
      example: { sql: 'SELECT e.name AS employee, e.job_title, m.name AS manager\nFROM employees e\nLEFT JOIN employees m ON m.employee_id = e.manager_id;', note: 'Who reports to whom.' },
      cheat: { syntax: 'FROM t e JOIN t m ON m.id = e.parent_id', note: 'Same table, two aliases.' },
    },
  ],
  practice: [
    {
      id: 'm06-p1',
      kind: 'parsons',
      conceptIds: ['m06-inner'],
      prompt: 'Build a query listing each book **title** next to its **author name**.',
      blocks: ['SELECT b.title, a.name', 'FROM books b', 'JOIN authors a', 'ON a.author_id = b.author_id;'],
      distractors: ['ON a.author_id = b.book_id;', 'WHERE a.name = b.title;'],
      wrongOrder: ['SELECT b.title, a.name', 'FROM books b', 'JOIN authors a', 'ON a.author_id = b.book_id;'],
      hints: ['The ON condition connects the matching columns.', 'books.author_id points to authors.author_id.'],
      explanation: 'Join on the key that links the tables: author_id.',
    },
    {
      id: 'm06-p2',
      kind: 'write',
      conceptIds: ['m06-inner', 'm06-aliases'],
      prompt: 'For each order, show the **order_id**, **order_date** and the customer\'s **first_name**.',
      solution: 'SELECT o.order_id, o.order_date, c.first_name FROM orders o JOIN customers c ON c.customer_id = o.customer_id;',
      wrongExample: 'SELECT o.order_id, o.order_date, c.first_name FROM orders o JOIN customers c ON c.customer_id = o.order_id;',
      hints: ['orders.customer_id points to customers.customer_id.'],
      explanation: 'Join on the foreign key → primary key.',
      variants: [
        {
          id: 'm06-p2-v1',
          prompt: 'Show each order line\'s **order_id**, the book **title** and the **quantity**.',
          solution: 'SELECT i.order_id, b.title, i.quantity FROM order_items i JOIN books b ON b.book_id = i.book_id;',
          wrongExample: 'SELECT i.order_id, b.title, i.quantity FROM order_items i JOIN books b ON b.book_id = i.order_id;',
          hints: ['order_items.book_id → books.book_id'],
          explanation: 'Join on book_id.',
        },
      ],
    },
    {
      id: 'm06-p3',
      kind: 'fixBug',
      conceptIds: ['m06-aliases'],
      prompt: 'This fails with *column reference "customer_id" is ambiguous*. Fix it so it shows each order\'s **customer_id**, **order_id** and **city**.',
      starterSql: 'SELECT customer_id, order_id, city\nFROM orders o\nJOIN customers c ON c.customer_id = o.customer_id;',
      solution: 'SELECT o.customer_id, o.order_id, c.city FROM orders o JOIN customers c ON c.customer_id = o.customer_id;',
      wrongExample: 'SELECT o.customer_id, o.order_id, c.city FROM orders o JOIN customers c ON c.customer_id = o.order_id;',
      hints: ['Which tables have a column called customer_id?', 'Prefix it: o.customer_id'],
      explanation: 'Columns that exist in both tables must be qualified with a table alias.',
    },
    {
      id: 'm06-p4',
      kind: 'write',
      conceptIds: ['m06-left'],
      prompt: 'Which **authors have no books** in the store? Show their **name**.',
      solution: 'SELECT a.name FROM authors a LEFT JOIN books b ON b.author_id = a.author_id WHERE b.book_id IS NULL;',
      wrongExample: 'SELECT a.name FROM authors a JOIN books b ON b.author_id = a.author_id WHERE b.book_id IS NULL;',
      hints: ['An INNER JOIN would throw these authors away. Keep them.', 'LEFT JOIN, then keep the rows where the book side is NULL.'],
      explanation: 'LEFT JOIN + WHERE right.id IS NULL is the standard "anti-join" pattern.',
      variants: [
        {
          id: 'm06-p4-v1',
          prompt: 'Which **books have never been ordered**? Show the **title**.',
          solution: 'SELECT b.title FROM books b LEFT JOIN order_items i ON i.book_id = b.book_id WHERE i.book_id IS NULL;',
          wrongExample: 'SELECT b.title FROM books b JOIN order_items i ON i.book_id = b.book_id;',
          hints: ['books LEFT JOIN order_items, then look for NULLs.'],
          explanation: 'Anti-join pattern.',
        },
      ],
    },
    {
      id: 'm06-p5',
      kind: 'write',
      conceptIds: ['m06-left'],
      prompt: 'List **every customer\'s first_name** with the **order_id** of each of their orders. Customers with **no orders must still appear** (with an empty order_id).',
      solution: 'SELECT c.first_name, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id;',
      wrongExample: 'SELECT c.first_name, o.order_id FROM customers c JOIN orders o ON o.customer_id = c.customer_id;',
      hints: ['"Must still appear" means LEFT JOIN.'],
      explanation: 'LEFT JOIN keeps Tom, who has no orders, with order_id NULL.',
    },
    {
      id: 'm06-p6',
      kind: 'write',
      conceptIds: ['m06-multi'],
      prompt: 'Show the **first_name** of each customer and the **title** of every book they ordered (one row per order line).',
      solution: 'SELECT c.first_name, b.title FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN order_items i ON i.order_id = o.order_id JOIN books b ON b.book_id = i.book_id;',
      wrongExample: 'SELECT c.first_name, b.title FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN order_items i ON i.order_id = o.order_id JOIN books b ON b.book_id = i.order_id;',
      hints: ['Four tables: customers → orders → order_items → books.', 'Each JOIN needs its own ON.'],
      explanation: 'Chain joins along the keys.',
    },
    {
      id: 'm06-p7',
      kind: 'write',
      conceptIds: ['m06-self'],
      prompt: 'Show each employee\'s **name** and their **manager\'s name**. Include the CEO (manager shown as NULL).',
      solution: 'SELECT e.name, m.name FROM employees e LEFT JOIN employees m ON m.employee_id = e.manager_id;',
      wrongExample: 'SELECT e.name, m.name FROM employees e JOIN employees m ON m.employee_id = e.manager_id;',
      hints: ['Join employees to itself with two aliases.', 'LEFT JOIN keeps the CEO.'],
      explanation: 'A self join with a LEFT JOIN.',
    },
    {
      id: 'm06-p8',
      kind: 'write',
      conceptIds: ['m06-left', 'm06-inner'],
      prompt: 'For **every author**, show the **name** and **how many books** they have in the store, **including 0** for authors without books.',
      solution: 'SELECT a.name, count(b.book_id) FROM authors a LEFT JOIN books b ON b.author_id = a.author_id GROUP BY a.author_id, a.name;',
      wrongExample: 'SELECT a.name, count(*) FROM authors a LEFT JOIN books b ON b.author_id = a.author_id GROUP BY a.author_id, a.name;',
      hints: ['LEFT JOIN so authors with no books stay, then GROUP BY author.', 'count(*) counts the row with NULLs as 1! Count a column from the books side instead.'],
      explanation: 'count(b.book_id) skips the NULL, so an author without books gets 0. count(*) would say 1.',
    },
    {
      id: 'm06-p9',
      kind: 'readQuery',
      conceptIds: ['m06-left'],
      prompt: 'We want **all customers**, with their **pending** orders if they have any. What is wrong with this query?',
      sql: "SELECT c.first_name, o.order_id\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id\nWHERE o.status = 'pending';",
      choices: [
        'Nothing, it works',
        'The WHERE removes customers without pending orders (their status is NULL), so it acts like an INNER JOIN',
        'LEFT JOIN cannot be combined with WHERE',
        'It returns duplicate customers',
      ],
      answer: 1,
      hints: [],
      explanation: "Conditions on the right table belong in the ON clause: `LEFT JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'pending'`.",
    },
    {
      id: 'm06-p10',
      kind: 'fixBug',
      conceptIds: ['m06-left'],
      prompt: 'Show **all customers** (first_name) with the **order_id** of their **pending** orders, or NULL if they have none. The current query loses most customers. Fix it.',
      starterSql: "SELECT c.first_name, o.order_id\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id\nWHERE o.status = 'pending';",
      solution: "SELECT c.first_name, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'pending';",
      wrongExample: "SELECT c.first_name, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE o.status = 'pending';",
      hints: ['WHERE runs after the join and drops rows whose status is NULL.', 'Move the status condition into the ON clause.'],
      explanation: 'Filters on the right side of a LEFT JOIN belong in ON. In WHERE they discard the unmatched rows.',
    },
    {
      id: 'm06-p11',
      kind: 'write',
      conceptIds: ['m06-multi'],
      prompt: '**Revenue per genre**: for each **genre**, the total of quantity × unit_price over all order lines. Show genre and revenue.',
      solution: 'SELECT b.genre, sum(i.quantity * i.unit_price) FROM order_items i JOIN books b ON b.book_id = i.book_id GROUP BY b.genre;',
      wrongExample: 'SELECT b.genre, sum(b.price) FROM order_items i JOIN books b ON b.book_id = i.book_id GROUP BY b.genre;',
      hints: ['Join order_items to books to learn each line\'s genre.', 'Then GROUP BY genre with sum(quantity * unit_price).'],
      explanation: 'Join first, then aggregate.',
    },
  ],
  test: [
    {
      id: 'm06-t1',
      kind: 'write',
      conceptIds: ['m06-inner'],
      prompt: 'Show the **title** of every book written by an author from **the United Kingdom**.',
      solution: "SELECT b.title FROM books b JOIN authors a ON a.author_id = b.author_id WHERE a.country = 'United Kingdom';",
      wrongExample: "SELECT b.title FROM books b JOIN authors a ON a.author_id = b.author_id WHERE a.country = 'United States';",
      hints: [],
      explanation: 'Join, then filter on the author table.',
    },
    {
      id: 'm06-t2',
      kind: 'write',
      conceptIds: ['m06-left'],
      prompt: 'Which **customers have never placed an order**? Show **first_name** and **last_name**.',
      solution: 'SELECT c.first_name, c.last_name FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE o.order_id IS NULL;',
      wrongExample: 'SELECT c.first_name, c.last_name FROM customers c JOIN orders o ON o.customer_id = c.customer_id;',
      hints: [],
      explanation: 'Anti-join.',
    },
    {
      id: 'm06-t3',
      kind: 'readQuery',
      conceptIds: ['m06-multi'],
      prompt: 'Table A has 4 rows and table B has 5. How many rows does `SELECT * FROM A, B;` return?',
      choices: ['4', '5', '9', '20'],
      answer: 3,
      hints: [],
      explanation: 'With no condition, every combination: 4 × 5.',
    },
    {
      id: 'm06-t4',
      kind: 'write',
      conceptIds: ['m06-self'],
      prompt: 'Show the **names** of employees whose manager is **Priya Sharma**.',
      solution: "SELECT e.name FROM employees e JOIN employees m ON m.employee_id = e.manager_id WHERE m.name = 'Priya Sharma';",
      wrongExample: "SELECT e.name FROM employees e WHERE e.name = 'Priya Sharma';",
      hints: [],
      explanation: 'Self join, filter on the manager side.',
    },
    {
      id: 'm06-t5',
      kind: 'write',
      conceptIds: ['m06-multi'],
      prompt: 'How many **copies** has each **author** sold? Show the author **name** and **copies** (sum of quantity), only for authors who sold something.',
      solution: 'SELECT a.name, sum(i.quantity) FROM authors a JOIN books b ON b.author_id = a.author_id JOIN order_items i ON i.book_id = b.book_id GROUP BY a.author_id, a.name;',
      wrongExample: 'SELECT a.name, count(*) FROM authors a JOIN books b ON b.author_id = a.author_id GROUP BY a.author_id, a.name;',
      hints: [],
      explanation: 'Three tables, then GROUP BY.',
    },
    {
      id: 'm06-t6',
      kind: 'fixBug',
      conceptIds: ['m06-left'],
      prompt: 'Should count books per author **including authors with 0 books**. Fix it.',
      starterSql: 'SELECT a.name, count(*)\nFROM authors a\nLEFT JOIN books b ON b.author_id = a.author_id\nGROUP BY a.name;',
      solution: 'SELECT a.name, count(b.book_id) FROM authors a LEFT JOIN books b ON b.author_id = a.author_id GROUP BY a.name;',
      wrongExample: 'SELECT a.name, count(*) FROM authors a JOIN books b ON b.author_id = a.author_id GROUP BY a.name;',
      hints: [],
      explanation: 'count(column from the right side) gives 0 for unmatched rows.',
    },
  ],
};
