/**
 * Pen & cards roadmap, phase 2: Compare upgraded (a measure on either side, six comparisons, 0–100) and new measures.
 */
import { describe, expect, it } from 'vitest';
import { node } from '../src/domain/spec';
import { describe as say } from '../src/domain/describe';
import { addObject, emptyStore, emptyWorld, step, type World } from '../src/sim/world';
import { compileCondition, generateWorld } from '../src/sim/compile';
import { compileEncoder } from '../src/learning/senses';
import { newGame } from '../src/game/state';
import { createRuntime, farmTick } from '../src/game/farm';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { recipeStage } from './helpers';
import type { SpecNode } from '../src/domain/types';

const cmp = (q: SpecNode, op: string, value: number | SpecNode) =>
  node('cond.compare', typeof value === 'number' ? { quantity: q, op, value } : { quantity: q, op, value: 0, than: value });
const holds = (c: SpecNode, w: World) => compileCondition(c)({ w, prev: w.pet });
const measure = (q: SpecNode, w: World) => { for (let v = 0; v <= 100; v++) if (holds(cmp(q, '==', v), w)) return v; return -1; };

function farmyard(): World {
  const w = emptyWorld(6, 4);
  addObject(w, 'berry', 0, 1); addObject(w, 'berry', 5, 3); addObject(w, 'home', 5, 0);
  const b = addObject(w, 'bin', 2, 0); b.store = [{ kind: 'berry', n: 3 }];
  const shed = addObject(w, 'shed', 3, 3); shed.store = [{ kind: 'carrot', n: 2 }, ...(emptyStore('shed') ?? []).slice(1)];
  return w;
}

describe('measures', () => {
  it('Stored counts what is in storage — any, baskets, sheds, or the carried basket', () => {
    const w = farmyard();
    expect(measure(node('q.stored', { what: node('kind:berry') }), w)).toBe(3);
    expect(measure(node('q.stored', { what: node('kind:berry'), where: 'sheds' }), w)).toBe(0);
    expect(measure(node('q.stored', { what: node('kind:carrot'), where: 'sheds' }), w)).toBe(2);
    expect(measure(node('q.stored', { what: node('kind:@crop') }), w)).toBe(5);
    expect(measure(node('q.stored', { what: node('kind:berry'), where: 'carried' }), w)).toBe(0);
    w.pet.x = 2; w.pet.y = 0; step(w, 'lift');
    expect(measure(node('q.stored', { what: node('kind:berry'), where: 'carried' }), w)).toBe(3);
    expect(measure(node('q.stored', { what: node('kind:berry'), where: 'baskets' }), w)).toBe(3); // still counts, carried
  });

  it('Sold / delivered count by kind, this try', () => {
    const w = emptyWorld(3, 1);
    addObject(w, 'berry', 0, 0); addObject(w, 'carrot', 0, 0); addObject(w, 'home', 1, 0);
    addObject(w, 'bin', 2, 0).store = emptyStore('bin');
    step(w, 'pick'); step(w, 'E'); step(w, 'drop'); // a berry sold at the house
    step(w, 'W'); step(w, 'pick'); step(w, 'E'); step(w, 'E'); step(w, 'drop'); // a carrot stored in the basket
    expect(measure(node('q.sold', { what: node('kind:berry') }), w)).toBe(1);
    expect(measure(node('q.sold', { what: node('kind:carrot') }), w)).toBe(0);
    expect(measure(node('q.sold', { what: node('kind:carrot'), mode: 'delivered' }), w)).toBe(1);
    expect(measure(node('q.sold', { what: node('kind:@crop'), mode: 'delivered' }), w)).toBe(2);
  });

  it('Distance between any two things; Energy, Seed money, Water, Step, Note value', () => {
    const w = farmyard();
    expect(measure(node('q.between', { from: node('kind:home'), what: node('kind:berry') }), w)).toBe(3); // (5,0)→(5,3)
    expect(measure(node('q.between', { from: node('kind:home'), what: node('kind:pond') }), w)).toBe(99);
    expect(measure(node('q.energy'), w)).toBe(100);
    w.petEnergy = 37; expect(measure(node('q.energy'), w)).toBe(37);
    w.seedCoins = 4; expect(measure(node('q.seed'), w)).toBe(4);
    w.pet.water = 2; expect(measure(node('q.water'), w)).toBe(2);
    step(w, 'wait'); step(w, 'wait'); expect(measure(node('q.step'), w)).toBe(2);
    w.notes = { leg: 3 }; expect(measure(node('q.note', { name: 'leg' }), w)).toBe(3);
    expect(measure(node('q.note', { name: 'other' }), w)).toBe(0);
  });

  it('Time until ripe reads the farm’s growing plots (0 when one is ripe; 99 when nothing grows, as in pens)', () => {
    const s = newGame();
    const rt = createRuntime(s.farm);
    farmTick(s, rt);
    const w = s.farm.world;
    for (const o of w.objects.filter((x) => x.kind === 'berry')) o.delivered = true; // harvest the bushes
    farmTick(s, rt);
    const t = measure(node('q.ripe', { what: node('kind:berry') }), w);
    expect(t).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) farmTick(s, rt);
    expect(measure(node('q.ripe', { what: node('kind:berry') }), w)).toBeLessThan(t);
    expect(measure(node('q.ripe', { what: node('kind:pumpkin') }), w)).toBe(99);
    expect(measure(node('q.ripe', { what: node('kind:berry') }), generateWorld(recipeStage('go-to-berry'), 1))).toBe(0); // a berry lies in the pen
  });
});

