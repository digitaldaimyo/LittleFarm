import { jobCapability } from './capability';
import type { StageSpec } from '../domain/types';
import type { TrainingReport } from '../learning/report';
import type { GameState } from './types';
import { templateOf } from '../learning/skilldef';
import { BRAINS, brainOf, stateSpaceSize } from '../learning/senses';
import { OBJECT_BY_ID } from '../domain/packs/farm';

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
  const uses = (p: (typeof duty)[number], card: string) => p.assignment.mode !== 'manual' && (!p.plan || JSON.stringify(p.plan.rows).includes(`"${card}"`));
  const hauler = duty.some((p) => (!!jobCapability(p, 'haul') && uses(p, 'job.haul')) || (!!jobCapability(p, 'basketRun') && uses(p, 'job.basketRun')));
  if (full && !hauler) tips.push({ id: 'storage-full', text: 'The basket is full and nobody is hauling it, so new crops are left beside it. A pet with a certified Fetch on Auto carries storage to the house, where it sells (a Basket run routine empties it six at a time).', lesson: 'results' });
  // Empty soil the farm can afford to plant, and nobody on duty plants.
  const soil = f.world.objects.filter((o) => o.kind === 'soil' && !o.carried && !o.delivered);
  const affordable = soil.some((o) => s.resources.coins >= (OBJECT_BY_ID[o.crop ?? 'carrot']?.crop?.seed ?? 0));
  const planter = duty.some((p) => !!jobCapability(p, 'plant') && uses(p, 'job.plant'));
  const canPlant = duty.some((p) => !!jobCapability(p, 'plant'));
  if (soil.length && affordable && duty.length && !planter) tips.push({ id: 'idle-soil', text: `${soil.length === 1 ? 'A field plot is' : `${soil.length} field plots are`} empty. Field crops need replanting after each harvest — ${canPlant ? 'put a pet that knows Plant on Auto (with a responsibility that uses Plant).' : 'teach a pet the Plant routine (Train), then put it on Auto.'}` });
  // Pets on duty, and none of them can harvest: the farm earns nothing.
  if (duty.length && !duty.some((p) => !!jobCapability(p, 'harvest'))) tips.push({ id: 'no-harvester', text: `${duty.length === 1 ? `${duty[0].name} is` : 'The pets on duty are'} on the farm, but nobody can harvest yet — a pet only does what it has learned. Teach Harvest (Guide: “Teach a job: Harvest”).`, lesson: 'harvest' });
  return tips;
}

export function visibleTips(s: GameState, tips: Tip[]): Tip[] {
  return tips.filter((t) => !s.progress.flags[`tip:${t.id}`]);
}
