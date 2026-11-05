import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGame } from '../src/persistence/save';
import { SAVE_VERSION } from '../src/game/types';
import { classicApproachStage, recipeStage } from '../src/domain/recipes';
import { compileStage } from '../src/sim/compile';
import { FetchController, FetchRun, isDone } from '../src/learning/policies';
import { sensePolicyOf, activeRevision, getSkill, adoptPet } from '../src/game/pets';
import { step, nearest, objectsAt } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { validateStage } from '../src/domain/validate';
import { node } from '../src/domain/spec';
import { compileEncoder, presetSenses } from '../src/learning/senses';
import { navIndex, navObserve } from '../src/learning/features';
import { newGame } from '../src/game/state';
import { createRuntime, farmTick } from '../src/game/farm';
import type { StageSpec } from '../src/domain/types';
import { trainAndSave, onJob } from './helpers';

const fixture = readFileSync(new URL('./fixtures/save-v1.json', import.meta.url), 'utf8');
const expected: Record<string, string[]> = JSON.parse(readFileSync(new URL('./fixtures/save-v1-expected.json', import.meta.url), 'utf8'));

function train(stage: StageSpec) {
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: DEFAULT_TRAITS });
  while (!t.done) t.runChunk(500, false);
  return buildReport(stage, DEFAULT_TRAITS, null, t.policy(), null);
}

describe('M1: v1 saves keep working', () => {
  const r = parseGame(fixture);
  it('migrates v1 → current (v2 templates, v3 well, v4 coop)', () => {
    expect(r.ok).toBe(true);
    expect(r.diagnostics.some((d) => d.includes('v2'))).toBe(true);
    const g = r.game!;
    expect(g.version).toBe(SAVE_VERSION);
    expect(g.farm.world.areas?.map((a) => a.name)).toEqual(['coop']);
    expect(g.farm.world.objects.filter((o) => o.kind === 'well').length).toBe(1);
    expect(g.stages.every((s) => s.learner.template)).toBe(true);
    expect(g.pets[0].skills.map((k) => k.template)).toEqual(['sense', 'fetch']);
  });

  it('preset sense encoder reproduces the legacy movement state index exactly', () => {
    const cs = compileStage(recipeStage('avoid-pond'));
    const enc = compileEncoder(presetSenses(), 'berry');
    for (let i = 0; i < 200; i++) {
      const w = cs.generate(i);
      const o = navObserve(w, 'berry');
      if (!o || o.dist === 0) continue;
      expect(enc.index(enc.encode(w))).toBe(navIndex(o.dir, o.dist <= 1 ? 0 : o.dist <= 3 ? 1 : 2, o.blocked, o.hazard, o.heading));
    }
  });

  it('v1 skills act identically after migration', () => {
    const pet = r.game!.pets[0];
    const nav = sensePolicyOf(activeRevision(getSkill(pet, 'Approach'))!)!;
    const ctrl = FetchController.from(activeRevision(getSkill(pet, 'Fetch'))!.policy)!;
    for (const [id, stageId] of [['approach', 'go-to-berry'], ['avoid', 'avoid-pond']] as const) {
      // The v1 fixture's actions were recorded on the Approach pen from before the polish sweep (no obstacle practice).
      const cs = compileStage(stageId === 'go-to-berry' ? classicApproachStage() : recipeStage(stageId));
      for (let i = 0; i < 15; i++) {
        const w = cs.generate(900001 + i * 7);
        const acts: string[] = [];
        for (let t = 0; t < 30 && nearest(w, 'berry') && !objectsAt(w, w.pet.x, w.pet.y).some((o) => o.kind === 'berry'); t++) {
          const a = nav.act(w, 'berry');
          acts.push(a);
          step(w, a);
        }
        expect(acts).toEqual(expected[`${id}-${i}`]);
      }
    }
    const fcs = compileStage(recipeStage('bring-it-home'));
    for (let i = 0; i < 10; i++) {
      const w = fcs.generate(900001 + i * 7);
      const run = new FetchRun(ctrl, nav, 'berry', 'bin', 23, 80, new Rng(1), 0);
      const acts: string[] = [];
      for (let t = 0; t < 80; t++) { const a = run.next(w); if (isDone(a)) break; acts.push(a); step(w, a); }
      expect(acts).toEqual(expected[`fetch-${i}`]);
    }
  });
});

