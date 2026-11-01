import { describe, expect, it } from 'vitest';
import { recipeStage } from '../src/domain/recipes';
import { validateStage } from '../src/domain/validate';
import { node } from '../src/domain/spec';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import type { SubSkills } from '../src/learning/routine';
import type { StageSpec } from '../src/domain/types';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill, staleUses, subskillsFor } from '../src/game/pets';
import { createRuntime, farmTick } from '../src/game/farm';
import { trainAndSave } from './helpers';
import type { Pet, GameState } from '../src/game/types';

function train(stage: StageSpec, extra: Record<string, unknown> = {}) {
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: DEFAULT_TRAITS, ...extra });
  while (!t.done) t.runChunk(1000, false);
  return t.policy();
}

/** A pet that has learned the four skills Morning chores can use. */
function choresPet(): { g: GameState; pet: Pet } {
  const g = newGame();
  const pet = adoptPet(g, 'Pip', 'meadow');
  pet.traits = { ...DEFAULT_TRAITS };
  for (const id of ['herd-chicken', 'water-garden', 'keep-clear', 'wait-for-it']) trainAndSave(g, pet, recipeStage(id));
  return { g, pet };
}

describe('M3 gate 1: Fetch rebuilt as a routine', () => {
  it('learns exactly the same controller as the built-in Fetch', () => {
    const ap = train(recipeStage('go-to-berry'));
    const subs: SubSkills = { Approach: { name: 'Approach', rev: 1, preset: true, policy: ap } };
    for (const seed of [303, 101]) {
      const fetch = { ...recipeStage('bring-it-home'), seed };
      const routine = { ...recipeStage('fetch-routine'), seed };
      expect(validateStage(routine).filter((d) => d.severity === 'error')).toEqual([]);
      const a = train(fetch, { navigator: ap });
      const b = train(routine, { subskills: subs });
      expect(b).toEqual(a);
      const ra = buildReport(fetch, DEFAULT_TRAITS, null, a, ap);
      const rb = buildReport(routine, DEFAULT_TRAITS, null, b, null, undefined, subs);
      expect(rb.after.successRate).toBe(ra.after.successRate);
    }
  });
});

describe('M3 gates 2 & 3: Morning chores from player-made skills', () => {
  const { g, pet } = choresPet();
  const stage = recipeStage('morning-chores');
  const subs = subskillsFor(pet);
  const q = train(stage, { subskills: subs });

  it('beats random steps by ≥30 points — and random choice of the same skills by ≥20', () => {
    expect(validateStage(stage).filter((d) => d.severity === 'error')).toEqual([]);
    const r = buildReport(stage, DEFAULT_TRAITS, null, q, null, undefined, subs);
    expect(r.after.successRate).toBeGreaterThanOrEqual(r.random.successRate + 0.3);
    expect(r.after.successRate).toBeGreaterThanOrEqual((r.randomOptions?.successRate ?? 1) + 0.2);
    expect(r.after.successRate).toBeGreaterThan(r.before.successRate);
  });

  it('swapping a sub-skill revision changes the routine without retraining it', () => {
    const good = buildReport(stage, DEFAULT_TRAITS, null, q, null, undefined, subs).after.successRate;
    const weakHerd = train({ ...recipeStage('herd-chicken'), learner: { ...recipeStage('herd-chicken').learner, episodes: 40 } });
    const weakSubs: SubSkills = { ...subs, Herd: { ...subs.Herd, rev: 99, policy: weakHerd } };
    const weak = buildReport(stage, DEFAULT_TRAITS, null, q, null, undefined, weakSubs).after.successRate;
    expect(weak).toBeLessThan(good - 0.2);
  });

  it('records which revisions it used and notices when one changes', () => {
    const rev = trainAndSaveRoutine(g, pet, stage, subs);
    expect(rev.uses?.map((u) => u.skill).sort()).toEqual(['Herd', 'Keep clear', 'Wait for it', 'Water the garden']);
    expect(getSkill(pet, 'Morning chores')?.kind).toBe('routine');
    expect(staleUses(pet, rev)).toEqual([]);
    trainAndSave(g, pet, { ...recipeStage('herd-chicken'), seed: 4242 });
    expect(staleUses(pet, rev)).toEqual([{ skill: 'Herd', trained: 1, now: 2 }]);
  });
});

function trainAndSaveRoutine(g: GameState, pet: Pet, stage: StageSpec, subs: SubSkills) {
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: pet.traits, subskills: subs });
  while (!t.done) t.runChunk(1000, false);
  const report = buildReport(stage, pet.traits, null, t.policy(), null, undefined, subs);
  const uses = Object.values(subs).filter((x) => stage.learner.routine!.options.some((o) => o.args.skill === x.name)).map((x) => ({ skill: x.name, rev: x.rev }));
  return saveRevisionFor(g, pet, stage, t.policy(), report, uses);
}
import { saveRevision } from '../src/game/pets';
function saveRevisionFor(g: GameState, pet: Pet, stage: StageSpec, policy: ReturnType<typeof train>, report: ReturnType<typeof buildReport>, uses: { skill: string; rev: number }[]) {
  return saveRevision(g, pet, { stage, policy, report, episodes: stage.learner.episodes, durationMs: 1, simTicks: 0, uses });
}

describe('M3: routines elsewhere', () => {
  it('a routine runs on the farm with the pet’s current skills (Fetch routine delivering carrots)', () => {
    const g = newGame();
    const pet = adoptPet(g, 'Pip', 'meadow');
    pet.traits = { ...DEFAULT_TRAITS };
    trainAndSave(g, pet, recipeStage('go-to-berry'));
    const stage = recipeStage('fetch-routine');
    trainAndSaveRoutine(g, pet, stage, subskillsFor(pet));
    expect(activeRevision(getSkill(pet, 'Fetch routine'))?.stage).toBeDefined();
    g.progress.unlocks.push('carrots');
    pet.assignment = { mode: 'job', job: 'skill', navigator: 'Approach', skillName: 'Fetch routine', target: 'carrot' };
    const rt = createRuntime(g.farm);
    for (let t = 0; t < 800; t++) farmTick(g, rt);
    // The routine's destination is the basket: carrots are stored there (to be hauled and sold later).
    expect(g.farm.world.delivered.carrot ?? 0).toBeGreaterThan(2);
  });

  it('validation: options, watch limit, self-reference; training refuses missing skills', () => {
    const s = recipeStage('morning-chores');
    s.learner.routine!.watch.push(node('cond.night'), node('cond.night'), node('cond.night'));
    expect(validateStage(s).some((d) => d.code === 'too-many-watch')).toBe(true);
    s.learner.routine!.options = [];
    expect(validateStage(s).some((d) => d.code === 'no-options')).toBe(true);
    s.learner.routine!.options = [node('opt.skill', { skill: 'Morning chores' })];
    expect(validateStage(s).some((d) => d.code === 'self-reference')).toBe(true);
    expect(() => new Trainer({ stage: recipeStage('morning-chores'), episodes: 10, traits: DEFAULT_TRAITS, subskills: {} })).toThrow(/hasn't saved/);
  });
});
