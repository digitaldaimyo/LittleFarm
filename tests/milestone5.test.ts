import { describe, expect, it } from 'vitest';
import { addObject, emptyWorld, step, isSolidAt } from '../src/sim/world';
import { recipeStage } from '../src/domain/recipes';
import { generateWorld } from '../src/sim/compile';
import { validateStage } from '../src/domain/validate';
import { node } from '../src/domain/spec';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { buy } from '../src/game/progression';
import { applyPlan, createRuntime, farmTick, previewPlan, DAY_TICKS } from '../src/game/farm';
import { BIG_H, BIG_W, ORCHARD_GATE } from '../src/game/expand';
import { describeRequest, trackRequests } from '../src/game/requests';
import { trainAndSave, giveFarmJobs } from './helpers';
import type { GameState } from '../src/game/types';

function farmWithPet(): GameState {
  const g = newGame();
  const pet = adoptPet(g, 'Pip', 'meadow');
  pet.traits = { ...DEFAULT_TRAITS };
  const ap = trainAndSave(g, pet, recipeStage('go-to-berry'));
  giveFarmJobs(g, pet);
  trainAndSave(g, pet, recipeStage('bring-it-home'), ap.policy);
  g.progress.unlocks.push('custom', 'fetch', 'carrots');
  return g;
}

describe('M5: gates', () => {
  it('closed gates block pets and chickens; Nudge opens/closes from next to it, never on someone', () => {
    const w = emptyWorld(4, 1);
    w.rng = 3;
    const gate = addObject(w, 'gate', 2, 0);
    w.pet.x = 1;
    expect(isSolidAt(w, 2, 0)).toBe(true);
    expect(step(w, 'E').map((e) => e.type)).toContain('bump');
    const ev = step(w, 'nudge');
    expect(ev.find((e) => e.type === 'gate')?.state).toBe('open');
    expect(gate.open).toBe(true);
    step(w, 'E'); // stand in the gateway
    expect(step(w, 'nudge').map((e) => e.type)).toContain('fumble'); // can't shut it on yourself
    step(w, 'W');
    expect(step(w, 'nudge').find((e) => e.type === 'gate')?.state).toBe('closed');
    const w2 = emptyWorld(3, 1);
    w2.rng = 5;
    addObject(w2, 'gate', 1, 0);
    const hen = addObject(w2, 'chicken', 0, 0);
    w2.pet.x = 2;
    for (let i = 0; i < 200; i++) step(w2, 'wait');
    expect(hen.x).toBe(0);
  });

  it('“Open the gate” (cards only) is learnable', () => {
    const st = recipeStage('open-gate');
    expect(validateStage(st).filter((d) => d.severity === 'error')).toEqual([]);
    const t = new Trainer({ stage: st, episodes: st.learner.episodes, traits: DEFAULT_TRAITS });
    while (!t.done) t.runChunk(1000, false);
    const r = buildReport(st, DEFAULT_TRAITS, null, t.policy(), null);
    expect(r.after.successRate).toBeGreaterThanOrEqual(r.random.successRate + 0.3);
  });
});

describe('M5: orchard expansion', () => {
  it('grows the farm to 16×12 with a gated orchard whose bushes a trained pet harvests', () => {
    const g = farmWithPet();
    g.resources.coins = 60;
    expect(buy(g, 'orchard').ok).toBe(true);
    const w = g.farm.world;
    expect([w.w, w.h]).toEqual([BIG_W, BIG_H]);
    expect(w.objects.find((o) => o.kind === 'gate')).toMatchObject({ x: ORCHARD_GATE.x, y: ORCHARD_GATE.y, open: true });
    expect(w.areas?.map((a) => a.name)).toContain('orchard');
    expect(g.journal.some((j) => j.kind === 'expand')).toBe(true);
    const pet = g.pets[0];
    pet.assignment = { mode: 'job', job: 'forage', navigator: 'Approach' };
    // Farm life: every berry now travels home, and the near bushes regrow during each trip, so a lone pet
    // never needs the orchard. Make the orchard the only source, to test that it can be harvested at all.
    for (const p of g.farm.plots) if (p.crop === 'berry' && p.x < 13) p.unlock = 'never';
    g.farm.world.objects = g.farm.world.objects.filter((o) => !(o.kind === 'berry' && o.x < 13));
    const rt = createRuntime(g.farm);
    let orchardBerries = 0;
    for (let t = 0; t < 1200; t++) {
      const carrying = g.farm.world.pet.carrying;
      farmTick(g, rt);
      // A berry picked in the orchard (it's sold later, at the house).
      if (carrying === null && g.farm.world.pet.carrying !== null && g.farm.world.pet.x >= 13) orchardBerries++;
    }
    expect(orchardBerries).toBeGreaterThan(0);
  });

  it('a plan row “Mind the gate” shuts it (and the preview agrees)', () => {
    const g = farmWithPet();
    g.resources.coins = 60;
    buy(g, 'orchard');
    const pid = g.pets[0].id;
    trainAndSave(g, g.pets[0], recipeStage('shut-gate')); // Mind the gate (shut) runs the pet's own Shut the gate skill
    const plan = { chooser: 'first' as const, guard: true, rows: [node('plan.row', { label: 'Shut the gate', if: [node('cond.gates', { state: 'open' })], do: node('job.gate', { state: 'closed' }) }), node('plan.row', { label: 'Nap', if: [], do: node('job.nap') })] };
    // Approach r1 is shaky right next to the fence (rare in 8×8 pens); the stuck-recovery gets it there.
    const p = previewPlan(g, pid, plan, 300);
    g.pets[0].plan = plan;
    const rt = createRuntime(g.farm);
    applyPlan(g, rt, pid);
    for (let t = 0; t < 300; t++) farmTick(g, rt);
    expect(g.farm.world.objects.find((o) => o.kind === 'gate')?.open).toBe(false);
    expect(p.final.petX).toBe(g.farm.world.pet.x);
    expect(g.journal.some((j) => j.kind === 'first-gate-closed')).toBe(true);
  });
});

