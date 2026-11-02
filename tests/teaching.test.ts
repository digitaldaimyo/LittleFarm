import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RECIPES, recipeStage } from '../src/domain/recipes';
import { node, isNode } from '../src/domain/spec';
import type { StageSpec } from '../src/domain/types';
import { REGISTRY } from '../src/domain/registry';
import { nominal } from '../src/domain/typecheck';
import { buildHand } from '../src/domain/hand';
import { validateStage, validateNodes } from '../src/domain/validate';
import { applyRepair } from '../src/domain/repairs';
import { describe as say, describeRule } from '../src/domain/describe';
import { compileCondition, compileStage, withTarget } from '../src/sim/compile';
import { cloneWorld, legalActions, step } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { compileEncoder } from '../src/learning/senses';
import { rolloutChecks } from '../src/learning/lint';
import { SensePolicy, SkillRun, isDone } from '../src/learning/policies';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { parseGame, serializeGame } from '../src/persistence/save';
import { newGame } from '../src/game/state';
import { adoptPet, getSkill } from '../src/game/pets';
import { exportSkillCard, importSkillCard } from '../src/game/skillcard';
import { SAVE_VERSION } from '../src/game/types';
import { trainAndSave } from './helpers';

const pet = () => node('actor.pet');
const shoo = () => node('ev.shoo', { actor: pet(), what: node('kind:chicken') });

/** The case that started the plan: a herding pen where the goal is "shoo a chicken". */
function shooLesson(success: 'has' | 'near', end: 'judge' | 'success' = 'judge', seed = 101): StageSpec {
  const st = recipeStage('herd-chicken');
  st.seed = seed;
  st.abilities = ['move', 'shoo'];
  st.learner.senses = [node('sense.nearest', { what: node('ref.target') }), node('sense.blocked'), node('sense.heading')];
  st.learner.episodes = 2000;
  st.rules = [node('rule', { label: 'Shooed!', when: shoo(), then: [node('eff.reward', { amount: 10 }), node('eff.end', { outcome: end })] })];
  st.success = success === 'has' ? node('cond.happened', { event: shoo(), count: 1 }) : node('cond.near', { actor: pet(), what: node('kind:chicken'), dist: 1 });
  return st;
}

/** Put the pet next to the chicken in a generated layout. */
function nextToChicken(st: StageSpec) {
  const cs = compileStage(st);
  for (let seed = 1; seed < 200; seed++) {
    const w = cs.generate(seed);
    const ch = w.objects.find((o) => o.kind === 'chicken')!;
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [ch.x + dx, ch.y + dy]).find(([x, y]) => x >= 0 && y >= 0 && x < w.w && y < w.h && !w.objects.some((o) => o.x === x && o.y === y));
    if (!spot) continue;
    [w.pet.x, w.pet.y] = spot;
    return { cs, w };
  }
  throw new Error('no layout');
}

