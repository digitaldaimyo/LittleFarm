import type { StageSpec } from '../domain/types';
import type { TrainingReport } from '../learning/report';
import type { GameState } from './types';
import { templateOf } from '../learning/skilldef';
import { stateSpaceSize } from '../learning/senses';

/**
 * Coaching tips: short, evidence-triggered hints that link to the Field Guide lesson explaining them.
 * Each can be dismissed for good ("tip:<id>" flag). Heuristics — suggestions, never errors.
 */
export interface Tip {
  id: string;
  text: string;
  /** Field Guide lesson that explains it. */
  lesson?: string;
}

export function reportTips(stage: StageSpec, r: TrainingReport, episodes: number): Tip[] {
  const out: Tip[] = [];
  const bar = stage.evaluation.minimumSuccessRate;
  if (r.scattered && r.scattered.successRate < r.after.successRate - 0.15) {
    out.push({ id: 'pinned', lesson: 'scatter', text: 'Pinned things teach one layout. Scatter the target and the start, and your pet learns a skill instead of a route.' });
  }
  if (r.exploits.length) {
    out.push({ id: 'loophole', lesson: 'results', text: 'Treats came from repeating something, not finishing the job. Pay for the result — or add a limit like “once per object”.' });
  } else if (r.after.successRate <= r.random.successRate + 0.05 && r.after.meanReward > 0) {
    out.push({ id: 'below-random', lesson: 'results', text: 'It earns treats but isn’t beating random wandering at the task. Check that the treats and the SUCCESS condition describe the same job.' });
  }
  // Too-little-practice only explains a weak score when nothing else does (no loophole, no pinning).
  if (r.after.successRate < bar && episodes < 700 && !r.exploits.length && !out.some((t) => t.id === 'pinned')) {
    out.push({ id: 'practice', lesson: 'practice', text: `That may just be too little practice (${episodes} tries). Most lessons look broken below ~700 tries — try more, or press Refine.` });
  }
  if (r.after.successRate >= 0.5 && r.transfer.successRate < r.after.successRate - 0.25) {
    out.push({ id: 'transfer', lesson: 'where', text: 'It struggles in bigger, busier pens. Add a little variety to the practice pen — more obstacles, the things the real job will meet.' });
  }
  if (templateOf(stage) === 'sense' && stage.learner.senses && stateSpaceSize(stage.learner.senses) > 50000) {
    out.push({ id: 'situations', lesson: 'invent', text: 'So many senses means a huge number of situations to practise. Try dropping a sense the job doesn’t need.' });
  }
  if (r.randomOptions && r.after.successRate < r.randomOptions.successRate + 0.1) {
    out.push({ id: 'routine-choice', text: 'The routine isn’t choosing much better than picking its options at random yet. Give it something useful to watch, or more practice.' });
  }
  return out;
}

/** Farm-level tip: two pets doing the same job share one supply. */
export function farmTips(s: GameState): Tip[] {
  const f = s.farm;
  if (!f.duty2PetId || !f.dutyPetId) return [];
  const a = s.pets.find((p) => p.id === f.dutyPetId), b = s.pets.find((p) => p.id === f.duty2PetId);
  if (!a || !b) return [];
  const same = (a.assignment.mode === 'job' && b.assignment.mode === 'job' && a.assignment.job === b.assignment.job)
    || (f.current && f.current2 && f.current.behaviorId === f.current2.behaviorId && f.current.behaviorId !== 'rest' && f.current.behaviorId !== 'wander' && a.assignment.mode !== 'auto');
  return same ? [{ id: 'two-pets-same-job', text: `${a.name} and ${b.name} are doing the same job, so they share one supply. Different jobs earn far more (one forager + one deliverer earned 387 coins vs 183 for two foragers).` }] : [];
}

export function visibleTips(s: GameState, tips: Tip[]): Tip[] {
  return tips.filter((t) => !s.progress.flags[`tip:${t.id}`]);
}
