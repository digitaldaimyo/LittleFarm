import { describe, expect, it } from 'vitest';
import { node } from '../src/domain/spec';
import { compileCondition, generateWorld } from '../src/sim/compile';
import { addObject, aimIs, emptyWorld, step } from '../src/sim/world';
import { compileEncoder } from '../src/learning/senses';
import { validateStage } from '../src/domain/validate';
import { newGame } from '../src/game/state';
import { adoptPet, activeRevision, getSkill, routineRunFor } from '../src/game/pets';
import { createRuntime, farmTick, type FarmRuntime } from '../src/game/farm';
import { jobCapability, jobSkill } from '../src/game/capability';
import { applyLayout, move, place, startLayout } from '../src/game/layout';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { NavRun, isDone } from '../src/learning/policies';
import { Rng } from '../src/sim/rng';
import type { GameState } from '../src/game/types';
import type { StageSpec } from '../src/domain/types';
import { giveRoutine, recipeStage, trainAndSave, trainAndSaveRoutine } from './helpers';

const withEnv = (extra: ReturnType<typeof node>[]): StageSpec => { const st = recipeStage('go-to-berry'); st.environment.push(...extra); return st; };

describe('pens can express the farm (learned-farm phase 2)', () => {
  it('“any ripe crop” placed in a pen is a real crop, a different one from try to try; “storage with room” is an empty basket', () => {
    const st = recipeStage('harvest');
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) for (const o of generateWorld(st, seed).objects) if (aimIs(o.kind, '@crop')) kinds.add(o.kind);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    const sto = generateWorld(withEnv([node('place.random', { kind: node('kind:@storage'), count: 1, region: 'anywhere' })]), 2).objects.find((o) => o.kind === 'bin')!;
    expect(sto.store).toEqual([{ kind: null, n: 0 }]);
    expect(validateStage(st).filter((d) => d.severity === 'error')).toEqual([]); // “the target” aimed at any ripe crop type-checks
  });

  it('Energy: work drains 0.12, staying put restores 1.5; Energy below and the Tired? sense read it — on the farm too', () => {
    const w = generateWorld(withEnv([node('place.energy', { level: 30, vary: 'exact' })]), 3);
    expect(w.petEnergy).toBe(30);
    const tired = compileEncoder([node('sense.tired')], 'berry');
    const below = compileCondition(node('cond.energyBelow', { value: 25 }));
    expect(tired.encode(w)).toEqual([1]);
    step(w, 'wait');
    expect(w.petEnergy).toBeCloseTo(31.5);
    w.petEnergy = 24.05;
    step(w, 'N');
    expect(w.petEnergy).toBeCloseTo(23.93);
    expect(below({ w } as never)).toBe(true);
    expect(tired.encode(w)).toEqual([2]);
    const varied = new Set([1, 2, 3, 4, 5, 6].map((sd) => generateWorld(withEnv([node('place.energy', { vary: 'random' })]), sd).petEnergy));
    expect(varied.size).toBeGreaterThan(1);
    expect([...varied].every((e) => e! >= 10 && e! <= 100)).toBe(true);
    expect(generateWorld(recipeStage('go-to-berry'), 3).petEnergy).toBeUndefined(); // pens without the card: no energy
    // The farm writes the working pet's energy into the world every tick, so the same sense works there.
    const s = newGame(); const p = adoptPet(s, 'Pip', 'meadow'); s.farm.dutyPetId = p.id; p.energy = 70;
    const rt = createRuntime(s.farm); farmTick(s, rt);
    expect(tired.encode(s.farm.world)).toEqual([0]);
  });

  it('Seed money: planting pays the seed; with too little left, Plant does nothing', () => {
    const w = emptyWorld(3, 3);
    w.seedCoins = 4;
    const a = addObject(w, 'soil', 0, 0); a.crop = 'pumpkin';
    const b = addObject(w, 'soil', 1, 0); b.crop = 'pumpkin';
    w.pet.x = 0; w.pet.y = 0;
    step(w, 'plant');
    expect(a.kind).toBe('patch');
    expect(w.seedCoins).toBe(1);
    step(w, 'E');
    expect(step(w, 'plant').map((e) => e.type)).toContain('fumble');
    expect(b.kind).toBe('soil');
    expect(generateWorld(withEnv([node('place.purse', { coins: 7 })]), 1).seedCoins).toBe(7);
  });
});

/** A pet with Approach + Fetch trained on `seed`, carrots unlocked; optionally the held-out farm layout. */
function farmFor(seed: number, heldOut: boolean): GameState {
  const g = newGame();
  const p = adoptPet(g, 'Pip', 'meadow');
  p.traits = { ...DEFAULT_TRAITS };
  const ap = recipeStage('go-to-berry'); ap.seed = seed; trainAndSave(g, p, ap);
  const fe = recipeStage('bring-it-home'); fe.seed = seed; trainAndSave(g, p, fe, activeRevision(getSkill(p, 'Approach'))!.policy);
  g.progress.unlocks.push('fetch', 'carrots');
  g.resources.coins = 30;
  if (heldOut) {
    g.resources.coins += 20;
    const d = startLayout(g);
    move(d, 9, 1, 7, 5); move(d, 10, 5, 2, 5); move(d, 2, 7, 6, 8); place(g, d, 'carrot', 8, 8); place(g, d, 'carrot', 10, 7);
    applyLayout(g, d);
    g.resources.coins -= 20;
  }
  g.farm.dutyPetId = p.id;
  return g;
}
function runFarm(g: GameState, ticks = 2400): { coins: number; rt: FarmRuntime } {
  const rt = createRuntime(g.farm);
  rt.stats = {};
  const c0 = g.progress.totalCoins;
  for (let t = 0; t < ticks; t++) farmTick(g, rt);
  return { coins: g.progress.totalCoins - c0, rt };
}

