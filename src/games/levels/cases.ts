/* Case Files (Module 7) and The Final Case (finale): multi-step mysteries. */

export interface CaseStep {
  prompt: string;
  solution: string;
  hint: string;
  /** Story text revealed after solving this step. */
  reveal: string;
}

export interface MysteryCase {
  id: 'casefiles' | 'finale';
  title: string;
  intro: string;
  setupSql: string;
  steps: CaseStep[];
  suspects: string[];
  culprit: string;
  epilogue: string;
}

const WAREHOUSE_SETUP = `
CREATE TABLE badge_log (employee_id integer, door text, ts timestamp);
CREATE TABLE inventory_log (book_id integer, action text, ts timestamp, employee_id integer);
INSERT INTO badge_log VALUES
  (4, 'warehouse', '2025-01-12 17:30'), (10, 'warehouse', '2025-01-12 18:00'),
  (11, 'warehouse', '2025-01-12 21:40'), (12, 'warehouse', '2025-01-12 22:15'),
  (8, 'warehouse', '2025-01-12 22:30'), (12, 'office', '2025-01-12 22:20'),
  (12, 'warehouse', '2025-01-12 22:40'), (12, 'loading dock', '2025-01-12 22:50'),
  (8, 'office', '2025-01-12 23:10'), (3, 'office', '2025-01-12 09:00'),
  (11, 'warehouse', '2025-01-11 21:00');
INSERT INTO inventory_log VALUES
  (5, 'scan', '2025-01-12 21:00', 10), (5, 'scan', '2025-01-11 20:00', 10),
  (3, 'scan_out', '2025-01-12 22:00', 11), (7, 'scan', '2025-01-12 22:35', 8);`;

const WAREHOUSE_VISITORS = "SELECT employee_id FROM badge_log WHERE door = 'warehouse' AND ts::date = '2025-01-12'";
const LAST_SCAN = "(SELECT max(ts) FROM inventory_log WHERE book_id = 5 AND action = 'scan')";
const LATE = `SELECT employee_id FROM badge_log WHERE door = 'warehouse' AND ts > ${LAST_SCAN}`;

