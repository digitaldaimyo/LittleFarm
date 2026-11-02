import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { MAX_ON_DUTY, createRuntime, crewSummary, describeTile, dutyPets, farmTick, makeLead, setOnDuty } from '../src/game/farm';
import { parseGame, serializeGame } from '../src/persistence/save';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import type { GameState } from '../src/game/types';
import { recipeStage, trainAndSave } from './helpers';

const NAMES = ['Pip', 'Mochi', 'Bean', 'Juniper', 'Clover'] as const;
const PALS = ['meadow', 'plum', 'sky', 'moss', 'meadow'] as const;

function crewFarm(n: number): GameState {
  const g = newGame();
  const pets = NAMES.slice(0, n).map((name, i) => adoptPet(g, name, PALS[i]));
  for (const p of pets) p.traits = { ...DEFAULT_TRAITS }; // adoptPet's temperament is random
  const ap = trainAndSave(g, pets[0], recipeStage('go-to-berry'));
  const fe = trainAndSave(g, pets[0], recipeStage('bring-it-home'), ap.policy);
  for (const [i, p] of pets.entries()) {
    if (i > 0) {
      // Same skills for everyone (copied revisions keep this fast).
      p.skills = structuredClone(pets[0].skills);
    }
    p.assignment = { mode: i === 1 ? 'job' : 'auto', job: i === 1 ? 'deliver' : 'forage', navigator: 'Approach' };
  }
  void fe;
  g.farm.dutyPetId = pets[0].id;
  for (const p of pets.slice(1)) setOnDuty(g, p.id, true);
  g.progress.unlocks.push('fetch', 'carrots', 'custom');
  g.resources.coins = 30;
  return g;
}

