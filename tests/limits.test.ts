import { describe, expect, it } from 'vitest';
import { DoubleQ } from '../src/learning/qtable';
import { Rng } from '../src/sim/rng';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { BRAINS, MAX_EPISODES, MAX_TICKS, stateSpaceSize } from '../src/learning/senses';
import { validateStage } from '../src/domain/validate';
import { node } from '../src/domain/spec';
import { newGame } from '../src/game/state';
import { adoptPet, getSkill, rollbackSkill } from '../src/game/pets';
import { exportSkillCard, importSkillCard } from '../src/game/skillcard';
import { exportLessonCard, importLessonCard } from '../src/game/lessoncard';
import type { StageSpec } from '../src/domain/types';
import { recipeStage, trainAndSave } from './helpers';

/** The basket lesson, item by item, with 6 senses: 279,936 situations (beyond a Standard brain). */
function bigLesson(): StageSpec {
  const st = recipeStage('empty-basket');
  st.abilities = ['move', 'pickup', 'drop']; st.maxTicks = 120;
  st.rules = [
    node('rule', { label: 'Sold one', when: node('ev.deliver', { what: node('kind:berry'), into: node('kind:home') }), then: [node('eff.reward', { amount: 3 })] }),
    node('rule', { label: 'All out', when: node('ev.tick'), if: [node('cond.storage', { level: 'empty' })], then: [node('eff.reward', { amount: 5 }), node('eff.end', { outcome: 'judge' })], limit: node('lim.once') }),
    node('rule', { label: 'Hurry up', when: node('ev.tick'), then: [node('eff.penalty', { amount: 0.03 })] }),
  ];
  // The recipe is a routine now; this lesson is the sense-skill version of it.
  st.learner = { skill: 'Empty the basket', template: 'sense', focus: 'bin', episodes: 8000, senses: [] };
  st.learner.senses = [node('sense.nearest', { what: node('kind:bin') }), node('sense.nearest', { what: node('kind:home') }), node('sense.carrying'), node('sense.stock'), node('sense.blocked'), node('sense.heading')];
  return st;
}
const errors = (st: StageSpec) => validateStage(st).filter((d) => d.severity === 'error').map((d) => d.code);

describe('the Big brain', () => {
  it('a sparse table computes exactly what the dense one does', () => {
    const dense = new DoubleQ(5000, 6), sparse = new DoubleQ(5000, 6, true);
    const rng = new Rng(3);
    for (let i = 0; i < 20000; i++) {
      const s = rng.int(800), a = rng.int(6), r = rng.next() * 2 - 1, n = rng.next() < 0.1 ? -1 : rng.int(800), coin = rng.next();
      dense.update(s, a, r, n, 0.95, 0.25, coin);
      sparse.update(s, a, r, n, 0.95, 0.25, coin);
    }
    expect(sparse.serialize()).toEqual(dense.serialize());
    for (let s = 0; s < 900; s++) expect(sparse.greedy(s, [0, 2, 4])).toBe(dense.greedy(s, [0, 2, 4]));
    const back = DoubleQ.deserialize(sparse.serialize());
    expect(back.sparse).toBe(false); // 5,000 situations fit a dense table
    const big = DoubleQ.deserialize({ ...sparse.serialize(), nS: 2_000_000 });
    expect(big.sparse).toBe(true);
    expect(big.visitedStates()).toBe(sparse.visitedStates());
    expect(big.value(17, 3)).toBe(back.value(17, 3));
  });

  it('a 6-sense lesson is refused by a Standard brain and learns with a Big one', () => {
    const st = bigLesson();
    expect(stateSpaceSize(st.learner.senses!)).toBe(279936);
    expect(errors(st)).toContain('too-many-senses');
    expect(errors(st)).toContain('state-budget');
    st.learner.brain = 'big';
    expect(errors(st)).toEqual([]);
    const t = new Trainer({ stage: st, episodes: 30000, traits: { ...DEFAULT_TRAITS } });
    while (!t.done) t.runChunk(2000, false);
    expect(t.q.sparse).toBe(true);
    expect(t.curve.length).toBeLessThanOrEqual(401); // long runs keep a bounded learning curve
    const r = buildReport(st, DEFAULT_TRAITS, null, t.policy(), null);
    expect(r.after.successRate).toBeGreaterThanOrEqual(0.55); // measured 70% at 30,000 tries (83% at 60,000)
    expect(r.random.successRate).toBeLessThan(0.3);
    const too = bigLesson(); too.learner.brain = 'big';
    too.learner.senses = [...too.learner.senses!, node('sense.hazards'), node('sense.still'), node('sense.rain')];
    expect(errors(too)).toContain('too-many-senses');
  }, 60000);

  it('keeps the tables of the active and newest revisions only; older ones keep their reports', () => {
    const s = newGame();
    const p = adoptPet(s, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    const st = bigLesson(); st.learner.brain = 'big'; st.learner.episodes = 300;
    for (let i = 0; i < 3; i++) trainAndSave(s, p, st);
    const k = getSkill(p, 'Empty the basket')!;
    expect(k.revisions.map((r) => !!r.tableDropped)).toEqual([true, false, false]);
    expect(k.revisions[0].eval).toBeDefined();
    expect(rollbackSkill(s, p, k.name, 1)).toBe(false);
    expect(rollbackSkill(s, p, k.name, 2)).toBe(true);
    // A Big skill travels as a skill card.
    const g2 = newGame(); const q = adoptPet(g2, 'Mochi', 'plum');
    expect(importSkillCard(g2, q, JSON.stringify(exportSkillCard(p, k.name))).ok).toBe(true);
  });
});

describe('longer runs and more steps', () => {
  it('limits: 100,000 tries for sense skills, 20,000 for others, 400 steps; lesson cards accept them', () => {
    expect(MAX_EPISODES).toEqual({ sense: 100000, composite: 20000 });
    expect(MAX_TICKS).toBe(400);
    expect(BRAINS.big.states).toBe(2000000);
    const st = recipeStage('go-to-berry');
    st.learner.episodes = 100000; st.maxTicks = 400;
    const g = newGame();
    expect(importLessonCard(g, JSON.stringify(exportLessonCard(st))).ok).toBe(true);
  });
});
