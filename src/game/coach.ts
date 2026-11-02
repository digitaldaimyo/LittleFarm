import type { StageSpec } from '../domain/types';
import type { TrainingReport } from '../learning/report';
import type { GameState } from './types';
import { templateOf } from '../learning/skilldef';
import { BRAINS, brainOf, stateSpaceSize } from '../learning/senses';
import { OBJECT_BY_ID } from '../domain/packs/farm';
import { activeRevision, getSkill } from './pets';

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
  if (templateOf(stage) === 'sense' && stage.learner.senses && stateSpaceSize(stage.learner.senses) > BRAINS[brainOf(stage.learner)].warn) {
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
  const tips: Tip[] = [];
  const duty = [f.dutyPetId, ...(f.helpers ?? []).map((h) => h.petId)].map((id) => s.pets.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  // Farm life: storage is full and nobody on duty can (or is set to) haul it to the house.
  const full = f.world.objects.some((o) => { const st = OBJECT_BY_ID[o.kind]?.storage; return !!o.store && !!st && o.store.reduce((a, x) => a + x.n, 0) >= st.slots * st.perSlot; });
  const hauler = duty.some((p) => !!activeRevision(getSkill(p, 'Fetch')) && (p.assignment.mode !== 'job' || p.assignment.job === 'deliver'));
  if (full && !hauler) tips.push({ id: 'storage-full', text: 'The basket is full and nobody is hauling it, so new crops are left beside it. A pet with Fetch on Auto (or on Haul) carries storage to the house, where it sells.', lesson: 'results' });
  // Empty soil the farm can afford to plant, and nobody on duty plants.
  const soil = f.world.objects.filter((o) => o.kind === 'soil' && !o.carried && !o.delivered);
  const affordable = soil.some((o) => s.resources.coins >= (OBJECT_BY_ID[o.crop ?? 'carrot']?.crop?.seed ?? 0));
  const planter = duty.some((p) => p.assignment.mode === 'auto' || (p.assignment.mode === 'job' && p.assignment.job === 'plant')
    || (p.assignment.mode === 'plan' && !!p.plan?.rows.some((r) => (r.args.do as { cardId?: string } | undefined)?.cardId === 'job.plant')));
  if (soil.length && affordable && duty.length && !planter) tips.push({ id: 'idle-soil', text: `${soil.length === 1 ? 'A field plot is' : `${soil.length} field plots are`} empty. Field crops need replanting after each harvest — put a pet on Auto or Plant (or add a Plant row to your farm plan).` });
  // Every pet on duty hauling (nobody harvests, so there's soon nothing to haul), or all napping.
  const job = duty[0]?.assignment.mode === 'job' ? duty[0].assignment.job : null;
  if (duty.length >= 2 && (job === 'deliver' || job === 'rest') && duty.every((p) => p.assignment.mode === 'job' && p.assignment.job === job)) {
    const names = duty.length === 2 ? `${duty[0].name} and ${duty[1].name} are both` : `All ${duty.length} pets on duty are`;
    tips.push({ id: 'two-pets-same-job', text: `${names} ${job === 'deliver' ? 'hauling, but nobody is harvesting — soon there’s nothing to haul' : 'napping'}. Give one of them Harvest (or Auto).` });
  }
  return tips;
}

export function visibleTips(s: GameState, tips: Tip[]): Tip[] {
  return tips.filter((t) => !s.progress.flags[`tip:${t.id}`]);
}
