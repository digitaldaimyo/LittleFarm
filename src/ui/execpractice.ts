/**
 * Runs executive practice off the page's thread (polish phase 2). Practice and comparison take a second or more in a
 * browser; in a worker the farm keeps animating and buttons keep working. Falls back to running inline, a farm day
 * at a time, where workers aren't available.
 */
import { practiceState, runExecPractice, type FromExecWorker } from '../game/execpractice';
import type { GameState } from '../game/types';

export interface ExecPracticeHandle { cancel(): void }

export function startExecPractice(state: GameState, petId: string, days: number, onMessage: (m: FromExecWorker) => void): ExecPracticeHandle {
  const job = { state: practiceState(state, petId), petId, days };
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('../game/exec.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (worker) {
    const w = worker;
    let finished = false;
    w.onmessage = (e: MessageEvent<FromExecWorker>) => {
      if (finished) return;
      if (e.data.type !== 'progress') { finished = true; w.terminate(); }
      onMessage(e.data);
    };
    w.onerror = (e) => { if (finished) return; finished = true; w.terminate(); onMessage({ type: 'error', error: e.message || 'Practice stopped unexpectedly.' }); };
    w.postMessage({ type: 'start', job });
    return { cancel: () => { if (finished) return; finished = true; w.terminate(); onMessage({ type: 'cancelled' }); } };
  }
  let stop = false;
  void runExecPractice(structuredClone(job), onMessage, () => stop, () => new Promise((r) => setTimeout(r, 0)));
  return { cancel: () => { stop = true; } };
}