export const CASEFILES: MysteryCase = {
  id: 'casefiles',
  title: 'The Vanishing First Edition',
  intro: `The bookstore's only **first edition of *One Hundred Years of Solitude*** (book 5) vanished from the warehouse on the night of **12 January 2025**.

You have the usual tables plus two new ones:
- \`badge_log(employee_id, door, ts)\`: every door swipe
- \`inventory_log(book_id, action, ts, employee_id)\`: warehouse scans

Each step's answer narrows down the suspects. Solve them in order.`,
  setupSql: WAREHOUSE_SETUP,
  steps: [
    {
      prompt: '**Step 1 (IN subquery).** Which employees badged into the **warehouse** door **on 2025-01-12**? Return their **name** (each once).',
      solution: `SELECT name FROM employees WHERE employee_id IN (${WAREHOUSE_VISITORS})`,
      hint: "SELECT name FROM employees WHERE employee_id IN (SELECT employee_id FROM badge_log WHERE door = 'warehouse' AND ts::date = '2025-01-12')",
      reveal: 'Five people were in the warehouse that day. But when exactly did the book disappear?',
    },
    {
      prompt: "**Step 2 (scalar subquery).** The book was last scanned (book_id 5, action 'scan') at the **latest** such time in inventory_log. Which employees badged into the warehouse **after** that moment? Return **name**.",
      solution: `SELECT name FROM employees WHERE employee_id IN (${LATE})`,
      hint: `… WHERE employee_id IN (SELECT employee_id FROM badge_log WHERE door = 'warehouse' AND ts > (SELECT max(ts) FROM inventory_log WHERE book_id = 5 AND action = 'scan'))`,
      reveal: 'Three employees came in after 21:00, when the book was last seen.',
    },
    {
      prompt: "**Step 3 (NOT EXISTS).** Honest staff always record a **'scan_out'** when they leave with stock. Of the three late visitors, who has **no 'scan_out' record at all** in inventory_log? Return **name**.",
      solution: `SELECT e.name FROM employees e WHERE e.employee_id IN (${LATE}) AND NOT EXISTS (SELECT 1 FROM inventory_log i WHERE i.employee_id = e.employee_id AND i.action = 'scan_out')`,
      hint: "Add: AND NOT EXISTS (SELECT 1 FROM inventory_log i WHERE i.employee_id = e.employee_id AND i.action = 'scan_out')",
      reveal: 'Two suspects remain. Someone was very nervous that night…',
    },
    {
      prompt: '**Step 4 (CTE + GROUP BY).** Using a **WITH** clause, count **every badge swipe on 2025-01-12** (any door) for the two remaining suspects, **Leo Fischer** and **Ravi Nair**. Return **name** and **swipes**.',
      solution: "WITH s AS (SELECT employee_id, count(*) AS swipes FROM badge_log WHERE ts::date = '2025-01-12' GROUP BY employee_id) SELECT e.name, s.swipes FROM s JOIN employees e ON e.employee_id = s.employee_id WHERE e.name IN ('Leo Fischer', 'Ravi Nair')",
      hint: "WITH s AS (SELECT employee_id, count(*) AS swipes FROM badge_log WHERE ts::date = '2025-01-12' GROUP BY employee_id) SELECT e.name, s.swipes FROM s JOIN employees e …",
      reveal: 'Four swipes in 35 minutes: warehouse, office, warehouse, loading dock. That\'s someone moving something out.',
    },
    {
      prompt: '**Step 5 (WITH RECURSIVE).** Before you accuse anyone, you must inform their **entire chain of command**. Starting from **Ravi Nair**, walk **up** through manager_id to the CEO. Return the **names of all his managers** (not Ravi himself).',
      solution: "WITH RECURSIVE up AS (SELECT manager_id FROM employees WHERE name = 'Ravi Nair' UNION ALL SELECT e.manager_id FROM employees e JOIN up ON e.employee_id = up.manager_id) SELECT e.name FROM employees e JOIN up ON e.employee_id = up.manager_id",
      hint: "Start: Ravi's manager_id. Step: the manager_id of that employee. Then join to employees to get names.",
      reveal: 'Ben Adeyemi, Owen Clarke and Margaret Hale have been informed. Time to make the accusation.',
    },
  ],
  suspects: ['Ben Adeyemi', 'Chloe Martin', 'Leo Fischer', 'Ravi Nair', 'Owen Clarke'],
  culprit: 'Ravi Nair',
  epilogue: 'Ravi Nair confessed: the first edition was hidden in a box on the loading dock, waiting to be "shipped". Case closed! 🗂️',
};

const FRAUD_SETUP = `
CREATE TABLE logins (customer_id integer, ts timestamp, ip text);
INSERT INTO logins VALUES
  (1, '2025-01-02 10:00', '198.51.100.4'), (2, '2025-01-20 09:00', '192.0.2.10'),
  (13, '2025-01-17 22:00', '203.0.113.7'), (2, '2025-01-22 23:30', '203.0.113.7'),
  (7, '2025-01-08 08:00', '198.51.100.9'), (11, '2025-01-14 12:00', '192.0.2.44'),
  (2, '2025-01-23 00:10', '203.0.113.7'), (13, '2025-01-23 00:20', '203.0.113.7'),
  (5, '2024-11-10 18:00', '198.51.100.20'), (10, '2024-12-19 20:00', '192.0.2.77');
INSERT INTO orders VALUES (40, 2, '2025-01-23', 'pending');
INSERT INTO order_items VALUES (40, 9, 4, 24.99), (40, 23, 3, 22.00);`;

