import { recipeStage } from '../src/domain/recipes';
import type { StageSpec } from '../src/domain/types';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import type { SerializedQ } from '../src/learning/qtable';
import { saveRevision, subskillsFor } from '../src/game/pets';
import * as pets from '../src/game/pets';
import type { GameState, JobId, NavigatorName, Pet } from '../src/game/types';
import { jobPlan } from '../src/game/plan';

export function trainAndSave(s: GameState, pet: Pet, stage: StageSpec, navigator?: SerializedQ) {
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: pet.traits, navigator });
  while (!t.done) t.runChunk(250, false);
  const policy = t.policy();
  const report = buildReport(stage, pet.traits, null, policy, navigator ?? null);
  pet.stats.trainingRuns++;
  return saveRevision(s, pet, { stage, policy, report, episodes: t.episode, durationMs: 1, simTicks: t.simTicks });
}

/** Train and save a routine over the pet's current skills (routines need their sub-skills). */
export function trainAndSaveRoutine(s: GameState, pet: Pet, stage: StageSpec) {
  const subs = subskillsFor(pet);
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: pet.traits, subskills: subs });
  while (!t.done) t.runChunk(1000, false);
  const report = buildReport(stage, pet.traits, null, t.policy(), null, undefined, subs);
  const uses = Object.values(subs).filter((x) => stage.learner.routine!.options.some((o) => o.args.skill === x.name)).map((x) => ({ skill: x.name, rev: x.rev }));
  return saveRevision(s, pet, { stage, policy: t.policy(), report, episodes: stage.learner.episodes, durationMs: 1, simTicks: 0, uses });
}

/**
 * Learned-farm phase 3: farm jobs are learned. Give a pet that knows Approach the Harvest routine (trained in its pen,
 * like a player would), so it can harvest on the farm. Cached by Approach policy: same Approach → same Harvest.
 */
const harvestCache = new Map<string, Parameters<typeof saveRevision>[2]>();
export function giveHarvest(s: GameState, pet: Pet) {
  const ap = pet.skills.find((k) => k.name === 'Approach');
  const key = JSON.stringify(ap?.revisions.find((r) => r.rev === ap.activeRev)?.policy ?? null) + JSON.stringify(pet.traits);
  const hit = harvestCache.get(key);
  if (hit) return saveRevision(s, pet, structuredClone(hit));
  const stage = recipeStage('harvest');
  const subs = subskillsFor(pet);
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: pet.traits, subskills: subs });
  while (!t.done) t.runChunk(1000, false);
  const report = buildReport(stage, pet.traits, null, t.policy(), null, undefined, subs);
  const input = { stage, policy: t.policy(), report, episodes: stage.learner.episodes, durationMs: 1, simTicks: 0, uses: [{ skill: 'Approach', rev: ap?.activeRev ?? 1 }] };
  harvestCache.set(key, structuredClone(input));
  return saveRevision(s, pet, input);
}

/** Any routine recipe, trained over the pet's skills and cached like `giveHarvest`. */
const routineCache = new Map<string, Parameters<typeof saveRevision>[2]>();
export function giveRoutine(s: GameState, pet: Pet, recipe: string) {
  const subs = subskillsFor(pet);
  const key = recipe + JSON.stringify(Object.values(subs).map((x) => x.policy)) + JSON.stringify(pet.traits);
  const hit = routineCache.get(key);
  if (hit) return saveRevision(s, pet, structuredClone(hit));
  const stage = recipeStage(recipe);
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: pet.traits, subskills: subs });
  while (!t.done) t.runChunk(1000, false);
  const report = buildReport(stage, pet.traits, null, t.policy(), null, undefined, subs);
  const uses = Object.values(subs).filter((x) => stage.learner.routine!.options.some((o) => o.args.skill === x.name)).map((x) => ({ skill: x.name, rev: x.rev }));
  const input = { stage, policy: t.policy(), report, episodes: stage.learner.episodes, durationMs: 1, simTicks: 0, uses };
  routineCache.set(key, structuredClone(input));
  return saveRevision(s, pet, input);
}

export { recipeStage, DEFAULT_TRAITS };

/**
 * Put a pet on one job, the way the retired direct jobs now work (and old saves are converted): that job as its
 * responsibilities (then nap), on Auto in the player's order.
 */
export function onJob(p: Pet, job: JobId, opts: { skillName?: string; target?: string; navigator?: NavigatorName } = {}) {
  p.plan = jobPlan(job, { skill: opts.skillName, target: opts.target, navigator: opts.navigator ?? 'Approach' });
  p.assignment = { ...p.assignment, mode: 'auto', job, ...opts, navigator: opts.navigator ?? 'Approach' };
  p.executive.mode = 'order';
}

/** A pet with a random temperament, as in the game (tests/setup.ts gives every other test pet the default one). */
export function adoptRandomPet(s: GameState, name: string, palette: Parameters<typeof import('../src/game/pets').adoptPet>[2]): Pet {
  return (pets as unknown as { adoptRandomPet: typeof import('../src/game/pets').adoptPet }).adoptRandomPet(s, name, palette);
}

/** The farm's basic learned jobs (phase 3c): Harvest and Plant, trained in pens over the pet's Approach. */
export function giveFarmJobs(s: GameState, pet: Pet) {
  giveHarvest(s, pet);
  return giveRoutine(s, pet, 'plant');
}
