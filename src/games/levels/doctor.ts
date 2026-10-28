/* Data Doctor (Module 8): heal a corrupted copy of the books table. */

export const DOCTOR_SETUP = `
CREATE TABLE shop AS SELECT book_id, title, genre, price, in_stock FROM books;
UPDATE shop SET genre = 'Sci-Fi' WHERE book_id IN (12, 13);
UPDATE shop SET genre = 'mystery' WHERE book_id = 16;
UPDATE shop SET in_stock = -3 WHERE book_id = 7;
UPDATE shop SET price = 0 WHERE book_id = 24;
UPDATE shop SET title = 'Pride and Prejudise' WHERE book_id = 1;
INSERT INTO shop SELECT book_id, title, genre, price, in_stock FROM books WHERE book_id = 3;
DELETE FROM shop WHERE book_id = 30;`;

export interface Symptom {
  label: string;
  /** Returns true when healed. */
  healthy: string;
  hint: string;
}

export const SYMPTOMS: Symptom[] = [
  { label: "Two books have the genre **'Sci-Fi'**. The store's genre name is **'Science Fiction'**.", healthy: "SELECT NOT EXISTS (SELECT 1 FROM shop WHERE genre = 'Sci-Fi') AND (SELECT count(*) FROM shop WHERE book_id IN (12, 13) AND genre = 'Science Fiction') = 2", hint: "UPDATE shop SET genre = 'Science Fiction' WHERE genre = 'Sci-Fi';" },
  { label: "Book 16 has the genre **'mystery'** (lower case). It should be **'Mystery'**.", healthy: "SELECT (SELECT genre FROM shop WHERE book_id = 16) = 'Mystery'", hint: "UPDATE shop SET genre = 'Mystery' WHERE book_id = 16;" },
  { label: 'Book 7 has **−3 copies** in stock. Negative stock is impossible, so set it to **0**.', healthy: 'SELECT (SELECT in_stock FROM shop WHERE book_id = 7) = 0 AND NOT EXISTS (SELECT 1 FROM shop WHERE in_stock < 0)', hint: 'UPDATE shop SET in_stock = 0 WHERE in_stock < 0;' },
  { label: '**Homo Deus** (book 24) costs **€0**. Its real price is **€21.50**.', healthy: 'SELECT (SELECT price FROM shop WHERE book_id = 24) = 21.50', hint: 'UPDATE shop SET price = 21.50 WHERE book_id = 24;' },
  { label: "Book 1's title is misspelled: **'Pride and Prejudise'**.", healthy: "SELECT (SELECT title FROM shop WHERE book_id = 1) = 'Pride and Prejudice'", hint: "UPDATE shop SET title = 'Pride and Prejudice' WHERE book_id = 1;" },
  { label: '**Book 3 appears twice.** Exactly one copy must remain (careful: the rows are identical!).', healthy: 'SELECT (SELECT count(*) FROM shop WHERE book_id = 3) = 1', hint: 'Delete one row using its hidden ctid: DELETE FROM shop WHERE ctid = (SELECT max(ctid) FROM shop WHERE book_id = 3); or delete both and INSERT one back.' },
  { label: "**Book 30 is missing**: 'The Arabian Nights', genre 'Classic', price 11.99, 0 in stock.", healthy: "SELECT EXISTS (SELECT 1 FROM shop WHERE book_id = 30 AND title = 'The Arabian Nights' AND genre = 'Classic' AND price = 11.99 AND in_stock = 0)", hint: "INSERT INTO shop VALUES (30, 'The Arabian Nights', 'Classic', 11.99, 0);" },
];

/** Rows that should never have been touched, compared with the original books table. */
export const COLLATERAL = `
SELECT count(*) FROM books b
WHERE b.book_id NOT IN (1, 3, 7, 12, 13, 16, 24, 30)
  AND NOT EXISTS (
    SELECT 1 FROM shop s
    WHERE s.book_id = b.book_id AND s.title = b.title AND s.genre = b.genre
      AND s.price = b.price AND s.in_stock = b.in_stock
  )`;

export const DOCTOR_REFERENCE_CURE = `
UPDATE shop SET genre = 'Science Fiction' WHERE genre = 'Sci-Fi';
UPDATE shop SET genre = 'Mystery' WHERE book_id = 16;
UPDATE shop SET in_stock = 0 WHERE in_stock < 0;
UPDATE shop SET price = 21.50 WHERE book_id = 24;
UPDATE shop SET title = 'Pride and Prejudice' WHERE book_id = 1;
DELETE FROM shop WHERE ctid = (SELECT max(ctid) FROM shop WHERE book_id = 3);
INSERT INTO shop VALUES (30, 'The Arabian Nights', 'Classic', 11.99, 0);`;