describe('memory: “Has done…”, “Just…”, the event tally', () => {
  it('the world tallies notable events per try; clones copy it; new layouts start empty', () => {
    const { w } = nextToChicken(shooLesson('has'));
    expect(w.tally ?? {}).toEqual({});
    step(w, 'shoo');
    expect(Object.keys(w.tally!).some((k) => k.startsWith('shoo|chicken'))).toBe(true);
    const c = cloneWorld(w);
    step(c, 'shoo');
    expect(Object.values(w.tally!)[0][0]).toBe(1); // the clone's tally is its own
    expect(Object.keys(w.tally!).some((k) => k.startsWith('move') || k.startsWith('tick'))).toBe(false);
  });

  it('Has done… (with a count), Just…, Any of', () => {
    const st = shooLesson('has');
    st.rules = [];
    st.success = node('cond.any', { any: [node('cond.happened', { event: shoo(), count: 2 }), node('cond.just', { event: node('ev.bump', { actor: pet() }) })] });
    const { cs, w } = nextToChicken(st);
    expect(cs.isSuccess(w)).toBe(false);
    step(w, 'shoo');
    expect(cs.isSuccess(w)).toBe(false); // once is not twice
    // Walk back next to the chicken and shoo again.
    const ch = w.objects.find((o) => o.kind === 'chicken')!;
    w.pet.x = ch.x + (ch.x > 0 ? -1 : 1); w.pet.y = ch.y;
    if (w.objects.some((o) => o.x === w.pet.x && o.y === w.pet.y)) { w.pet.x = ch.x; w.pet.y = ch.y + (ch.y > 0 ? -1 : 1); }
    step(w, 'shoo');
    expect(cs.isSuccess(w)).toBe(true);
  });

  it('“Done … yet?” senses before vs after; a farm skill run counts from its own start', () => {
    const { w } = nextToChicken(shooLesson('has'));
    const enc = compileEncoder([node('sense.did', { event: shoo() })], 'chicken');
    expect(enc.size).toBe(2);
    expect(enc.encode(w)).toEqual([0]);
    step(w, 'shoo');
    expect(enc.encode(w)).toEqual([1]);
    // A skill run that starts after that shoo: its "Has done…" counts from the run's start (farm rule).
    const has = compileStage({ ...shooLesson('has'), rules: [] });
    const goal = withTarget('chicken', () => compileCondition(node('cond.happened', { event: shoo(), count: 1 })));
    const run = new SkillRun({ act: () => 'wait' } as unknown as SensePolicy, 'chicken', 10, (x, base) => goal({ w: x, prev: x.pet, base }));
    expect(has.isSuccess(w)).toBe(true); // in a pen, the try's shoo counts
    const a = run.next(w);
    step(w, isDone(a) ? 'wait' : a);
    const b = run.next(w);
    expect(isDone(b)).toBe(false); // the earlier shoo doesn't count for this run
  });
});

describe('End try says what it means', () => {
  it('judged by SUCCESS / counts as a success ✓ / counts as a miss ✗', () => {
    for (const [outcome, expectSuccess] of [['judge', false], ['success', true], ['fail', false]] as const) {
      const { cs, w } = nextToChicken(shooLesson('near', outcome as 'judge'));
      if (outcome === 'fail') (cs.spec.rules[0].args.then as ReturnType<typeof node>[])[1].args.outcome = 'fail';
      const cs2 = compileStage(cs.spec);
      const prev = { x: w.pet.x, y: w.pet.y };
      const out = cs2.evalStep(w, prev, step(w, 'shoo'), cs2.newRuleState());
      expect(out.end).toBe(outcome);
      // After the shoo the chicken is 2 steps away, so "within 1" no longer holds: only ✓ makes it a success.
      expect(cs2.isSuccess(w)).toBe(expectSuccess);
      expect(cs2.isFail(w)).toBe(outcome === 'fail');
    }
  });

  it('recipes keep their scores: no recipe ends a try “as a miss” while SUCCESS holds (random rollouts)', () => {
    for (const r of RECIPES) {
      const st = recipeStage(r.id);
      const cs = compileStage(st);
      const failRules = new Set(cs.rules.filter((x) => x.end === 'fail').map((x) => x.id));
      if (!failRules.size) continue;
      const rng = new Rng(7);
      for (let i = 0; i < 60; i++) {
        const w = cs.generate(800001 + i);
        const rs = cs.newRuleState();
        while (w.tick < st.maxTicks) {
          const acts = legalActions(w, st.abilities);
          const prev = { x: w.pet.x, y: w.pet.y };
          const out = cs.evalStep(w, prev, step(w, acts[rng.int(acts.length)]), rs);
          if (!out.end) continue;
          if (out.hits.some((h) => failRules.has(h.ruleId) && h.end === 'fail')) {
            delete w.verdict; // what the old rules would have judged
            expect(cs.isSuccess(w), `${r.id}: a miss-ending rule fired while SUCCESS held`).toBe(false);
          }
          break;
        }
      }
    }
  });
});

