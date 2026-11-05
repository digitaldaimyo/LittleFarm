/**
 * Pen & cards roadmap, phase 5: recipes certify reliably at default traits, and learned picks stop exploring on the
 * farm once the pet has practised (unless the player says otherwise).
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { deployExploreExec, keepsLearning } from '../src/game/plan';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { recipeStage, trainAndSave, trainAndSaveRoutine } from './helpers';

describe('recipes certify reliably (default traits, 6 training seeds)', () => {
  // Polish phase 1 adds the routines the sturdier Approach (obstacle practice) and the routine rebuild fixed; the slow
  // sense recipes are checked by scripts/recipe-sweep.ts.
  for (const id of ['plant', 'open-gate', 'shut-gate', 'empty-basket', 'harvest', 'basket-run']) {
    it(`${id}: ≥ 80% on every seed`, () => {
      const rates: number[] = [];
      for (const seed of [0, 11, 22, 33, 44, 55]) { // 0: the recipe's own seed
        const g = newGame();
        const p = adoptPet(g, 'Pip', 'meadow');
        p.traits = { ...DEFAULT_TRAITS };
        const ap = recipeStage('go-to-berry'); ap.seed = seed; trainAndSave(g, p, ap);
        const st = recipeStage(id); if (seed) st.seed = seed;
        rates.push((st.learner.template === 'routine' ? trainAndSaveRoutine(g, p, st) : trainAndSave(g, p, st)).eval.successRate);
      }
      expect(Math.min(...rates), rates.join(' ')).toBeGreaterThanOrEqual(0.8);
    }, 120000);
  }
});

describe('learned picks on the farm', () => {
  it('explore until practised, then stop — unless the player chose', () => {
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    expect(keepsLearning(p)).toBe(true);
    expect(deployExploreExec(p)).toBeGreaterThan(0);
    p.executive.values = { upper: {}, lower: {}, practised: 4800, updates: 300 };
    expect(keepsLearning(p)).toBe(false);
    expect(deployExploreExec(p)).toBe(0);
    p.executive.explore = true;
    expect(deployExploreExec(p)).toBeGreaterThan(0);
    p.executive.explore = false;
    p.executive.values.practised = 0;
    expect(deployExploreExec(p)).toBe(0);
  });
});
