/**
 * Behaviour checks for table-design exercises (and the Gatekeeper game).
 *
 * Instead of comparing CREATE TABLE text (many valid spellings), we throw a
 * list of statements at the learner's table and record which ones Postgres
 * accepted or rejected. Two designs that behave the same are equally correct.
 */

const TRY_ALL = `CREATE OR REPLACE FUNCTION pg_temp.try_all(qs text[]) RETURNS TABLE(n int, outcome text)
LANGUAGE plpgsql AS $fn$
DECLARE i int;
BEGIN
  FOR i IN 1 .. coalesce(array_length(qs, 1), 0) LOOP
    n := i;
    BEGIN
      EXECUTE qs[i];
      outcome := 'accepted';
    EXCEPTION WHEN others THEN
      outcome := 'rejected: ' || SQLSTATE;
    END;
    RETURN NEXT;
  END LOOP;
END
$fn$;`;

function dollar(s: string): string {
  if (s.includes('$q$')) throw new Error('statement must not contain $q$');
  return `$q$${s}$q$`;
}

/**
 * A checkQuery that runs `statements` one by one and returns (n, outcome).
 * `rejected: <SQLSTATE>` records *why* (23505 unique, 23502 not-null,
 * 23503 foreign key, 23514 check), so the right constraint must fire.
 * Optional `finalQuery` (one text column, aliased `outcome`) is appended as row 0.
 */
export function behaviourCheck(statements: string[], finalQuery?: string): string {
  const tries = `SELECT n, outcome FROM pg_temp.try_all(ARRAY[${statements.map(dollar).join(', ')}]::text[])`;
  const tail = finalQuery ? `\nUNION ALL SELECT 0, (${finalQuery})::text` : '';
  return `${TRY_ALL}\n${tries}${tail};`;
}

/** Runs statements and reports each outcome. Used by the Gatekeeper game. */
export function tryAllQuery(statements: string[]): string {
  return `${TRY_ALL}\nSELECT n, outcome FROM pg_temp.try_all(ARRAY[${statements.map(dollar).join(', ')}]::text[]);`;
}