describe('the case that started this: “end on shoo chicken”', () => {
  it('is expressible from cards and learns (gate: ≥ 30 points over random, held out)', () => {
    const st = shooLesson('has');
    expect(validateStage(st).filter((d) => d.severity === 'error')).toEqual([]);
    const t = new Trainer({ stage: st, episodes: st.learner.episodes, traits: DEFAULT_TRAITS });
    while (!t.done) t.runChunk(1000, false);
    const r = buildReport(st, DEFAULT_TRAITS, null, t.policy(), null);
    expect(r.random.successRate).toBeGreaterThan(0.1); // random can shoo now (it couldn't before: see below)
    expect(r.after.successRate - r.random.successRate).toBeGreaterThanOrEqual(0.3);
  });

  it('the old setup (“within 1 of chicken” as SUCCESS) is caught by the measured check, and its repair works', () => {
    const st = shooLesson('near');
    const d = rolloutChecks(st);
    const w = d.find((x) => x.code === 'goal-rule-shadowed');
    expect(w?.repair?.action).toBe('success-has-event');
    applyRepair(st, w!.repair!.action, w!.repair!.ruleId);
    expect(st.success?.cardId).toBe('cond.happened');
    expect(rolloutChecks(st)).toEqual([]);
    expect(validateStage(st).filter((x) => x.severity !== 'info')).toEqual([]);
  });

  it('measured checks stay quiet on every recipe', () => {
    for (const r of RECIPES) expect(rolloutChecks(recipeStage(r.id)), r.id).toEqual([]);
  });

  it('the random baseline uses every ability (it used to skip Shoo and Stay)', () => {
    expect(legalActions(cloneWorld(compileStage(shooLesson('has')).generate(1)), ['move', 'stay', 'shoo'])).toEqual(expect.arrayContaining(['wait', 'shoo']));
  });
});

