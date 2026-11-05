import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { buy } from '../src/game/progression';
import { applyPlan, createRuntime, farmTick, previewPlan, DAY_TICKS } from '../src/game/farm';
import { planWarnings, starterPlan } from '../src/game/plan';
import { node } from '../src/domain/spec';
import { giveFarmJobs, recipeStage, trainAndSave } from './helpers';
import type { Responsibilities, GameState } from '../src/game/types';

/** A busy farm: Approach + Fetch, carrots, chickens, crows, nights. */
function busyFarm(): GameState {
  const g = newGame();
  const pet = adoptPet(g, 'Pip', 'meadow');
  pet.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
  const ap = trainAndSave(g, pet, recipeStage('go-to-berry'));
  trainAndSave(g, pet, recipeStage('bring-it-home'), ap.policy);
  giveFarmJobs(g, pet);
  g.progress.unlocks.push('custom', 'fetch', 'carrots');
  g.resources.coins = 30;
  buy(g, 'chickens');
  return g;
}

const snapshot = (g: GameState) => JSON.stringify({ o: g.farm.world.objects, p: g.farm.world.pet, r: g.resources, e: g.pets[0].energy, t: g.farm.tick });

describe('M4 gate 1: the starter plan is the built-in rules executive', () => {
  it('produces an identical farm, tick for tick, over 2½ days', () => {
    const a = busyFarm();
    const b: GameState = structuredClone(a);
    a.pets[0].assignment.mode = 'auto';
    a.pets[0].executive.mode = 'order';
    const ra = createRuntime(a.farm);
    const rb = createRuntime(b.farm);
    b.pets[0].plan = starterPlan();
    applyPlan(b, rb, b.pets[0].id);
    for (let t = 0; t < DAY_TICKS * 2.5; t++) {
      farmTick(a, ra);
      farmTick(b, rb);
      expect(snapshot(b)).toBe(snapshot(a));
    }
    expect(a.resources.coins).toBeGreaterThan(40);
    expect(rb.plan.guarded).toBe(0);
  });
});

describe('M4 gate 2: preview = reality', () => {
  it('a 300-tick dry run matches the real farm over the same ticks', () => {
    const g = busyFarm();
    const rt = createRuntime(g.farm);
    for (let t = 0; t < 500; t++) farmTick(g, rt); // mid-game state
    const plan = starterPlan();
    plan.rows.splice(2, 0, node('plan.responsibility', { label: 'Eggs first', if: [node('cond.compare', { quantity: node('q.count', { what: node('kind:egg') }), op: '>=', value: 1 })], do: node('job.haul', { navigator: 'Approach' }) }));
    const pid = g.pets[0].id;
    const preview = previewPlan(g, pid, plan, 300);
    g.pets[0].plan = plan;
    applyPlan(g, rt, pid);
    const coins0 = g.resources.coins;
    for (let t = 0; t < 300; t++) farmTick(g, rt);
    expect(g.resources.coins - coins0).toBe(preview.coins);
    expect({ coins: g.resources.coins, tick: g.farm.tick, petX: g.farm.world.pet.x, petY: g.farm.world.pet.y }).toEqual(preview.final);
    expect(g.pets[0].energy).toBeCloseTo(preview.energyEnd, 9);
    expect(preview.fires[plan.rows[2].id]).toBeGreaterThan(0); // “Eggs first” (eggs keep coming, so it keeps the pet busy)
  });
});

describe('M4 gate 3: the anti-dithering guard', () => {
  /** Two rows that fight: at the bin → go home; otherwise → go to the bin. */
  const fighting = (guard: boolean): Responsibilities => ({
    guard,
    rows: [
      node('plan.responsibility', { label: 'At the bin? go home', if: [node('cond.near', { actor: node('actor.pet'), what: node('kind:bin'), dist: 0 })], do: node('job.goto', { aim: node('kind:home') }) }),
      node('plan.responsibility', { label: 'Go to the bin', if: [], do: node('job.goto', { aim: node('kind:bin') }) }),
    ],
  });
  it('detects flip-flopping rows and cuts the switching rate', () => {
    const g = busyFarm();
    const pid = g.pets[0].id;
    const off = previewPlan(g, pid, fighting(false), 600);
    const on = previewPlan(g, pid, fighting(true), 600);
    expect(off.switchesPerMinute).toBeGreaterThan(40);
    expect(on.guarded).toBeGreaterThan(0);
    // Measured 42 → 21.4 switches/min (errands walk through the one runtime since phase 6, with Curiosity's odd random step).
    expect(on.switchesPerMinute).toBeLessThan(off.switchesPerMinute * 0.6);
  });
});

describe('M4: plans in play', () => {
  it('a player plan using a learned skill outearns doing nothing, and warns about unknown skills', () => {
    const g = busyFarm();
    const pid = g.pets[0].id;
    const plan: Responsibilities = {
      guard: true,
      rows: [
        node('plan.responsibility', { label: 'Tired', if: [node('cond.energyBelow', { value: 25 })], do: node('job.nap') }),
        node('plan.responsibility', { label: 'Eggs', if: [node('cond.compare', { quantity: node('q.count', { what: node('kind:egg') }), op: '>=', value: 1 })], do: node('job.haul') }),
        node('plan.responsibility', { label: 'Herd', if: [], do: node('job.skill', { skill: 'Herd', aim: node('kind:chicken') }) }),
        node('plan.responsibility', { label: 'Berries', if: [], do: node('job.harvest') }),
      ],
    };
    expect(planWarnings(g.pets[0], plan).some((w) => /hasn’t learned “Herd”/.test(w.message))).toBe(true);
    const p = previewPlan(g, pid, plan, 600);
    expect(p.coins).toBeGreaterThan(0);
    const napOnly = previewPlan(g, pid, { guard: true, rows: [node('plan.responsibility', { label: 'Nap', if: [], do: node('job.nap') })] }, 600);
    expect(napOnly.coins).toBe(0);
  });
});
