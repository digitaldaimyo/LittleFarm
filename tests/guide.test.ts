import { describe, expect, it } from 'vitest';
import { newGame, trainingCost } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { ackStep, advanceTutorial, currentStep, guide, guideComparison, isPinned, PINNED_STAGE, PRACTICE_STAGE, recordGuideRun, skipChapter, startChapter } from '../src/game/tutorial';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { parseGame, serializeGame } from '../src/persistence/save';
import type { GameState } from '../src/game/types';
import type { StageSpec } from '../src/domain/types';

/** Train a Field Guide pen exactly as the game does and record the run. */
function run(s: GameState, stageId: string) {
  const st = s.stages.find((x) => x.id === stageId)! as StageSpec;
  const t = new Trainer({ stage: st, episodes: st.learner.episodes, traits: DEFAULT_TRAITS });
  while (!t.done) t.runChunk(1000, false);
  const r = buildReport(st, DEFAULT_TRAITS, null, t.policy(), null);
  recordGuideRun(s, st, st.learner.episodes, r.after.successRate, r.random.successRate, r.transfer.successRate, r.scattered?.successRate);
  advanceTutorial(s);
  return r;
}

function afterFirstLesson(): GameState {
  const s = newGame();
  adoptPet(s, 'Pip', 'meadow');
  skipChapter(s, 'first');
  return s;
}

describe('Field Guide engine', () => {
  it('offers the next lesson when the previous one is done or skipped, and lessons are free', () => {
    const s = afterFirstLesson();
    expect(guide(s).status.practice).toBe('offered');
    expect(guide(s).status.scatter).toBeUndefined();
    startChapter(s, 'practice');
    expect(currentStep(s)?.id).toBe('short');
    expect(trainingCost(s.stages.find((x) => x.id === PRACTICE_STAGE)!)).toBe(0);
  });

  it('“Read the report: practice” — 300 tries vs 1,500 tries, compared side by side', () => {
    const s = afterFirstLesson();
    startChapter(s, 'practice');
    const short = run(s, PRACTICE_STAGE);
    expect(currentStep(s)?.id).toBe('long');
    s.stages.find((x) => x.id === PRACTICE_STAGE)!.learner.episodes = 1500;
    const long = run(s, PRACTICE_STAGE);
    expect(currentStep(s)?.id).toBe('compare');
    expect(long.after.successRate).toBeGreaterThan(short.after.successRate + 0.3);
    const cmp = guideComparison(s, 'practice');
    expect(cmp.map((c) => c.label)).toEqual(['300 tries', '1500 tries']);
    ackStep(s);
    expect(guide(s).status.practice).toBe('done');
    expect(guide(s).status.scatter).toBe('offered');
  });

  it('“Scatter, don’t pin” — the pinned pen scores worse on new layouts until scattered', () => {
    const s = afterFirstLesson();
    skipChapter(s, 'practice');
    startChapter(s, 'scatter');
    const st = s.stages.find((x) => x.id === PINNED_STAGE)!;
    expect(isPinned(st)).toBe(true);
    const pinned = run(s, PINNED_STAGE);
    expect(currentStep(s)?.id).toBe('miss');
    s.progress.flags.replayedMiss = true;
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('unpin');
    // The player presses “Scatter this” and “Random start”.
    const berry = st.environment.find((p) => p.cardId === 'place.fixed')!;
    berry.cardId = 'place.random';
    berry.args = { kind: berry.args.kind, count: 1, region: 'anywhere' };
    st.environment.find((p) => p.cardId === 'place.pet')!.args.mode = 'random';
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('retrain');
    const scattered = run(s, PINNED_STAGE);
    // On its own pinned layout the pinned pet looks great; the report's scattered row is the honest test.
    expect(pinned.after.successRate).toBeGreaterThan(0.9);
    expect(pinned.scattered!.successRate).toBeLessThan(0.4);
    expect(scattered.scattered).toBeUndefined();
    expect(scattered.after.successRate).toBeGreaterThan(pinned.scattered!.successRate + 0.4);
    const cmp = guideComparison(s, 'scatter');
    expect(cmp.map((c) => c.label)).toEqual(['Pinned pen', 'Scattered pen']);
    expect(cmp[0].run.after).toBe(pinned.scattered!.successRate);
    ackStep(s);
    expect(guide(s).status.scatter).toBe('done');
  });

  it('replaying the first lesson resets its pen; an old save with a finished tutorial maps to Chapter 1 done', () => {
    const s = afterFirstLesson();
    startChapter(s, 'first');
    expect(currentStep(s)?.id).toBe('open-pen');
    expect(s.stages.find((x) => x.id === 'stage-tutorial')!.rules).toEqual([]);
    const old = newGame();
    adoptPet(old, 'Pip', 'meadow');
    delete old.progress.guide;
    old.progress.tutorialDone = true;
    const r = parseGame(serializeGame(old));
    advanceTutorial(r.game!);
    expect(guide(r.game!).status.first).toBe('done');
    expect(guide(r.game!).status.practice).toBe('offered');
  });
});

