/* Gatekeeper (Module 9): design a table whose constraints admit good rows and block bad ones. */

export interface GateRow {
  sql: string;
  good: boolean;
  label: string;
}

export interface GateWave {
  table: string;
  brief: string;
  starter: string;
  setupSql?: string;
  rows: GateRow[];
  reference: string;
  hint: string;
}

export const GATE_WAVES: GateWave[] = [
  {
    table: 'visitors',
    brief: '**visitors**(name text, age integer). Every visitor needs a **name**, and must be **18 or older**.',
    starter: 'CREATE TABLE visitors (\n  name text,\n  age  integer\n);',
    rows: [
      { sql: "INSERT INTO visitors VALUES ('Ana', 30)", good: true, label: "Ana, 30" },
      { sql: "INSERT INTO visitors VALUES (NULL, 25)", good: false, label: 'nameless, 25' },
      { sql: "INSERT INTO visitors VALUES ('Cy', 17)", good: false, label: 'Cy, 17' },
      { sql: "INSERT INTO visitors VALUES ('Bo', 18)", good: true, label: 'Bo, 18' },
      { sql: "INSERT INTO visitors VALUES ('Di', NULL)", good: false, label: 'Di, age unknown' },
    ],
    reference: 'CREATE TABLE visitors (name text NOT NULL, age integer NOT NULL CHECK (age >= 18));',
    hint: 'NOT NULL on both columns, plus CHECK (age >= 18). An unknown age can\'t prove the visitor is 18!',
  },
  {
    table: 'members',
    brief: '**members**(member_id integer, email text). member_id is the **primary key**. Every member needs an **email**, and **no two members may share one**.',
    starter: 'CREATE TABLE members (\n  member_id integer,\n  email     text\n);',
    rows: [
      { sql: "INSERT INTO members VALUES (1, 'a@x.com')", good: true, label: '#1 a@x.com' },
      { sql: "INSERT INTO members VALUES (2, 'a@x.com')", good: false, label: '#2 a@x.com (dup email)' },
      { sql: "INSERT INTO members VALUES (1, 'b@x.com')", good: false, label: '#1 again (dup id)' },
      { sql: "INSERT INTO members VALUES (3, NULL)", good: false, label: '#3 no email' },
      { sql: "INSERT INTO members VALUES (NULL, 'c@x.com')", good: false, label: 'no id' },
      { sql: "INSERT INTO members VALUES (4, 'd@x.com')", good: true, label: '#4 d@x.com' },
    ],
    reference: 'CREATE TABLE members (member_id integer PRIMARY KEY, email text NOT NULL UNIQUE);',
    hint: 'PRIMARY KEY on member_id; NOT NULL UNIQUE on email.',
  },
  {
    table: 'tickets',
    brief: "**tickets**(ticket_id integer, seat integer, class text, price numeric(8,2)). ticket_id is the primary key. **seat from 1 to 200**. class is **'economy' or 'business'**, and **defaults to 'economy'** when not given. **price must be positive** and is required.",
    starter: 'CREATE TABLE tickets (\n  ticket_id integer,\n  seat      integer,\n  class     text,\n  price     numeric(8,2)\n);',
    rows: [
      { sql: "INSERT INTO tickets (ticket_id, seat, price) VALUES (1, 12, 99.00)", good: true, label: 'seat 12, default class' },
      { sql: "INSERT INTO tickets VALUES (2, 0, 'economy', 50)", good: false, label: 'seat 0' },
      { sql: "INSERT INTO tickets VALUES (3, 201, 'economy', 50)", good: false, label: 'seat 201' },
      { sql: "INSERT INTO tickets VALUES (4, 5, 'first', 900)", good: false, label: "class 'first'" },
      { sql: "INSERT INTO tickets VALUES (5, 5, 'business', 0)", good: false, label: 'price 0' },
      { sql: "INSERT INTO tickets VALUES (6, 200, 'business', 450)", good: true, label: 'seat 200 business' },
      { sql: "INSERT INTO tickets (ticket_id, seat, class) VALUES (7, 3, 'economy')", good: false, label: 'no price' },
      { sql: "UPDATE tickets SET class = 'luxury' WHERE ticket_id = 1", good: false, label: "update to 'luxury'" },
    ],
    reference: "CREATE TABLE tickets (ticket_id integer PRIMARY KEY, seat integer CHECK (seat BETWEEN 1 AND 200), class text NOT NULL DEFAULT 'economy' CHECK (class IN ('economy', 'business')), price numeric(8,2) NOT NULL CHECK (price > 0));",
    hint: "CHECK (seat BETWEEN 1 AND 200), DEFAULT 'economy' CHECK (class IN (…)), NOT NULL CHECK (price > 0)",
  },
  {
    table: 'bookings',
    brief: '**bookings**(booking_id integer, member_id integer, day date). booking_id is the primary key. member_id must be a **real member** (the members table exists). A member can book **at most once per day**. Deleting a member **deletes their bookings**.',
    starter: 'CREATE TABLE bookings (\n  booking_id integer,\n  member_id  integer,\n  day        date\n);',
    setupSql: "CREATE TABLE members (member_id integer PRIMARY KEY, email text NOT NULL UNIQUE); INSERT INTO members VALUES (1, 'a@x.com'), (2, 'b@x.com');",
    rows: [
      { sql: "INSERT INTO bookings VALUES (1, 1, '2025-03-01')", good: true, label: 'member 1, Mar 1' },
      { sql: "INSERT INTO bookings VALUES (2, 1, '2025-03-01')", good: false, label: 'member 1, Mar 1 again' },
      { sql: "INSERT INTO bookings VALUES (3, 1, '2025-03-02')", good: true, label: 'member 1, Mar 2' },
      { sql: "INSERT INTO bookings VALUES (4, 9, '2025-03-01')", good: false, label: 'member 9 (unknown)' },
      { sql: "INSERT INTO bookings VALUES (5, 2, '2025-03-01')", good: true, label: 'member 2, Mar 1' },
      { sql: 'DELETE FROM members WHERE member_id = 2', good: true, label: 'delete member 2' },
    ],
    reference: 'CREATE TABLE bookings (booking_id integer PRIMARY KEY, member_id integer REFERENCES members (member_id) ON DELETE CASCADE, day date, UNIQUE (member_id, day));',
    hint: 'REFERENCES members (member_id) ON DELETE CASCADE, and a table-level UNIQUE (member_id, day).',
  },
];