describe('Compare', () => {
  it('all six comparisons, numbers up to 100', () => {
    const w = farmyard();
    const q = node('q.stored', { what: node('kind:berry') }); // 3
    const truth = (op: string, v: number) => holds(cmp(q, op, v), w);
    expect([truth('<', 3), truth('<', 4), truth('<=', 3), truth('==', 3), truth('!=', 3), truth('!=', 2), truth('>=', 3), truth('>', 3), truth('>', 2)])
      .toEqual([false, true, true, true, false, true, true, false, true]);
    w.petEnergy = 90;
    expect(holds(cmp(node('q.energy'), '>=', 90), w)).toBe(true);
  });

  it('a measure against another measure: stored berries > stored carrots; steps to the basket < steps to the house', () => {
    const w = farmyard();
    const berries = node('q.stored', { what: node('kind:berry') }), carrots = node('q.stored', { what: node('kind:carrot') });
    expect(holds(cmp(berries, '>', carrots), w)).toBe(true);
    expect(holds(cmp(carrots, '>', berries), w)).toBe(false);
    const toBin = node('q.distance', { actor: node('actor.pet'), what: node('kind:bin') }), toHome = node('q.distance', { actor: node('actor.pet'), what: node('kind:home') });
    expect(holds(cmp(toBin, '<', toHome), w)).toBe(true);
    expect(say(cmp(berries, '>', carrots), { petName: 'Pip', target: 'berry' })).toBe('berry stored in any storage > carrot stored in any storage');
  });

  it('old saves: a Compare with ≤ / ≥ / = and a number means what it meant', () => {
    const w = farmyard();
    const old = (op: string, value: number) => ({ id: 'old', cardId: 'cond.compare', args: { quantity: node('q.count', { what: node('kind:berry') }), op, value } });
    expect([holds(old('<=', 2), w), holds(old('>=', 3), w), holds(old('==', 2), w)]).toEqual([true, false, true]);
  });

  it('works on the farm too: a responsibility WHEN stored berries ≥ 3 picks Haul', async () => {
    const { chooseDuty, compilePlan, newPlanRuntime } = await import('../src/game/plan');
    const { adoptPet } = await import('../src/game/pets');
    const { farmContext } = await import('../src/game/farm');
    const { Rng } = await import('../src/sim/rng');
    const s = newGame();
    const p = adoptPet(s, 'Pip', 'meadow');
    s.farm.dutyPetId = p.id;
    p.plan = { guard: true, rows: [node('plan.responsibility', { label: 'Plenty stored', if: [cmp(node('q.stored', { what: node('kind:berry') }), '>=', 3)], do: node('job.nap') }), node('plan.responsibility', { label: 'Else', if: [], do: node('job.nap') })] };
    const rows = compilePlan(p.plan);
    const pick = () => chooseDuty(s, p, p.plan!, rows, farmContext(s, p, false), newPlanRuntime(), new Rng(1)).row?.label;
    expect(pick()).toBe('Else');
    s.farm.world.objects.find((o) => o.kind === 'bin')!.store = [{ kind: 'berry', n: 4 }];
    expect(pick()).toBe('Plenty stored');
  });
});

