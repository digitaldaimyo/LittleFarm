/**
 * Pen & cards roadmap, phase 1: honest limits and a wiring audit.
 */
import { describe, expect, it } from 'vitest';
import { node } from '../src/domain/spec';
import { addObject, emptyStore, emptyWorld, step, type World } from '../src/sim/world';
import { compileStage } from '../src/sim/compile';
import { recipeStage } from './helpers';
import type { StageSpec } from '../src/domain/types';

/** Run scripted actions through a stage's rules; returns the treats from each step. */
function treats(stage: StageSpec, w: World, actions: Parameters<typeof step>[1][]): number[] {
  const cs = compileStage(stage);
  const rs = cs.newRuleState();
  return actions.map((a) => {
    const prev = { ...w.pet };
    const ev = step(w, a);
    return cs.evalStep(w, prev, ev, rs).reward;
  });
}

/** A pen with one berry and a basket on the same tile as the pet. */
function storagePen(): { stage: StageSpec; w: World } {
  const stage = recipeStage('go-to-berry');
  stage.rules = [node('rule', { label: 'Pickup treat', when: node('ev.pickup', { actor: node('actor.pet'), what: node('kind:berry') }), then: [node('eff.reward', { amount: 1 })], limit: node('lim.perObject') })];
  const w = emptyWorld(3, 3);
  addObject(w, 'berry', 0, 0);
  addObject(w, 'bin', 0, 0).store = emptyStore('bin');
  return { stage, w };
}

