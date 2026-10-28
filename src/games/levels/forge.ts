/* Formula Forge (Module 4): write the expression that turns inputs into outputs. */

export const FORGE_SETUP = `
CREATE TABLE forge (id integer, first_name text, last_name text, nick text, raw text, score integer, price numeric(8,2), day date);
INSERT INTO forge VALUES
  (1, 'ada', 'LOVELACE', NULL, '  Hello World ', 95, 12.50, '2024-03-14'),
  (2, 'grace', 'hopper', 'Amazing Grace', ' SQL  ', 78, 9.99, '2024-07-04'),
  (3, 'alan', 'TURING', NULL, 'DATA ', 52, 20.00, '2024-12-25'),
  (4, 'edsger', 'dijkstra', 'Ed', ' go to ', 31, 0.99, '2024-01-01'),
  (5, 'barbara', 'LISKOV', NULL, 'Substitution', 88, 105.00, '2024-10-31');`;

export interface ForgeLevel {
  title: string;
  /** Columns shown as input. */
  inputs: string[];
  target: string;
  hint: string;
}

export const FORGE_LEVELS: ForgeLevel[] = [
  { title: 'Shout it', inputs: ['first_name'], target: 'upper(first_name)', hint: 'upper(…)' },
  { title: 'Proper names', inputs: ['last_name'], target: 'initcap(last_name)', hint: 'initcap(…) capitalises each word.' },
  { title: 'Initial + surname', inputs: ['first_name', 'last_name'], target: "upper(left(first_name, 1)) || '. ' || initcap(last_name)", hint: "upper(left(first_name, 1)) || '. ' || initcap(…)" },
  { title: 'Nickname or name', inputs: ['nick', 'first_name'], target: 'coalesce(nick, initcap(first_name))', hint: 'coalesce(nick, …) and the fallback is capitalised.' },
  { title: 'Grade the score', inputs: ['score'], target: "CASE WHEN score >= 90 THEN 'A' WHEN score >= 75 THEN 'B' WHEN score >= 50 THEN 'C' ELSE 'F' END", hint: "CASE WHEN score >= 90 THEN 'A' WHEN … (A ≥ 90, B ≥ 75, C ≥ 50, else F)" },
  { title: 'Add VAT', inputs: ['price'], target: 'round(price * 1.21, 2)', hint: 'Multiply by 1.21 and round to 2 decimals.' },
  { title: 'Clean the mess', inputs: ['raw'], target: 'lower(trim(raw))', hint: 'trim() the spaces, lower() the case.' },
  { title: 'Pretty dates', inputs: ['day'], target: "to_char(day, 'DD Mon YYYY')", hint: "to_char(day, 'DD Mon YYYY')" },
  { title: 'Countdown to 2025', inputs: ['day'], target: "date '2025-01-01' - day", hint: "Subtracting dates gives days: date '2025-01-01' - day" },
];

export function forgeQuery(expr: string): string {
  return `SELECT ${expr} FROM forge ORDER BY id`;
}