describe('the Storage of… sense', () => {
  it('reads stored counts in bands: none, 1–2, 3–5, 6+', () => {
    const enc = compileEncoder([node('sense.stored', { what: node('kind:berry') })], 'berry');
    const w = farmyard();
    const b = w.objects.find((o) => o.kind === 'bin')!;
    const band = (n: number) => { b.store = [{ kind: 'berry', n }]; return enc.encode(w)[0]; };
    expect([band(0), band(1), band(2), band(3), band(5), band(6)]).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe('gate: “keep 3 berries in the basket” trains without notes', () => {
  it('a routine with “stored berries ≥ 3” as SUCCESS (no notes, no counting by hand) — well above random choices', async () => {
    const { newGame } = await import('../src/game/state');
    const { adoptPet } = await import('../src/game/pets');
    const { trainAndSave, trainAndSaveRoutine } = await import('./helpers');
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    trainAndSave(g, p, recipeStage('go-to-berry'));
    const st = recipeStage('harvest-store');
    const three = cmp(node('q.stored', { what: node('kind:berry'), where: 'baskets' }), '>=', 3);
    const carrying = () => node('cond.carryingAny', { actor: node('actor.pet') });
    st.environment = [
      node('place.pet', { mode: 'random', x: 0, y: 0 }),
      node('place.random', { kind: node('kind:berry'), count: 4, region: 'anywhere' }),
      node('place.random', { kind: node('kind:bin'), count: 1, region: 'anywhere' }),
      node('place.obstacles', { amount: 'few', kind: 'rocks' }),
    ];
    st.rules = [
      node('rule', { label: 'Stored one', when: node('ev.deliver', { what: node('kind:berry'), into: node('kind:bin') }), then: [node('eff.reward', { amount: 3 })], limit: node('lim.perObject') }),
      node('rule', { label: 'Three in the basket', when: node('ev.tick'), if: [three], then: [node('eff.reward', { amount: 10 }), node('eff.end', { outcome: 'judge' })], limit: node('lim.once') }),
      node('rule', { label: 'Hurry up', when: node('ev.tick'), then: [node('eff.penalty', { amount: 0.02 })] }),
    ];
    st.success = three;
    st.maxTicks = 200;
    st.learner = { ...st.learner, skill: 'Stock the basket', focus: 'berry', destination: 'bin', episodes: 800, routine: {
      options: [
        node('opt.skill', { skill: 'Approach', aim: node('kind:berry'), when: node('cond.not', { inner: carrying() }) }),
        node('opt.skill', { skill: 'Approach', aim: node('kind:bin'), when: carrying() }),
        node('opt.action', { action: 'pick', when: node('cond.at', { actor: node('actor.pet'), what: node('kind:berry') }) }),
        node('opt.action', { action: 'drop', when: node('cond.at', { actor: node('actor.pet'), what: node('kind:bin') }) }),
      ],
      watch: [carrying(), node('cond.at', { actor: node('actor.pet'), what: node('kind:berry') }), node('cond.at', { actor: node('actor.pet'), what: node('kind:bin') })],
    } };
    const rev = trainAndSaveRoutine(g, p, st);
    if (process.env.DBG) console.log('GATE', rev.eval);
    expect(JSON.stringify(st)).not.toMatch(/"cardId":"(eff|cond|sense)\.note"/);
    expect(rev.eval.successRate).toBeGreaterThanOrEqual(0.6);
    expect(rev.eval.successRate).toBeGreaterThan(rev.eval.randomRate + 0.3);
  }, 120000);
});
