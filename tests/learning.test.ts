import { describe, expect, it } from 'vitest';
import { recipeStage, EVAL_SEED_BASE } from '../src/domain/recipes';
import { Trainer, trainingSeed, TRAIN_SEED_MAX } from '../src/learning/trainer';
import { buildReport, heldOutSeeds } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { applyRepair } from '../src/domain/repairs';
import type { StageSpec } from '../src/domain/types';
import type { SerializedQ } from '../src/learning/qtable';

function train(stage: StageSpec, navigator?: SerializedQ): SerializedQ {
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: DEFAULT_TRAITS, navigator });
  while (!t.done) t.runChunk(200, false);
  return t.policy();
}

describe('local learning', () => {
  const approach = recipeStage('go-to-berry');
  const apQ = train(approach);

  it('evaluation seeds are held out from training seeds', () => {
    const seeds = heldOutSeeds(approach);
    expect(seeds.length).toBeGreaterThanOrEqual(10);
    expect(seeds.every((s) => s > EVAL_SEED_BASE)).toBe(true);
    for (let i = 0; i < 5000; i++) expect(trainingSeed(approach, i)).toBeLessThan(TRAIN_SEED_MAX);
  });

  it('learned Approach beats random on unseen layouts (≥80%)', () => {
    const r = buildReport(approach, DEFAULT_TRAITS, null, apQ, null);
    expect(r.after.successRate).toBeGreaterThanOrEqual(0.8);
    expect(r.after.successRate).toBeGreaterThan(r.random.successRate + 0.2);
    expect(r.transfer.successRate).toBeGreaterThan(r.random.successRate);
    expect(r.passed).toBe(true);
  });

  it('training is deterministic for a fixed stage seed', () => {
    const a = train({ ...approach, learner: { ...approach.learner, episodes: 200 } });
    const b = train({ ...approach, learner: { ...approach.learner, episodes: 200 } });
    expect(a).toEqual(b);
  });

  it('Fetch reuses the saved Approach; swapping Approach changes Fetch without retraining it', () => {
    const fetch = recipeStage('bring-it-home');
    const ctrl = train(fetch, apQ);
    const good = buildReport(fetch, DEFAULT_TRAITS, null, ctrl, apQ);
    expect(good.after.successRate).toBeGreaterThanOrEqual(0.65);
    const weakNav = train({ ...approach, learner: { ...approach.learner, episodes: 30 } });
    const weak = buildReport(fetch, DEFAULT_TRAITS, null, ctrl, weakNav);
    expect(weak.after.successRate).toBeLessThan(good.after.successRate);
  });

  it('an exploitable reward is diagnosed, and the repair changes the outcome', () => {
    const exploit = recipeStage('pay-per-pickup');
    const q = train(exploit, apQ);
    const r = buildReport(exploit, DEFAULT_TRAITS, null, q, apQ);
    expect(r.exploits.length).toBeGreaterThan(0);
    expect(r.exploits[0].replay).toBeDefined();
    const fixed = structuredClone(exploit);
    expect(applyRepair(fixed, 'limit-per-object', r.exploits[0].ruleId)).toBe(true);
    const q2 = train(fixed, apQ);
    const r2 = buildReport(fixed, DEFAULT_TRAITS, null, q2, apQ);
    expect(r2.after.successRate).toBeGreaterThan(r.after.successRate + 0.4);
    expect(r2.exploits.length).toBe(0);
  });
});
