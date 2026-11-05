/**
 * Polish roadmap, phase 1: "Why isn't it learning?" — each finding reproduced by a small pen.
 */
import { describe, expect, it } from 'vitest';
import { node } from '../src/domain/spec';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { recipeStage } from './helpers';
import type { StageSpec } from '../src/domain/types';

function train(st: StageSpec, episodes = st.learner.episodes) {
  const t = new Trainer({ stage: st, episodes, traits: DEFAULT_TRAITS });
  while (!t.done) t.runChunk(1000, false);
  return buildReport(st, DEFAULT_TRAITS, null, t.policy(), null, undefined, undefined, t.practiceCounts());
}
const ids = (r: ReturnType<typeof train>) => (r.findings ?? []).map((f) => f.id);

/** "Keep 3 berries in the basket" as one sense skill: the case that failed silently. */
function threeBerries(): StageSpec {
  const st = recipeStage('go-to-berry');
  st.environment = [
    node('place.pet', { mode: 'random', x: 0, y: 0 }),
    node('place.random', { kind: node('kind:berry'), count: 4, region: 'anywhere' }),
    node('place.random', { kind: node('kind:bin'), count: 1, region: 'anywhere' }),
  ];
  st.abilities = ['move', 'pickup', 'drop'];
  const three = node('cond.compare', { quantity: node('q.stored', { what: node('kind:berry'), where: 'baskets' }), op: '>=', value: 3 });
  st.rules = [
    node('rule', { label: 'Three in the basket', when: node('ev.tick'), if: [three], then: [node('eff.reward', { amount: 10 }), node('eff.end', { outcome: 'judge' })], limit: node('lim.once') }),
    node('rule', { label: 'Hurry up', when: node('ev.tick'), then: [node('eff.penalty', { amount: 0.02 })] }),
  ];
  st.success = three;
  st.maxTicks = 120;
  st.learner = { ...st.learner, episodes: 3000, senses: [node('sense.nearest', { what: node('kind:berry') }), node('sense.nearest', { what: node('kind:bin') }), node('sense.carrying')] };
  return st;
}

describe('why isn’t it learning?', () => {
  it('the “keep 3 berries” sense skill: the big treat never happened, and it’s a long chain for one skill', () => {
    const r = train(threeBerries());
    expect(r.passed).toBe(false);
    expect(ids(r)).toEqual(expect.arrayContaining(['never-happened', 'long-chain']));
    const f = r.findings!.find((x) => x.id === 'never-happened')!;
    expect(f.text).toMatch(/“Three in the basket”.*practice tries/);
    expect(f.lesson).toBe('routines');
  }, 60000);

  it('can’t tell apart: carrying a berry to the basket without a Carrying sense', () => {
    const st = recipeStage('bring-it-home');
    st.environment.push(node('place.random', { kind: node('kind:berry'), count: 1, region: 'anywhere' })); // two berries: "no berry in sight" can't give carrying away
    st.rules.unshift(node('rule', { label: 'Picked up', when: node('ev.pickup', { actor: node('actor.pet'), what: node('kind:berry') }), then: [node('eff.reward', { amount: 1 })], limit: node('lim.perObject') }));
    st.learner = { ...st.learner, template: 'sense', episodes: 3000, senses: [node('sense.nearest', { what: node('kind:berry') }), node('sense.nearest', { what: node('kind:bin') })] };
    const r = train(st);
    expect(r.passed).toBe(false);
    const f = r.findings!.find((x) => x.id === 'cant-tell');
    expect(f?.text).toMatch(/can’t tell when it is carrying something/);
    expect(f?.text).toMatch(/“Carrying”/);
  }, 60000);

  it('can’t tell apart, in a routine: lesson 8’s Berry run, which doesn’t watch “at the basket”', async () => {
    const { newGame } = await import('../src/game/state');
    const { adoptPet, subskillsFor } = await import('../src/game/pets');
    const { trainAndSave } = await import('./helpers');
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    trainAndSave(g, p, recipeStage('go-to-berry'));
    const st = recipeStage('fetch-routine');
    st.learner.routine!.options.push(node('opt.skill', { skill: 'Approach', aim: node('kind:rock') }));
    st.learner.routine!.watch = st.learner.routine!.watch.slice(0, 2);
    const subs = subskillsFor(p);
    const t = new Trainer({ stage: st, episodes: st.learner.episodes, traits: DEFAULT_TRAITS, subskills: subs });
    while (!t.done) t.runChunk(1000, false);
    const r = buildReport(st, DEFAULT_TRAITS, null, t.policy(), null, undefined, subs, t.practiceCounts());
    const f = r.findings!.find((x) => x.id === 'cant-tell');
    expect(f?.text).toMatch(/standing at the basket/);
    expect(f?.text).toMatch(/Watches/);
    expect(f?.lesson).toBe('routines');
  }, 60000);

  it('loops: a barely trained walker paces in place, and the finding offers a replay and the Walls / Heading senses', () => {
    const st = recipeStage('go-to-berry');
    st.learner = { ...st.learner, senses: [node('sense.nearest', { what: node('kind:berry') })] };
    const r = train(st, 5);
    expect(ids(r)).toContain('loops');
    const f = r.findings!.find((x) => x.id === 'loops')!;
    expect(f.replay).toBeTruthy();
    expect(f.text).toMatch(/Walls and Heading/);
  }, 60000);

  it('a skill that passes gets no findings', () => {
    const r = train(recipeStage('go-to-berry'));
    expect(r.passed).toBe(true);
    expect(r.findings).toEqual([]);
  }, 60000);
});
