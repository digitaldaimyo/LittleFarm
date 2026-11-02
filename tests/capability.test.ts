import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill, sensePolicyOf } from '../src/game/pets';
import { allowedOnFarm, capabilityOf, deployedRevision, eligibility, runCapability } from '../src/game/capability';
import { createRuntime, farmTick } from '../src/game/farm';
import { NavRun, SkillRun, isDone } from '../src/learning/policies';
import { OPTION_GAMMA_PER_TICK, Trainer } from '../src/learning/trainer';
import { addObject, aimIs, emptyStore, emptyWorld, nearest, objIs, step } from '../src/sim/world';
import { compileCondition, generateWorld, withTarget } from '../src/sim/compile';
import { node } from '../src/domain/spec';
import { Rng } from '../src/sim/rng';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import type { GameState, Pet } from '../src/game/types';
import { recipeStage, trainAndSave, trainAndSaveRoutine } from './helpers';

function pet(): { s: GameState; p: Pet } {
  const s = newGame();
  const p = adoptPet(s, 'Pip', 'meadow');
  p.traits = { ...DEFAULT_TRAITS };
  trainAndSave(s, p, recipeStage('go-to-berry'));
  return { s, p };
}
const runOut = (r: { next(w: ReturnType<typeof emptyWorld>): ReturnType<SkillRun['next']> }, w: ReturnType<typeof emptyWorld>, n = 20) => {
  let st = r.next(w);
  for (let i = 0; i < n && !isDone(st); i++) st = r.next(w);
  return isDone(st) ? st.done : 'running';
};

describe('one outcome protocol', () => {
  it('walking out of time is a timeout; a survive skill succeeds at time-up only if it survived', () => {
    const { p } = pet();
    const w = generateWorld(recipeStage('go-to-berry'), 4);
    const nav = sensePolicyOf(activeRevision(getSkill(p, 'Approach'))!);
    expect(runOut(new NavRun(nav, 'berry', 2, new Rng(1)), w)).toBe('timeout');
    // Keep clear (survive): at time-up, dry → success; standing in the pond → fail.
    const kc = recipeStage('keep-clear');
    const fail = withTarget('pond', () => compileCondition(kc.fail!));
    const dry = generateWorld(kc, 3);
    const mk = () => new SkillRun(nav!, 'pond', 2, null, null, (world) => !fail({ w: world, prev: world.pet }));
    expect(runOut(mk(), dry)).toBe('success');
    const pond = dry.objects.find((o) => o.kind === 'pond')!;
    const wet = { ...dry, pet: { ...dry.pet, x: pond.x, y: pond.y } };
    expect(runOut(mk(), wet)).toBe('fail');
  });
});

describe('capabilities: which revision runs, and whether the farm may use it', () => {
  it('runs the active revision, or the pinned one (while its table is kept)', () => {
    const { s, p } = pet();
    trainAndSave(s, p, recipeStage('go-to-berry'));
    const k = getSkill(p, 'Approach')!;
    expect(deployedRevision(k)!.rev).toBe(2);
    k.pinnedRev = 1;
    expect(deployedRevision(k)!.rev).toBe(1);
    expect(capabilityOf(k)!.pinned).toBe(true);
    k.revisions[0].tableDropped = true;
    expect(deployedRevision(k)!.rev).toBe(2); // a pin to a dropped table falls back to the active revision
  });

  it('certified skills are usable on the farm by default; others only when opted in; any can be switched off', () => {
    const { s, p } = pet();
    const k = getSkill(p, 'Approach')!;
    expect(allowedOnFarm(k)).toBe(k.revisions.some((r) => r.eval.passed));
    const weak = recipeStage('wait-for-it'); weak.learner.episodes = 50; // not enough practice to certify
    trainAndSave(s, p, weak);
    const w4 = getSkill(p, 'Wait for it')!;
    expect(allowedOnFarm(w4)).toBe(false);
    w4.farmUse = 'on';
    expect(allowedOnFarm(w4)).toBe(true);
    k.farmUse = 'off';
    expect(allowedOnFarm(k)).toBe(false);
    const el = eligibility(s, p, capabilityOf(k, 'home')!, { forFarm: true });
    expect(!el.ok && el.reason).toBe('not_allowed');
    expect(eligibility(s, p, capabilityOf(k, 'home')!).ok).toBe(true); // assigning it directly is the player's call
  });

  it('says why a capability can’t run: missing skill, nothing to aim at, paws full, too tired', () => {
    const { s, p } = pet();
    const k = getSkill(p, 'Approach')!;
    const reason = (cap: ReturnType<typeof capabilityOf>, opts = {}) => { const e = eligibility(s, p, cap!, opts); return e.ok ? 'ok' : e.reason; };
    expect(reason({ ...capabilityOf(k)!, name: 'Juggling' })).toBe('missing_skill');
    expect(reason(capabilityOf(k, 'pumpkin'))).toBe('no_target');
    expect(reason(capabilityOf(k, 'home'))).toBe('ok'); // (a new farm's bushes fruit on its first tick)
    const w = s.farm.world;
    const held = addObject(w, 'carrot', w.pet.x, w.pet.y); held.carried = true; w.pet.carrying = held.id;
    expect(reason(capabilityOf(k, 'home'))).toBe('hands_full'); // Approach can't put things down
    w.pet.carrying = null; held.carried = false;
    p.energy = 10;
    expect(reason(capabilityOf(k, 'home'), { tired: 25 })).toBe('too_tired');
  });
});

