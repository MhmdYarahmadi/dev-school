import type { Module } from '../types';

export const m05: Module = {
  id: 'm05',
  number: 5,
  title: 'Aggregation',
  tagline: 'Summarise many rows into one: COUNT, SUM, AVG, MIN, MAX, GROUP BY and HAVING.',
  games: ['warehouse'],
  concepts: [
    {
      id: 'm05-aggregates',
      title: 'Aggregate functions',
      card: `Aggregate functions squash **many rows into one value**:

| Function | Gives |
|---|---|
| \`count(*)\` | number of rows |
| \`sum(x)\` | total |
| \`avg(x)\` | average |
| \`min(x)\` / \`max(x)\` | smallest / largest |

\`\`\`sql
SELECT count(*) AS books, round(avg(price), 2) AS avg_price, max(price)
FROM books;
\`\`\`

The result is **one row**. WHERE runs *before* aggregating: \`WHERE genre = 'Mystery'\` makes \`count(*)\` count only mysteries.`,
      predict: {
        sql: 'SELECT count(*), min(price), max(price) FROM books;',
        question: 'How many rows does this return?',
        choices: ['30 (one per book)', '1', '3'],
        answer: 1,
        why: 'Aggregates without GROUP BY collapse the whole table into a single summary row.',
      },
      example: { sql: 'SELECT count(*) AS books,\n       sum(in_stock) AS copies,\n       round(avg(price), 2) AS avg_price,\n       min(published_year) AS oldest\nFROM books;', note: 'One summary row.' },
      cheat: { syntax: 'SELECT count(*), sum(x), avg(x), min(x), max(x) FROM t;', note: 'Many rows → one value.' },
    },
    {
      id: 'm05-count',
      title: 'COUNT(*) vs COUNT(col) vs COUNT(DISTINCT)',
      card: `Three different counts:

- \`count(*)\`: counts **rows**
- \`count(email)\`: counts rows where email is **not NULL**
- \`count(DISTINCT country)\`: counts **different** non-NULL values

All aggregates except \`count(*)\` **ignore NULLs**. So \`avg(pages)\` is the average of the *known* page counts.`,
      predict: {
        sql: 'SELECT count(*), count(email), count(DISTINCT country)\nFROM customers;',
        question: 'There are 20 customers, 3 without an email, from 15 different countries. What are the three numbers?',
        choices: ['20, 20, 20', '20, 17, 15', '17, 17, 15', '20, 17, 20'],
        answer: 1,
        why: 'count(*) counts all 20 rows, count(email) skips the 3 NULLs, and count(DISTINCT country) counts 15 different values.',
      },
      example: { sql: 'SELECT count(*) AS all_books,\n       count(pages) AS with_pages,\n       count(DISTINCT genre) AS genres\nFROM books;', note: 'Three kinds of count.' },
      cheat: { syntax: 'count(*) · count(col) · count(DISTINCT col)', note: 'Rows · non-NULL values · different values.' },
    },
    {
      id: 'm05-groupby',
      title: 'GROUP BY',
      card: `**GROUP BY** splits the rows into groups and computes the aggregates **per group**:

\`\`\`sql
SELECT genre, count(*) AS books, round(avg(price), 2) AS avg_price
FROM books
GROUP BY genre;
\`\`\`

You get one result row **per genre**.

🔑 The golden rule: every column in SELECT must either be **in the GROUP BY** or **inside an aggregate**. \`SELECT genre, title … GROUP BY genre\` fails, because which title should a whole group show?

Try **🔍 Step through** on the example to watch the rows collapse into groups.`,
      predict: {
        sql: 'SELECT genre, count(*) FROM books GROUP BY genre;',
        question: 'The 30 books cover 7 genres. How many rows come back?',
        choices: ['30', '7', '1'],
        answer: 1,
        why: 'One output row per group, and there are 7 genres.',
      },
      example: { sql: 'SELECT genre,\n       count(*) AS books,\n       round(avg(price), 2) AS avg_price\nFROM books\nGROUP BY genre\nORDER BY books DESC;', note: 'Per-genre summary, biggest first.' },
      cheat: { syntax: 'SELECT g, count(*) FROM t GROUP BY g;', note: 'One row per group. SELECT only grouped columns or aggregates.' },
    },
    {
      id: 'm05-having',
      title: 'HAVING: filtering groups',
      card: `WHERE filters **rows before** grouping. To filter **groups after** aggregating, use **HAVING**:

\`\`\`sql
SELECT genre, count(*)
FROM books
GROUP BY genre
HAVING count(*) >= 3;   -- only genres with 3+ books
\`\`\`

You can use both in one query:

\`\`\`
FROM → WHERE (rows) → GROUP BY → HAVING (groups) → SELECT → ORDER BY → LIMIT
\`\`\``,
      predict: {
        sql: "SELECT genre, count(*) FROM books\nWHERE price < 15\nGROUP BY genre\nHAVING count(*) >= 3;",
        question: 'What does WHERE price < 15 do here?',
        choices: [
          'It removes genres whose average price is 15 or more',
          'It removes expensive books before they are counted',
          'Nothing, because HAVING overrides it',
        ],
        answer: 1,
        why: 'WHERE works on individual rows before grouping, so expensive books never get counted. HAVING then drops groups with fewer than 3 cheap books.',
      },
      example: { sql: "SELECT customer_id, count(*) AS orders\nFROM orders\nWHERE status <> 'cancelled'\nGROUP BY customer_id\nHAVING count(*) >= 2\nORDER BY orders DESC;", note: 'Repeat customers.' },
      cheat: { syntax: 'GROUP BY g HAVING count(*) > 2', note: 'WHERE filters rows (before). HAVING filters groups (after).' },
    },
    {
      id: 'm05-groupexpr',
      title: 'Grouping by expressions and several columns',
      card: `You can group by **several columns** or by an **expression**:

\`\`\`sql
-- orders per year and status
SELECT extract(year FROM order_date) AS year, status, count(*)
FROM orders
GROUP BY year, status;

-- revenue per order: aggregate an expression
SELECT order_id, sum(quantity * unit_price) AS total
FROM order_items
GROUP BY order_id;
\`\`\`

Postgres lets you GROUP BY a SELECT alias (like \`year\`) or a column position (\`GROUP BY 1\`).`,
      predict: {
        sql: 'SELECT order_id, sum(quantity * unit_price) AS total\nFROM order_items\nGROUP BY order_id\nORDER BY total DESC\nLIMIT 1;',
        question: 'Order 10 is three copies of Sapiens at €22.00 each. Order 7 is one book at €15.75 plus two at €16.00. Which order comes out on top?',
        choices: ['Order 10 (€66.00)', 'Order 7', 'Order 1'],
        answer: 0,
        why: '3 × 22.00 = 66.00, the largest total. Order 7 is 15.75 + 2 × 16.00 = 47.75.',
      },
      example: { sql: 'SELECT extract(year FROM order_date) AS year,\n       status,\n       count(*) AS orders\nFROM orders\nGROUP BY year, status\nORDER BY year, status;', note: 'Groups made of two columns.' },
      cheat: { syntax: 'GROUP BY extract(year FROM d), status', note: 'Group by several columns or expressions.' },
    },
  ],
  practice: [
    {
      id: 'm05-p1',
      kind: 'write',
      conceptIds: ['m05-aggregates'],
      prompt: 'How many **copies** of books do we have **in stock in total**? (Sum of in_stock.)',
      solution: 'SELECT sum(in_stock) FROM books;',
      wrongExample: 'SELECT count(in_stock) FROM books;',
      hints: ['You want to add values up, not count rows.'],
      explanation: 'sum() adds the values. count() would count the rows (30).',
    },
    {
      id: 'm05-p2',
      kind: 'write',
      conceptIds: ['m05-aggregates'],
      prompt: 'Show the **cheapest** and **most expensive** price among **Science Fiction** books (two columns).',
      solution: "SELECT min(price), max(price) FROM books WHERE genre = 'Science Fiction';",
      wrongExample: 'SELECT min(price), max(price) FROM books;',
      hints: ['Filter with WHERE first, then aggregate.'],
      explanation: 'WHERE runs before the aggregates.',
    },
    {
      id: 'm05-p3',
      kind: 'readQuery',
      conceptIds: ['m05-count'],
      prompt: '28 books have a known page count and 2 have NULL. What does `SELECT avg(pages) FROM books;` compute?',
      choices: ['sum of pages ÷ 30', 'sum of pages ÷ 28', 'NULL, because some values are NULL', 'An error'],
      answer: 1,
      hints: [],
      explanation: 'Aggregates skip NULLs: avg = sum of the 28 known values ÷ 28.',
    },
    {
      id: 'm05-p4',
      kind: 'write',
      conceptIds: ['m05-count'],
      prompt: 'How many **different cities** do our customers live in?',
      solution: 'SELECT count(DISTINCT city) FROM customers;',
      wrongExample: 'SELECT count(city) FROM customers;',
      hints: ['count(city) counts rows. You want *different* values.'],
      explanation: 'count(DISTINCT city) counts unique values.',
    },
    {
      id: 'm05-p5',
      kind: 'parsons',
      conceptIds: ['m05-groupby'],
      prompt: 'Build a query showing **each department** and **how many employees** it has.',
      blocks: ['SELECT department, count(*)', 'FROM employees', 'GROUP BY department;'],
      distractors: ['SELECT department, name, count(*)', 'ORDER BY department;'],
      wrongOrder: ['SELECT department, count(*)', 'GROUP BY department;', 'FROM employees'],
      hints: ['GROUP BY comes after FROM (and after WHERE, if any).', 'Can you SELECT name if you only group by department?'],
      explanation: 'One row per department. Adding name would break the GROUP BY rule.',
    },
    {
      id: 'm05-p6',
      kind: 'write',
      conceptIds: ['m05-groupby'],
      prompt: 'For each **genre**, show the genre and its **average price rounded to 2 decimals**.',
      solution: 'SELECT genre, round(avg(price), 2) FROM books GROUP BY genre;',
      wrongExample: 'SELECT genre, round(avg(price), 2) FROM books GROUP BY genre, title;',
      hints: ['GROUP BY genre', 'round(avg(price), 2)'],
      explanation: 'The aggregate is computed per group.',
      variants: [
        {
          id: 'm05-p6-v1',
          prompt: 'For each **department**, show the department and its **highest salary**.',
          solution: 'SELECT department, max(salary) FROM employees GROUP BY department;',
          wrongExample: 'SELECT department, min(salary) FROM employees GROUP BY department;',
          hints: ['max() per group.'],
          explanation: 'max(salary) per department.',
        },
      ],
    },
    {
      id: 'm05-p7',
      kind: 'fixBug',
      conceptIds: ['m05-groupby'],
      prompt: 'This should count **orders per status**, but it errors. Fix it.',
      starterSql: 'SELECT status, order_id, count(*)\nFROM orders\nGROUP BY status;',
      solution: 'SELECT status, count(*) FROM orders GROUP BY status;',
      wrongExample: 'SELECT status, count(*) FROM orders GROUP BY status, order_id;',
      hints: ['Read the error: which column is neither grouped nor aggregated?'],
      explanation: 'order_id varies inside each status group, so it can\'t be shown. Remove it.',
    },
    {
      id: 'm05-p8',
      kind: 'write',
      conceptIds: ['m05-having'],
      prompt: 'Show the **genres that have more than 3 books**, with their book count.',
      solution: 'SELECT genre, count(*) FROM books GROUP BY genre HAVING count(*) > 3;',
      wrongExample: 'SELECT genre, count(*) FROM books GROUP BY genre;',
      hints: ['You need to filter on an aggregate.', 'HAVING count(*) > 3'],
      explanation: 'HAVING filters groups after counting.',
    },
    {
      id: 'm05-p9',
      kind: 'fixBug',
      conceptIds: ['m05-having'],
      prompt: '**Customers (customer_id) with at least 3 orders.** This fails. Fix it.',
      starterSql: 'SELECT customer_id, count(*)\nFROM orders\nWHERE count(*) >= 3\nGROUP BY customer_id;',
      solution: 'SELECT customer_id, count(*) FROM orders GROUP BY customer_id HAVING count(*) >= 3;',
      wrongExample: 'SELECT customer_id, count(*) FROM orders GROUP BY customer_id;',
      hints: ['Can WHERE see counts? When does WHERE run?', 'Move the condition into HAVING, after GROUP BY.'],
      explanation: 'Aggregates are not allowed in WHERE, which runs before grouping. Use HAVING.',
    },
    {
      id: 'm05-p10',
      kind: 'write',
      conceptIds: ['m05-groupexpr'],
      prompt: 'Show each **order_id** with its **total value** (sum of quantity × unit_price), **largest first**. (Two orders tie at 43.50, so sort those by order_id.)',
      solution: 'SELECT order_id, sum(quantity * unit_price) AS total FROM order_items GROUP BY order_id ORDER BY total DESC, order_id;',
      wrongExample: 'SELECT order_id, sum(unit_price) AS total FROM order_items GROUP BY order_id ORDER BY total DESC, order_id;',
      orderMatters: true,
      hints: ['Aggregate an expression: sum(quantity * unit_price).', 'ORDER BY the alias, DESC.'],
      explanation: 'You can aggregate expressions, then sort by the result.',
    },
    {
      id: 'm05-p11',
      kind: 'write',
      conceptIds: ['m05-groupexpr', 'm05-having'],
      prompt: 'Which **book_ids** have sold **3 or more copies in total** (sum of quantity in order_items)? Show book_id and copies.',
      solution: 'SELECT book_id, sum(quantity) AS copies FROM order_items GROUP BY book_id HAVING sum(quantity) >= 3;',
      wrongExample: 'SELECT book_id, count(*) AS copies FROM order_items GROUP BY book_id HAVING count(*) >= 3;',
      hints: ['Copies sold = sum of quantity, not the number of rows.'],
      explanation: 'One order line can contain several copies, so sum(quantity) and count(*) differ.',
    },
  ],
  test: [
    {
      id: 'm05-t1',
      kind: 'write',
      conceptIds: ['m05-aggregates'],
      prompt: 'What is the **average salary** of all employees? (Any precision is fine.)',
      solution: 'SELECT avg(salary) FROM employees;',
      wrongExample: 'SELECT sum(salary) FROM employees;',
      hints: [],
      explanation: 'avg().',
    },
    {
      id: 'm05-t2',
      kind: 'write',
      conceptIds: ['m05-groupby'],
      prompt: 'Show **each country** and the **number of customers** from it.',
      solution: 'SELECT country, count(*) FROM customers GROUP BY country;',
      wrongExample: 'SELECT country, count(DISTINCT city) FROM customers GROUP BY country, city;',
      hints: [],
      explanation: 'GROUP BY country.',
    },
    {
      id: 'm05-t3',
      kind: 'readQuery',
      conceptIds: ['m05-having'],
      prompt: 'Where must the condition `count(*) > 5` go?',
      choices: ['In WHERE', 'In HAVING', 'In GROUP BY', 'In SELECT'],
      answer: 1,
      hints: [],
      explanation: 'Conditions on aggregates go in HAVING.',
    },
    {
      id: 'm05-t4',
      kind: 'write',
      conceptIds: ['m05-having', 'm05-groupby'],
      prompt: 'Show **departments** whose **average salary is above 70000**, with that average.',
      solution: 'SELECT department, avg(salary) FROM employees GROUP BY department HAVING avg(salary) > 70000;',
      wrongExample: 'SELECT department, avg(salary) FROM employees WHERE salary > 70000 GROUP BY department;',
      hints: [],
      explanation: 'HAVING filters on the group average. WHERE would filter individual salaries.',
    },
    {
      id: 'm05-t5',
      kind: 'write',
      conceptIds: ['m05-count'],
      prompt: 'How many authors have a **known** birth year?',
      solution: 'SELECT count(birth_year) FROM authors;',
      wrongExample: 'SELECT count(*) FROM authors;',
      hints: [],
      explanation: 'count(col) skips NULLs.',
    },
    {
      id: 'm05-t6',
      kind: 'write',
      conceptIds: ['m05-groupexpr'],
      prompt: 'Count orders **per year** (by order_date). Show the year and the count.',
      solution: 'SELECT extract(year FROM order_date) AS year, count(*) FROM orders GROUP BY year;',
      wrongExample: 'SELECT order_date, count(*) FROM orders GROUP BY order_date;',
      hints: [],
      explanation: 'Group by an expression.',
    },
  ],
  project: {
    id: 'proj1',
    title: 'Project: the quarterly bookstore report',
    story: `The owner wants a short report for the quarterly meeting, and has asked **you**. There is no single right query for these tasks. Choose your own approach, as long as the result meets the requirements.

All three tasks only need what you've learned so far (one table at a time, with WHERE, CASE, GROUP BY and HAVING).`,
    tasks: [
      {
        id: 'proj1-t1',
        prompt: '**Loyal customers.** Which customers placed **2 or more orders that were not cancelled**? Return columns named **customer_id** and **order_count**.',
        requirements: [
          { label: 'Has columns customer_id and order_count', sql: "SELECT count(*) = 2 FROM information_schema.columns WHERE table_name = 'answer' AND column_name IN ('customer_id', 'order_count')" },
          { label: 'Exactly the right customers', sql: "SELECT (SELECT array_agg(customer_id ORDER BY customer_id) FROM answer) = (SELECT array_agg(customer_id ORDER BY customer_id) FROM (SELECT customer_id FROM orders WHERE status <> 'cancelled' GROUP BY customer_id HAVING count(*) >= 2) t)" },
          { label: 'Counts are correct (cancelled orders excluded)', sql: "SELECT NOT EXISTS (SELECT 1 FROM answer a WHERE a.order_count <> (SELECT count(*) FROM orders o WHERE o.customer_id = a.customer_id AND o.status <> 'cancelled'))" },
        ],
        referenceSolution: "SELECT customer_id, count(*) AS order_count\nFROM orders\nWHERE status <> 'cancelled'\nGROUP BY customer_id\nHAVING count(*) >= 2\nORDER BY order_count DESC;",
        discussion: 'WHERE removes the cancelled orders *before* counting, and HAVING keeps the groups with 2+. If you put the status check in HAVING, it would fail: status isn\'t a group-level value.',
        hints: ['Filter cancelled orders out first (WHERE), then group by customer.', 'HAVING count(*) >= 2'],
      },
      {
        id: 'proj1-t2',
        prompt: '**Big orders.** Decide for yourself what counts as a "big" order, and list the big ones with their total value. Return **order_id** and **total**.',
        requirements: [
          { label: 'Has columns order_id and total', sql: "SELECT count(*) = 2 FROM information_schema.columns WHERE table_name = 'answer' AND column_name IN ('order_id', 'total')" },
          { label: 'Totals are correct (sum of quantity × unit_price)', sql: 'SELECT NOT EXISTS (SELECT 1 FROM answer a WHERE a.total <> (SELECT sum(quantity * unit_price) FROM order_items i WHERE i.order_id = a.order_id))' },
          { label: 'Between 3 and 15 orders', sql: 'SELECT count(*) BETWEEN 3 AND 15 FROM answer' },
          { label: 'Really the biggest: no order you left out is bigger than one you kept', sql: 'SELECT (SELECT min(total) FROM answer) >= ALL (SELECT sum(quantity * unit_price) FROM order_items WHERE order_id NOT IN (SELECT order_id FROM answer) GROUP BY order_id)' },
        ],
        referenceSolution: 'SELECT order_id, sum(quantity * unit_price) AS total\nFROM order_items\nGROUP BY order_id\nHAVING sum(quantity * unit_price) >= 35\nORDER BY total DESC;',
        discussion: 'We picked €35 as the threshold, but any threshold that gives 3–15 orders is fine. `ORDER BY total DESC LIMIT 5` also works, though LIMIT can cut through a tie: two orders total 43.50!',
        hints: ['Total per order: GROUP BY order_id with sum(quantity * unit_price).', 'Either HAVING total >= some amount, or ORDER BY … LIMIT.'],
      },
      {
        id: 'proj1-t3',
        prompt: '**Price bands.** Put every book into **at least 3 price bands** of your own design (using CASE), and count the books in each band. Return **band** and **book_count**.',
        requirements: [
          { label: 'Has columns band and book_count', sql: "SELECT count(*) = 2 FROM information_schema.columns WHERE table_name = 'answer' AND column_name IN ('band', 'book_count')" },
          { label: 'At least 3 bands', sql: 'SELECT count(*) >= 3 FROM answer' },
          { label: 'Every book counted exactly once (counts add up to 30)', sql: 'SELECT sum(book_count) = 30 FROM answer' },
          { label: 'Each band appears once', sql: 'SELECT count(*) = count(DISTINCT band) FROM answer' },
        ],
        referenceSolution: "SELECT CASE\n         WHEN price < 10 THEN 'budget'\n         WHEN price < 15 THEN 'standard'\n         ELSE 'premium'\n       END AS band,\n       count(*) AS book_count\nFROM books\nGROUP BY band;",
        discussion: 'Grouping by a CASE expression is a very common reporting pattern. Make sure every price falls into some band: an ELSE branch guarantees no NULL band.',
        hints: ['Write the CASE first and look at it per book.', 'Then GROUP BY that CASE (or its alias) and count(*).'],
      },
    ],
  },
};
