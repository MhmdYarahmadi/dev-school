import { inSandbox, type RunResult } from '../db/runQuery';
import { firstKeyword, splitStatements } from '../db/statements';
import type { ProjectTask } from './types';

export interface RequirementResult {
  label: string;
  ok: boolean;
}

/**
 * Runs the learner's SELECT, stores its result in a temp table `answer`, then
 * evaluates each requirement query (which must return a single boolean).
 */
export async function checkProjectTask(
  task: ProjectTask,
  sql: string,
): Promise<{ run: RunResult; requirements: RequirementResult[] } | { run: RunResult | null; error: string }> {
  const stmts = splitStatements(sql);
  if (stmts.length !== 1 || !['SELECT', 'WITH'].includes(firstKeyword(stmts[0]))) {
    return { run: null, error: 'Projects need exactly one SELECT (or WITH … SELECT) query.' };
  }
  return inSandbox(async (exec) => {
    const run = await exec(stmts[0]);
    if (!run.ok) return { run, error: 'Your query has an error. Fix it first.' };
    const mk = await exec(`CREATE TEMP TABLE answer AS ${stmts[0]}`);
    if (!mk.ok) return { run, error: `Could not inspect your result: ${mk.error.message}. Make sure every column has a unique name (use AS).` };
    const requirements: RequirementResult[] = [];
    for (const r of task.requirements) {
      const res = await exec(r.sql);
      requirements.push({ label: r.label, ok: res.ok && res.last?.rows[0]?.[0] === true });
    }
    return { run, requirements };
  });
}
