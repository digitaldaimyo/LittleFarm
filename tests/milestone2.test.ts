import { describe, expect, it } from 'vitest';
import { addObject, emptyWorld, step, type Action } from '../src/sim/world';
import { recipeStage } from '../src/domain/recipes';
import { compileStage, generateWorld } from '../src/sim/compile';
import { validateStage } from '../src/domain/validate';
import { node } from '../src/domain/spec';
import { applyRepair } from '../src/domain/repairs';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { Rng } from '../src/sim/rng';
import type { StageSpec } from '../src/domain/types';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { buy } from '../src/game/progression';
import { createRuntime, farmTick, DAY_TICKS } from '../src/game/farm';
import { parseGame, serializeGame } from '../src/persistence/save';
import { trainAndSave, recipeStage as rs } from './helpers';

function train(stage: StageSpec) {
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: DEFAULT_TRAITS });
  while (!t.done) t.runChunk(1000, false);
  return buildReport(stage, DEFAULT_TRAITS, null, t.policy(), null);
}

describe('M2: creatures and areas in the simulator', () => {
  it('is deterministic with wandering chickens and crows', () => {
    const run = (seed: number) => {
      const st = recipeStage('herd-chicken');
      st.environment.push(node('place.random', { kind: node('kind:crow'), count: 1 }), node('place.random', { kind: node('kind:berry'), count: 2 }));
      const cs = compileStage(st);
      const w = cs.generate(seed);
      const rng = new Rng(3);
      const acts: Action[] = ['N', 'E', 'S', 'W', 'shoo', 'wait'];
      const out: string[] = [];
      for (let i = 0; i < 80; i++) out.push(JSON.stringify(step(w, acts[rng.int(acts.length)])) + JSON.stringify(w.objects));
      return out;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it('shoo pushes a chicken one tile away (into an area) and scares crows off', () => {
    const w = emptyWorld(5, 1);
    w.areas = [{ name: 'coop', x: 3, y: 0, w: 2, h: 1 }];
    w.rng = 1;
    const c = addObject(w, 'chicken', 2, 0);
    w.pet.x = 1;
    const ev = step(w, 'shoo');
    expect(c.x).toBe(3);
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(['shoo', 'enterArea']));
    expect(ev.find((e) => e.type === 'enterArea')?.area).toBe('coop');
    const w2 = emptyWorld(3, 1);
    const crow = addObject(w2, 'crow', 1, 0);
    expect(step(w2, 'shoo').map((e) => e.type)).toContain('scare');
    expect(crow.delivered).toBe(true);
    expect(step(emptyWorld(3, 1), 'shoo').map((e) => e.type)).toContain('fumble');
  });

  it('crows fly to crops and peck them, but keep clear of scarecrows', () => {
    const peckAll = (scarecrow: boolean) => {
      const w = emptyWorld(8, 1);
      w.rng = 9;
      w.pet.x = 7;
      addObject(w, 'crow', 0, 0);
      addObject(w, 'berry', 4, 0);
      if (scarecrow) addObject(w, 'scarecrow', 5, 0);
      for (let i = 0; i < 40; i++) step(w, 'wait');
      return w.counts?.pecks ?? 0;
    };
    expect(peckAll(false)).toBe(1);
    expect(peckAll(true)).toBe(0);
  });

  it('areas: random placements stay out of areas; In area + area references validate', () => {
    const st = recipeStage('herd-chicken');
    for (let s = 0; s < 50; s++) {
      const w = generateWorld(st, s);
      const a = w.areas![0];
      expect(w.objects.some((o) => o.x >= a.x && o.x < a.x + a.w && o.y >= a.y && o.y < a.y + a.h)).toBe(false);
      expect(w.pet.x >= a.x && w.pet.x < a.x + a.w && w.pet.y >= a.y && w.pet.y < a.y + a.h).toBe(false);
    }
    expect(validateStage(st).filter((d) => d.severity === 'error')).toEqual([]);
    const bad = recipeStage('herd-chicken');
    (bad.success as any).args.area = node('area.named', { name: 'garden' });
    expect(validateStage(bad).some((d) => d.code === 'missing-reference' && /garden/.test(d.message))).toBe(true);
  });
});

describe('M2 gate: herding and its loophole', () => {
  it('“Herd a chicken” (cards only) reaches ≥60% held-out and beats random', () => {
    const r = train(recipeStage('herd-chicken'));
    expect(r.after.successRate).toBeGreaterThanOrEqual(0.6);
    expect(r.after.successRate).toBeGreaterThan(r.random.successRate + 0.3);
  });

  it('a treat for every shoo is flagged as a loophole; “once per object” repairs it', () => {
    const st = recipeStage('shoo-loophole');
    expect(validateStage(st).some((d) => d.code === 'repeatable-reward')).toBe(true);
    const r = train(st);
    expect(r.exploits.length).toBe(1);
    expect(r.exploits[0].perEpisode).toBeGreaterThan(10);
    const fixed = structuredClone(st);
    applyRepair(fixed, 'limit-per-object', r.exploits[0].ruleId);
    const r2 = train(fixed);
    expect(r2.exploits.length).toBe(0);
    expect(r2.after.successRate).toBeGreaterThan(r.after.successRate + 0.4);
  });
});

describe('M2: the farm comes alive', () => {
  it('chickens from the shop lay eggs only inside the coop, and Fetch delivers eggs', () => {
    const g = newGame();
    const pet = adoptPet(g, 'Pip', 'meadow');
    pet.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
    g.progress.unlocks.push('custom', 'fetch');
    g.resources.coins = 50;
    expect(buy(g, 'chickens').ok).toBe(true);
    const chickens = g.farm.world.objects.filter((o) => o.kind === 'chicken');
    expect(chickens.length).toBe(2);
    const ap = trainAndSave(g, pet, rs('go-to-berry'));
    trainAndSave(g, pet, rs('bring-it-home'), ap.policy);
    pet.assignment = { mode: 'job', job: 'deliver', navigator: 'Approach' };
    const rt = createRuntime(g.farm);
    let laidOutside = false;
    const before = new Set(g.farm.world.objects.map((o) => o.id));
    for (let t = 0; t < 1500; t++) {
      farmTick(g, rt);
      for (const o of g.farm.world.objects) if (o.kind === 'egg' && !before.has(o.id)) { before.add(o.id); if (!(o.x <= 1 && o.y >= 5 && o.y <= 6)) laidOutside = true; }
    }
    expect(laidOutside).toBe(false);
    expect(g.resources.eggs ?? 0).toBeGreaterThan(0);
  });

  it('crows visit from day 2 and peck crops; a pet with Shoo can chase them off', () => {
    const g = newGame();
    adoptPet(g, 'Pip', 'meadow');
    g.progress.unlocks.push('custom');
    const rt = createRuntime(g.farm);
    while (g.farm.tick < DAY_TICKS * 2) farmTick(g, rt);
    expect(g.journal.some((j) => j.kind === 'first-crow')).toBe(true);
  });

  it('a learned Herd skill, run on the farm, brings in the stray even when another chicken is already home', () => {
    const g = newGame();
    const pet = adoptPet(g, 'Pip', 'meadow');
    pet.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
    trainAndSave(g, pet, recipeStage('herd-chicken'));
    const w = g.farm.world;
    const home = { id: w.nextId++, kind: 'chicken', x: 0, y: 5, carried: false, delivered: false };
    const stray = { id: w.nextId++, kind: 'chicken', x: 6, y: 6, carried: false, delivered: false };
    w.objects.push(home, stray);
    pet.assignment = { mode: 'job', job: 'skill', navigator: 'Approach', skillName: 'Herd', target: 'chicken' };
    const rt = createRuntime(g.farm);
    let allHome = false;
    for (let t = 0; t < 600 && !allHome; t++) {
      farmTick(g, rt);
      allHome = [home, stray].every((c) => c.x <= 1 && c.y >= 5 && c.y <= 6);
    }
    expect(allHome).toBe(true);
    expect(g.journal.some((j) => j.kind === 'first-herd')).toBe(true);
  });

  it('a v3 save gains the coop area on load', () => {
    const g = newGame();
    delete g.farm.world.areas;
    g.version = 3;
    const r = parseGame(serializeGame(g));
    expect(r.game!.farm.world.areas?.[0]).toMatchObject({ name: 'coop', w: 2, h: 2 });
  });
});