describe('M5: gentle weather', () => {
  it('showers (from day 2) water every plot, swell the pond by a tile, keep crows away, then dry up', () => {
    const g = farmWithPet();
    const rt = createRuntime(g.farm);
    const ponds0 = g.farm.world.objects.filter((o) => o.kind === 'pond').length;
    let sawRain = false, maxPonds = ponds0, crowInRain = false, allWet = true;
    for (let t = 0; t < DAY_TICKS * 6 && !(sawRain && !g.farm.world.raining); t++) {
      farmTick(g, rt);
      const w = g.farm.world;
      if (w.raining) {
        sawRain = true;
        maxPonds = Math.max(maxPonds, w.objects.filter((o) => o.kind === 'pond').length);
        if (w.objects.some((o) => o.kind === 'crow' && !o.delivered)) crowInRain = true;
        if (w.objects.some((o) => (o.kind === 'bush' || o.kind === 'patch') && !o.wet && (!g.farm.plots.find((p) => p.x === o.x && p.y === o.y)?.unlock))) allWet = false;
      }
    }
    expect(sawRain).toBe(true);
    expect(g.farm.tick).toBeGreaterThanOrEqual(DAY_TICKS);
    expect(maxPonds).toBe(ponds0 + 1);
    expect(g.farm.world.objects.filter((o) => o.kind === 'pond').length).toBe(ponds0);
    expect(crowInRain).toBe(false);
    expect(allWet).toBe(true);
    expect(g.journal.some((j) => j.kind === 'first-rain')).toBe(true);
  });

  it('the Weather pen card + Is raining condition', () => {
    const st = recipeStage('water-garden');
    st.environment.push(node('place.weather', { mode: 'rain' }));
    const w = generateWorld(st, 1);
    expect(w.raining).toBe(true);
    expect(w.objects.filter((o) => o.kind === 'patch').every((o) => o.wet)).toBe(true);
  });
});

describe('M5: requests board', () => {
  it('posts requests the farm can do, tracks progress and pays (with an occasional gift)', () => {
    const g = farmWithPet();
    g.resources.coins = 30;
    buy(g, 'chickens');
    const rt = createRuntime(g.farm);
    farmTick(g, rt);
    const reqs = g.farm.requests ?? [];
    expect(reqs.length).toBeGreaterThan(0);
    expect(reqs.length).toBeLessThanOrEqual(3);
    expect(reqs.every((r) => describeRequest(r).length > 5)).toBe(true);
    // Fake a few deliveries/harvests and check completion pays.
    const r = reqs.find((x) => x.kind === 'berries' || x.kind === 'eggs' || x.kind === 'carrots') ?? reqs[0];
    const coins0 = g.resources.coins;
    // Farm life: produce counts when it is sold at the house.
    const ev = r.kind === 'berries' ? { type: 'deliver' as const, kind: 'berry', into: 'home' } : r.kind === 'eggs' ? { type: 'deliver' as const, kind: 'egg', into: 'home' } : r.kind === 'carrots' ? { type: 'deliver' as const, kind: 'carrot', into: 'home' } : r.kind === 'fireflies' ? { type: 'reach' as const, kind: 'firefly' } : { type: 'water' as const, kind: 'bush' };
    if (r.kind !== 'noPecks' && r.kind !== 'coop') {
      for (let i = 0; i < r.n; i++) trackRequests(g, [{ ...ev, x: 0, y: 0 }]);
      expect(r.status).toBe('done');
      expect(g.resources.coins).toBe(coins0 + r.reward);
      expect(g.journal.some((j) => j.kind === 'request-done')).toBe(true);
    }
  });

  it('a whole day of play judges requests at nightfall and posts fresh ones at dawn', () => {
    const g = farmWithPet();
    g.pets[0].assignment = { mode: 'auto', job: 'forage', navigator: 'Approach' };
    const rt = createRuntime(g.farm);
    for (let t = 0; t < DAY_TICKS + 5; t++) farmTick(g, rt);
    const reqs = g.farm.requests ?? [];
    expect(reqs.some((r) => r.day === 1 && r.status !== 'open')).toBe(true);
    expect(reqs.some((r) => r.day === 2 && r.status === 'open')).toBe(true);
  });
});