import { LOOPHOLE_STAGE, AVOID_STAGE, INVENT_STAGE, testApproachHere } from '../src/game/tutorial';
import { applyRepair } from '../src/domain/repairs';
import { suggestedRules, recipeStage } from '../src/domain/recipes';
import { node } from '../src/domain/spec';
import { getSkill } from '../src/game/pets';
import { reportTips, farmTips } from '../src/game/coach';
import { trainAndSave } from './helpers';
import type { SerializedQ } from '../src/learning/qtable';

function runNav(s: GameState, stageId: string, nav?: SerializedQ) {
  const st = s.stages.find((x) => x.id === stageId)! as StageSpec;
  const t = new Trainer({ stage: st, episodes: st.learner.episodes, traits: DEFAULT_TRAITS, navigator: nav });
  while (!t.done) t.runChunk(2000, false);
  const r = buildReport(st, DEFAULT_TRAITS, null, t.policy(), nav ?? null);
  recordGuideRun(s, st, st.learner.episodes, r.after.successRate, r.random.successRate, r.transfer.successRate, r.scattered?.successRate, r.after.meanReward);
  advanceTutorial(s);
  return { r, q: t.policy() };
}

describe('Field Guide phase B lessons', () => {
  function withApproach(): GameState {
    const s = newGame();
    const p = adoptPet(s, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    trainAndSave(s, p, recipeStage('go-to-berry'));
    skipChapter(s, 'first');
    return s;
  }

  it('“Pay for results”: the pickup loophole earns treats but not deliveries; the repair card fixes it', () => {
    const s = withApproach();
    expect(guide(s).status.results).toBeUndefined();
    s.progress.unlocks.push('fetch');
    advanceTutorial(s);
    expect(guide(s).status.results).toBe('offered');
    startChapter(s, 'results');
    const nav = getSkill(s.pets[0], 'Approach')!.revisions[0].policy;
    const loop = runNav(s, LOOPHOLE_STAGE, nav).r;
    expect(currentStep(s)?.id).toBe('read');
    ackStep(s);
    const st = s.stages.find((x) => x.id === LOOPHOLE_STAGE)!;
    applyRepair(st, 'limit-per-object', loop.exploits[0].ruleId);
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('retrain');
    const fixed = runNav(s, LOOPHOLE_STAGE, nav).r;
    expect(fixed.after.successRate).toBeGreaterThan(loop.after.successRate + 0.5);
    expect(loop.after.meanReward).toBeGreaterThan(fixed.after.meanReward);
    const cmp = guideComparison(s, 'results');
    expect(cmp.map((c) => c.label)).toEqual(['Treat every pickup', 'Once per object']);
    expect(cmp[0].run.treats).toBeGreaterThan(cmp[1].run.treats!);
    ackStep(s);
    expect(currentStep(s)?.id).toBe('save');
    expect(reportTips(st, loop, 400).some((t) => t.id === 'loophole' && t.lesson === 'results')).toBe(true);
  });

  it('“Practise where it works”: Approach without ponds vs Avoid trained with ponds', () => {
    const s = withApproach();
    s.progress.unlocks.push('avoid');
    s.pets[0].stats.dips = 1;
    advanceTutorial(s);
    expect(guide(s).status.where).toBe('offered');
    startChapter(s, 'where');
    testApproachHere(s);
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('train');
    const avoid = runNav(s, AVOID_STAGE).r;
    const cmp = guideComparison(s, 'where');
    expect(cmp.map((c) => c.label)).toEqual(['Approach (practised without ponds)', 'Avoid (practised with ponds)']);
    expect(avoid.after.successRate).toBeGreaterThan(cmp[0].run.after + 0.15);
    ackStep(s);
    trainAndSave(s, s.pets[0], s.stages.find((x) => x.id === AVOID_STAGE)!);
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('use');
    s.pets[0].assignment.navigator = 'Avoid';
    advanceTutorial(s);
    expect(guide(s).status.where).toBe('done');
  });

  it('“Invent a skill”: add Stay and Patience, use the rules, then an unneeded sense costs practice', () => {
    const s = withApproach();
    s.progress.unlocks.push('custom');
    advanceTutorial(s);
    startChapter(s, 'invent');
    const st = s.stages.find((x) => x.id === INVENT_STAGE)!;
    expect(currentStep(s)?.id).toBe('stay');
    st.abilities.push('stay');
    advanceTutorial(s);
    st.learner.senses!.push(node('sense.still'));
    advanceTutorial(s);
    expect(currentStep(s)?.id).toBe('rules');
    const sug = suggestedRules(st)[0];
    expect(sug.label).toBe('Wait for it rules');
    st.rules = sug.rules;
    st.success = sug.success;
    advanceTutorial(s);
    const lean = runNav(s, INVENT_STAGE).r;
    expect(currentStep(s)?.id).toBe('extra');
    st.learner.senses!.push(node('sense.distance', { what: node('kind:rock') }));
    const heavy = runNav(s, INVENT_STAGE).r;
    expect(currentStep(s)?.id).toBe('compare');
    expect(lean.after.successRate).toBeGreaterThan(heavy.after.successRate + 0.3);
    expect(guideComparison(s, 'invent').map((c) => c.label)).toEqual(['Lean senses', 'With the extra sense']);
  });
});

describe('Coaching tips', () => {
  it('point at the right lesson for too little practice, pinned pens and busy senses', () => {
    const short = { ...recipeStage('go-to-berry'), learner: { ...recipeStage('go-to-berry').learner, episodes: 300 } };
    const t = new Trainer({ stage: short, episodes: 300, traits: DEFAULT_TRAITS });
    while (!t.done) t.runChunk(300, false);
    const r = buildReport(short, DEFAULT_TRAITS, null, t.policy(), null);
    expect(reportTips(short, r, 300).map((x) => x.lesson)).toContain('practice');
    const pinned = recipeStage('go-to-berry');
    pinned.environment = [node('place.pet', { mode: 'fixed', x: 0, y: 0 }), node('place.fixed', { kind: node('kind:berry'), x: 7, y: 7 })];
    const t2 = new Trainer({ stage: pinned, episodes: 1500, traits: DEFAULT_TRAITS });
    while (!t2.done) t2.runChunk(1500, false);
    expect(reportTips(pinned, buildReport(pinned, DEFAULT_TRAITS, null, t2.policy(), null), 1500).map((x) => x.id)).toContain('pinned');
    const busy = recipeStage('wait-for-it');
    busy.learner.senses!.push(node('sense.distance', { what: node('kind:rock') }), node('sense.carrying'), node('sense.here', { what: node('kind:rock') }));
    expect(reportTips(busy, r, 3000).map((x) => x.id)).toContain('situations');
  });

  it('notice two pets on the same job', () => {
    const s = newGame();
    const a = adoptPet(s, 'Pip', 'meadow'), b = adoptPet(s, 'Mochi', 'plum');
    s.farm.dutyPetId = a.id; s.farm.duty2PetId = b.id;
    a.assignment = { mode: 'job', job: 'forage', navigator: 'Approach' };
    b.assignment = { mode: 'job', job: 'forage', navigator: 'Approach' };
    expect(farmTips(s).map((t) => t.id)).toEqual(['two-pets-same-job']);
    b.assignment.job = 'deliver';
    expect(farmTips(s)).toEqual([]);
  });
});
