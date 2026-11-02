import { describe, expect, it } from 'vitest';
import { addObject, emptyWorld, step } from '../src/sim/world';
import { recipeStage } from '../src/domain/recipes';
import { compileStage, generateWorld } from '../src/sim/compile';
import { validateStage } from '../src/domain/validate';
import { node } from '../src/domain/spec';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { createRuntime, dayInfo, farmTick, DAY_TICKS, NIGHT_FROM, GROW_TICKS } from '../src/game/farm';
import { chooseDuty, compilePlan, newPlanRuntime, starterPlan } from '../src/game/plan';
import { farmContext } from '../src/game/farm';
import { Rng } from '../src/sim/rng';
import { parseGame, serializeGame } from '../src/persistence/save';
import { recipeStage as rs, trainAndSave, giveHarvest } from './helpers';

describe('watering', () => {
  it('fills at the well and waters a dry plot (3 splashes per fill)', () => {
    const w = emptyWorld(4, 1);
    addObject(w, 'well', 0, 0);
    const a = addObject(w, 'patch', 1, 0);
    expect(step(w, 'water').map((e) => e.type)).toContain('fill');
    expect(w.pet.water).toBe(3);
    step(w, 'E');
    const ev = step(w, 'water');
    expect(ev.find((e) => e.type === 'water')?.kind).toBe('patch');
    expect(a.wet).toBe(true);
    expect(w.pet.water).toBe(2);
    expect(step(w, 'water').map((e) => e.type)).toContain('fumble'); // already wet
  });

  it('“Water the garden” (a custom skill) is valid and beats random by ≥30 points', () => {
    const st = recipeStage('water-garden');
    expect(validateStage(st).filter((d) => d.severity === 'error')).toEqual([]);
    const t = new Trainer({ stage: st, episodes: st.learner.episodes, traits: DEFAULT_TRAITS });
    while (!t.done) t.runChunk(1000, false);
    const r = buildReport(st, DEFAULT_TRAITS, null, t.policy(), null);
    expect(r.after.successRate).toBeGreaterThanOrEqual(r.random.successRate + 0.3);
  });

  it('“the target” takes the traits of what the skill is aimed at', () => {
    const st = recipeStage('water-garden');
    st.learner.focus = 'rock';
    st.environment.push(node('place.random', { kind: node('kind:rock'), count: 1 }));
    expect(validateStage(st).some((d) => d.code === 'type-mismatch' && /aimed at Rock/.test(d.message))).toBe(true);
  });

  it('watered farm plots regrow twice as fast', () => {
    const g = newGame();
    const rt = createRuntime(g.farm);
    farmTick(g, rt); // first berries appear
    const bush = g.farm.world.objects.find((o) => o.kind === 'bush' && o.x === 9 && o.y === 1)!;
    const plot = g.farm.plots.find((p) => p.x === 9 && p.y === 1)!;
    const harvest = () => { const b = g.farm.world.objects.find((o) => o.kind === 'berry' && o.x === 9 && o.y === 1 && !o.delivered)!; b.delivered = true; };
    const ticksToRegrow = () => {
      harvest();
      let n = 0;
      while (!g.farm.world.objects.some((o) => o.kind === 'berry' && o.x === 9 && o.y === 1 && !o.delivered) && n < 200) { farmTick(g, rt); n++; }
      return n;
    };
    const dry = ticksToRegrow();
    bush.wet = true;
    const wet = ticksToRegrow();
    expect(dry).toBeGreaterThanOrEqual(GROW_TICKS.berry);
    expect(wet).toBeLessThanOrEqual(Math.ceil(GROW_TICKS.berry / 2) + 1);
    expect(bush.wet).toBe(false); // dries after the crop appears
    expect(plot.crop).toBe('berry');
  });
});

describe('day and night', () => {
  it('the clock turns to night at 70% of the day', () => {
    expect(dayInfo(0).night).toBe(false);
    expect(dayInfo(Math.floor(DAY_TICKS * NIGHT_FROM)).night).toBe(true);
    expect(dayInfo(DAY_TICKS).day).toBe(2);
  });

  it('fireflies appear at night, can be caught for coins, and leave at dawn', () => {
    const g = newGame();
    const pet = adoptPet(g, 'Pip', 'meadow');
    pet.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
    trainAndSave(g, pet, rs('go-to-berry'));
    pet.assignment.mode = 'auto';
    const rt = createRuntime(g.farm);
    const nightAt = Math.floor(DAY_TICKS * NIGHT_FROM);
    while (g.farm.tick < nightAt) farmTick(g, rt);
    expect(g.farm.world.night).toBe(true);
    expect(g.farm.world.objects.filter((o) => o.kind === 'firefly').length).toBeGreaterThan(0);
    while (g.farm.tick < DAY_TICKS) farmTick(g, rt);
    expect(g.resources.fireflies ?? 0).toBeGreaterThan(0);
    farmTick(g, rt);
    expect(g.farm.world.night).toBe(false);
    expect(g.farm.world.objects.some((o) => o.kind === 'firefly')).toBe(false);
    expect(g.journal.some((j) => j.kind === 'first-night')).toBe(true);
  });

  it('the responsibility executive sleeps at night unless there are fireflies to catch (a night responsibility)', () => {
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    trainAndSave(g, p, rs('go-to-berry'));
    giveHarvest(g, p);
    g.farm.dutyPetId = p.id;
    const plan = starterPlan();
    const rows = compilePlan(plan);
    const w = g.farm.world;
    const pick = () => { const d = chooseDuty(g, p, plan, rows, farmContext(g, p, false), newPlanRuntime(), new Rng(1)); return d.need ?? d.job?.behaviorId; };
    w.night = false;
    addObject(w, 'berry', 6, 6); // something ripe
    expect(pick()).toBe('forage');
    w.night = true;
    expect(pick()).toBe('night');
    addObject(w, 'firefly', 5, 5);
    expect(pick()).toBe('catch');
  });

  it('Time of day card + Is night condition + night sense work in pens', () => {
    const st = recipeStage('go-to-berry');
    st.environment.push(node('place.time', { mode: 'random' }));
    const nights = Array.from({ length: 40 }, (_, i) => generateWorld(st, i).night).filter(Boolean).length;
    expect(nights).toBeGreaterThan(5);
    expect(nights).toBeLessThan(35);
    st.environment = st.environment.filter((p) => p.cardId !== 'place.time');
    st.environment.push(node('place.time', { mode: 'night' }));
    st.success = node('cond.night');
    const cs = compileStage(st);
    expect(cs.isSuccess(cs.generate(3))).toBe(true);
  });

  it('a pre-watering save gets a well on load', () => {
    const g = newGame();
    g.farm.world.objects = g.farm.world.objects.filter((o) => o.kind !== 'well');
    g.version = 2;
    const r = parseGame(serializeGame(g));
    expect(r.game!.farm.world.objects.filter((o) => o.kind === 'well').length).toBe(1);
  });
});
