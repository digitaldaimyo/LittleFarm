import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { adoptPet, getSkill, activeRevision, rollbackSkill } from '../src/game/pets';
import { createRuntime, farmTick, recentProduction } from '../src/game/farm';
import { advanceTutorial, currentStep } from '../src/game/tutorial';
import { recipeStage, trainAndSave } from './helpers';
import { node } from '../src/domain/spec';
import { suggestedRules } from '../src/domain/recipes';

function runFarm(s: ReturnType<typeof newGame>, ticks: number) {
  const rt = createRuntime(s.farm);
  for (let i = 0; i < ticks; i++) farmTick(s, rt);
  return s.resources.coins;
}

describe('farm', () => {
  it('a trained pet changes resource production relative to an untrained one', () => {
    const untrained = newGame();
    adoptPet(untrained, 'Pebble', 'sky');
    const trained = newGame();
    const p = adoptPet(trained, 'Pip', 'meadow');
    p.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
    trainAndSave(trained, p, recipeStage('go-to-berry'));
    p.assignment = { mode: 'job', job: 'forage', navigator: 'Approach' };
    expect(runFarm(untrained, 800)).toBe(0);
    expect(runFarm(trained, 800)).toBeGreaterThanOrEqual(8);
    expect(recentProduction(trained.farm, 800)).toBeGreaterThan(0);
  });

  it('second pet has an independent repertoire; rollback switches revision', () => {
    const s = newGame();
    const a = adoptPet(s, 'Pip', 'meadow');
    const b = adoptPet(s, 'Mochi', 'plum');
    trainAndSave(s, a, recipeStage('go-to-berry'));
    trainAndSave(s, a, { ...recipeStage('go-to-berry'), seed: 999 });
    expect(getSkill(a, 'Approach')?.revisions.length).toBe(2);
    expect(getSkill(b, 'Approach')).toBeNull();
    expect(rollbackSkill(s, a, 'Approach', 1)).toBe(true);
    expect(activeRevision(getSkill(a, 'Approach'))?.rev).toBe(1);
  });

  it('first-hour flow: adopt → pen → train → save → deploy → earn → Fetch unlocked', () => {
    const s = newGame();
    expect(currentStep(s)?.id).toBe('adopt');
    const pet = adoptPet(s, 'Pip', 'meadow');
    pet.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
    s.progress.flags.visitedTeach = true;
    const tut = s.stages.find((x) => x.id === 'stage-tutorial')!;
    tut.environment.push(node('place.random', { kind: node('kind:berry'), count: 1, region: 'anywhere' }));
    const sug = suggestedRules(tut)[0];
    tut.rules = sug.rules;
    tut.success = sug.success;
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('train');
    const rev = trainAndSave(s, pet, tut);
    expect(rev.eval.passed).toBe(true);
    s.progress.flags.sawReport = true;
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('assign');
    pet.assignment = { mode: 'job', job: 'forage', navigator: 'Approach' };
    s.progress.flags.assignedJob = true;
    runFarm(s, 900);
    advanceTutorial(s);
    expect(s.progress.unlocks).toContain('fetch');
    expect(s.progress.tutorialDone).toBe(true);
    expect(s.journal.some((j) => j.kind === 'first-berry')).toBe(true);
  });

  it('deploys Fetch on the farm to deliver carrots', () => {
    const s = newGame();
    const pet = adoptPet(s, 'Pip', 'meadow');
    pet.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
    const ap = trainAndSave(s, pet, recipeStage('go-to-berry'));
    trainAndSave(s, pet, recipeStage('bring-it-home'), ap.policy);
    s.progress.unlocks.push('fetch', 'carrots');
    pet.assignment = { mode: 'job', job: 'deliver', navigator: 'Approach' };
    runFarm(s, 1200);
    expect(s.resources.carrots).toBeGreaterThan(2);
  });
});

describe('farm robustness', () => {
  it('a working pet keeps producing over a long run (no permanent stuck loops)', () => {
    for (const seed of [101, 202, 303]) {
      const s = newGame();
      const pet = adoptPet(s, 'Pip', 'meadow');
      pet.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
      const ap = trainAndSave(s, pet, { ...recipeStage('go-to-berry'), seed });
      trainAndSave(s, pet, { ...recipeStage('bring-it-home'), seed }, ap.policy);
      s.progress.unlocks.push('fetch', 'carrots');
      pet.executive.mode = seed === 202 ? 'learned' : 'rules';
      const rt = createRuntime(s.farm);
      let windowStart = 0;
      for (let t = 1; t <= 3000; t++) {
        farmTick(s, rt);
        if (t % 600 === 0) {
          expect(s.resources.coins - windowStart).toBeGreaterThan(3);
          windowStart = s.resources.coins;
        }
      }
    }
  });
});