export const FINALE: MysteryCase = {
  id: 'finale',
  title: 'The Final Case: Account Takeover',
  intro: `On **23 January 2025** a strange **pending order (#40)** appeared: €165.96 of expensive books on **Bob Smith's** account. Bob swears it wasn't him.

There's a new table, \`logins(customer_id, ts, ip)\`. Use **everything** you've learned to find out who's behind it.`,
  setupSql: FRAUD_SETUP,
  steps: [
    {
      prompt: '**Step 1 (JOIN + aggregation).** Show every **pending** order with the customer\'s **first_name** and the order **total** (sum of quantity × unit_price). Return order_id, first_name, total.',
      solution: "SELECT o.order_id, c.first_name, sum(i.quantity * i.unit_price) FROM orders o JOIN customers c ON c.customer_id = o.customer_id JOIN order_items i ON i.order_id = o.order_id WHERE o.status = 'pending' GROUP BY o.order_id, c.first_name",
      hint: 'Join orders → customers and orders → order_items, filter pending, GROUP BY order_id and first_name.',
      reveal: 'Order #40 is more than four times bigger than any other pending order. Very suspicious.',
    },
    {
      prompt: '**Step 2 (GROUP BY + HAVING).** Which **IP addresses** were used by **more than one different customer**? Return ip and the number of distinct accounts.',
      solution: 'SELECT ip, count(DISTINCT customer_id) FROM logins GROUP BY ip HAVING count(DISTINCT customer_id) > 1',
      hint: 'count(DISTINCT customer_id) … HAVING count(DISTINCT customer_id) > 1',
      reveal: 'One IP address, 203.0.113.7, was shared by two accounts.',
    },
    {
      prompt: "**Step 3 (JOIN).** Which customers (**first_name, last_name**) logged in from **'203.0.113.7'**? Each once.",
      solution: "SELECT DISTINCT c.first_name, c.last_name FROM logins l JOIN customers c ON c.customer_id = l.customer_id WHERE l.ip = '203.0.113.7'",
      hint: 'Join logins to customers, filter the IP, use DISTINCT.',
      reveal: 'Bob Smith… and Mei Chen. Bob says he has never been to the place that IP belongs to.',
    },
    {
      prompt: "**Step 4 (window function).** List all logins from that IP **in time order**, with the **customer_id of the previous login from the same IP** (use lag). Return customer_id, ts, previous_customer.",
      solution: "SELECT customer_id, ts, lag(customer_id) OVER (ORDER BY ts) FROM logins WHERE ip = '203.0.113.7'",
      hint: "SELECT customer_id, ts, lag(customer_id) OVER (ORDER BY ts) FROM logins WHERE ip = '203.0.113.7'",
      reveal: 'Mei logged in from that IP at 22:00. Then "Bob" logged in from the same machine at 23:30 and 00:10, and Mei again at 00:20.',
    },
    {
      prompt: "**Step 5 (CASE + window).** For each login from that IP, label it **'switch'** when the customer differs from the previous login on that IP, otherwise **'same'** (the first row: 'first'). Return ts, customer_id, label.",
      solution: "SELECT ts, customer_id, CASE WHEN lag(customer_id) OVER (ORDER BY ts) IS NULL THEN 'first' WHEN lag(customer_id) OVER (ORDER BY ts) <> customer_id THEN 'switch' ELSE 'same' END FROM logins WHERE ip = '203.0.113.7'",
      hint: "CASE WHEN lag(…) OVER (ORDER BY ts) IS NULL THEN 'first' WHEN lag(…) OVER (ORDER BY ts) <> customer_id THEN 'switch' ELSE 'same' END",
      reveal: 'The same machine switched between Mei\'s and Bob\'s accounts, minutes before order #40 was placed.',
    },
  ],
  suspects: ['Bob Smith', 'Mei Chen', 'Kavya Patel', 'Alice Johnson'],
  culprit: 'Mei Chen',
  epilogue: 'Mei Chen had stolen Bob\'s password and placed the order from her own laptop. Order #40 is cancelled and Bob gets a new password. You\'ve cracked the final case. You\'re a Query Wizard now! 🧙',
};
