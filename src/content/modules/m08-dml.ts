import type { Module } from '../types';

const BOOKS_STATE = 'SELECT book_id, title, price, in_stock FROM books';
const ORDERS_STATE = 'SELECT order_id, customer_id, order_date, status FROM orders';

export const m08: Module = {
  id: 'm08',
  number: 8,
  title: 'Changing data',
  tagline: 'INSERT, UPDATE and DELETE safely, get rows back with RETURNING, upsert, and group changes in transactions.',
  games: ['doctor'],
  concepts: [
    {
      id: 'm08-insert',
      title: 'INSERT: adding rows',
      card: `**INSERT** adds new rows. Name the columns, then give the values in the same order:

\`\`\`sql
INSERT INTO authors (author_id, name, country, birth_year)
VALUES (14, 'N. K. Jemisin', 'United States', 1972);
\`\`\`

- Several rows at once: \`VALUES (…), (…), (…)\`
- Columns you leave out get their **DEFAULT** (or NULL).
- You can insert the result of a query: \`INSERT INTO t (a, b) SELECT …\`

🛟 In pgschool, every change you make in lessons and exercises is **rolled back automatically**, so experiment freely. (The Playground is the exception: changes you make there stay.)`,
      predict: {
        sql: "INSERT INTO books (book_id, title, genre, price, published_year)\nVALUES (31, 'The Fifth Season', 'Fantasy', 15.99, 2015)\nRETURNING book_id, in_stock, tags;",
        question: 'We didn\'t give in_stock or tags. What values do they get?',
        choices: ['NULL and NULL', '0 and {} (empty array), the column defaults', 'An error: all columns are required'],
        answer: 1,
        why: 'The table defines `in_stock DEFAULT 0` and `tags DEFAULT \'{}\'`. Omitted columns take their default, or NULL if there is no default.',
      },
      example: { sql: "INSERT INTO customers (customer_id, first_name, last_name, email, city, country, signup_date)\nVALUES (21, 'Uma', 'Rao', 'uma@example.com', 'Pune', 'India', '2025-02-01');\n\nSELECT * FROM customers WHERE customer_id = 21;", note: 'Insert, then look. (Rolled back afterwards.)' },
      cheat: { syntax: 'INSERT INTO t (a, b) VALUES (1, \'x\'), (2, \'y\');', note: 'Name the columns. Omitted ones get their DEFAULT.' },
    },
    {
      id: 'm08-update',
      title: 'UPDATE: changing rows',
      card: `**UPDATE** changes values in existing rows:

\`\`\`sql
UPDATE books
SET price = price * 1.10, in_stock = in_stock + 5
WHERE genre = 'Mystery';
\`\`\`

⚠️ **The WHERE clause is everything.** Without it, *every row* in the table is updated.

💡 Pro habit: write the \`SELECT … WHERE …\` first, check that it returns exactly the rows you mean, then turn it into an UPDATE.`,
      predict: {
        sql: "UPDATE books SET price = 9.99;",
        question: 'How many books now cost €9.99?',
        choices: ['None, because the query needs a WHERE', 'Only the first book', 'All 30 books'],
        answer: 2,
        why: 'No WHERE means every row. UPDATE and DELETE never ask "are you sure?". (Here it was rolled back, phew.)',
      },
      example: { sql: "UPDATE books\nSET in_stock = in_stock + 10\nWHERE in_stock = 0;\n\nSELECT title, in_stock FROM books ORDER BY in_stock;", note: 'Restock the sold-out books.' },
      cheat: { syntax: 'UPDATE t SET a = …, b = … WHERE …;', note: 'No WHERE = every row! SELECT first, then UPDATE.' },
    },
    {
      id: 'm08-delete',
      title: 'DELETE and foreign keys',
      card: `**DELETE** removes rows:

\`\`\`sql
DELETE FROM order_items WHERE order_id = 6;
\`\`\`

Foreign keys protect you: you **can't delete an order that still has order_items pointing to it**. Postgres refuses with a *foreign key violation*. Delete the children first, then the parent (or design the table with \`ON DELETE CASCADE\`, which Module 9 covers).

Same warning as UPDATE: **no WHERE = everything goes.**`,
      predict: {
        sql: "DELETE FROM orders WHERE status = 'cancelled';",
        question: 'The two cancelled orders still have rows in order_items. What happens?',
        choices: ['Both orders are deleted', 'Both orders and their items are deleted', 'An error: a foreign key violation'],
        answer: 2,
        why: 'order_items.order_id references orders, so Postgres won\'t leave orphaned items behind.',
        expectError: true,
      },
      example: { sql: "DELETE FROM order_items\nWHERE order_id IN (SELECT order_id FROM orders WHERE status = 'cancelled');\n\nDELETE FROM orders WHERE status = 'cancelled';\n\nSELECT status, count(*) FROM orders GROUP BY status;", note: 'Children first, then the parents.' },
      cheat: { syntax: 'DELETE FROM t WHERE …;', note: 'Delete the referencing rows first (or use ON DELETE CASCADE).' },
    },
    {
      id: 'm08-returning',
      title: 'RETURNING',
      card: `A Postgres favourite: add **RETURNING** to INSERT, UPDATE or DELETE to get the affected rows back immediately, with no second query needed:

\`\`\`sql
UPDATE books SET price = price * 0.9
WHERE genre = 'Classic'
RETURNING title, price;          -- the new prices

DELETE FROM orders WHERE order_id = 32 … RETURNING *;
\`\`\``,
      predict: {
        sql: "UPDATE books SET price = price * 1.1\nWHERE genre = 'Mystery'\nRETURNING title, price;",
        question: 'What do you get back?',
        choices: ['Nothing, since UPDATE returns no rows', 'The 3 mystery books with their NEW prices', 'The 3 mystery books with their OLD prices'],
        answer: 1,
        why: 'RETURNING shows the rows as they are *after* the change. The price column is numeric(6,2), so 11.25 × 1.1 is stored as 12.38.',
      },
      example: { sql: "INSERT INTO orders (order_id, customer_id, order_date, status)\nVALUES (33, 20, '2025-02-01', 'pending')\nRETURNING *;", note: 'See exactly what was stored.' },
      cheat: { syntax: '… RETURNING col1, col2;', note: 'Get the changed rows back.' },
    },
    {
      id: 'm08-upsert',
      title: 'Upsert: INSERT … ON CONFLICT',
      card: `"Insert it, or if it already exists, update it" is called an **upsert**:

\`\`\`sql
INSERT INTO books (book_id, title, genre, price, published_year, in_stock)
VALUES (3, '1984', 'Dystopian', 12.50, 1949, 5)
ON CONFLICT (book_id)
DO UPDATE SET in_stock = books.in_stock + EXCLUDED.in_stock;
\`\`\`

- \`ON CONFLICT (col)\` needs a primary key or UNIQUE constraint on that column.
- \`EXCLUDED\` is the row you *tried* to insert.
- \`DO NOTHING\` silently skips duplicates instead.`,
      predict: {
        sql: "INSERT INTO books (book_id, title, genre, price, published_year)\nVALUES (3, 'Duplicate', 'X', 1, 2000)\nON CONFLICT (book_id) DO NOTHING\nRETURNING *;",
        question: 'Book 3 already exists. What comes back?',
        choices: ['The new row', 'Zero rows, and no error', 'A duplicate key error'],
        answer: 1,
        why: 'DO NOTHING skips the conflicting row silently, so RETURNING has nothing to return.',
      },
      example: { sql: "INSERT INTO books (book_id, title, genre, price, published_year, in_stock)\nVALUES (3, '1984', 'Dystopian', 12.50, 1949, 5)\nON CONFLICT (book_id)\nDO UPDATE SET in_stock = books.in_stock + EXCLUDED.in_stock\nRETURNING title, in_stock;", note: '20 in stock + 5 delivered = 25.' },
      cheat: { syntax: 'INSERT … ON CONFLICT (key) DO UPDATE SET c = EXCLUDED.c', note: 'Insert or update. DO NOTHING skips.' },
    },
    {
      id: 'm08-transactions',
      title: 'Transactions',
      card: `A **transaction** groups several changes so they happen **all together or not at all**:

\`\`\`sql
BEGIN;
UPDATE books SET in_stock = in_stock - 1 WHERE book_id = 3;
INSERT INTO order_items (order_id, book_id, quantity, unit_price) VALUES (32, 3, 1, 12.50);
COMMIT;      -- make it permanent
\`\`\`

- \`ROLLBACK\` instead of COMMIT undoes everything since BEGIN.
- If any statement fails, the transaction is aborted and nothing is applied.
- Other users never see a half-finished transaction.

(Postgres even runs each single statement as its own small transaction.)`,
      predict: {
        sql: "BEGIN;\nDELETE FROM order_items;\nROLLBACK;\nSELECT count(*) FROM order_items;",
        question: 'What does the final count show?',
        choices: ['0', 'The original number (49)', 'An error'],
        answer: 1,
        why: 'ROLLBACK undoes everything since BEGIN, so the items are all back.',
      },
      example: { sql: "BEGIN;\nUPDATE books SET in_stock = in_stock - 1 WHERE book_id = 3;\nINSERT INTO order_items (order_id, book_id, quantity, unit_price)\nVALUES (32, 3, 1, 12.50);\nCOMMIT;\n\nSELECT * FROM order_items WHERE order_id = 32;", note: 'Both changes or neither.' },
      cheat: { syntax: 'BEGIN; … COMMIT;  /  ROLLBACK;', note: 'All or nothing.' },
    },
  ],
  practice: [
    {
      id: 'm08-p1',
      kind: 'write',
      conceptIds: ['m08-insert'],
      prompt: "Add a new author: id **14**, name **'N. K. Jemisin'**, country **'United States'**, born **1972**.",
      solution: "INSERT INTO authors (author_id, name, country, birth_year) VALUES (14, 'N. K. Jemisin', 'United States', 1972);",
      wrongExample: "INSERT INTO authors (author_id, name, country) VALUES (14, 'N. K. Jemisin', 'United States');",
      checkQuery: 'SELECT * FROM authors',
      hints: ['INSERT INTO authors (columns…) VALUES (values…);', 'Text in single quotes, numbers without.'],
      explanation: 'List the columns and the matching values in the same order.',
      variants: [
        {
          id: 'm08-p1-v1',
          prompt: "Add a customer: id **21**, **Uma Rao**, email **'uma@example.com'**, city **Pune**, country **India**, signed up **'2025-02-01'**.",
          solution: "INSERT INTO customers (customer_id, first_name, last_name, email, city, country, signup_date) VALUES (21, 'Uma', 'Rao', 'uma@example.com', 'Pune', 'India', '2025-02-01');",
          wrongExample: "INSERT INTO customers (customer_id, first_name, last_name, city, country, signup_date) VALUES (21, 'Uma', 'Rao', 'Pune', 'India', '2025-02-01');",
          checkQuery: 'SELECT * FROM customers',
          hints: ['Seven columns, seven values.'],
          explanation: 'Dates go in quotes too.',
        },
      ],
    },
    {
      id: 'm08-p2',
      kind: 'write',
      conceptIds: ['m08-insert'],
      prompt: "Order **32** gets **two more lines**: book **12**, quantity **1**, unit_price **10.99**; and book **21**, quantity **2**, unit_price **12.00**. Insert both in **one statement**.",
      solution: 'INSERT INTO order_items (order_id, book_id, quantity, unit_price) VALUES (32, 12, 1, 10.99), (32, 21, 2, 12.00);',
      wrongExample: 'INSERT INTO order_items (order_id, book_id, quantity, unit_price) VALUES (32, 12, 1, 10.99);',
      checkQuery: 'SELECT * FROM order_items',
      hints: ['VALUES (…), (…) inserts several rows at once.'],
      explanation: 'One INSERT, multiple row tuples.',
    },
    {
      id: 'm08-p3',
      kind: 'write',
      conceptIds: ['m08-update'],
      prompt: 'Raise the price of every **Science Fiction** book by **10%**.',
      solution: "UPDATE books SET price = price * 1.10 WHERE genre = 'Science Fiction';",
      wrongExample: 'UPDATE books SET price = price * 1.10;',
      checkQuery: BOOKS_STATE,
      hints: ['UPDATE books SET price = … WHERE …', '10% more = price * 1.10'],
      explanation: 'The new value can be computed from the old one.',
      variants: [
        {
          id: 'm08-p3-v1',
          prompt: 'Give every employee in **Operations** a raise of **2000**.',
          solution: "UPDATE employees SET salary = salary + 2000 WHERE department = 'Operations';",
          wrongExample: 'UPDATE employees SET salary = salary + 2000;',
          checkQuery: 'SELECT employee_id, salary FROM employees',
          hints: ['SET salary = salary + 2000 WHERE …'],
          explanation: 'Don\'t forget the WHERE!',
        },
      ],
    },
    {
      id: 'm08-p4',
      kind: 'write',
      conceptIds: ['m08-update'],
      prompt: "All **pending** orders placed **before 2025-01-20** have now shipped. Set their status to **'shipped'**.",
      solution: "UPDATE orders SET status = 'shipped' WHERE status = 'pending' AND order_date < '2025-01-20';",
      wrongExample: "UPDATE orders SET status = 'shipped' WHERE status = 'pending';",
      checkQuery: ORDERS_STATE,
      hints: ['Two conditions in the WHERE.', 'Try a SELECT with the same WHERE first to see which rows match.'],
      explanation: 'Orders 30 and 31 match. Order 32 (Jan 21) stays pending.',
    },
    {
      id: 'm08-p5',
      kind: 'fixBug',
      conceptIds: ['m08-update'],
      prompt: 'The intention: mark **book 4 (Animal Farm)** as having **12 copies** in stock. Running this would be a disaster. Fix it before it\'s too late!',
      starterSql: 'UPDATE books SET in_stock = 12;',
      solution: 'UPDATE books SET in_stock = 12 WHERE book_id = 4;',
      wrongExample: "UPDATE books SET in_stock = 12 WHERE title = 'Animal';",
      checkQuery: BOOKS_STATE,
      hints: ['Which rows does this UPDATE touch?'],
      explanation: 'Without WHERE, all 30 books would get in_stock = 12.',
    },
    {
      id: 'm08-p6',
      kind: 'write',
      conceptIds: ['m08-delete'],
      prompt: '**Delete all cancelled orders**, together with their order items. (Hint: foreign keys!)',
      solution: "DELETE FROM order_items WHERE order_id IN (SELECT order_id FROM orders WHERE status = 'cancelled'); DELETE FROM orders WHERE status = 'cancelled';",
      wrongExample: "DELETE FROM order_items WHERE order_id IN (SELECT order_id FROM orders WHERE status = 'cancelled');",
      checkQuery: 'SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS items',
      hints: ['Try deleting the orders first and read the error.', 'Two statements: the items first, then the orders.'],
      explanation: 'Children (order_items) before parents (orders).',
    },
    {
      id: 'm08-p7',
      kind: 'write',
      conceptIds: ['m08-returning'],
      prompt: "Mark order **32** as **'cancelled'** and **return** its order_id and new status in the same statement.",
      solution: "UPDATE orders SET status = 'cancelled' WHERE order_id = 32 RETURNING order_id, status;",
      wrongExample: "UPDATE orders SET status = 'cancelled' WHERE order_id = 31 RETURNING order_id, status;",
      hints: ['Add RETURNING at the end of the UPDATE.'],
      explanation: 'RETURNING gives you the changed row without a second query.',
    },
    {
      id: 'm08-p8',
      kind: 'write',
      conceptIds: ['m08-upsert'],
      prompt: 'A delivery arrives: **6 copies of book 21** (The Left Hand of Darkness, Science Fiction, €12.00, 1969). Write an **upsert** that inserts the book if it doesn\'t exist, or **adds 6 to in_stock** if it does.',
      solution: "INSERT INTO books (book_id, title, genre, price, published_year, in_stock) VALUES (21, 'The Left Hand of Darkness', 'Science Fiction', 12.00, 1969, 6) ON CONFLICT (book_id) DO UPDATE SET in_stock = books.in_stock + EXCLUDED.in_stock;",
      wrongExample: "INSERT INTO books (book_id, title, genre, price, published_year, in_stock) VALUES (21, 'The Left Hand of Darkness', 'Science Fiction', 12.00, 1969, 6) ON CONFLICT (book_id) DO UPDATE SET in_stock = EXCLUDED.in_stock;",
      checkQuery: BOOKS_STATE,
      hints: ['INSERT … ON CONFLICT (book_id) DO UPDATE SET …', 'books.in_stock is the current value. EXCLUDED.in_stock is the 6 you tried to insert.'],
      explanation: 'Book 21 had 6 in stock, so it now has 12. `SET in_stock = EXCLUDED.in_stock` would overwrite the stock with 6 instead of adding.',
    },
    {
      id: 'm08-p9',
      kind: 'write',
      conceptIds: ['m08-transactions'],
      prompt: 'In **one transaction**: move **3 copies** of stock from book **3** to book **4** (decrease one, increase the other), and **COMMIT**.',
      solution: 'BEGIN; UPDATE books SET in_stock = in_stock - 3 WHERE book_id = 3; UPDATE books SET in_stock = in_stock + 3 WHERE book_id = 4; COMMIT;',
      wrongExample: 'BEGIN; UPDATE books SET in_stock = in_stock - 3 WHERE book_id = 3; UPDATE books SET in_stock = in_stock + 3 WHERE book_id = 4; ROLLBACK;',
      checkQuery: BOOKS_STATE,
      hints: ['BEGIN; …two UPDATEs… COMMIT;'],
      explanation: 'Both updates succeed together or not at all.',
    },
    {
      id: 'm08-p10',
      kind: 'readQuery',
      conceptIds: ['m08-transactions'],
      prompt: 'Inside a transaction, the second statement fails with an error. What happens to the first statement\'s change after you run ROLLBACK?',
      choices: ['It stays', 'It is undone', 'Postgres keeps the half that worked'],
      answer: 1,
      hints: [],
      explanation: 'A transaction is all or nothing.',
    },
  ],
  test: [
    {
      id: 'm08-t1',
      kind: 'write',
      conceptIds: ['m08-insert'],
      prompt: "Insert an employee: id **13**, **'Zara Ahmed'**, job_title **'Data Analyst'**, department **'Technology'**, manager **3**, salary **70000**, hired **'2025-01-06'**.",
      solution: "INSERT INTO employees (employee_id, name, job_title, department, manager_id, salary, hire_date) VALUES (13, 'Zara Ahmed', 'Data Analyst', 'Technology', 3, 70000, '2025-01-06');",
      wrongExample: "INSERT INTO employees (employee_id, name, job_title, department, manager_id, salary, hire_date) VALUES (13, 'Zara Ahmed', 'Data Analyst', 'Technology', 1, 70000, '2025-01-06');",
      checkQuery: 'SELECT * FROM employees',
      hints: [],
      explanation: 'INSERT with all columns.',
    },
    {
      id: 'm08-t2',
      kind: 'write',
      conceptIds: ['m08-update'],
      prompt: 'Put every **Classic** book **on sale at half price**.',
      solution: "UPDATE books SET price = price / 2 WHERE genre = 'Classic';",
      wrongExample: "UPDATE books SET price = price / 2 WHERE genre = 'Literary';",
      checkQuery: BOOKS_STATE,
      hints: [],
      explanation: 'UPDATE … WHERE.',
    },
    {
      id: 'm08-t3',
      kind: 'readQuery',
      conceptIds: ['m08-delete'],
      prompt: 'What does `DELETE FROM customers;` do?',
      choices: ['Deletes the customers table', 'Deletes every row (if no foreign key blocks it)', 'Nothing without a WHERE', 'Deletes the first customer'],
      answer: 1,
      hints: [],
      explanation: 'DELETE without WHERE removes every row. Here, orders reference customers, so it fails with a foreign key error. DROP TABLE removes the table itself.',
    },
    {
      id: 'm08-t4',
      kind: 'write',
      conceptIds: ['m08-delete'],
      prompt: 'Delete every **order line** (order_items) with a **quantity of 2 or more**.',
      solution: 'DELETE FROM order_items WHERE quantity >= 2;',
      wrongExample: 'DELETE FROM order_items WHERE quantity > 2;',
      checkQuery: 'SELECT * FROM order_items',
      hints: [],
      explanation: '>= includes 2.',
    },
    {
      id: 'm08-t5',
      kind: 'write',
      conceptIds: ['m08-returning'],
      prompt: 'Reduce the stock of book **1** by one and **return** its title and new in_stock.',
      solution: 'UPDATE books SET in_stock = in_stock - 1 WHERE book_id = 1 RETURNING title, in_stock;',
      wrongExample: 'UPDATE books SET in_stock = in_stock + 1 WHERE book_id = 1 RETURNING title, in_stock;',
      hints: [],
      explanation: 'RETURNING shows the new values.',
    },
    {
      id: 'm08-t6',
      kind: 'write',
      conceptIds: ['m08-upsert'],
      prompt: "Insert author **13**, 'Octavia Butler', 'United States', 1947, but if author 13 **already exists, do nothing**.",
      solution: "INSERT INTO authors (author_id, name, country, birth_year) VALUES (13, 'Octavia Butler', 'United States', 1947) ON CONFLICT (author_id) DO NOTHING;",
      wrongExample: "INSERT INTO authors (author_id, name, country, birth_year) VALUES (13, 'Octavia Butler', 'United States', 1947) ON CONFLICT (author_id) DO UPDATE SET name = 'Duplicate';",
      checkQuery: 'SELECT * FROM authors',
      hints: [],
      explanation: 'ON CONFLICT DO NOTHING.',
    },
  ],
};
