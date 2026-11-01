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
