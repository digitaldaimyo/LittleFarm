/**
 * Learned-farm phase 5: the learned executive. Gate: beats random picks on held-out farms (and the player's order
 * when that order has a mistake), stays close to a good order, and never loses safety (no job started while tired).
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { compareExecutives, farmContext, practiseExecutive } from '../src/game/farm';
import { chooseDuty, compilePlan, newPlanRuntime, starterPlan } from '../src/game/plan';
import { Rng } from '../src/sim/rng';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { recipeStage, trainAndSave, giveFarmJobs } from './helpers';
import type { GameState } from '../src/game/types';

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
  p.plan = starterPlan();
  return g;
}
const by = (rows: ReturnType<typeof compareExecutives>, mode: string) => rows.find((r) => r.mode === mode)!;

describe('the learned executive (phase 5)', () => {
  it('untrained, it picks in the player’s order', () => {
    const g = farm();
    const p = g.pets[0];
    const rows = compilePlan(p.plan!);
    const ctx = farmContext(g, p, false);
    const a = chooseDuty(g, p, p.plan!, rows, ctx, newPlanRuntime(), new Rng(3), { mode: 'order', eps: 0 });
    const b = chooseDuty(g, p, p.plan!, rows, ctx, newPlanRuntime(), new Rng(3), { mode: 'learned', eps: 0 });
    expect(b.row?.id).toBe(a.row?.id);
    expect(b.job?.key).toBe(a.job?.key);
  });

  it('with a mistake in the order (“Otherwise nap” first), learned picks beat the order and random picks; nobody starts work tired', () => {
    const g = farm();
    const p = g.pets[0];
    const r = p.plan!.rows;
    r.unshift(r.splice(r.findIndex((x) => x.args.label === 'Otherwise nap'), 1)[0]);
    practiseExecutive(g, p.id, 4);
    const cmp = compareExecutives(g, p.id);
    expect(by(cmp, 'order').coins).toBeLessThan(60); // the order just naps
    expect(by(cmp, 'learned').coins).toBeGreaterThan(by(cmp, 'random').coins);
    expect(by(cmp, 'learned').coins).toBeGreaterThan(3 * by(cmp, 'order').coins);
    for (const row of cmp) expect(row.tiredWork).toBe(0);
  }, 60000);

  it('with a good order, learned picks stay close to it and beat random picks', () => {
    const g = farm(202);
    practiseExecutive(g, g.pets[0].id, 4);
    const cmp = compareExecutives(g, g.pets[0].id);
    expect(by(cmp, 'learned').coins).toBeGreaterThanOrEqual(0.9 * by(cmp, 'order').coins);
    expect(by(cmp, 'learned').coins).toBeGreaterThan(by(cmp, 'random').coins);
    expect(by(cmp, 'learned').tiredWork).toBe(0);
  }, 60000);

  it('practice only changes the pet’s executive values (the real farm and skills stay as they were)', () => {
    const g = farm();
    const p = g.pets[0];
    const before = JSON.stringify({ farm: g.farm, coins: g.resources, skills: p.skills });
    const res = practiseExecutive(g, p.id, 2);
    expect(res.updates).toBeGreaterThan(50);
    expect(p.executive.values!.practised).toBe(2 * 1200);
    expect(JSON.stringify({ farm: g.farm, coins: g.resources, skills: p.skills })).toBe(before);
  }, 60000);

  it('a choice that gets nothing done loses value; one that makes progress keeps it', () => {
    const g = farm();
    const p = g.pets[0];
    const r = p.plan!.rows;
    r.unshift(r.splice(r.findIndex((x) => x.args.label === 'Otherwise nap'), 1)[0]);
    practiseExecutive(g, p.id, 2);
    const ids = Object.fromEntries(compilePlan(p.plan!).map((x) => [x.label, x.id]));
    const mean = (rowId: string) => { const es = Object.entries(p.executive.values!.upper).filter(([k]) => k.endsWith(`|${rowId}`)).map(([, e]) => e); return es.reduce((a, e) => a + e.q * e.n, 0) / Math.max(1, es.reduce((a, e) => a + e.n, 0)); }; // weighted by how often each situation came up
    expect(mean(ids['Otherwise nap'])).toBeLessThan(0.3); // started at 0.8 (top of the list)
    expect(mean(ids['Harvest what’s ripe'])).toBeGreaterThan(2 * mean(ids['Otherwise nap']));
  }, 60000);
});
