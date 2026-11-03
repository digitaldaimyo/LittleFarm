/**
 * Pen & cards roadmap, phase 3: qualifiers — the nearest / furthest X (from the pet or another thing), the fullest /
 * emptiest storage, what the pet carries — in conditions, measures and senses.
 */
import { describe, expect, it } from 'vitest';
import { node } from '../src/domain/spec';
import { describe as say } from '../src/domain/describe';
import { REGISTRY } from '../src/domain/registry';
import { buildHand } from '../src/domain/hand';
import { validateStage } from '../src/domain/validate';
import { addObject, emptyStore, emptyWorld, resolveSelector, step, type World } from '../src/sim/world';
import { compileCondition, resolveKind } from '../src/sim/compile';
import { compileEncoder } from '../src/learning/senses';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { recipeStage } from './helpers';
import type { SpecNode } from '../src/domain/types';

const pick = (q: SpecNode, w: World) => resolveSelector(w, resolveKind(q));
const holds = (c: SpecNode, w: World) => compileCondition(c)({ w, prev: w.pet });
const pet = () => node('actor.pet');

/** House at (0,0); berries at (1,0), (4,0) and (2,3); the pet at (3,3). */
function yard(): World {
  const w = emptyWorld(6, 5);
  addObject(w, 'home', 0, 0);
  addObject(w, 'berry', 1, 0); addObject(w, 'berry', 4, 0); addObject(w, 'berry', 2, 3);
  w.pet.x = 3; w.pet.y = 3;
  return w;
}

describe('qualifiers pick one object', () => {
  it('nearest / furthest, from the pet or from another thing', () => {
    const w = yard();
    const at = (q: SpecNode) => { const o = pick(q, w); return o ? [o.x, o.y] : null; };
    expect(at(node('obj.nearest', { what: node('kind:berry') }))).toEqual([2, 3]);
    expect(at(node('obj.furthest', { what: node('kind:berry') }))).toEqual([1, 0]); // 5 steps, vs (4,0) at 4
    expect(at(node('obj.nearest', { what: node('kind:berry'), from: node('kind:home') }))).toEqual([1, 0]);
    expect(at(node('obj.furthest', { what: node('kind:berry'), from: node('kind:home') }))).toEqual([2, 3]); // 5, vs (4,0) at 4
  });

  it('ties go to the first placed; nothing to point at → nothing (conditions false, measures 99, senses “none”)', () => {
    const w = emptyWorld(5, 1);
    const a = addObject(w, 'berry', 0, 0); addObject(w, 'berry', 4, 0);
    w.pet.x = 2;
    expect(pick(node('obj.nearest', { what: node('kind:berry') }), w)?.id).toBe(a.id);
    const none = node('obj.nearest', { what: node('kind:carrot') });
    expect(pick(none, w)).toBeUndefined();
    expect(holds(node('cond.at', { actor: pet(), what: none }), w)).toBe(false);
    expect(holds(node('cond.compare', { quantity: node('q.distance', { actor: pet(), what: none }), op: '==', value: 99 }), w)).toBe(true);
    expect(compileEncoder([node('sense.nearest', { what: none })], 'berry').encode(w)).toEqual([14]); // the "none" value
  });

  it('fullest / emptiest storage, and what the pet carries', () => {
    const w = emptyWorld(4, 1);
    const a = addObject(w, 'bin', 0, 0); a.store = [{ kind: 'berry', n: 2 }];
    const b = addObject(w, 'bin', 1, 0); b.store = [{ kind: 'berry', n: 5 }];
    const shed = addObject(w, 'shed', 2, 0); shed.store = emptyStore('shed');
    expect(pick(node('obj.fullest'), w)?.id).toBe(b.id);
    expect(pick(node('obj.emptiest'), w)?.id).toBe(shed.id);
    expect(pick(node('obj.emptiest', { what: node('kind:bin') }), w)?.id).toBe(a.id);
    expect(pick(node('obj.carried'), w)).toBeUndefined();
    addObject(w, 'berry', 3, 0); w.pet.x = 3; step(w, 'pick');
    expect(pick(node('obj.carried'), w)?.kind).toBe('berry');
  });
});