describe('pen → farm transfer: a Harvest routine trained in a pen runs the farm', () => {
  it('sells crops on a held-out farm using only learned capabilities, ≥ 80% of the scripted Harvest job', () => {
    const seed = 202;
    const base = 237; // the scripted Harvest job on this farm and seed, recorded in phase 0 (bench/farm-baseline.json); it no longer exists
    const g = farmFor(seed, true);
    const p = g.pets[0];
    const hv = recipeStage('harvest'); hv.seed = seed;
    trainAndSaveRoutine(g, p, hv);
    p.assignment = { mode: 'job', job: 'skill', navigator: 'Approach', skillName: 'Harvest', target: '@crop' };
    const { coins, rt } = runFarm(g);
    expect(Object.keys(rt.stats!).filter((k) => k !== 'skill' && k !== 'rest')).toEqual([]); // no scripted job ran: the learned routine, and innate rest when tired
    expect(coins).toBeGreaterThanOrEqual(0.8 * base); // measured 218 vs 237 (92%)
    // Each run is judged from its own start: earlier sales don't make the next run "succeed" at once.
    const st = rt.stats!.skill;
    expect(st.ticks / st.started).toBeGreaterThan(8);
  }, 60000);

  it('deployed walks take Curiosity’s occasional random step; training walks never do', () => {
    const w = generateWorld(recipeStage('go-to-berry'), 3);
    const greedy = { act: () => 'N' as const } as never;
    const always = new NavRun(greedy, 'berry', 50, new Rng(1), 1);
    const never = new NavRun(greedy, 'berry', 50, new Rng(1), 0);
    const steps = (r: NavRun) => Array.from({ length: 20 }, () => r.next(w));
    expect(steps(never).every((a) => a === 'N')).toBe(true);
    expect(steps(always).some((a) => a !== 'N')).toBe(true);
  });
});

describe('learned jobs (phase 3): no skill, no job', () => {
  it('a pet without a Harvest skill can’t harvest — Auto never does, the job isn’t possible, nothing sells by day', () => {
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    trainAndSave(g, p, recipeStage('go-to-berry'));
    g.farm.dutyPetId = p.id;
    p.assignment = { mode: 'auto', job: 'forage', navigator: 'Approach' };
    const { coins, rt } = runFarm(g, 800); // daytime only (no fireflies yet)
    expect(coins).toBe(0);
    expect(rt.stats!.forage).toBeUndefined();
    expect(jobCapability(p, 'forage')).toBeNull();
  });

  it('Harvest is bound to the pet’s Harvest routine, or to any skill the player picks; uncertified ones need opting in', () => {
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    trainAndSave(g, p, recipeStage('go-to-berry'));
    trainAndSaveRoutine(g, p, recipeStage('harvest'));
    expect(jobSkill(p, 'forage')?.name).toBe('Harvest');
    expect(jobCapability(p, 'forage')).toMatchObject({ name: 'Harvest', aim: '@crop' });
    p.jobSkills = { forage: 'Approach' };
    expect(jobSkill(p, 'forage')?.name).toBe('Approach');
    const k = getSkill(p, 'Harvest')!;
    p.jobSkills = {};
    k.revisions.forEach((r) => { r.eval.passed = false; });
    expect(jobCapability(p, 'forage')).toBeNull(); // uncertified: the farm won't use it on its own…
    k.farmUse = 'on';
    expect(jobCapability(p, 'forage')?.name).toBe('Harvest'); // …until the player opts in
  });
});

describe('learned jobs (phase 3b): Haul, Basket run, Harvest to storage', () => {
  it('Haul runs the pet’s Fetch, Basket run its Basket run routine; Harvest prefers storage only when it’s nearer than the house', () => {
    const g = farmFor(101, false);
    const p = g.pets[0];
    expect(jobCapability(p, 'deliver')?.name).toBe('Fetch');
    expect(jobCapability(p, 'tote')).toBeNull(); // no Basket run routine yet
    giveRoutine(g, p, 'harvest');
    giveRoutine(g, p, 'harvest-store');
    giveRoutine(g, p, 'basket-run');
    expect(jobCapability(p, 'tote')?.name).toBe('Basket run');
    const w = g.farm.world;
    const bin = w.objects.find((o) => o.kind === 'bin')!;
    const home = w.objects.find((o) => o.kind === 'home')!;
    for (const o of w.objects.filter((x) => aimIs(x.kind, '@crop'))) o.delivered = true; // one ripe berry, by the basket
    const berry = addObject(w, 'berry', bin.x + 1, bin.y);
    expect(jobCapability(p, 'forage', g)?.name).toBe('Harvest to storage');
    berry.x = home.x; berry.y = home.y + 1; // now the house is nearer
    expect(jobCapability(p, 'forage', g)?.name).toBe('Harvest');
  }, 60000);

  it('a routine with nothing it may do gives up (so the farm can choose again) instead of waiting out its time', () => {
    const g = farmFor(101, false);
    const p = g.pets[0];
    giveRoutine(g, p, 'harvest-store');
    const rev = activeRevision(getSkill(p, 'Harvest to storage'))!;
    const w = emptyWorld(5, 5);
    const c = addObject(w, 'berry', 0, 0); c.carried = true; w.pet.carrying = c.id; // a berry in paws, no storage anywhere
    const run = routineRunFor(p, rev, '@crop', new Rng(1), 100, w)!;
    let st = run.next(w);
    for (let i = 0; i < 5 && !isDone(st); i++) st = run.next(w);
    expect(isDone(st) && st).toMatchObject({ done: 'fail', reason: 'no option applies' });
  }, 60000);
});
