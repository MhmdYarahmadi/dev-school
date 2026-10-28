import { behaviourCheck } from '../ddlCheck';
import type { Module } from '../types';

const columnsOf = (table: string) =>
  `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '${table}'`;

export const m09: Module = {
  id: 'm09',
  number: 9,
  title: 'Designing tables',
  tagline: 'CREATE TABLE with the right types, keys and constraints, so bad data can never get in. Then ALTER it.',
  games: ['gatekeeper'],
  concepts: [
    {
      id: 'm09-create',
      title: 'CREATE TABLE',
      card: `So far you've used tables someone else designed. Now you'll make your own:

\`\`\`sql
CREATE TABLE reviews (
  review_id  integer,
  book_id    integer,
  rating     integer,
  body       text
);
\`\`\`

Each column gets a **name** and a **type**. \`DROP TABLE reviews;\` deletes the whole table, data and all.

(As always here, everything you create in exercises is rolled back afterwards. Use the **Playground** to keep your tables.)`,
      predict: {
        sql: "CREATE TABLE notes (id integer, body text);\nINSERT INTO notes VALUES (1, 'hi'), (1, 'hi'), (NULL, NULL);\nSELECT * FROM notes;",
        question: 'This table has no constraints. What happens with the duplicate and the all-NULL row?',
        choices: ['An error on the duplicate', 'All 3 rows are stored', 'The duplicates are merged into one row'],
        answer: 1,
        why: 'Without constraints a table accepts anything: duplicates, NULLs, nonsense. Constraints (next cards) are how you keep data clean.',
      },
      example: { sql: 'CREATE TABLE reviews (\n  review_id integer,\n  book_id   integer,\n  rating    integer,\n  body      text\n);\n\nSELECT column_name, data_type\nFROM information_schema.columns\nWHERE table_name = \'reviews\';', note: 'The catalog describes every table.' },
      cheat: { syntax: 'CREATE TABLE t (col type, …);  DROP TABLE t;', note: 'Name + type for each column.' },
    },
    {
      id: 'm09-types',
      title: 'Choosing data types',
      card: `| Data | Good type | Notes |
|---|---|---|
| whole numbers | \`integer\` (or \`bigint\` for huge ones) | |
| **money / exact decimals** | \`numeric(10,2)\` | **never** \`real\`/\`float\`! |
| text | \`text\` | \`varchar(n)\` only if a max length is a real rule |
| yes/no | \`boolean\` | |
| dates | \`date\` | |
| moments in time | \`timestamptz\` | stores the time zone correctly |
| flexible documents | \`jsonb\` | |
| lists | \`text[]\`, \`integer[]\` | arrays |

Floating-point types are fast but **approximate**: fine for science, wrong for money.`,
      predict: {
        sql: 'SELECT 0.1::float8 + 0.2::float8 = 0.3 AS with_float,\n       0.1::numeric + 0.2::numeric = 0.3 AS with_numeric;',
        question: 'Is 0.1 + 0.2 equal to 0.3?',
        choices: ['true, true', 'false, true', 'false, false'],
        answer: 1,
        why: 'Floats store binary approximations, so 0.1 + 0.2 = 0.30000000000000004. numeric is exact, which is why money uses numeric.',
      },
      example: { sql: "SELECT 0.1::float8 + 0.2::float8 AS float_sum,\n       0.1::numeric + 0.2 AS numeric_sum,\n       '2025-03-01 14:30+01'::timestamptz AS moment,\n       '{\"a\": [1, 2]}'::jsonb -> 'a' AS json_part;", note: 'Types behave differently.' },
      cheat: { syntax: 'integer · numeric(10,2) · text · boolean · date · timestamptz · jsonb', note: 'numeric for money, never float.' },
    },
    {
      id: 'm09-keys',
      title: 'Primary and foreign keys',
      card: `A **PRIMARY KEY** identifies each row uniquely: it's **unique** and **NOT NULL**. Let Postgres number the rows for you with an **identity** column:

\`\`\`sql
CREATE TABLE reviews (
  review_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  book_id    integer NOT NULL REFERENCES books (book_id),
  rating     integer
);
\`\`\`

A **FOREIGN KEY** (\`REFERENCES\`) guarantees the value exists in the other table, so there are no reviews of books that don't exist. You can choose what happens when the referenced row is deleted:
- default: refuse the delete
- \`ON DELETE CASCADE\`: delete the reviews too
- \`ON DELETE SET NULL\`: keep them, but blank out the link

(Older code uses \`serial\` instead of identity. It works similarly.)`,
      predict: {
        sql: 'CREATE TABLE reviews (\n  review_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  book_id   integer NOT NULL REFERENCES books (book_id)\n);\nINSERT INTO reviews (book_id) VALUES (999);',
        question: 'There is no book 999. What happens?',
        choices: ['The review is stored', 'An error: a foreign key violation', 'Postgres creates book 999'],
        answer: 1,
        why: 'REFERENCES checks that book 999 exists in books. It doesn\'t, so the insert is rejected.',
        expectError: true,
      },
      example: { sql: 'CREATE TABLE reviews (\n  review_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  book_id   integer NOT NULL REFERENCES books (book_id) ON DELETE CASCADE,\n  rating    integer\n);\nINSERT INTO reviews (book_id, rating) VALUES (1, 5), (1, 4), (3, 5)\nRETURNING *;', note: 'IDs are generated automatically.' },
      cheat: { syntax: 'id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY · x integer REFERENCES t (id)', note: 'PK: unique + not null. FK: the value must exist elsewhere.' },
    },
    {
      id: 'm09-constraints',
      title: 'NOT NULL, UNIQUE, CHECK, DEFAULT',
      card: `Constraints are rules the database enforces **on every insert and update**:

\`\`\`sql
CREATE TABLE members (
  member_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  age        integer CHECK (age >= 13),
  plan       text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  joined_on  date NOT NULL DEFAULT current_date
);
\`\`\`

- **NOT NULL**: the value is required
- **UNIQUE**: no two rows may share the value (but several NULLs are allowed!)
- **CHECK (condition)**: any rule you can write as a condition
- **DEFAULT**: the value to use when the INSERT doesn't give one

A UNIQUE or PRIMARY KEY can cover **several columns**: \`PRIMARY KEY (customer_id, book_id)\`.`,
      predict: {
        sql: "CREATE TABLE members (email text UNIQUE);\nINSERT INTO members VALUES (NULL), (NULL);\nSELECT count(*) FROM members;",
        question: 'email is UNIQUE. Can two rows both have a NULL email?',
        choices: ['No, the second insert fails', 'Yes, count = 2', 'Only one NULL is kept'],
        answer: 1,
        why: 'NULL is "unknown", and two unknowns aren\'t considered equal, so UNIQUE allows several NULLs. Add NOT NULL if the value is required.',
      },
      example: { sql: "CREATE TABLE members (\n  member_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  email     text NOT NULL UNIQUE,\n  age       integer CHECK (age >= 13),\n  plan      text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro'))\n);\nINSERT INTO members (email, age) VALUES ('a@example.com', 30)\nRETURNING *;", note: 'Defaults fill in plan.' },
      cheat: { syntax: "NOT NULL · UNIQUE · CHECK (age >= 13) · DEFAULT 'free'", note: 'Rules enforced on every write.' },
    },
    {
      id: 'm09-alter',
      title: 'ALTER TABLE',
      card: `Tables evolve. **ALTER TABLE** changes them without losing data:

\`\`\`sql
ALTER TABLE books ADD COLUMN language text NOT NULL DEFAULT 'English';
ALTER TABLE books DROP COLUMN details;
ALTER TABLE books RENAME COLUMN in_stock TO stock;
ALTER TABLE books ADD CONSTRAINT price_positive CHECK (price > 0);
ALTER TABLE books ALTER COLUMN pages SET NOT NULL;   -- fails if NULLs exist!
\`\`\`

Adding a NOT NULL column needs a DEFAULT, so the existing rows get a value.`,
      predict: {
        sql: "ALTER TABLE books ADD COLUMN language text NOT NULL DEFAULT 'English';\nSELECT title, language FROM books LIMIT 3;",
        question: 'What language do the existing books get?',
        choices: ['NULL', "'English'", 'An error, because existing rows have no value'],
        answer: 1,
        why: 'The DEFAULT fills in every existing row, which is what makes NOT NULL possible here.',
      },
      example: { sql: "ALTER TABLE books ADD COLUMN language text NOT NULL DEFAULT 'English';\nALTER TABLE books ADD CONSTRAINT price_positive CHECK (price > 0);\nSELECT column_name, data_type, column_default\nFROM information_schema.columns\nWHERE table_name = 'books';", note: 'The table after two changes.' },
      cheat: { syntax: 'ALTER TABLE t ADD COLUMN · DROP COLUMN · RENAME COLUMN · ADD CONSTRAINT', note: 'Change a table in place.' },
    },
  ],
  practice: [
    {
      id: 'm09-p1',
      kind: 'write',
      conceptIds: ['m09-create', 'm09-keys'],
      prompt: 'Create a table **reviews** with columns **review_id** (integer, the **primary key**), **book_id** (integer), **rating** (integer) and **body** (text).',
      solution: 'CREATE TABLE reviews (review_id integer PRIMARY KEY, book_id integer, rating integer, body text);',
      wrongExample: 'CREATE TABLE reviews (review_id integer, book_id integer, rating integer, body text);',
      checkQuery: `${columnsOf('reviews')}`,
      hints: ['CREATE TABLE reviews ( name type, name type, … );', 'Add PRIMARY KEY after the review_id type.'],
      explanation: 'A primary key makes review_id unique and NOT NULL. (The checker spots the missing PRIMARY KEY because review_id stays nullable.)',
    },
    {
      id: 'm09-p2',
      kind: 'write',
      conceptIds: ['m09-constraints', 'm09-keys'],
      prompt: `Create **reviews** so that bad data can't get in:
- **review_id** integer primary key
- **book_id** integer, **required**, and must **refer to an existing book**
- **rating** integer, required, **between 1 and 5**
- **body** text (optional)`,
      solution: 'CREATE TABLE reviews (review_id integer PRIMARY KEY, book_id integer NOT NULL REFERENCES books (book_id), rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5), body text);',
      wrongExample: 'CREATE TABLE reviews (review_id integer PRIMARY KEY, book_id integer NOT NULL REFERENCES books (book_id), rating integer NOT NULL, body text);',
      checkQuery: behaviourCheck([
        "INSERT INTO reviews (review_id, book_id, rating, body) VALUES (1, 1, 5, 'Loved it')",
        "INSERT INTO reviews (review_id, book_id, rating, body) VALUES (2, 1, 6, 'Too high')",
        "INSERT INTO reviews (review_id, book_id, rating, body) VALUES (3, 1, 0, 'Too low')",
        "INSERT INTO reviews (review_id, book_id, rating, body) VALUES (4, NULL, 4, 'No book')",
        "INSERT INTO reviews (review_id, book_id, rating, body) VALUES (5, 999, 4, 'Ghost book')",
        "INSERT INTO reviews (review_id, book_id, rating, body) VALUES (1, 2, 3, 'Duplicate id')",
        'INSERT INTO reviews (review_id, book_id, rating, body) VALUES (6, 2, 3, NULL)',
        "INSERT INTO reviews (review_id, book_id, rating, body) VALUES (7, 3, NULL, 'No rating')",
      ]),
      hints: ['Constraints go right after each column\'s type.', 'NOT NULL REFERENCES books (book_id) · NOT NULL CHECK (rating BETWEEN 1 AND 5)'],
      explanation: 'The checker throws 8 inserts at your table. Good ones must be accepted and each bad one rejected *for the right reason*.',
    },
    {
      id: 'm09-p3',
      kind: 'write',
      conceptIds: ['m09-keys', 'm09-constraints'],
      prompt: 'Create a table **tags** with **tag_id** (an integer generated automatically, the primary key) and **name** (text, required, and **no two tags with the same name**).',
      solution: 'CREATE TABLE tags (tag_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL UNIQUE);',
      wrongExample: 'CREATE TABLE tags (tag_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL);',
      checkQuery: behaviourCheck(
        ["INSERT INTO tags (name) VALUES ('scifi')", "INSERT INTO tags (name) VALUES ('scifi')", 'INSERT INTO tags (name) VALUES (NULL)', "INSERT INTO tags (name) VALUES ('mystery')"],
        "SELECT string_agg(name, ',' ORDER BY tag_id) FROM tags WHERE tag_id IS NOT NULL",
      ),
      hints: ['integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY (or serial PRIMARY KEY)', 'name text NOT NULL UNIQUE'],
      explanation: 'IDENTITY numbers the rows for you, and UNIQUE blocks duplicate names.',
    },
    {
      id: 'm09-p4',
      kind: 'write',
      conceptIds: ['m09-constraints', 'm09-keys'],
      prompt: `Create a **wishlist** table:
- **customer_id** integer → must exist in customers
- **book_id** integer → must exist in books
- **added_on** date, defaulting to **today**
- A customer can wish for a given book **only once** (make the pair the primary key).`,
      solution: 'CREATE TABLE wishlist (customer_id integer REFERENCES customers (customer_id), book_id integer REFERENCES books (book_id), added_on date DEFAULT current_date, PRIMARY KEY (customer_id, book_id));',
      wrongExample: 'CREATE TABLE wishlist (customer_id integer REFERENCES customers (customer_id), book_id integer REFERENCES books (book_id), added_on date DEFAULT current_date);',
      checkQuery: behaviourCheck(
        [
          'INSERT INTO wishlist (customer_id, book_id) VALUES (1, 1)',
          'INSERT INTO wishlist (customer_id, book_id) VALUES (1, 1)',
          'INSERT INTO wishlist (customer_id, book_id) VALUES (1, 2)',
          'INSERT INTO wishlist (customer_id, book_id) VALUES (99, 1)',
          'INSERT INTO wishlist (customer_id, book_id) VALUES (2, 999)',
        ],
        'SELECT count(*) FROM wishlist WHERE added_on = current_date',
      ),
      hints: ['A table-level constraint goes after the columns: PRIMARY KEY (customer_id, book_id)', 'DEFAULT current_date'],
      explanation: 'A composite primary key makes each (customer, book) pair unique.',
    },
    {
      id: 'm09-p5',
      kind: 'write',
      conceptIds: ['m09-alter'],
      prompt: "Add a column **language** (text) to **books** that is **required** and defaults to **'English'**.",
      solution: "ALTER TABLE books ADD COLUMN language text NOT NULL DEFAULT 'English';",
      wrongExample: 'ALTER TABLE books ADD COLUMN language text;',
      checkQuery: `SELECT (SELECT is_nullable FROM information_schema.columns WHERE table_name = 'books' AND column_name = 'language') AS nullable, (SELECT count(*) FROM books WHERE language = 'English') AS english`,
      hints: ['ALTER TABLE books ADD COLUMN …', "NOT NULL DEFAULT 'English'"],
      explanation: 'The DEFAULT fills in the existing rows, so NOT NULL can apply straight away.',
    },
    {
      id: 'm09-p6',
      kind: 'write',
      conceptIds: ['m09-alter', 'm09-constraints'],
      prompt: 'Add a rule to **books** that the **price must be greater than 0**.',
      solution: 'ALTER TABLE books ADD CONSTRAINT price_positive CHECK (price > 0);',
      wrongExample: 'ALTER TABLE books ADD CONSTRAINT price_positive CHECK (price >= 0);',
      checkQuery: behaviourCheck([
        'UPDATE books SET price = -1 WHERE book_id = 1',
        'UPDATE books SET price = 0 WHERE book_id = 1',
        'UPDATE books SET price = 5 WHERE book_id = 1',
      ]),
      hints: ['ALTER TABLE books ADD CONSTRAINT some_name CHECK (…)'],
      explanation: '"Greater than 0" excludes 0 itself, so use >, not >=.',
    },
    {
      id: 'm09-p7',
      kind: 'fixBug',
      conceptIds: ['m09-constraints'],
      prompt: 'This CREATE TABLE has a **syntax error**. Fix it, keeping the rule that **score is from 0 to 100**.',
      starterSql: 'CREATE TABLE quiz_results (\n  result_id integer PRIMARY KEY,\n  score integer CHECK score BETWEEN 0 AND 100\n);',
      solution: 'CREATE TABLE quiz_results (result_id integer PRIMARY KEY, score integer CHECK (score BETWEEN 0 AND 100));',
      wrongExample: 'CREATE TABLE quiz_results (result_id integer PRIMARY KEY, score integer);',
      checkQuery: behaviourCheck([
        'INSERT INTO quiz_results VALUES (1, 50)',
        'INSERT INTO quiz_results VALUES (2, 101)',
        'INSERT INTO quiz_results VALUES (3, -1)',
        'INSERT INTO quiz_results VALUES (4, 100)',
      ]),
      hints: ['CHECK needs parentheses around its condition.'],
      explanation: 'CHECK (condition): the parentheses are required.',
    },
    {
      id: 'm09-p8',
      kind: 'readQuery',
      conceptIds: ['m09-keys'],
      prompt: '`reviews.book_id` is declared `REFERENCES books (book_id) ON DELETE CASCADE`. What happens when book 1 is deleted?',
      choices: ['The delete is refused', 'Book 1 and all its reviews are deleted', 'The reviews keep book_id = 1', 'The reviews\' book_id becomes NULL'],
      answer: 1,
      hints: [],
      explanation: 'CASCADE deletes the referencing rows too. Without it, the delete would be refused. SET NULL would blank the link.',
    },
    {
      id: 'm09-p9',
      kind: 'readQuery',
      conceptIds: ['m09-types'],
      prompt: 'Which type should a column storing **prices in euros** use?',
      choices: ['real', 'float8', 'numeric(8,2)', 'text'],
      answer: 2,
      hints: [],
      explanation: 'numeric is exact. Floats are approximations (0.1 + 0.2 ≠ 0.3), and text can\'t do maths or validate the value.',
    },
    {
      id: 'm09-p10',
      kind: 'write',
      conceptIds: ['m09-alter'],
      prompt: 'We no longer need the **details** column on **books**. Remove it.',
      solution: 'ALTER TABLE books DROP COLUMN details;',
      wrongExample: 'ALTER TABLE books DROP COLUMN tags;',
      checkQuery: columnsOf('books'),
      hints: ['ALTER TABLE … DROP COLUMN …'],
      explanation: 'DROP COLUMN removes the column and its data.',
    },
  ],
  test: [
    {
      id: 'm09-t1',
      kind: 'write',
      conceptIds: ['m09-create', 'm09-keys', 'm09-constraints'],
      prompt: 'Create **publishers** with **publisher_id** (integer primary key), **name** (text, required, unique) and **country** (text, optional).',
      solution: 'CREATE TABLE publishers (publisher_id integer PRIMARY KEY, name text NOT NULL UNIQUE, country text);',
      wrongExample: 'CREATE TABLE publishers (publisher_id integer PRIMARY KEY, name text, country text);',
      checkQuery: behaviourCheck([
        "INSERT INTO publishers VALUES (1, 'Penguin', 'United Kingdom')",
        "INSERT INTO publishers VALUES (2, 'Penguin', 'United States')",
        'INSERT INTO publishers VALUES (3, NULL, NULL)',
        "INSERT INTO publishers VALUES (1, 'Vintage', NULL)",
        "INSERT INTO publishers VALUES (4, 'Vintage', NULL)",
      ]),
      hints: [],
      explanation: 'PK + NOT NULL UNIQUE.',
    },
    {
      id: 'm09-t2',
      kind: 'write',
      conceptIds: ['m09-constraints'],
      prompt: "Create **subscriptions** with **sub_id** (integer primary key) and **plan** (text, required, **only 'free' or 'pro'**, defaulting to **'free'**).",
      solution: "CREATE TABLE subscriptions (sub_id integer PRIMARY KEY, plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')));",
      wrongExample: "CREATE TABLE subscriptions (sub_id integer PRIMARY KEY, plan text NOT NULL CHECK (plan IN ('free', 'pro')));",
      checkQuery: behaviourCheck(
        ['INSERT INTO subscriptions (sub_id) VALUES (1)', "INSERT INTO subscriptions VALUES (2, 'pro')", "INSERT INTO subscriptions VALUES (3, 'gold')", 'INSERT INTO subscriptions VALUES (4, NULL)'],
        "SELECT string_agg(plan, ',' ORDER BY sub_id) FROM subscriptions",
      ),
      hints: [],
      explanation: 'DEFAULT + CHECK IN (…).',
    },
    {
      id: 'm09-t3',
      kind: 'readQuery',
      conceptIds: ['m09-constraints'],
      prompt: 'A column is declared `email text UNIQUE` (without NOT NULL). Which insert fails?',
      choices: ["A second row with email 'a@x.com' when one already exists", 'A second row with email NULL when one already has NULL', 'Both', 'Neither'],
      answer: 0,
      hints: [],
      explanation: 'UNIQUE allows multiple NULLs, but not duplicate values.',
    },
    {
      id: 'm09-t4',
      kind: 'write',
      conceptIds: ['m09-alter'],
      prompt: 'Add a **boolean** column **featured** to **books**, defaulting to **false**.',
      solution: 'ALTER TABLE books ADD COLUMN featured boolean DEFAULT false;',
      wrongExample: 'ALTER TABLE books ADD COLUMN featured boolean;',
      checkQuery: "SELECT count(*) FILTER (WHERE featured = false) AS f FROM books",
      hints: [],
      explanation: 'ADD COLUMN … DEFAULT false.',
    },
    {
      id: 'm09-t5',
      kind: 'write',
      conceptIds: ['m09-keys'],
      prompt: 'Create **loans** with **loan_id** (auto-generated integer primary key) and **customer_id** (integer, required, must exist in customers, and **deleting the customer deletes their loans**).',
      solution: 'CREATE TABLE loans (loan_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers (customer_id) ON DELETE CASCADE);',
      wrongExample: 'CREATE TABLE loans (loan_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers (customer_id));',
      checkQuery: behaviourCheck(
        ['INSERT INTO loans (customer_id) VALUES (20)', 'INSERT INTO loans (customer_id) VALUES (99)', 'DELETE FROM customers WHERE customer_id = 20'],
        'SELECT count(*) FROM loans',
      ),
      hints: [],
      explanation: 'ON DELETE CASCADE lets the customer delete go through and removes their loans.',
    },
  ],
};
