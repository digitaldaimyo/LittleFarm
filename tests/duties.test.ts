/**
 * Learned-farm phase 4: responsibilities and the deterministic executive (needs, commitment, cooldowns, evidence,
 * decision trace). The gate: a multi-job responsibility gets done; low energy is handled; no thrash; no endless retry.
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { createRuntime, farmTick, applyPlan } from '../src/game/farm';
import { COOLDOWN, FAIL_LIMIT, MIN_COMMIT, RESTED_AT, compilePlan, starterPlan } from '../src/game/plan';
import { compileCondition } from '../src/sim/compile';
import { addObject } from '../src/sim/world';
import { node } from '../src/domain/spec';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { recipeStage, trainAndSave, giveFarmJobs, giveRoutine } from './helpers';
import type { FarmPlan, GameState } from '../src/game/types';

function farm(seed = 101): GameState {
  const g = newGame();
  const p = adoptPet(g, 'Pip', 'meadow');
  p.traits = { ...DEFAULT_TRAITS };
  const ap = recipeStage('go-to-berry'); ap.seed = seed; trainAndSave(g, p, ap);
  const fe = recipeStage('bring-it-home'); fe.seed = seed; trainAndSave(g, p, fe, activeRevision(getSkill(p, 'Approach'))!.policy);
  giveFarmJobs(g, p);
  g.progress.unlocks.push('fetch', 'carrots');
  g.resources.coins = 30;
  g.farm.dutyPetId = p.id;
  return g;
}
const duty = (label: string, when: ReturnType<typeof node>[], use: ReturnType<typeof node>, also: ReturnType<typeof node>[] = [], until?: ReturnType<typeof node>) =>
  node('plan.row', { label, if: when, do: use, ...(also.length ? { also } : {}), ...(until ? { until } : {}) });

describe('responsibilities: the phase-4 gate', () => {
  it('a responsibility served by two jobs (Haul or Basket run) is worked on until its UNTIL holds', () => {
    const g = farm();
    const p = g.pets[0];
    giveRoutine(g, p, 'basket-run');
    const bin = g.farm.world.objects.find((o) => o.kind === 'bin')!;
    bin.store = [{ kind: 'berry', n: 6 }]; // full
    const half = node('cond.storage', { level: 'half' });
    const plan: FarmPlan = { chooser: 'first', guard: true, rows: [
      duty('Storage at most half full', [half], node('job.deliver'), [node('job.tote')], node('cond.not', { inner: half })),
      duty('Otherwise nap', [], node('job.nap')),
    ] };
    p.plan = plan;
    const rt = createRuntime(g.farm);
    applyPlan(g, rt, p.id);
    const done = compileCondition(node('cond.not', { inner: half }));
    let t = 0;
    for (; t < 1500 && !done({ w: g.farm.world, prev: g.farm.world.pet }); t++) farmTick(g, rt);
    expect(done({ w: g.farm.world, prev: g.farm.world.pet })).toBe(true);
    expect(rt.plan.fires[plan.rows[0].id]).toBeGreaterThanOrEqual(1);
    expect(Object.keys(p.evidence ?? {}).some((k) => k === 'deliver' || k === 'tote')).toBe(true);
    expect(rt.plan.trace.some((x) => x.text.startsWith('Storage at most half full'))).toBe(true);
  }, 60000);

  it('low energy: a tired pet rests first and keeps resting until refreshed (no work below the threshold)', () => {
    const g = farm();
    const p = g.pets[0];
    p.energy = 20;
    const rt = createRuntime(g.farm);
    let worked = false, rested = false;
    for (let t = 0; t < 400; t++) {
      farmTick(g, rt);
      const b = g.farm.current?.behaviorId;
      if (b === 'rest') rested = true;
      if (b && b !== 'rest' && rested && !worked) { worked = true; expect(p.energy).toBeGreaterThanOrEqual(RESTED_AT - 2); }
    }
    expect(rested).toBe(true);
    expect(worked).toBe(true);
    expect(rt.plan.trace[0].text).toMatch(/Tired/);
  }, 60000);

  it('no thrash: on three farms the starter responsibilities switch rarely and the guard is never needed', () => {
    for (const seed of [101, 202, 303]) {
      const g = farm(seed);
      const rt = createRuntime(g.farm);
      for (let t = 0; t < 2400; t++) farmTick(g, rt);
      const perMin = (rt.plan.switches * 214) / 2400;
      expect(perMin).toBeLessThan(25);
      expect(rt.plan.guarded).toBe(0);
    }
  }, 120000);

  it('no endless retry: a job that never works is cooled down after a few tries', () => {
    const g = farm();
    const p = g.pets[0];
    // A rock can never be stood on: “Go to the rock” always times out.
    const plan: FarmPlan = { chooser: 'first', guard: true, rows: [
      duty('Visit the rock', [], node('job.goto', { aim: node('kind:rock') })),
      duty('Otherwise nap', [], node('job.nap')),
    ] };
    p.plan = plan;
    const rt = createRuntime(g.farm);
    applyPlan(g, rt, p.id);
    const T = 1600;
    for (let t = 0; t < T; t++) farmTick(g, rt);
    const tries = rt.plan.fires[plan.rows[0].id] ?? 0;
    expect(tries).toBeGreaterThanOrEqual(FAIL_LIMIT);
    expect(tries).toBeLessThanOrEqual(FAIL_LIMIT * (Math.ceil(T / COOLDOWN) + 1));
    expect(rt.plan.trace.some((x) => /failed 3× in a row/.test(x.text))).toBe(true);
  }, 60000);

  it('commitment: an UNTIL responsibility isn’t dropped for a more important one before MIN_COMMIT ticks (unless its job fails)', () => {
    const g = farm();
    const p = g.pets[0];
    const rt = createRuntime(g.farm);
    p.plan = starterPlan();
    applyPlan(g, rt, p.id);
    const rows = compilePlan(p.plan);
    const until = rows.find((r) => r.until)!;
    expect(until.label).toBe('Storage at most half full');
    // Simulate: committed to it 10 ticks ago, its last job fine; a higher row applies.
    rt.plan.commit = { row: until.id, since: g.farm.tick - 10, lastOk: g.farm.tick, lastFailed: false };
    expect(MIN_COMMIT).toBeGreaterThan(10);
    g.farm.world.objects.find((o) => o.kind === 'bin')!.store = [{ kind: 'berry', n: 6 }];
    const w = g.farm.world;
    const berry = addObject(w, 'berry', w.pet.x, w.pet.y);
    berry.carried = true; w.pet.carrying = berry.id; // "Finish what's in your paws" (higher) applies
    farmTick(g, rt);
    expect(g.farm.current?.args.row).toBe(until.id);
    expect(g.farm.current?.intention).toMatch(/Sticking with/);
  }, 60000);
});
