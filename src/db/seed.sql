-- pgschool sample database: a small online bookstore.
-- Deliberately includes NULLs and "orphans" (an author with no books, a book
-- with no author, a customer with no orders, a book never ordered) so that
-- lessons can teach IS NULL, LEFT JOIN, etc.

CREATE TABLE authors (
  author_id   integer PRIMARY KEY,
  name        text NOT NULL,
  country     text NOT NULL,
  birth_year  integer            -- NULL = unknown
);

CREATE TABLE books (
  book_id         integer PRIMARY KEY,
  title           text NOT NULL,
  author_id       integer REFERENCES authors(author_id),  -- NULL = anonymous
  genre           text NOT NULL,
  tags            text[] NOT NULL DEFAULT '{}',
  price           numeric(6,2) NOT NULL,
  pages           integer,                                 -- NULL = unknown
  published_year  integer NOT NULL,
  in_stock        integer NOT NULL DEFAULT 0,
  details         jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE customers (
  customer_id  integer PRIMARY KEY,
  first_name   text NOT NULL,
  last_name    text NOT NULL,
  email        text,                -- NULL = never gave one
  city         text NOT NULL,
  country      text NOT NULL,
  signup_date  date NOT NULL
);

CREATE TABLE orders (
  order_id     integer PRIMARY KEY,
  customer_id  integer NOT NULL REFERENCES customers(customer_id),
  order_date   date NOT NULL,
  status       text NOT NULL CHECK (status IN ('pending','shipped','delivered','cancelled'))
);

CREATE TABLE order_items (
  order_id    integer NOT NULL REFERENCES orders(order_id),
  book_id     integer NOT NULL REFERENCES books(book_id),
  quantity    integer NOT NULL CHECK (quantity > 0),
  unit_price  numeric(6,2) NOT NULL,
  PRIMARY KEY (order_id, book_id)
);

CREATE TABLE employees (
  employee_id  integer PRIMARY KEY,
  name         text NOT NULL,
  job_title    text NOT NULL,
  department   text NOT NULL,
  manager_id   integer REFERENCES employees(employee_id),  -- NULL = the boss
  salary       integer NOT NULL,
  hire_date    date NOT NULL
);

INSERT INTO authors VALUES
  (1,  'Jane Austen',          'United Kingdom', 1775),
  (2,  'George Orwell',        'United Kingdom', 1903),
  (3,  'Gabriel García Márquez','Colombia',      1927),
  (4,  'Haruki Murakami',      'Japan',          1949),
  (5,  'Toni Morrison',        'United States',  1931),
  (6,  'Isaac Asimov',         'United States',  1920),
  (7,  'Agatha Christie',      'United Kingdom', 1890),
  (8,  'Chimamanda Ngozi Adichie','Nigeria',     1977),
  (9,  'Ursula K. Le Guin',    'United States',  1929),
  (10, 'Yuval Noah Harari',    'Israel',         1976),
  (11, 'Elena Ferrante',       'Italy',          NULL),
  (12, 'Liu Cixin',            'China',          1963),
  (13, 'Octavia Butler',       'United States',  1947);   -- no books in the store

INSERT INTO books VALUES
  (1,  'Pride and Prejudice',          1,  'Classic',     '{romance,satire}',         9.99, 432, 1813, 12, '{"format":"paperback","awards":[]}'),
  (2,  'Emma',                         1,  'Classic',     '{romance,comedy}',         8.49, 474, 1815,  4, '{"format":"paperback","awards":[]}'),
  (3,  '1984',                         2,  'Dystopian',   '{politics,classic}',      12.50, 328, 1949, 20, '{"format":"paperback","awards":["Prometheus Hall of Fame"]}'),
  (4,  'Animal Farm',                  2,  'Dystopian',   '{politics,satire}',        7.99, 112, 1945,  0, '{"format":"paperback","awards":["Retro Hugo"]}'),
  (5,  'One Hundred Years of Solitude',3,  'Literary',    '{magic realism,family}',  15.00, 417, 1967,  7, '{"format":"hardcover","awards":[]}'),
  (6,  'Love in the Time of Cholera',  3,  'Literary',    '{romance,magic realism}', 13.25, 348, 1985,  3, '{"format":"paperback","awards":[]}'),
  (7,  'Norwegian Wood',               4,  'Literary',    '{romance,coming of age}', 14.00, 296, 1987,  9, '{"format":"paperback","awards":[]}'),
  (8,  'Kafka on the Shore',           4,  'Literary',    '{magic realism}',         16.99, 505, 2002,  5, '{"format":"hardcover","awards":["World Fantasy Award"]}'),
  (9,  '1Q84',                         4,  'Literary',    '{magic realism,romance}', 24.99, 925, 2009,  2, '{"format":"hardcover","awards":[]}'),
  (10, 'Beloved',                      5,  'Literary',    '{history,ghost}',         14.50, 324, 1987,  6, '{"format":"paperback","awards":["Pulitzer Prize"]}'),
  (11, 'Song of Solomon',              5,  'Literary',    '{family,history}',        13.00, 337, 1977,  0, '{"format":"paperback","awards":["National Book Critics Circle Award"]}'),
  (12, 'Foundation',                   6,  'Science Fiction','{space,empire}',       10.99, 255, 1951, 15, '{"format":"paperback","awards":["Hugo Award"]}'),
  (13, 'I, Robot',                     6,  'Science Fiction','{robots,short stories}', 9.50, 253, 1950, 11, '{"format":"paperback","awards":[]}'),
  (14, 'The Caves of Steel',           6,  'Science Fiction','{robots,mystery}',      8.99, 206, 1954,  0, '{"format":"paperback","awards":[]}'),
  (15, 'Murder on the Orient Express', 7,  'Mystery',     '{detective,train}',       11.25, 256, 1934, 18, '{"format":"paperback","awards":[]}'),
  (16, 'And Then There Were None',     7,  'Mystery',     '{island,thriller}',       10.75, 272, 1939, 14, '{"format":"paperback","awards":[]}'),
  (17, 'Death on the Nile',            7,  'Mystery',     '{detective,travel}',      10.50, 333, 1937,  8, '{"format":"paperback","awards":[]}'),
  (18, 'Half of a Yellow Sun',         8,  'Literary',    '{history,war}',           15.75, 433, 2006,  4, '{"format":"paperback","awards":["Orange Prize"]}'),
  (19, 'Americanah',                   8,  'Literary',    '{romance,immigration}',   16.00, 588, 2013, 10, '{"format":"hardcover","awards":["National Book Critics Circle Award"]}'),
  (20, 'A Wizard of Earthsea',         9,  'Fantasy',     '{magic,coming of age}',    9.25, 183, 1968, 13, '{"format":"paperback","awards":[]}'),
  (21, 'The Left Hand of Darkness',    9,  'Science Fiction','{gender,politics}',    12.00, 304, 1969,  6, '{"format":"paperback","awards":["Hugo Award","Nebula Award"]}'),
  (22, 'The Dispossessed',             9,  'Science Fiction','{politics,utopia}',    12.75, 387, 1974,  0, '{"format":"paperback","awards":["Hugo Award","Nebula Award"]}'),
  (23, 'Sapiens',                      10, 'Non-fiction', '{history,science}',       22.00, 443, 2011, 25, '{"format":"hardcover","awards":[]}'),
  (24, 'Homo Deus',                    10, 'Non-fiction', '{future,science}',        21.50, 450, 2015,  9, '{"format":"hardcover","awards":[]}'),
  (25, 'My Brilliant Friend',          11, 'Literary',    '{friendship,italy}',      17.00, 331, 2011,  7, '{"format":"paperback","awards":[]}'),
  (26, 'The Story of a New Name',      11, 'Literary',    '{friendship,italy}',      17.00, 471, 2012,  3, '{"format":"paperback","awards":[]}'),
  (27, 'The Three-Body Problem',       12, 'Science Fiction','{aliens,physics}',     18.99, 400, 2008, 16, '{"format":"paperback","awards":["Hugo Award"]}'),
  (28, 'The Dark Forest',              12, 'Science Fiction','{aliens,strategy}',    19.99, 512, 2008,  8, '{"format":"paperback","awards":[]}'),
  (29, 'Beowulf',                      NULL,'Classic',    '{epic,poetry}',            6.99, NULL, 1000, 5, '{"format":"paperback","awards":[]}'),
  (30, 'The Arabian Nights',           NULL,'Classic',    '{stories,fantasy}',       11.99, NULL, 1706, 0, '{"format":"hardcover","awards":[]}');  -- never ordered

INSERT INTO customers VALUES
  (1,  'Alice',   'Johnson',  'alice.j@example.com',   'London',     'United Kingdom', '2023-01-15'),
  (2,  'Bob',     'Smith',    'bob.smith@example.com', 'New York',   'United States',  '2023-02-03'),
  (3,  'Carmen',  'López',    'carmen@example.com',    'Madrid',     'Spain',          '2023-02-20'),
  (4,  'David',   'Kim',      NULL,                    'Seoul',      'South Korea',    '2023-03-11'),
  (5,  'Emma',    'Brown',    'emma.b@example.com',    'Manchester', 'United Kingdom', '2023-04-02'),
  (6,  'Farid',   'Haddad',   'farid@example.com',     'Beirut',     'Lebanon',        '2023-05-19'),
  (7,  'Grace',   'Okafor',   'grace.o@example.com',   'Lagos',      'Nigeria',        '2023-06-07'),
  (8,  'Hiro',    'Tanaka',   'hiro.t@example.com',    'Tokyo',      'Japan',          '2023-07-23'),
  (9,  'Isabel',  'Rossi',    NULL,                    'Rome',       'Italy',          '2023-08-14'),
  (10, 'James',   'Wilson',   'jwilson@example.com',   'Chicago',    'United States',  '2023-09-01'),
  (11, 'Kavya',   'Patel',    'kavya.p@example.com',   'Mumbai',     'India',          '2023-10-10'),
  (12, 'Liam',    'Murphy',   'liam.m@example.com',    'Dublin',     'Ireland',        '2023-11-25'),
  (13, 'Mei',     'Chen',     'mei.chen@example.com',  'Shanghai',   'China',          '2024-01-08'),
  (14, 'Noah',    'Smith',    'noah.s@example.com',    'London',     'United Kingdom', '2024-02-14'),
  (15, 'Olivia',  'Garcia',   'olivia.g@example.com',  'Los Angeles','United States',  '2024-03-30'),
  (16, 'Pedro',   'Silva',    NULL,                    'São Paulo',  'Brazil',         '2024-05-05'),
  (17, 'Quinn',   'Taylor',   'quinn.t@example.com',   'Toronto',    'Canada',         '2024-06-18'),
  (18, 'Rania',   'Aziz',     'rania.a@example.com',   'Cairo',      'Egypt',          '2024-08-01'),
  (19, 'Sofia',   'Novak',    'sofia.n@example.com',   'Prague',     'Czechia',        '2024-09-12'),
  (20, 'Tom',     'Baker',    'tom.baker@example.com', 'New York',   'United States',  '2024-11-20');  -- no orders yet

INSERT INTO orders VALUES
  (1,  1,  '2024-01-05', 'delivered'),
  (2,  2,  '2024-01-12', 'delivered'),
  (3,  3,  '2024-01-20', 'delivered'),
  (4,  1,  '2024-02-02', 'delivered'),
  (5,  5,  '2024-02-14', 'delivered'),
  (6,  6,  '2024-02-28', 'cancelled'),
  (7,  7,  '2024-03-03', 'delivered'),
  (8,  8,  '2024-03-15', 'delivered'),
  (9,  2,  '2024-03-22', 'delivered'),
  (10, 10, '2024-04-01', 'delivered'),
  (11, 11, '2024-04-18', 'delivered'),
  (12, 4,  '2024-05-02', 'delivered'),
  (13, 12, '2024-05-20', 'cancelled'),
  (14, 13, '2024-06-08', 'delivered'),
  (15, 1,  '2024-06-30', 'delivered'),
  (16, 14, '2024-07-04', 'delivered'),
  (17, 15, '2024-07-19', 'delivered'),
  (18, 9,  '2024-08-02', 'delivered'),
  (19, 3,  '2024-08-25', 'delivered'),
  (20, 16, '2024-09-09', 'delivered'),
  (21, 17, '2024-09-30', 'delivered'),
  (22, 2,  '2024-10-14', 'delivered'),
  (23, 18, '2024-10-31', 'delivered'),
  (24, 5,  '2024-11-11', 'delivered'),
  (25, 19, '2024-11-29', 'delivered'),
  (26, 8,  '2024-12-12', 'delivered'),
  (27, 10, '2024-12-20', 'shipped'),
  (28, 1,  '2025-01-03', 'shipped'),
  (29, 7,  '2025-01-09', 'shipped'),
  (30, 11, '2025-01-15', 'pending'),
  (31, 13, '2025-01-18', 'pending'),
  (32, 2,  '2025-01-21', 'pending');

INSERT INTO order_items VALUES
  (1, 1, 1, 9.99),   (1, 3, 1, 12.50),
  (2, 12, 2, 10.99),
  (3, 5, 1, 15.00),  (3, 6, 1, 13.25),
  (4, 15, 1, 11.25), (4, 16, 1, 10.75), (4, 17, 1, 10.50),
  (5, 2, 1, 8.49),
  (6, 23, 1, 22.00),
  (7, 18, 1, 15.75), (7, 19, 2, 16.00),
  (8, 7, 1, 14.00),  (8, 8, 1, 16.99),
  (9, 27, 1, 18.99), (9, 28, 1, 19.99),
  (10, 23, 3, 22.00),
  (11, 20, 1, 9.25), (11, 21, 1, 12.00),
  (12, 9, 1, 24.99),
  (13, 4, 2, 7.99),
  (14, 27, 1, 18.99),
  (15, 25, 1, 17.00), (15, 26, 1, 17.00),
  (16, 3, 2, 12.50), (16, 4, 1, 7.99),
  (17, 24, 1, 21.50), (17, 23, 1, 22.00),
  (18, 25, 2, 17.00),
  (19, 10, 1, 14.50), (19, 11, 1, 13.00),
  (20, 13, 1, 9.50),  (20, 14, 1, 8.99),
  (21, 22, 1, 12.75),
  (22, 29, 1, 6.99),  (22, 1, 1, 9.99),
  (23, 15, 1, 11.25),
  (24, 16, 2, 10.75),
  (25, 12, 1, 10.99), (25, 13, 1, 9.50),
  (26, 9, 1, 24.99),
  (27, 23, 1, 22.00), (27, 24, 1, 21.50),
  (28, 3, 1, 12.50),
  (29, 7, 1, 14.00),
  (30, 27, 2, 18.99),
  (31, 28, 1, 19.99),
  (32, 19, 1, 16.00), (32, 5, 1, 15.00);

INSERT INTO employees VALUES
  (1,  'Margaret Hale',  'CEO',                 'Management', NULL, 150000, '2015-03-01'),
  (2,  'Daniel Reyes',   'Head of Sales',       'Sales',      1,    98000,  '2016-06-15'),
  (3,  'Priya Sharma',   'Head of Technology',  'Technology', 1,    112000, '2017-01-09'),
  (4,  'Owen Clarke',    'Head of Operations',  'Operations', 1,    91000,  '2016-11-20'),
  (5,  'Sara Lindqvist', 'Sales Associate',     'Sales',      2,    52000,  '2019-04-01'),
  (6,  'Marcus Bell',    'Sales Associate',     'Sales',      2,    49500,  '2021-08-16'),
  (7,  'Yuki Mori',      'Software Engineer',   'Technology', 3,    88000,  '2018-02-12'),
  (8,  'Leo Fischer',    'Software Engineer',   'Technology', 3,    84000,  '2020-07-01'),
  (9,  'Ana Costa',      'Data Analyst',        'Technology', 3,    72000,  '2022-03-14'),
  (10, 'Ben Adeyemi',    'Warehouse Lead',      'Operations', 4,    56000,  '2017-09-05'),
  (11, 'Chloe Martin',   'Warehouse Associate', 'Operations', 10,   38000,  '2022-10-03'),
  (12, 'Ravi Nair',      'Warehouse Associate', 'Operations', 10,   38000,  '2023-05-22');