describe('M1: player-made skills from cards only', () => {
  it('“Wait for it” (stay ability + patience sense) beats random by ≥30 points', () => {
    const r = train(recipeStage('wait-for-it'));
    expect(r.after.successRate).toBeGreaterThanOrEqual(r.random.successRate + 0.3);
  });

  it('“Keep clear” (a survive lesson) beats random by ≥30 points', () => {
    const r = train(recipeStage('keep-clear'));
    expect(r.after.successRate).toBeGreaterThanOrEqual(r.random.successRate + 0.3);
  });

  it('surprise: a skill not in the starter set — “Shadow the bin” (end next to it, not on it)', () => {
    const s = recipeStage('wait-for-it');
    s.name = 'Shadow'; s.learner.skill = 'Shadow'; s.learner.focus = 'bin'; s.seed = 77;
    s.environment = [node('place.pet', { mode: 'random' }), node('place.random', { kind: node('kind:bin'), count: 1, region: 'anywhere' }), node('place.random', { kind: node('kind:rock'), count: 2, region: 'anywhere' })];
    const near = () => node('cond.near', { actor: node('actor.pet'), what: node('ref.target'), dist: 1 });
    const on = () => node('cond.at', { actor: node('actor.pet'), what: node('ref.target') });
    const goal = () => node('cond.and', { all: [near(), node('cond.not', { inner: on() }), node('cond.stayedFor', { actor: node('actor.pet'), ticks: 3 })] });
    s.rules = [
      node('rule', { label: 'Shadowing', when: node('ev.tick'), if: [goal()], then: [node('eff.reward', { amount: 10 }), node('eff.end', { outcome: 'judge' })], limit: node('lim.once') }),
      node('rule', { label: 'Close by', when: node('ev.stay', { actor: node('actor.pet') }), if: [near(), node('cond.not', { inner: on() })], then: [node('eff.reward', { amount: 0.3 })] }),
      node('rule', { label: 'Hurry', when: node('ev.tick'), then: [node('eff.penalty', { amount: 0.05 })] }),
    ];
    s.success = goal();
    s.learner.senses = [node('sense.nearest', { what: node('ref.target') }), node('sense.blocked'), node('sense.still')];
    expect(validateStage(s).filter((d) => d.severity === 'error')).toEqual([]);
    const r = train(s);
    expect(r.after.successRate).toBeGreaterThanOrEqual(r.random.successRate + 0.3);
  });

  it('validation guards the state budget and missing senses', () => {
    const s = recipeStage('wait-for-it');
    s.learner.senses = [node('sense.nearest', { what: node('ref.target') }), node('sense.nearest', { what: node('kind:rock') }), node('sense.blocked'), node('sense.hazards'), node('sense.heading')];
    expect(validateStage(s).some((d) => d.code === 'state-budget' && d.severity === 'error')).toBe(true);
    s.learner.senses = [];
    expect(validateStage(s).some((d) => d.code === 'no-senses')).toBe(true);
    s.learner.senses = [node('eff.reward')];
    expect(validateStage(s).some((d) => d.code === 'type-mismatch')).toBe(true);
  });

  it('a custom skill is saved with its senses and runs (re-aimed) on the farm', () => {
    const g = newGame();
    const pet = adoptPet(g, 'Pip', 'meadow');
    const st = recipeStage('wait-for-it');
    const rev = trainAndSave(g, pet, st);
    const k = getSkill(pet, 'Wait for it')!;
    expect(k.custom).toBe(true);
    expect(rev.learner?.senses.map((x) => x.cardId)).toEqual(['sense.nearest', 'sense.blocked', 'sense.heading', 'sense.still']);
    expect(k.signature).toContain('Patience');
    onJob(pet, 'skill', { skillName: 'Wait for it', target: 'bin' });
    const rt = createRuntime(g.farm);
    let reached = 0;
    for (let t = 0; t < 400; t++) {
      const res = farmTick(g, rt);
      if (res.fx.some((f) => f.type === 'celebrate')) reached++;
    }
    expect(reached).toBeGreaterThan(0);
    expect(g.farm.queue.some((q) => q.behaviorId === 'skill' && q.args.target === 'bin')).toBe(true);
  });
});