describe('a crew of up to 4 pets', () => {
  it('four pets never share a tile (outside the house and storage) or a target, and a fifth is refused', () => {
    const g = crewFarm(5);
    expect(dutyPets(g)).toHaveLength(MAX_ON_DUTY);
    expect(setOnDuty(g, g.pets[4].id, true)).toMatch(/At most 4/);
    const rt = createRuntime(g.farm);
    let clash = 0, sameClaim = 0;
    for (let t = 0; t < 1500; t++) {
      farmTick(g, rt);
      const w = g.farm.world;
      const bodies = [w.pet, ...(w.crew ?? [])];
      expect(bodies).toHaveLength(4);
      for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) {
        if (bodies[a].x === bodies[b].x && bodies[a].y === bodies[b].y && !w.objects.some((o) => o.x === bodies[a].x && o.y === bodies[a].y && ['home', 'bin', 'shed'].includes(o.kind))) clash++;
      }
      const claims = [rt.claim, ...rt.crew.map((r) => r.claim)].filter((c) => c !== null);
      if (new Set(claims).size !== claims.length) sameClaim++;
      expect(w.objects.some((o) => o.hidden || o.kind === 'buddy')).toBe(false);
    }
    expect(clash).toBe(0);
    expect(sameClaim).toBe(0);
    expect(g.progress.totalCoins).toBeGreaterThan(100);
  });

  it('is deterministic with four pets', () => {
    const run = () => { const g = crewFarm(4); const rt = createRuntime(g.farm); for (let t = 0; t < 600; t++) farmTick(g, rt); return JSON.stringify([g.farm.world, g.resources, g.farm.helpers?.map((h) => h.rngState)]); }; // (pet ids are random; everything else must match)
    expect(run()).toBe(run());
  });

  it('taking a helper off duty removes its body; taking the lead off hands the lead to the first helper', () => {
    const g = crewFarm(3);
    const rt = createRuntime(g.farm);
    for (let t = 0; t < 50; t++) farmTick(g, rt);
    const [a, b, c] = g.pets;
    const cBody = { ...g.farm.world.crew![1] };
    expect(setOnDuty(g, b.id, false, rt)).toBeNull();
    expect(g.farm.helpers!.map((h) => h.petId)).toEqual([c.id]);
    expect(g.farm.world.crew).toEqual([expect.objectContaining({ x: cBody.x, y: cBody.y })]);
    expect(rt.crew).toHaveLength(1);
    expect(setOnDuty(g, a.id, false, rt)).toBeNull();
    expect(g.farm.dutyPetId).toBe(c.id);
    expect(g.farm.world.pet).toMatchObject({ x: cBody.x, y: cBody.y });
    expect(g.farm.helpers).toBeUndefined();
    expect(setOnDuty(g, c.id, false, rt)).toMatch(/Someone has to mind the farm/);
    for (let t = 0; t < 50; t++) farmTick(g, rt);
    expect(g.farm.world.crew).toBeUndefined();
  });

  it('make lead swaps the two pets’ places on the farm', () => {
    const g = crewFarm(2);
    const rt = createRuntime(g.farm);
    for (let t = 0; t < 30; t++) farmTick(g, rt);
    const lead0 = { ...g.farm.world.pet }, helper0 = { ...g.farm.world.crew![0] };
    makeLead(g, g.pets[1].id, rt);
    expect(g.farm.dutyPetId).toBe(g.pets[1].id);
    expect(g.farm.helpers![0].petId).toBe(g.pets[0].id);
    expect(g.farm.world.pet).toMatchObject({ x: helper0.x, y: helper0.y });
    expect(g.farm.world.crew![0]).toMatchObject({ x: lead0.x, y: lead0.y });
  });

  it('says who does what, and what is on a tile', () => {
    const g = crewFarm(3);
    const rt = createRuntime(g.farm);
    for (let t = 0; t < 20; t++) farmTick(g, rt);
    expect(crewSummary(g)).toMatch(/\d (harvesting|hauling|planting|napping|thinking)/);
    expect(describeTile(g, 2, 3)).toMatch(/^Basket: /);
    expect(describeTile(g, 9, 1)).toMatch(/^Berry bush: (ripe|growing)/);
    g.progress.unlocks = g.progress.unlocks.filter((u) => u !== 'carrots');
    expect(describeTile(g, 2, 7)).toMatch(/waiting for carrots/);
    expect(describeTile(g, 6, 6)).toBeNull();
  });

  it('v7 saves: the second pet on duty becomes the first helper, with its body, job and RNG', () => {
    const g = crewFarm(2);
    const old = JSON.parse(serializeGame(g));
    const f = old.game.farm;
    old.version = 7; old.game.version = 7;
    f.duty2PetId = f.helpers[0].petId; f.rngState2 = 777; f.stun2 = 2; f.queue2 = []; f.current2 = null;
    f.world.pet2 = { x: 5, y: 6, carrying: null, facing: 'S' };
    delete f.helpers; delete f.world.crew;
    const r = parseGame(JSON.stringify(old));
    expect(r.ok).toBe(true);
    const nf = r.game!.farm;
    expect(nf.helpers).toEqual([{ petId: g.pets[1].id, current: null, stun: 2, queue: [], rngState: 777 }]);
    expect(nf.world.crew).toEqual([{ x: 5, y: 6, carrying: null, facing: 'S' }]);
    expect((nf as unknown as Record<string, unknown>).duty2PetId).toBeUndefined();
  });

  it('four pets on duty stay fast enough for phones (well under a frame per tick)', () => {
    const g = crewFarm(4);
    const rt = createRuntime(g.farm);
    for (let t = 0; t < 200; t++) farmTick(g, rt); // warm up
    const t0 = performance.now();
    for (let t = 0; t < 1000; t++) farmTick(g, rt);
    const perTick = (performance.now() - t0) / 1000;
    if (process.env.DBG) console.log('ms per tick, 4 pets:', perTick.toFixed(3));
    expect(perTick).toBeLessThan(4); // the farm runs at most ~15 ticks/s (4×); a 60 fps frame is 16 ms
  });
});