describe('storage keeps identity (the pick / store / pick-again loophole)', () => {
  it('“once per object”: a berry put into a basket and taken out again is the same berry — one treat, not one per trip', () => {
    const { stage, w } = storagePen();
    // pick it up, put it in the basket, take it out again, put it back, take it out again…
    const r = treats(stage, w, ['pick', 'drop', 'pick', 'drop', 'pick', 'drop', 'pick']);
    expect(r.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

// ————————————————————————————————————————————— storage identity, more cases

describe('storage identity: baskets, sheds, the house, the farm', () => {
  it('emptying a carried basket into a shed moves each item’s identity; taking one out of the shed is the same item', () => {
    const w = emptyWorld(3, 1);
    const berry = addObject(w, 'berry', 0, 0);
    addObject(w, 'bin', 0, 0).store = emptyStore('bin');
    const shed = addObject(w, 'shed', 1, 0); shed.store = emptyStore('shed');
    step(w, 'pick'); step(w, 'drop'); // the berry goes into the basket
    step(w, 'lift'); step(w, 'E'); // carry the basket to the shed
    const ev = step(w, 'drop'); // empties it there
    expect(ev.find((e) => e.type === 'deliver')?.objId).toBe(berry.id);
    step(w, 'W'); step(w, 'drop'); step(w, 'E'); // set the basket down, back to the shed
    const out = step(w, 'pick');
    expect(out.find((e) => e.type === 'pickup')?.objId).toBe(berry.id);
  });

  it('the farm tidies stored items away, yet taking one out again gives back the same id', () => {
    const w = emptyWorld(3, 1);
    const berry = addObject(w, 'berry', 0, 0);
    addObject(w, 'bin', 0, 0).store = emptyStore('bin');
    step(w, 'pick'); step(w, 'drop');
    w.objects = w.objects.filter((o) => !o.delivered); // what the farm does each tick
    const out = step(w, 'pick');
    expect(out.find((e) => e.type === 'pickup')?.objId).toBe(berry.id);
    expect(w.objects.filter((o) => o.id === berry.id)).toHaveLength(1);
  });

  it('stock with no known identity (old saves, Stocked storage) gets an id when it first comes out, and keeps it after', () => {
    const w = emptyWorld(2, 1);
    const b = addObject(w, 'bin', 0, 0); b.store = [{ kind: 'berry', n: 2 }];
    const first = step(w, 'pick').find((e) => e.type === 'pickup')!.objId!;
    step(w, 'drop');
    expect(step(w, 'pick').find((e) => e.type === 'pickup')!.objId).toBe(first);
  });
});

// ————————————————————————————————————————————— every card: compiles, reads, validates

import { REGISTRY } from '../src/domain/registry';
import { fits } from '../src/domain/typecheck';
import { effectiveOutput, validateNodes } from '../src/domain/validate';
import { describe as say } from '../src/domain/describe';
import { compileCondition, compileEvent, generateWorld } from '../src/sim/compile';
import { compileEncoder, radixOf } from '../src/learning/senses';
import { compilePlan } from '../src/game/plan';
import { socketActive } from '../src/domain/spec';
import type { CardDef, SpecNode, TypeExpr } from '../src/domain/types';

const PREFER: Record<string, string> = { Kind: 'kind:berry', Actor: 'actor.pet', Object: 'ref.it', Event: 'ev.pickup', Condition: 'cond.night', Quantity: 'q.count', Area: 'area.named', Limit: 'lim.once', Effect: 'eff.reward', Job: 'job.nap', Option: 'opt.action' };

/** A filled-in instance of a card: parameter defaults, and the simplest fitting card in every required slot. */
function sample(card: CardDef, depth = 0): SpecNode {
  const args: SpecNode['args'] = {};
  for (const p of card.params ?? []) args[p.id] = p.default as never;
  const n: SpecNode = { id: `s${depth}-${card.id}`, cardId: card.id, args };
  for (const s of card.sockets) {
    if (!s.required || !socketActive(n, s, card.params?.find((p) => p.id === s.when?.param)?.default)) continue;
    const child = filler(s.type, depth + 1);
    if (child) args[s.id] = (s.many ? [child] : child) as never;
  }
  return n;
}
function filler(t: TypeExpr, depth: number): SpecNode | null {
  const pref = PREFER[t.name] ? REGISTRY.cards.get(PREFER[t.name]) : undefined;
  if (pref && fits(t, effectiveOutput(REGISTRY, pref, 'berry'))) return sample(pref, depth);
  if (depth > 4) return null;
  const c = [...REGISTRY.cards.values()].find((x) => !x.retired && fits(t, effectiveOutput(REGISTRY, x, 'berry')));
  return c ? sample(c, depth) : null;
}

const ALL_KINDS = new Set([...REGISTRY.objects.keys(), '@crop', '@storage']);
function busyWorld(): World {
  const w = emptyWorld(6, 6);
  addObject(w, 'berry', 1, 0); addObject(w, 'home', 5, 5); addObject(w, 'well', 3, 3);
  const b = addObject(w, 'bin', 2, 2); b.store = [{ kind: 'berry', n: 2 }];
  addObject(w, 'chicken', 4, 1); addObject(w, 'rock', 0, 4); addObject(w, 'soil', 4, 4); addObject(w, 'gate', 2, 5);
  w.areas = [{ name: 'coop', x: 0, y: 5, w: 2, h: 1 }];
  w.petEnergy = 40; w.seedCoins = 5; w.notes = { leg: 1 };
  return w;
}

describe('wiring audit: every card in the registry', () => {
  const cards = [...REGISTRY.cards.values()].filter((c) => !c.retired);

  it('reads as a plain sentence with every slot filled (no “{slot}”, no undefined)', () => {
    for (const c of cards) {
      const text = say(sample(c), { petName: 'Pip', target: 'berry' });
      expect(text, c.id).not.toMatch(/[{}]|undefined|NaN/);
      expect(text.length, c.id).toBeGreaterThan(0);
    }
  });

  it('type-checks in its own slot type', () => {
    for (const c of cards) {
      const out = effectiveOutput(REGISTRY, c, 'berry');
      const errs = validateNodes([sample(c)], out, { placed: ALL_KINDS, areas: new Set(['coop']) }).filter((d) => d.severity === 'error' && d.code !== 'scope');
      expect(errs.map((d) => `${c.id}: ${d.message}`)).toEqual([]);
    }
  });

  it('compiles and runs where it belongs (conditions, events, measures, senses, placements, effects, limits, jobs)', () => {
    const w = busyWorld();
    for (const c of cards) {
      const n = sample(c);
      const g = c.presentation.group;
      const out = effectiveOutput(REGISTRY, c, 'berry').name;
      if (out === 'Condition') expect(typeof compileCondition(n)({ w, prev: w.pet }), c.id).toBe('boolean');
      else if (out === 'Event') expect(typeof compileEvent(n)({ type: 'tick', x: 0, y: 0 }), c.id).toBe('boolean');
      else if (out === 'Quantity') expect(typeof compileCondition({ id: 'q', cardId: 'cond.compare', args: { quantity: n, op: '>=', value: 0 } })({ w, prev: w.pet }), c.id).toBe('boolean');
      else if (out === 'Sense') {
        const v = compileEncoder([n], 'berry').encode(w);
        expect(v.length, c.id).toBe(1);
        expect(v[0], c.id).toBeGreaterThanOrEqual(0);
        expect(v[0], c.id).toBeLessThan(radixOf(n));
      } else if (out === 'Placement') {
        const st = recipeStage('go-to-berry');
        st.environment.push(n);
        expect(() => generateWorld(st, 3), c.id).not.toThrow();
      } else if (out === 'Effect' || out === 'Limit') {
        const st = recipeStage('go-to-berry');
        st.rules = [node('rule', { label: 'x', when: node('ev.tick'), then: out === 'Effect' ? [n] : [node('eff.reward', { amount: 1 })], ...(out === 'Limit' ? { limit: n } : {}) })];
        expect(() => compileStage(st), c.id).not.toThrow();
      } else if (out === 'Job') {
        expect(compilePlan({ guard: true, rows: [node('plan.responsibility', { label: 'r', if: [], do: n })] })[0].job, c.id).toBeTruthy();
      } else expect(['kind', 'actor', 'reference', 'rule', 'option'].includes(g) || ['Area', 'Responsibility', 'Rule', 'Option'].includes(out), `${c.id} (${out}) has no audit`).toBe(true);
    }
  });
});

// ————————————————————————————————————————————— events: each fires in its scenario, and only its own

type Scene = { setup: (w: World) => void; acts: Parameters<typeof step>[1][]; card?: () => SpecNode };
const SCENES: Record<string, Scene> = {
  'ev.reach': { setup: (w) => { addObject(w, 'berry', 1, 0); }, acts: ['E'] },
  'ev.enter': { setup: (w) => { addObject(w, 'pond', 1, 0); }, acts: ['E'] },
  'ev.pickup': { setup: (w) => { addObject(w, 'berry', 0, 0); }, acts: ['pick'] },
  'ev.drop': { setup: (w) => { addObject(w, 'berry', 0, 0); }, acts: ['pick', 'E', 'drop'] },
  'ev.deliver': { setup: (w) => { addObject(w, 'berry', 0, 0); addObject(w, 'home', 1, 0); }, acts: ['pick', 'E', 'drop'], card: () => node('ev.deliver', { what: node('kind:berry'), into: node('kind:home') }) },
  'ev.stay': { setup: () => {}, acts: ['wait'] },
  'ev.fill': { setup: (w) => { addObject(w, 'well', 0, 0); }, acts: ['water'] },
  'ev.water': { setup: (w) => { addObject(w, 'well', 0, 0); addObject(w, 'patch', 1, 0); }, acts: ['water', 'E', 'water'], card: () => node('ev.water', { actor: node('actor.pet'), what: node('kind:patch') }) },
  'ev.shoo': { setup: (w) => { addObject(w, 'chicken', 1, 0); }, acts: ['shoo'] },
  'ev.plant': { setup: (w) => { addObject(w, 'soil', 0, 0); }, acts: ['plant'], card: () => node('ev.plant', { actor: node('actor.pet'), what: node('kind:carrot') }) },
  'ev.lift': { setup: (w) => { addObject(w, 'bin', 0, 0).store = emptyStore('bin'); }, acts: ['lift'] },
  'ev.empty': { setup: (w) => { addObject(w, 'bin', 0, 0).store = [{ kind: 'berry', n: 1 }]; addObject(w, 'home', 1, 0); }, acts: ['lift', 'E', 'drop'], card: () => node('ev.empty', { what: node('kind:bin'), into: node('kind:home') }) },
  'ev.gate': { setup: (w) => { addObject(w, 'gate', 1, 0); }, acts: ['nudge'], card: () => node('ev.gate', { actor: node('actor.pet'), state: 'open' }) },
  'ev.bump': { setup: (w) => { addObject(w, 'rock', 1, 0); }, acts: ['E'] },
  'ev.entersArea': { setup: (w) => { addObject(w, 'chicken', 1, 0); w.areas = [{ name: 'coop', x: 2, y: 0, w: 2, h: 2 }]; }, acts: ['shoo'], card: () => node('ev.entersArea', { what: node('kind:chicken'), area: node('area.named', { name: 'coop' }) }) },
  'ev.leavesArea': { setup: (w) => { addObject(w, 'chicken', 1, 0); w.areas = [{ name: 'coop', x: 1, y: 0, w: 1, h: 2 }]; }, acts: ['shoo'], card: () => node('ev.leavesArea', { what: node('kind:chicken'), area: node('area.named', { name: 'coop' }) }) },
  'ev.peck': { setup: (w) => { addObject(w, 'crow', 3, 1); addObject(w, 'berry', 3, 0); addObject(w, 'berry', 2, 1); }, acts: Array(60).fill('wait'), card: () => node('ev.peck', { what: node('kind:berry') }) },
};

describe('wiring audit: event cards', () => {
  for (const [id, sc] of Object.entries(SCENES)) {
    it(`${id} fires in its scene${id === 'ev.stay' ? '' : ', and not in a pet standing still'}`, () => {
      const card = REGISTRY.cards.get(id)!;
      const match = compileEvent(sc.card ? sc.card() : sample(card));
      const w = emptyWorld(4, 2);
      sc.setup(w);
      const evs = sc.acts.flatMap((a) => step(w, a));
      expect(evs.some((e) => match(e)), `${id}: ${evs.map((e) => e.type).join(',')}`).toBe(true);
      if (id !== 'ev.stay') {
        const still = emptyWorld(4, 2);
        expect(step(still, 'wait').some((e) => match(e)), id).toBe(false);
      }
    });
  }
});

// ————————————————————————————————————————————— limits hold through every way an item can travel

describe('wiring audit: limits through pick up, put down, storage, lifting and emptying', () => {
  const rule = (limit: SpecNode, when = node('ev.pickup', { actor: node('actor.pet'), what: node('kind:berry') })) => {
    const st = recipeStage('go-to-berry');
    st.rules = [node('rule', { label: 'Treat', when, then: [node('eff.reward', { amount: 1 })], limit })];
    return st;
  };
  const loop: Parameters<typeof step>[1][] = ['pick', 'drop', 'pick', 'drop', 'pick', 'drop', 'pick'];
  const pen = (store: boolean) => { const w = emptyWorld(3, 2); addObject(w, 'berry', 0, 0); if (store) addObject(w, 'bin', 0, 0).store = emptyStore('bin'); return w; };
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  it('once: one treat per try, on the ground or through storage', () => {
    expect(sum(treats(rule(node('lim.once')), pen(false), loop))).toBe(1);
    expect(sum(treats(rule(node('lim.once')), pen(true), loop))).toBe(1);
  });
  it('once per object: one treat per berry, on the ground or through storage; a second berry pays once more', () => {
    expect(sum(treats(rule(node('lim.perObject')), pen(false), loop))).toBe(1);
    expect(sum(treats(rule(node('lim.perObject')), pen(true), loop))).toBe(1);
    const w = pen(true); addObject(w, 'berry', 1, 0);
    expect(sum(treats(rule(node('lim.perObject')), w, [...loop, 'drop', 'E', 'pick']))).toBe(2);
  });
  it('once per object on deliveries: putting the same berry into storage again doesn’t pay again', () => {
    const when = node('ev.deliver', { what: node('kind:berry'), into: node('kind:bin') });
    expect(sum(treats(rule(node('lim.perObject'), when), pen(true), loop))).toBe(1);
  });
  it('cooldown: at most one treat per window, however the berry travels', () => {
    const r = treats(rule(node('lim.cooldown', { ticks: 4 })), pen(true), loop);
    expect(sum(r)).toBe(2); // picks at steps 1, 3, 5, 7: paid at 1 and 5
  });
  it('lifting and emptying a basket: once per object holds for what was inside', () => {
    const w = emptyWorld(3, 1);
    addObject(w, 'berry', 0, 0);
    addObject(w, 'bin', 0, 0).store = emptyStore('bin');
    addObject(w, 'shed', 1, 0).store = emptyStore('shed');
    const st = rule(node('lim.perObject'), node('ev.deliver', { what: node('kind:berry'), into: node('kind:shed') }));
    // put it in the basket, carry the basket to the shed, empty it, take the berry out, put it back in the shed
    const r = treats(st, w, ['pick', 'drop', 'lift', 'E', 'drop', 'W', 'drop', 'E', 'pick', 'drop']);
    expect(sum(r)).toBe(1);
  });
});

// ————————————————————————————————————————————— the loophole probe: train tiny reward setups with each limit

import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';

/** A pen with a berry and a basket: the pickup treat uses `limit`; SUCCESS = the berry sold at the house. */
function probePen(limit: SpecNode): StageSpec {
  const st = recipeStage('go-to-berry');
  st.environment.push(node('place.random', { kind: node('kind:bin'), count: 1, region: 'anywhere' }), node('place.random', { kind: node('kind:home'), count: 1, region: 'anywhere' }));
  st.abilities = ['move', 'pickup', 'drop'];
  st.rules = [
    node('rule', { label: 'Pickup treat', when: node('ev.pickup', { actor: node('actor.pet'), what: node('kind:berry') }), then: [node('eff.reward', { amount: 2 })], limit }),
    node('rule', { label: 'Sold', when: node('ev.deliver', { what: node('kind:berry'), into: node('kind:home') }), then: [node('eff.reward', { amount: 5 }), node('eff.end', { outcome: 'judge' })], limit: node('lim.once') }),
  ];
  st.success = node('cond.delivered', { what: node('kind:berry'), into: node('kind:home'), count: 1 });
  st.maxTicks = 60;
  st.learner.episodes = 2500;
  return st;
}
function probe(limit: SpecNode) {
  const st = probePen(limit);
  const t = new Trainer({ stage: st, episodes: st.learner.episodes, traits: DEFAULT_TRAITS });
  while (!t.done) t.runChunk(500, false);
  const r = buildReport(st, DEFAULT_TRAITS, null, t.policy(), null);
  const pickRule = st.rules[0].id;
  const perTry = (r.after.ledger.find((e) => e.ruleId === pickRule)?.count ?? 0) / r.after.episodes;
  return { r, perTry };
}

describe('the loophole probe', () => {
  it('“every time”: the pet farms pickups (put it in the basket, take it out, again) — and the report names the berry', () => {
    const { r, perTry } = probe(node('lim.every'));
    expect(perTry).toBeGreaterThan(3);
    expect(r.exploits.length).toBeGreaterThan(0);
    expect(r.exploits[0].diagnostic.message).toMatch(/The same berry earned \d+ treats in one try/);
  }, 120000);

  it('“once per object”: with storage keeping identity, the same loop pays nothing — no loophole', () => {
    const { r, perTry } = probe(node('lim.perObject'));
    expect(perTry).toBeLessThanOrEqual(1);
    expect(r.exploits).toEqual([]);
  }, 120000);
});