describe('qualifiers in conditions, measures and senses', () => {
  it('“the nearest basket is full”, “stored in the nearest basket ≥ 3”, “at the furthest berry from the house”', () => {
    const w = emptyWorld(5, 1);
    const near = addObject(w, 'bin', 1, 0); near.store = [{ kind: 'berry', n: 6 }];
    const far = addObject(w, 'bin', 4, 0); far.store = [{ kind: 'berry', n: 1 }];
    const nearest = node('obj.nearest', { what: node('kind:bin') });
    expect(holds(node('cond.storageOf', { which: nearest, level: 'full' }), w)).toBe(true);
    w.pet.x = 4;
    expect(holds(node('cond.storageOf', { which: nearest, level: 'full' }), w)).toBe(false); // the nearest one is now the other
    expect(holds(node('cond.compare', { quantity: node('q.stored', { what: node('kind:berry'), in: node('obj.fullest') }), op: '>=', value: 6 }), w)).toBe(true);
    const y = yard();
    const furthest = node('obj.furthest', { what: node('kind:berry'), from: node('kind:home') });
    expect(holds(node('cond.at', { actor: pet(), what: furthest }), y)).toBe(false);
    y.pet.x = 2; y.pet.y = 3;
    expect(holds(node('cond.at', { actor: pet(), what: furthest }), y)).toBe(true);
    expect(holds(node('cond.at', { actor: pet(), what: node('kind:berry') }), y)).toBe(true);
  });

  it('a sense aimed at “the furthest berry from the house” points there, not at the nearest berry', () => {
    const w = yard();
    w.pet.x = 1; w.pet.y = 1; // nearest berry: (1,0), straight north; the furthest from the house: (2,3), south-east
    const furthest = compileEncoder([node('sense.nearest', { what: node('obj.furthest', { what: node('kind:berry'), from: node('kind:home') }) })], 'berry').encode(w)[0];
    const plain = compileEncoder([node('sense.nearest', { what: node('kind:berry') })], 'berry').encode(w)[0];
    expect(furthest).not.toBe(plain);
    expect(Math.floor(furthest / 3)).toBe((1 + 1) * 3 + (1 + 1)); // dx > 0, dy > 0
  });

  it('they read naturally, fit wherever a thing does, and are offered in the hand', () => {
    const ctx = { petName: 'Pip', target: 'berry' };
    expect(say(node('obj.furthest', { what: node('kind:berry'), from: node('kind:home') }), ctx)).toBe('the furthest berry from home');
    expect(say(node('cond.storageOf', { which: node('obj.nearest', { what: node('kind:bin') }), level: 'full' }), ctx)).toBe('the nearest basket is full');
    expect(say(node('q.stored', { what: node('kind:berry'), in: node('obj.nearest', { what: node('kind:bin') }) }), ctx)).toBe('berry stored in the nearest basket');
    const st = recipeStage('go-to-berry');
    const hand = buildHand(REGISTRY, { socket: REGISTRY.cards.get('cond.at')!.sockets.find((x) => x.id === 'what')!.type, stage: st, unlocks: new Set(), recent: [], favorites: [], itBound: false, placing: false });
    const ids = [...hand.recommended, ...Object.values(hand.bySheet).flat()].map((c) => c.card.id);
    expect(ids).toEqual(expect.arrayContaining(['obj.nearest', 'obj.furthest']));
  });

  it('validation: not inside an event; a warning for rewarding “closer to the nearest …”', () => {
    const st = recipeStage('go-to-berry');
    st.rules = [
      node('rule', { label: 'bad', when: node('ev.reach', { actor: pet(), what: node('obj.nearest', { what: node('kind:berry') }) }), then: [node('eff.reward', { amount: 1 })] }),
      node('rule', { label: 'trap', when: node('ev.tick'), if: [node('cond.closer', { actor: pet(), what: node('obj.nearest', { what: node('kind:berry') }) })], then: [node('eff.reward', { amount: 0.1 })] }),
    ];
    const d = validateStage(st);
    expect(d.some((x) => x.code === 'qualifier-in-event' && x.severity === 'error')).toBe(true);
    expect(d.some((x) => x.code === 'moving-target' && x.severity === 'warning')).toBe(true);
    st.environment.push(node('place.random', { kind: node('obj.nearest', { what: node('kind:berry') }), count: 1, region: 'anywhere' }));
    expect(validateStage(st).some((x) => x.code === 'qualifier-in-placement')).toBe(true);
  });
});

describe('gate: a pen using “the furthest berry from the house” trains above random, and transfers', () => {
  it('walk to the furthest berry from the house (not just any berry)', () => {
    const st = recipeStage('go-to-berry');
    const furthest = () => node('obj.furthest', { what: node('kind:berry'), from: node('kind:home') });
    st.environment = [
      node('place.pet', { mode: 'random', x: 0, y: 0 }),
      node('place.random', { kind: node('kind:berry'), count: 3, region: 'anywhere' }),
      node('place.random', { kind: node('kind:home'), count: 1, region: 'anywhere' }),
      node('place.random', { kind: node('kind:rock'), count: 2, region: 'anywhere' }),
    ];
    const there = () => node('cond.at', { actor: pet(), what: furthest() });
    st.rules = [
      node('rule', { label: 'At the far berry', when: node('ev.tick'), if: [there()], then: [node('eff.reward', { amount: 10 }), node('eff.end', { outcome: 'judge' })], limit: node('lim.once') }),
      node('rule', { label: 'Hurry up', when: node('ev.tick'), then: [node('eff.penalty', { amount: 0.05 })] }),
    ];
    st.success = there();
    st.learner = { ...st.learner, skill: 'Far berry', episodes: 3000, senses: [node('sense.nearest', { what: furthest() }), node('sense.blocked')] };
    expect(validateStage(st).filter((x) => x.severity === 'error')).toEqual([]);
    const t = new Trainer({ stage: st, episodes: st.learner.episodes, traits: DEFAULT_TRAITS });
    while (!t.done) t.runChunk(1000, false);
    const r = buildReport(st, DEFAULT_TRAITS, null, t.policy(), null);
    if (process.env.DBG) console.log('GATE', r.after.successRate, r.random.successRate, r.transfer.successRate);
    expect(r.after.successRate).toBeGreaterThanOrEqual(0.8);
    expect(r.after.successRate).toBeGreaterThan(r.random.successRate + 0.4);
    expect(r.transfer.successRate).toBeGreaterThanOrEqual(0.6); // bigger, busier pens it never saw
  }, 60000);
});