describe('trait aims: any ripe crop, storage with room', () => {
  it('match any crop kind, and storage that has room for what the pet carries', () => {
    expect(['berry', 'carrot', 'pumpkin', 'sunflower'].every((k) => aimIs(k, '@crop'))).toBe(true);
    expect(aimIs('bush', '@crop') || aimIs('soil', '@crop') || aimIs('egg', '@crop')).toBe(false);
    const w = emptyWorld(8, 3);
    addObject(w, 'carrot', 6, 0);
    addObject(w, 'pumpkin', 2, 0);
    expect(nearest(w, '@crop')!.kind).toBe('pumpkin');
    const full = addObject(w, 'bin', 1, 2); full.store = [{ kind: 'carrot', n: 6 }];
    const room = addObject(w, 'bin', 5, 2); room.store = emptyStore('bin');
    const held = addObject(w, 'carrot', 0, 0); held.carried = true; w.pet.carrying = held.id;
    expect(objIs(w, full, '@storage')).toBe(false);
    expect(nearest(w, '@storage')!.id).toBe(room.id);
    // Conditions and events read the aim too.
    w.pet.x = 2; w.pet.y = 0;
    expect(withTarget('@crop', () => compileCondition(node('cond.at', { actor: node('actor.pet'), what: node('ref.target') })))({ w } as never)).toBe(true);
    step(w, 'drop');
  });

  it('a learned Approach aimed at “any ripe crop” walks to whichever crop is nearest', () => {
    const { s, p } = pet();
    s.progress.unlocks.push('carrots');
    p.assignment = { mode: 'job', job: 'skill', navigator: 'Approach', skillName: 'Approach', target: '@crop' };
    s.farm.dutyPetId = p.id;
    const rt = createRuntime(s.farm);
    let onCrop = 0;
    for (let t = 0; t < 300; t++) {
      farmTick(s, rt);
      const w = s.farm.world;
      if (w.objects.some((o) => o.x === w.pet.x && o.y === w.pet.y && !o.delivered && aimIs(o.kind, '@crop'))) onCrop++;
    }
    expect(onCrop).toBeGreaterThan(0);
  });
});

describe('one runtime for skills, Fetch and routines', () => {
  it('a routine and Fetch run through runCapability; plan rows and direct jobs use the same path', () => {
    const { s, p } = pet();
    trainAndSaveRoutine(s, p, recipeStage('fetch-routine'));
    const routine = runCapability(s, p, 'Fetch routine', 'berry', new Rng(2), 5);
    expect(runOut(routine as never, s.farm.world, 50)).not.toBe('success'); // nothing steps the world here: time runs out
    expect(runCapability(s, p, 'Nope', undefined, new Rng(1), 5).next(s.farm.world)).toEqual({ done: 'fail', reason: 'skill missing' });
    // Direct job and a plan row: both end up as the farm's 'skill' behaviour, started by runCapability.
    p.plan = { chooser: 'first', guard: true, rows: [node('plan.row', { label: 'Run it', if: [], do: node('job.skill', { skill: 'Fetch routine', aim: node('kind:berry') }) })] } as never;
    p.assignment = { mode: 'plan', job: 'forage', navigator: 'Approach' };
    s.farm.dutyPetId = p.id;
    const rt = createRuntime(s.farm);
    for (let t = 0; t < 5; t++) farmTick(s, rt);
    expect(s.farm.current?.behaviorId).toBe('skill');
  });
});

describe('duration-aware option learning', () => {
  it('an option lasting k ticks is discounted by 0.99^k', () => {
    const { s, p } = pet();
    void s;
    const st = recipeStage('fetch-routine');
    const subs = Object.fromEntries(p.skills.map((k) => [k.name, { name: k.name, rev: k.activeRev, preset: true, policy: activeRevision(k)!.policy, learner: activeRevision(k)!.learner, focus: activeRevision(k)!.focus, success: activeRevision(k)!.success, outcome: activeRevision(k)!.outcome, maxTicks: activeRevision(k)!.maxTicks }]));
    const t = new Trainer({ stage: st, episodes: 30, traits: { ...DEFAULT_TRAITS }, subskills: subs as never });
    const gammas: number[] = [];
    const orig = t.q.update.bind(t.q);
    t.q.update = (s0, a, r, n, gamma, alpha, coin) => { gammas.push(gamma); return orig(s0, a, r, n, gamma, alpha, coin); };
    while (!t.done) t.runChunk(30, false);
    expect(new Set(gammas.map((g) => g.toFixed(6))).size).toBeGreaterThan(1); // options of different lengths
    for (const g of gammas) {
      const k = Math.log(g) / Math.log(OPTION_GAMMA_PER_TICK);
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }
  });
});
