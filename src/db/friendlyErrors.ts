import type { PgError } from './runQuery';

/** Turns a Postgres error into a short, beginner-friendly explanation. */
export function explainError(err: PgError): string {
  const m = err.message;
  let match: RegExpExecArray | null;

  if ((match = /column "([^"]+)" does not exist/.exec(m))) {
    const name = match[1];
    if (/^[A-Z]|[A-Z]/.test(name) && name !== name.toLowerCase())
      return `Postgres can't find a column called "${name}". Unquoted names are lower-cased, but double-quoted ones keep their case. Did you mean ${name.toLowerCase()}?`;
    return `There's no column called "${name}" in the tables you're querying. Check the spelling in the schema panel. If you meant the text '${name}', use single quotes: double quotes are for names, single quotes are for text.`;
  }
  if ((match = /relation "([^"]+)" does not exist/.exec(m)))
    return `There's no table called "${match[1]}". Check the spelling. The tables in this database are listed in the schema panel.`;
  if (/aggregate functions are not allowed in WHERE/.test(m))
    return 'WHERE filters individual rows *before* any grouping happens, so it can\'t use COUNT/SUM/AVG… To filter on an aggregate, put the condition in HAVING (after GROUP BY).';
  if ((match = /column "([^"]+)" must appear in the GROUP BY clause/.exec(m)))
    return `Once you GROUP BY, every column in SELECT must either be in the GROUP BY or wrapped in an aggregate like COUNT(), MAX() or SUM(). Postgres doesn't know which "${match[1]}" to show for each group.`;
  if (/syntax error at or near/.test(m)) {
    const near = /near "([^"]*)"/.exec(m)?.[1];
    if (near === undefined || near === '') return 'The query ended unexpectedly. Is something missing at the end, like a closing parenthesis or a value?';
    return `Postgres got confused near "${near}". Common causes: a missing comma between columns, a trailing comma before FROM, a keyword in the wrong order (the order is SELECT → FROM → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT), or a missing quote.`;
  }
  if ((match = /column reference "([^"]+)" is ambiguous/.exec(m)))
    return `More than one joined table has a column called "${match[1]}". Prefix it with the table name or alias, like books.${match[1]}.`;
  if ((match = /missing FROM-clause entry for table "([^"]+)"/.exec(m)))
    return `You used "${match[1]}." but there's no table or alias called ${match[1]} in FROM/JOIN. Add it to FROM or a JOIN, or fix the alias.`;
  if (/invalid input syntax for type (integer|numeric|date)/.test(m))
    return 'A value is in the wrong format for its column type. Dates look like \'2024-01-31\', and numbers have no quotes or letters.';
  if (/operator does not exist/.test(m))
    return 'You\'re comparing or combining two values of different types (for example text = integer). Check the column types, or cast one side with ::type.';
  if (/violates not-null constraint/.test(m))
    return 'That column is NOT NULL, so every row needs a value for it. Did you leave it out of your INSERT column list?';
  if (/violates unique constraint|duplicate key value/.test(m))
    return 'A row with that key already exists. Primary keys and UNIQUE columns can\'t repeat. Use a different value, or use INSERT … ON CONFLICT to update the existing row instead.';
  if (/violates foreign key constraint/.test(m))
    return 'This row points to something that doesn\'t exist (or something else still points to it). Foreign keys keep references valid.';
  if (/violates check constraint/.test(m))
    return 'The value breaks a CHECK rule on the table, for example a negative quantity or an unknown status.';
  if (/division by zero/.test(m)) return 'You divided by zero. NULLIF(x, 0) turns a zero into NULL, and dividing by NULL gives NULL instead of an error.';
  if (/subquery used as an expression|more than one row returned by a subquery/.test(m))
    return 'A subquery used as a single value returned more than one row. Use IN (…) instead of =, or make the subquery return one row.';
  if (/function (\w+)\(.*\) does not exist/.test(m))
    return 'Postgres has no function with that name for those argument types. Check the spelling, and whether the argument types need a cast (for example ::text).';
  if (/each (UNION|INTERSECT|EXCEPT) query must have the same number of columns/.test(m))
    return 'Both sides of UNION/INTERSECT/EXCEPT must return the same number of columns.';
  if (/cannot be matched|cannot insert multiple commands into a prepared statement/.test(m)) return m;
  return err.hint ?? '';
}
