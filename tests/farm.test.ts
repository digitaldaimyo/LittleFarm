import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { adoptPet, getSkill, activeRevision, rollbackSkill } from '../src/game/pets';
import { createRuntime, farmTick, recentProduction } from '../src/game/farm';
import { ackStep, advanceTutorial, currentStep, recordGuideRun } from '../src/game/tutorial';
import { trainingCost } from '../src/game/state';
import { recipeStage, trainAndSave, giveHarvest, trainAndSaveRoutine } from './helpers';
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
    giveHarvest(trained, p);
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

  it('first-hour flow: adopt → build pen and rules → train → read report → save → teach Harvest → deploy → earn → Fetch unlocked', () => {
    const s = newGame();
    expect(currentStep(s)?.id).toBe('adopt');
    const pet = adoptPet(s, 'Pip', 'meadow');
    pet.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
    s.progress.flags.visitedTeach = true;
    const tut = s.stages.find((x) => x.id === 'stage-tutorial')!;
    tut.environment.push(node('place.random', { kind: node('kind:berry'), count: 1, region: 'anywhere' }));
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('treat-rule');
    // The player builds the treat rule card by card…
    const rule = node('rule', { label: 'Treat at the berry', when: node('ev.reach', { actor: node('actor.pet'), what: node('kind:berry') }), then: [node('eff.reward', { amount: 10 })] });
    tut.rules.push(rule);
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('success');
    (rule.args.then as ReturnType<typeof node>[]).push(node('eff.end', { outcome: 'judge' }));
    tut.success = suggestedRules(tut)[0].success;
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('train');
    expect(trainingCost(tut)).toBe(0); // Field Guide lessons are free
    recordGuideRun(s, tut, 1500, 0.95, 0.4, 0.9); // the training run finishes (and is recorded)…
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('read-report');
    ackStep(s);
    expect(currentStep(s)?.id).toBe('save');
    const rev = trainAndSave(s, pet, tut); // …then the player saves it
    advanceTutorial(s);
    expect(rev.eval.passed).toBe(true);
    expect(currentStep(s)?.id).toBe('next');
    ackStep(s);
    // Learned farm: the first lesson ends there and "Teach a job: Harvest" starts by itself.
    expect(s.progress.tutorialDone).toBe(true);
    expect(currentStep(s)?.chapter.id).toBe('harvest');
    expect(s.activeStageId).toBe('stage-guide-harvest');
    expect(currentStep(s)?.id).toBe('train');
    const hv = s.stages.find((x) => x.id === 'stage-guide-harvest')!;
    recordGuideRun(s, hv, 600, 0.9, 0.2, 0.8);
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('save');
    trainAndSaveRoutine(s, pet, hv);
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('assign');
    pet.assignment = { mode: 'job', job: 'forage', navigator: 'Approach' };
    s.progress.flags.assignedJob = true;
    runFarm(s, 900);
    advanceTutorial(s);
    expect(s.progress.unlocks).toContain('fetch');
    expect(s.progress.guide?.status.harvest).toBe('done');
    expect(s.progress.guide?.status.practice).toBe('offered');
    expect(s.journal.some((j) => j.kind === 'first-berry')).toBe(true);
  });

  it('with Fetch and a learned Harvest, carrots are harvested and sold at the house', () => {
    const s = newGame();
    const pet = adoptPet(s, 'Pip', 'meadow');
    pet.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
    const ap = trainAndSave(s, pet, recipeStage('go-to-berry'));
    giveHarvest(s, pet);
    trainAndSave(s, pet, recipeStage('bring-it-home'), ap.policy);
    s.progress.unlocks.push('fetch', 'carrots');
    pet.assignment = { mode: 'auto', job: 'forage', navigator: 'Approach' };
    runFarm(s, 1200);
    expect(s.resources.carrots).toBeGreaterThan(2); // sold at the house (the learned Harvest takes crops home)
  });
});

describe('farm robustness', () => {
  it('a working pet keeps producing over a long run (no permanent stuck loops)', () => {
    for (const seed of [101, 202, 303]) {
      const s = newGame();
      const pet = adoptPet(s, 'Pip', 'meadow');
      pet.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
      const ap = trainAndSave(s, pet, { ...recipeStage('go-to-berry'), seed });
      giveHarvest(s, pet);
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
