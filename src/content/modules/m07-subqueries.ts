import type { Module } from '../types';

export const m07: Module = {
  id: 'm07',
  number: 7,
  title: 'Subqueries & CTEs',
  tagline: 'Queries inside queries: scalar, IN and EXISTS subqueries, WITH (CTEs), recursion and set operations.',
  games: ['casefiles'],
  concepts: [
    {
      id: 'm07-scalar',
      title: 'Subqueries as values',
      card: `A query in parentheses can be used **as a value**, as long as it returns exactly **one row and one column**:

\`\`\`sql
SELECT title, price
FROM books
WHERE price > (SELECT avg(price) FROM books);
\`\`\`

Postgres runs the inner query (average = 13.80) and then uses the number. Scalar subqueries also work in SELECT:

\`\`\`sql
SELECT title, price, price - (SELECT avg(price) FROM books) AS vs_avg FROM books;
\`\`\``,
      predict: {
        sql: 'SELECT title, price FROM books\nWHERE price > (SELECT avg(price) FROM books);',
        question: 'What does this return?',
        choices: ['Only the most expensive book', 'Every book priced above the average', 'An error: you can\'t compare to a query'],
        answer: 1,
        why: 'The subquery becomes a single number (the average), and each book is compared against it. 13 books are above average.',
      },
      example: { sql: 'SELECT name, salary,\n       salary - (SELECT avg(salary) FROM employees) AS vs_average\nFROM employees;', note: 'How far each salary is from the average.' },
      cheat: { syntax: 'WHERE x > (SELECT avg(x) FROM t)', note: 'A one-row, one-column query can be used as a value.' },
    },
    {
      id: 'm07-in',
      title: 'IN (subquery) and the NOT IN trap',
      card: `A subquery that returns **one column with many rows** works with **IN**:

\`\`\`sql
-- customers who ordered something in 2025
SELECT first_name FROM customers
WHERE customer_id IN (SELECT customer_id FROM orders WHERE order_date >= '2025-01-01');
\`\`\`

⚠️ **NOT IN + NULL = nothing.** If the subquery returns even one NULL, \`x NOT IN (…)\` is never true, because "is x different from unknown?" is unknown. Filter out the NULLs or use NOT EXISTS (next card).`,
      predict: {
        sql: 'SELECT name FROM authors\nWHERE author_id NOT IN (SELECT author_id FROM books);',
        question: 'Octavia Butler has no books. Some books have author_id NULL. What comes back?',
        choices: ['Octavia Butler', 'No rows at all', 'All 13 authors'],
        answer: 1,
        why: 'The subquery contains NULLs (the anonymous books), so NOT IN is never true. Add `WHERE author_id IS NOT NULL` inside, or use NOT EXISTS.',
      },
      example: { sql: "SELECT first_name, last_name\nFROM customers\nWHERE customer_id IN (\n  SELECT customer_id FROM orders WHERE status = 'pending'\n);", note: 'Customers with a pending order.' },
      cheat: { syntax: 'WHERE id IN (SELECT …)', note: 'NOT IN breaks if the subquery returns any NULL. Prefer NOT EXISTS.' },
    },
    {
      id: 'm07-exists',
      title: 'EXISTS and correlated subqueries',
      card: `**EXISTS (subquery)** is true when the subquery returns **at least one row**. The subquery can refer to the **outer row**. This is called a *correlated* subquery:

\`\`\`sql
SELECT a.name
FROM authors a
WHERE NOT EXISTS (
  SELECT 1 FROM books b WHERE b.author_id = a.author_id
);
\`\`\`

For each author, "is there any book by *this* author?". NOT EXISTS handles NULLs correctly, and it's usually the clearest way to write "has no …".`,
      predict: {
        sql: 'SELECT a.name FROM authors a\nWHERE NOT EXISTS (SELECT 1 FROM books b WHERE b.author_id = a.author_id);',
        question: 'Same question as before, written with NOT EXISTS. What comes back?',
        choices: ['Octavia Butler', 'No rows at all', 'All 13 authors'],
        answer: 0,
        why: 'NOT EXISTS checks for matching rows. NULL author_ids simply never match, so they don\'t break anything.',
      },
      example: { sql: 'SELECT c.first_name\nFROM customers c\nWHERE EXISTS (\n  SELECT 1 FROM orders o\n  WHERE o.customer_id = c.customer_id AND o.status = \'cancelled\'\n);', note: 'Customers who cancelled at least once.' },
      cheat: { syntax: 'WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.a_id = a.id)', note: 'True if the subquery finds rows. NULL-safe.' },
    },
    {
      id: 'm07-cte',
      title: 'WITH: common table expressions',
      card: `Long queries get easier to read when you **name the steps**. **WITH** defines temporary named results (CTEs), and the main query uses them like tables:

\`\`\`sql
WITH order_totals AS (
  SELECT order_id, sum(quantity * unit_price) AS total
  FROM order_items
  GROUP BY order_id
)
SELECT order_id, total
FROM order_totals
WHERE total > (SELECT avg(total) FROM order_totals);
\`\`\`

Add more steps separated by commas: \`WITH a AS (…), b AS (SELECT … FROM a) SELECT …\`. Subqueries in FROM work similarly but need an alias: \`FROM (SELECT …) AS t\`.`,
      predict: {
        sql: 'WITH big AS (SELECT * FROM books WHERE price > 20)\nSELECT count(*) FROM big;',
        question: 'What does this return?',
        choices: ['30', '3', 'An error: big is not a table'],
        answer: 1,
        why: '`big` exists only for this query: the 3 books over €20.',
      },
      example: { sql: "WITH spend AS (\n  SELECT o.customer_id, sum(i.quantity * i.unit_price) AS total\n  FROM orders o\n  JOIN order_items i ON i.order_id = o.order_id\n  WHERE o.status <> 'cancelled'\n  GROUP BY o.customer_id\n)\nSELECT c.first_name, s.total\nFROM spend s\nJOIN customers c ON c.customer_id = s.customer_id\nORDER BY s.total DESC\nLIMIT 5;", note: 'Top 5 customers by spending, in two readable steps.' },
      cheat: { syntax: 'WITH step AS (SELECT …) SELECT … FROM step', note: 'Name intermediate results. Chain them with commas.' },
    },
    {
      id: 'm07-recursive',
      title: 'Recursive CTEs',
      card: `**WITH RECURSIVE** lets a CTE refer to **itself**. That's how SQL walks trees and hierarchies:

\`\`\`sql
WITH RECURSIVE chain AS (
  SELECT employee_id, name, manager_id, 1 AS level   -- start: the CEO
  FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.employee_id, e.name, e.manager_id, c.level + 1  -- step: their reports
  FROM employees e
  JOIN chain c ON e.manager_id = c.employee_id
)
SELECT * FROM chain;
\`\`\`

1. Run the **starting query**.
2. Repeatedly run the **recursive part** using the rows found in the previous round.
3. Stop when a round finds no new rows.`,
      predict: {
        sql: 'WITH RECURSIVE n AS (\n  SELECT 1 AS x\n  UNION ALL\n  SELECT x + 1 FROM n WHERE x < 5\n)\nSELECT x FROM n;',
        question: 'What does this produce?',
        choices: ['1', '1, 2, 3, 4, 5', '1, 2, 3, 4', 'It never ends'],
        answer: 1,
        why: 'It starts at 1, keeps adding 1 while x < 5, and stops once x = 5 adds no new rows.',
      },
      example: { sql: 'WITH RECURSIVE chain AS (\n  SELECT employee_id, name, manager_id, 1 AS level\n  FROM employees WHERE manager_id IS NULL\n  UNION ALL\n  SELECT e.employee_id, e.name, e.manager_id, c.level + 1\n  FROM employees e\n  JOIN chain c ON e.manager_id = c.employee_id\n)\nSELECT level, name FROM chain ORDER BY level, name;', note: 'The org chart, level by level.' },
      cheat: { syntax: 'WITH RECURSIVE r AS (start UNION ALL step-using-r) …', note: 'Walk hierarchies. Always make sure it stops!' },
    },
    {
      id: 'm07-setops',
      title: 'UNION, INTERSECT, EXCEPT',
      card: `Set operations combine the results of two queries **with the same columns**:

- \`A UNION B\`: rows in either (duplicates removed). \`UNION ALL\` keeps duplicates and is faster.
- \`A INTERSECT B\`: rows in both
- \`A EXCEPT B\`: rows in A but not in B

\`\`\`sql
SELECT country FROM customers
INTERSECT
SELECT country FROM authors;   -- countries with both customers and authors
\`\`\``,
      predict: {
        sql: 'SELECT country FROM customers\nUNION\nSELECT country FROM authors;',
        question: 'Do countries that appear in both tables show up twice?',
        choices: ['Yes', 'No, UNION removes duplicates', 'It\'s an error'],
        answer: 1,
        why: 'UNION removes duplicate rows, and UNION ALL would keep them.',
      },
      example: { sql: 'SELECT country FROM customers\nINTERSECT\nSELECT country FROM authors\nORDER BY country;', note: 'Countries with both customers and authors.' },
      cheat: { syntax: 'q1 UNION [ALL] q2 · INTERSECT · EXCEPT', note: 'Same number and types of columns on both sides.' },
    },
  ],
  practice: [
    {
      id: 'm07-p1',
      kind: 'write',
      conceptIds: ['m07-scalar'],
      prompt: 'Show the **name** and **salary** of employees who earn **more than the average salary**.',
      solution: 'SELECT name, salary FROM employees WHERE salary > (SELECT avg(salary) FROM employees);',
      wrongExample: 'SELECT name, salary FROM employees WHERE salary > 70000;',
      hints: ['First compute the average in a subquery.', 'WHERE salary > (SELECT avg(salary) FROM employees)'],
      explanation: 'The scalar subquery is computed once and then compared against each row.',
      variants: [
        {
          id: 'm07-p1-v1',
          prompt: 'Show the **title** of the **cheapest book(s)**. Use a subquery for the minimum price.',
          solution: 'SELECT title FROM books WHERE price = (SELECT min(price) FROM books);',
          wrongExample: 'SELECT title FROM books WHERE price < 8;',
          hints: ['price = (SELECT min(price) …)'],
          explanation: 'Compare to the minimum.',
        },
      ],
    },
    {
      id: 'm07-p2',
      kind: 'write',
      conceptIds: ['m07-in'],
      prompt: 'Show the **title** of books that appear in **at least one order** (use IN with a subquery on order_items).',
      solution: 'SELECT title FROM books WHERE book_id IN (SELECT book_id FROM order_items);',
      wrongExample: 'SELECT title FROM books WHERE book_id NOT IN (SELECT book_id FROM order_items);',
      hints: ['The subquery returns all the book_ids that were ordered.'],
      explanation: 'IN with a subquery. Duplicates in the subquery don\'t matter.',
    },
    {
      id: 'm07-p3',
      kind: 'fixBug',
      conceptIds: ['m07-in', 'm07-exists'],
      prompt: 'Should list **authors with no books** (there is one), but it returns **nothing**. Fix it.',
      starterSql: 'SELECT name FROM authors\nWHERE author_id NOT IN (SELECT author_id FROM books);',
      solution: 'SELECT name FROM authors a WHERE NOT EXISTS (SELECT 1 FROM books b WHERE b.author_id = a.author_id);',
      wrongExample: 'SELECT name FROM authors WHERE author_id NOT IN (SELECT author_id FROM books);',
      hints: ['Does books.author_id contain any NULLs?', 'Use NOT EXISTS, or filter NULLs out inside the subquery.'],
      explanation: 'One NULL in a NOT IN list makes the whole condition unknown. NOT EXISTS is NULL-safe.',
    },
    {
      id: 'm07-p4',
      kind: 'write',
      conceptIds: ['m07-exists'],
      prompt: 'Show the **first_name** of customers who have **at least one order with status "shipped"**. Use EXISTS.',
      solution: "SELECT c.first_name FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id AND o.status = 'shipped');",
      wrongExample: "SELECT c.first_name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id AND o.status = 'shipped');",
      hints: ['The subquery should refer to the outer customer: o.customer_id = c.customer_id'],
      explanation: 'A correlated EXISTS. Unlike a join, it returns each customer once even if they have several shipped orders.',
    },
    {
      id: 'm07-p5',
      kind: 'write',
      conceptIds: ['m07-cte'],
      prompt: 'Using a **CTE** called `order_totals` (order_id, total), show the orders whose total is **above the average order total**.',
      solution: 'WITH order_totals AS (SELECT order_id, sum(quantity * unit_price) AS total FROM order_items GROUP BY order_id) SELECT order_id, total FROM order_totals WHERE total > (SELECT avg(total) FROM order_totals);',
      wrongExample: 'WITH order_totals AS (SELECT order_id, sum(quantity * unit_price) AS total FROM order_items GROUP BY order_id) SELECT order_id, total FROM order_totals;',
      hints: ['Step 1 (the CTE): total per order.', 'Step 2: compare each total to (SELECT avg(total) FROM order_totals).'],
      explanation: 'A CTE can be used more than once, here both in FROM and in the subquery.',
    },
    {
      id: 'm07-p6',
      kind: 'write',
      conceptIds: ['m07-cte'],
      prompt: 'For each **genre**, show the **most expensive price** in that genre and the **title(s)** that have it. Columns: genre, title, price.',
      solution: 'WITH top AS (SELECT genre, max(price) AS price FROM books GROUP BY genre) SELECT b.genre, b.title, b.price FROM books b JOIN top t ON t.genre = b.genre AND t.price = b.price;',
      wrongExample: 'SELECT genre, max(title), max(price) FROM books GROUP BY genre;',
      hints: ['First find the max price per genre (a CTE).', 'Then join books back to it on genre AND price.'],
      explanation: '"Top per group" in two steps: aggregate, then join back. (max(title) is the alphabetically last title, which is a different thing!)',
    },
    {
      id: 'm07-p7',
      kind: 'write',
      conceptIds: ['m07-recursive'],
      prompt: 'Using **WITH RECURSIVE**, list **everyone who works under Priya Sharma** (employee_id 3), directly or indirectly. Show their **name**. Don\'t include Priya herself.',
      solution: 'WITH RECURSIVE team AS (SELECT employee_id, name FROM employees WHERE manager_id = 3 UNION ALL SELECT e.employee_id, e.name FROM employees e JOIN team t ON e.manager_id = t.employee_id) SELECT name FROM team;',
      wrongExample: 'SELECT name FROM employees WHERE manager_id = 1;',
      hints: ['Start: employees whose manager_id = 3.', 'Step: employees whose manager is someone already in the CTE.'],
      explanation: 'The recursive part keeps adding the next level down until nobody new is found.',
      variants: [
        {
          id: 'm07-p7-v1',
          prompt: 'Using **WITH RECURSIVE**, list everyone under **Owen Clarke** (employee_id 4), at every level. Show **name**.',
          solution: 'WITH RECURSIVE team AS (SELECT employee_id, name FROM employees WHERE manager_id = 4 UNION ALL SELECT e.employee_id, e.name FROM employees e JOIN team t ON e.manager_id = t.employee_id) SELECT name FROM team;',
          wrongExample: 'SELECT name FROM employees WHERE manager_id = 4;',
          hints: ['Same pattern, different starting manager.'],
          explanation: 'Owen → Ben → Chloe & Ravi: the recursion finds the second level.',
        },
      ],
    },
    {
      id: 'm07-p8',
      kind: 'write',
      conceptIds: ['m07-setops'],
      prompt: 'List the **countries that have customers but no authors**.',
      solution: 'SELECT country FROM customers EXCEPT SELECT country FROM authors;',
      wrongExample: 'SELECT country FROM customers INTERSECT SELECT country FROM authors;',
      hints: ['"In A but not in B" is EXCEPT.'],
      explanation: 'EXCEPT subtracts the second result from the first (and removes duplicates).',
    },
    {
      id: 'm07-p9',
      kind: 'readQuery',
      conceptIds: ['m07-scalar'],
      prompt: 'Why does this fail?',
      sql: 'SELECT title FROM books\nWHERE author_id = (SELECT author_id FROM authors WHERE country = \'United Kingdom\');',
      expectError: true,
      choices: [
        'You can\'t use a subquery in WHERE',
        'The subquery returns several rows, so = can\'t compare against it. Use IN',
        'author_id is ambiguous',
        'It doesn\'t fail',
      ],
      answer: 1,
      hints: [],
      explanation: '3 authors are from the UK. With `=` the subquery must return a single value. `IN (…)` accepts many.',
    },
  ],
  test: [
    {
      id: 'm07-t1',
      kind: 'write',
      conceptIds: ['m07-scalar'],
      prompt: 'Show the **title** and **pages** of books **longer than the average** page count.',
      solution: 'SELECT title, pages FROM books WHERE pages > (SELECT avg(pages) FROM books);',
      wrongExample: 'SELECT title, pages FROM books WHERE pages > 300;',
      hints: [],
      explanation: 'Scalar subquery.',
    },
    {
      id: 'm07-t2',
      kind: 'write',
      conceptIds: ['m07-exists'],
      prompt: 'Show the **title** of books that were **never ordered**, using NOT EXISTS.',
      solution: 'SELECT b.title FROM books b WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.book_id = b.book_id);',
      wrongExample: 'SELECT b.title FROM books b WHERE EXISTS (SELECT 1 FROM order_items i WHERE i.book_id = b.book_id);',
      hints: [],
      explanation: 'NOT EXISTS anti-join.',
    },
    {
      id: 'm07-t3',
      kind: 'readQuery',
      conceptIds: ['m07-in'],
      prompt: '`x NOT IN (1, 2, NULL)` for x = 5: what is the result?',
      choices: ['true', 'false', 'NULL (unknown), so the row is filtered out'],
      answer: 2,
      hints: [],
      explanation: '5 <> NULL is unknown, so the whole NOT IN is unknown.',
    },
    {
      id: 'm07-t4',
      kind: 'write',
      conceptIds: ['m07-cte'],
      prompt: 'With a CTE, find each **customer_id**\'s **total spending** (sum of quantity × unit_price over their non-cancelled orders), and show only customers who spent **more than €20**.',
      solution: "WITH spend AS (SELECT o.customer_id, sum(i.quantity * i.unit_price) AS total FROM orders o JOIN order_items i ON i.order_id = o.order_id WHERE o.status <> 'cancelled' GROUP BY o.customer_id) SELECT customer_id, total FROM spend WHERE total > 20;",
      wrongExample: 'WITH spend AS (SELECT o.customer_id, sum(i.quantity * i.unit_price) AS total FROM orders o JOIN order_items i ON i.order_id = o.order_id GROUP BY o.customer_id) SELECT customer_id, total FROM spend WHERE total > 20;',
      hints: [],
      explanation: 'Aggregate in the CTE, filter in the main query.',
    },
    {
      id: 'm07-t5',
      kind: 'write',
      conceptIds: ['m07-recursive'],
      prompt: 'With **WITH RECURSIVE**, produce the numbers **1 to 10** (one column).',
      solution: 'WITH RECURSIVE n AS (SELECT 1 AS x UNION ALL SELECT x + 1 FROM n WHERE x < 10) SELECT x FROM n;',
      wrongExample: 'WITH RECURSIVE n AS (SELECT 1 AS x UNION ALL SELECT x + 1 FROM n WHERE x <= 10) SELECT x FROM n;',
      hints: [],
      explanation: 'Stop condition x < 10 → the last row is 10.',
    },
    {
      id: 'm07-t6',
      kind: 'write',
      conceptIds: ['m07-setops'],
      prompt: 'List every **country** that has **customers or authors** (or both), **each only once**. Use UNION.',
      solution: 'SELECT country FROM customers UNION SELECT country FROM authors;',
      wrongExample: 'SELECT country FROM customers UNION ALL SELECT country FROM authors;',
      hints: [],
      explanation: 'UNION removes duplicates. UNION ALL keeps them.',
    },
  ],
};
