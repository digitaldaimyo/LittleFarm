/**
 * Executive practice and comparison as a sequence of small steps (polish phase 2). The Farm screen runs them in a
 * worker, so the page stays responsive, with progress and a cancel button; without workers, inline with a pause
 * between steps. The result is exactly what `practiseExecutive` + `compareExecutives` give.
 */
import type { GameState } from './types';
import type { ExecValues } from './plan';
import { execValues } from './plan';
import { petById } from './pets';
import { EXEC_EVAL_SEEDS, EXEC_MODES, compareExecutiveRun, comparisonRow, practiseExecutiveDay, type ExecComparisonRow, type ExecRun } from './farm';

export interface ExecPracticeJob { state: GameState; petId: string; days: number }
export interface ExecPracticeResult { values: ExecValues; rows: ExecComparisonRow[] }
export interface ExecPracticeProgress { done: number; total: number; label: string }

export type ToExecWorker = { type: 'start'; job: ExecPracticeJob } | { type: 'cancel' };
export type FromExecWorker =
  | { type: 'progress'; progress: ExecPracticeProgress }
  | { type: 'done'; result: ExecPracticeResult }
  | { type: 'cancelled' }
  | { type: 'error'; error: string };

/** Only what practice needs: this pet (its skills and responsibilities) and the farm. Smaller to send to a worker. */
export function practiceState(s: GameState, petId: string): GameState {
  return { ...s, pets: s.pets.filter((p) => p.id === petId) };
}

/** The steps: practice days first (in order — each builds on the last), then one step per way of choosing × farm. */
export function* execPracticeSteps(job: ExecPracticeJob): Generator<ExecPracticeProgress, ExecPracticeResult> {
  const s = job.state;
  const pet = petById(s, job.petId);
  if (!pet) throw new Error('That pet is not here any more.');
  const seedBase = execValues(pet).practised;
  const total = job.days + EXEC_MODES.length * EXEC_EVAL_SEEDS.length;
  let done = 0;
  for (let d = 0; d < job.days; d++) {
    yield { done, total, label: `Practising day ${d + 1} of ${job.days}` };
    practiseExecutiveDay(s, job.petId, d, seedBase);
    done++;
  }
  const rows: ExecComparisonRow[] = [];
  for (const mode of EXEC_MODES) {
    const runs: ExecRun[] = [];
    for (const seed of EXEC_EVAL_SEEDS) {
      yield { done, total, label: 'Comparing on farms it hasn’t practised on' };
      runs.push(compareExecutiveRun(s, job.petId, mode, seed));
      done++;
    }
    rows.push(comparisonRow(mode, runs));
  }
  yield { done, total, label: 'Done' };
  return { values: structuredClone(execValues(petById(s, job.petId)!)), rows };
}

/** Run the steps to the end, pausing between them (`pause` yields to the page or to the worker's message queue). */
export async function runExecPractice(job: ExecPracticeJob, post: (m: FromExecWorker) => void, cancelled: () => boolean, pause: () => Promise<void>): Promise<void> {
  try {
    const it = execPracticeSteps(job);
    for (;;) {
      const r = it.next();
      if (r.done) { post({ type: 'done', result: r.value }); return; }
      post({ type: 'progress', progress: r.value });
      await pause();
      if (cancelled()) { post({ type: 'cancelled' }); return; }
    }
  } catch (e) {
    post({ type: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}