describe('validation and repairs for memory', () => {
  it('a treat that depends on “Has done…” suggests the “Done … yet?” sense; the repair adds it', () => {
    const st = shooLesson('has');
    st.rules.push(node('rule', { label: 'Then go home', when: node('ev.tick'), if: [node('cond.happened', { event: shoo(), count: 1 })], then: [node('eff.reward', { amount: 0.1 })] }));
    const warn = validateStage(st).find((d) => d.code === 'memory-unsensed');
    expect(warn?.repair?.action).toBe('add-did-sense');
    applyRepair(st, warn!.repair!.action, warn!.repair!.ruleId);
    expect(st.learner.senses!.some((s) => s.cardId === 'sense.did')).toBe(true);
    expect(validateStage(st).some((d) => d.code === 'memory-unsensed')).toBe(false);
    // As the whole SUCCESS (once) it needs no sense: the try ends right then.
    expect(validateStage(shooLesson('has')).some((d) => d.code === 'memory-unsensed')).toBe(false);
  });

  it('“Has done… every step” is flagged; farm plans accept memory (since phase C)', () => {
    const st = shooLesson('has');
    st.success = node('cond.happened', { event: node('ev.tick'), count: 1 });
    expect(validateStage(st).some((d) => d.code === 'memory-every-step')).toBe(true);
    const row = node('plan.row', { label: 'x', if: [node('cond.happened', { event: shoo(), count: 1 })], do: node('job.nap') });
    expect(validateNodes([row], nominal('PlanRow'), { placed: new Set(['chicken']), areas: new Set(['coop']) }).filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('the hand knows what the lesson is about', () => {
  const ctx = (st: StageSpec, socket: string, role: 'success' | 'when') => ({ socket: nominal(socket), stage: st, unlocks: new Set(['custom', 'fetch', 'avoid', 'routines', 'carrots']), recent: [], favorites: [], itBound: false, placing: false, role });
  it('a Shoo lesson recommends Shoos first for WHEN and Has done… first for SUCCESS; More cards come in groups', () => {
    const st = shooLesson('has');
    const when = buildHand(REGISTRY, ctx(st, 'Event', 'when'));
    expect(when.recommended[0].card.id).toBe('ev.shoo');
    const succ = buildHand(REGISTRY, ctx(st, 'Condition', 'success'));
    expect(succ.recommended[0].card.id).toBe('cond.happened');
    expect(succ.recommended.map((c) => c.card.id)).not.toContain('cond.delivered'); // nothing carryable in a herding pen
    expect(Object.keys(succ.bySheet)).toEqual(expect.arrayContaining(['Conditions · Combine', 'Conditions · Where']));
    // A plain movement lesson still leads with Reaches.
    expect(buildHand(REGISTRY, ctx(recipeStage('go-to-berry'), 'Event', 'when')).recommended[0].card.id).toBe('ev.reach');
  });
});

describe('plain sentences', () => {
  it('every recipe’s rules and SUCCESS read as sentences with no template left over', () => {
    for (const r of RECIPES) {
      const st = recipeStage(r.id);
      const c = { petName: 'Pip', target: st.learner.focus };
      for (const rule of st.rules) expect(describeRule(rule, c)).not.toMatch(/[{}]/);
      expect(say(st.success, c)).not.toMatch(/[{}]/);
    }
    expect(say(node('cond.and', { all: [node('cond.happened', { event: shoo(), count: 1 }), node('cond.near', { actor: pet(), what: node('kind:chicken'), dist: 2 })] }), { petName: 'Pip' }))
      .toBe('“Pip shoos chicken” has happened and Pip within 2 of chicken');
  });
});

describe('saves and skill cards (v5)', () => {
  it('a v4 save’s “End try (done ✓)” becomes “judged by SUCCESS” — same meaning, new name', () => {
    const g = JSON.parse(serializeGame(newGame()));
    g.version = 4;
    g.game.version = 4;
    g.game.stages[0].rules = [node('rule', { label: 'old', when: node('ev.tick'), then: [node('eff.end', { outcome: 'success' }), node('eff.end', { outcome: 'fail' })] })];
    const r = parseGame(JSON.stringify(g));
    expect(r.ok).toBe(true);
    const then = r.game!.stages[0].rules[0].args.then as ReturnType<typeof node>[];
    expect(then.map((e) => e.args.outcome)).toEqual(['judge', 'fail']);
    expect(SAVE_VERSION).toBe(9);
  });

  it('the v1 fixture save migrates all the way and its old “done ✓” ends are judged by SUCCESS', () => {
    const r = parseGame(readFileSync(new URL('./fixtures/save-v1.json', import.meta.url), 'utf8'));
    expect(r.ok).toBe(true);
    const outcomes: string[] = [];
    const visit = (v: unknown) => { if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') { const o = v as { cardId?: string; args?: { outcome?: string } }; if (o.cardId === 'eff.end') outcomes.push(String(o.args?.outcome)); Object.values(o).forEach(visit); } };
    visit(r.game);
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes).not.toContain('success');
  });

  it('version-1 skill cards are migrated on import', () => {
    const s = newGame();
    const p = adoptPet(s, 'Pip', 'meadow');
    trainAndSave(s, p, shooLesson('has'));
    const card = exportSkillCard(p, 'Herd')!;
    expect(card.version).toBe(2);
    const old = JSON.parse(JSON.stringify(card));
    old.version = 1;
    (old.revision.stage.rules[0].args.then as { args: { outcome: string } }[])[1].args.outcome = 'success'; // how v1 cards said "done ✓"
    const q = adoptPet(s, 'Mochi', 'plum');
    const res = importSkillCard(s, q, JSON.stringify(old));
    expect(res.ok).toBe(true);
    const imported = getSkill(q, 'Herd')!.revisions[0].stage!;
    const end = (imported.rules[0].args.then as unknown[]).filter(isNode).find((e) => e.cardId === 'eff.end')!;
    expect(end.args.outcome).toBe('judge');
  });
});
