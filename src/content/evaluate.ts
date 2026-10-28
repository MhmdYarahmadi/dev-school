import { checkAnswer, type CheckOutcome, type CheckSpec } from '../db/checker';
import type { ParsonsExercise, SqlCheck } from './types';

export function specFor(ex: SqlCheck | ParsonsExercise): CheckSpec {
  if ('blocks' in ex) return { solution: ex.blocks.join('\n'), orderMatters: ex.orderMatters, setupSql: ex.setupSql };
  return { solution: ex.solution, orderMatters: ex.orderMatters, checkQuery: ex.checkQuery, setupSql: ex.setupSql };
}

export function hasBlank(sql: string): boolean {
  return /___/.test(sql);
}

export async function evaluateSql(ex: SqlCheck | ParsonsExercise, sql: string): Promise<CheckOutcome> {
  if (hasBlank(sql)) return { status: 'wrong', feedback: ['Fill in every ___ blank first.'] };
  return checkAnswer(sql, specFor(ex));
}

export function parsonsSql(blocks: string[]): string {
  return blocks.join('\n');
}
