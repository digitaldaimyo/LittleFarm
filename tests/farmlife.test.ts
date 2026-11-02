import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { createRuntime, farmTick, harvestDestination, seedGift, SELL_PRICE } from '../src/game/farm';
import { compileCondition } from '../src/sim/compile';
import { node } from '../src/domain/spec';
import { ABILITY_ORDER } from '../src/learning/senses';
import { OBJECT_BY_ID } from '../src/domain/packs/farm';
import { farmTips } from '../src/game/coach';
import { trackRequests } from '../src/game/requests';
import { parseGame, serializeGame } from '../src/persistence/save';
import { addObject, emptyStore, emptyWorld, seedPrice, step, storeCount, type World } from '../src/sim/world';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import type { GameState } from '../src/game/types';
import { recipeStage, trainAndSave, giveFarmJobs } from './helpers';

/** A tiny world: the pet stands on a container with a crop in its paws. */
function holding(kind: string, container: string, store = true): { w: World; c: ReturnType<typeof addObject> } {
  const w = emptyWorld(5, 5);
  const c = addObject(w, container, 2, 2);
  if (store) c.store = emptyStore(container);
  w.pet.x = 2; w.pet.y = 2;
  const item = addObject(w, kind, 2, 2);
  item.carried = true;
  w.pet.carrying = item.id;
  return { w, c };
}
const putIn = (w: World, c: ReturnType<typeof addObject>, kind: string) => { const it = addObject(w, kind, c.x, c.y); it.carried = true; w.pet.carrying = it.id; return step(w, 'drop'); };

function farmGame(opts: { fetch?: boolean; mode?: 'auto' | 'forage' | 'deliver' } = {}): GameState {
  const s = newGame();
  const p = adoptPet(s, 'Pip', 'meadow');
  p.traits = { ...DEFAULT_TRAITS };
  trainAndSave(s, p, recipeStage('go-to-berry'));
  giveFarmJobs(s, p);
  if (opts.fetch) trainAndSave(s, p, recipeStage('bring-it-home'), activeRevision(getSkill(p, 'Approach'))!.policy);
  p.assignment = opts.mode === 'auto' || !opts.mode ? { mode: 'auto', job: 'forage', navigator: 'Approach' } : { mode: 'job', job: opts.mode, navigator: 'Approach' };
  s.farm.dutyPetId = p.id;
  return s;
}
const run = (s: GameState, ticks: number) => { const rt = createRuntime(s.farm); for (let i = 0; i < ticks; i++) farmTick(s, rt); return rt; };
const basket = (s: GameState) => s.farm.world.objects.find((o) => o.kind === 'bin')!;

describe('storage: baskets and sheds', () => {
  it('a basket holds 6 of one kind; another kind (or a 7th) is refused and left beside it', () => {
    const { w, c } = holding('berry', 'bin');
    expect(step(w, 'drop').map((e) => e.type)).toContain('deliver');
    for (let i = 0; i < 5; i++) putIn(w, c, 'berry');
    expect(c.store).toEqual([{ kind: 'berry', n: 6 }]);
    expect(putIn(w, c, 'berry').map((e) => e.type)).toContain('full');
    const carrotTry = holding('carrot', 'bin');
    carrotTry.c.store = [{ kind: 'berry', n: 2 }];
    expect(step(carrotTry.w, 'drop').map((e) => e.type)).toContain('full');
    expect(carrotTry.w.objects.find((o) => o.kind === 'carrot')!.delivered).toBe(false); // nothing is lost
  });

  it('a shed holds 4 slots of 10, one kind each; picking takes from the fullest slot', () => {
    const { w, c } = holding('berry', 'shed');
    step(w, 'drop');
    for (let i = 0; i < 9; i++) putIn(w, c, 'carrot');
    putIn(w, c, 'egg');
    expect(c.store!.map((s) => `${s.kind}:${s.n}`)).toEqual(['berry:1', 'carrot:9', 'egg:1', 'null:0']);
    const ev = step(w, 'pick');
    expect(ev[1]).toMatchObject({ type: 'pickup', kind: 'carrot', into: 'shed' });
    expect(storeCount(c)).toBe(10);
  });

  it('pens are unchanged: a container without a store takes anything, any number', () => {
    const { w, c } = holding('berry', 'bin', false);
    for (let i = 0; i < 12; i++) expect(putIn(w, c, i % 2 ? 'carrot' : 'berry').map((e) => e.type)).toContain('deliver');
    expect(c.store).toBeUndefined();
  });
});

describe('produce travels; the house sells', () => {
  it('coins come only from the house (and fireflies): picking a berry earns nothing until it is sold', () => {
    const { w } = holding('berry', 'home', false);
    expect(step(w, 'drop')).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'deliver', kind: 'berry', into: 'home' })]));
    expect(w.sold).toBe(1);
    const s = farmGame({ mode: 'forage' });
    const rt = createRuntime(s.farm);
    let firstPickTick = -1, firstCoinTick = -1;
    for (let i = 0; i < 400 && firstCoinTick < 0; i++) {
      farmTick(s, rt);
      if (firstPickTick < 0 && s.farm.world.pet.carrying !== null) firstPickTick = i;
      if (s.progress.totalCoins > 0) firstCoinTick = i;
    }
    expect(firstPickTick).toBeGreaterThanOrEqual(0);
    expect(firstCoinTick).toBeGreaterThan(firstPickTick); // the walk home comes in between
    expect(s.progress.totalCoins).toBe(SELL_PRICE.berry);
    expect(s.journal.some((j) => j.kind === 'first-sale')).toBe(true);
  });

  it('without Fetch, harvests go straight to the house; with it, to the nearest storage with room (or the house)', () => {
    const s = farmGame();
    const w = s.farm.world;
    w.pet.x = 3; w.pet.y = 4; // nearer the basket (2,3) than the house (1,1)
    expect(harvestDestination(w, 'berry', false)).toBe('home');
    expect(harvestDestination(w, 'berry', true)).toBe('bin');
    basket(s).store = [{ kind: 'carrot', n: 1 }];
    expect(harvestDestination(w, 'berry', true)).toBe('home'); // the basket holds carrots
    basket(s).store = [{ kind: 'berry', n: 6 }];
    expect(harvestDestination(w, 'berry', true)).toBe('home'); // full
  });

  it('a pet with Fetch on Auto harvests with its learned Harvest (selling at the house) and hauls stored goods', () => {
    // Learned-farm phase 3: Harvest is the pet's own routine, which sells at the house; storage is filled by hand here
    // (a learned "harvest into storage" comes with the haul and basket jobs).
    const s = farmGame({ fetch: true });
    s.progress.unlocks.push('carrots');
    basket(s).store = [{ kind: 'carrot', n: 4 }];
    run(s, 1500);
    expect(storeCount(basket(s))).toBeLessThan(4);
    expect(s.resources.carrots + s.resources.berries).toBeGreaterThan(10);
    expect(s.progress.totalCoins).toBeGreaterThan(40);
  });

  it('Haul empties storage into the house', () => {
    const s = farmGame({ fetch: true, mode: 'deliver' });
    basket(s).store = [{ kind: 'carrot', n: 5 }];
    s.farm.world.objects = s.farm.world.objects.filter((o) => o.kind !== 'berry'); // nothing else to do
    run(s, 600);
    expect(storeCount(basket(s))).toBeLessThan(5);
    expect(s.resources.carrots).toBe(5 - storeCount(basket(s)));
    expect(s.progress.totalCoins).toBe(s.resources.carrots * SELL_PRICE.carrot);
  });

  it('never stuck: from 0 coins, empty storage, a pet with only Approach earns within a farm day', () => {
    const s = farmGame();
    s.resources.coins = 0;
    run(s, 1200);
    expect(s.progress.totalCoins).toBeGreaterThanOrEqual(5);
  });

  it('is deterministic (and a plan preview still equals reality is covered by tests/milestone4)', () => {
    const a = farmGame({ fetch: true }), b = farmGame({ fetch: true });
    run(a, 800); run(b, 800);
    expect(JSON.stringify(a.farm.world)).toBe(JSON.stringify(b.farm.world));
  });
});

describe('the shed, requests, tips and saves', () => {
  it('requests count sales at the house, not picks or storing', () => {
    const s = farmGame();
    s.farm.requests = [{ id: 'r', kind: 'berries', n: 2, from: 'Hazel', day: 1, until: 'nightfall', progress: 0, status: 'open', reward: 3 } as never];
    trackRequests(s, [{ type: 'pickup', kind: 'berry', x: 0, y: 0 }, { type: 'deliver', kind: 'berry', into: 'bin', x: 0, y: 0 }]);
    expect(s.farm.requests![0].progress).toBe(0);
    trackRequests(s, [{ type: 'deliver', kind: 'berry', into: 'home', x: 0, y: 0 }]);
    expect(s.farm.requests![0].progress).toBe(1);
  });

  it('a full basket with nobody to haul it gets a coaching tip', () => {
    const s = farmGame();
    basket(s).store = [{ kind: 'berry', n: 6 }];
    expect(farmTips(s).map((t) => t.id)).toContain('storage-full');
    const t = farmGame({ fetch: true });
    basket(t).store = [{ kind: 'berry', n: 6 }];
    expect(farmTips(t).map((x) => x.id)).not.toContain('storage-full'); // a pet with Fetch on Auto hauls
  });

  it('v5 saves: the bin becomes an empty 6-slot basket; everything else is kept', () => {
    const s = farmGame();
    const old = JSON.parse(serializeGame(s));
    old.version = 5; old.game.version = 5;
    for (const o of old.game.farm.world.objects) delete o.store;
    delete old.game.farm.world.sold;
    const coins = old.game.resources.coins;
    const r = parseGame(JSON.stringify(old));
    expect(r.ok).toBe(true);
    expect(r.game!.farm.world.objects.find((o) => o.kind === 'bin')!.store).toEqual([{ kind: null, n: 0 }]);
    expect(r.game!.resources.coins).toBe(coins);
  });
});

describe('crops and planting (farm life B)', () => {
  const field = (s: GameState) => s.farm.world.objects.filter((o) => ['soil', 'patch'].includes(o.kind) && o.y === 7);
  const soilWorld = (crop: string, coins?: number) => {
    const w = emptyWorld(5, 5);
    const o = addObject(w, 'soil', 2, 2); o.crop = crop;
    w.pet.x = 2; w.pet.y = 2;
    if (coins !== undefined) w.seedCoins = coins;
    return { w, o };
  };

  it('plant turns empty soil into a growing patch; without coins for the seed it fumbles', () => {
    const a = soilWorld('pumpkin', 3);
    expect(step(a.w, 'plant')).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'plant', kind: 'pumpkin' })]));
    expect(a.o.kind).toBe('patch');
    const b = soilWorld('pumpkin', 2);
    expect(step(b.w, 'plant').map((e) => e.type)).toContain('fumble');
    expect(b.o.kind).toBe('soil');
    const pen = soilWorld('carrot'); // pens don't track coins: planting is free
    step(pen.w, 'plant');
    expect(pen.o.kind).toBe('patch');
  });

  it('a harvested (or pecked) field plot goes back to soil and waits; a bush regrows by itself', () => {
    const s = farmGame();
    s.progress.unlocks.push('carrots');
    s.farm.dutyPetId = null; // nobody harvests or replants
    const rt = createRuntime(s.farm);
    const w = s.farm.world;
    for (let i = 0; i < 60; i++) farmTick(s, rt); // carrots ripen (44 ticks)
    const carrot = w.objects.find((o) => o.kind === 'carrot')!;
    expect(carrot).toBeDefined();
    carrot.delivered = true; // as if harvested and sold
    const bush = w.objects.find((o) => o.kind === 'berry')!;
    bush.delivered = true;
    for (let i = 0; i < 200; i++) farmTick(s, rt);
    const plot = w.objects.find((o) => o.x === carrot.x && o.y === carrot.y && (o.kind === 'soil' || o.kind === 'patch'))!;
    expect(plot.kind).toBe('soil');
    expect(plot.crop).toBe('carrot');
    expect(w.objects.filter((o) => o.kind === 'carrot' && o.x === carrot.x && o.y === carrot.y && !o.delivered)).toHaveLength(0);
    expect(w.objects.some((o) => o.kind === 'berry' && o.x === bush.x && o.y === bush.y && !o.delivered)).toBe(true);
  });

  it('a pet on Auto replants, paying for the seed from the farm’s coins', () => {
    const s = farmGame();
    s.progress.unlocks.push('carrots');
    for (const o of field(s)) { o.kind = 'soil'; o.crop = 'carrot'; }
    s.resources.coins = 10;
    const rt = createRuntime(s.farm);
    let planted = 0;
    for (let i = 0; i < 200 && planted < 2; i++) { farmTick(s, rt); planted = s.pets[0].stats.planted ?? 0; }
    expect(planted).toBeGreaterThanOrEqual(2);
    expect(s.journal.some((j) => j.kind === 'first-plant')).toBe(true);
    expect(s.resources.coins).toBeLessThanOrEqual(10 - 2 * seedPrice('carrot') + s.progress.totalCoins);
  });

  it('Can afford seeds reads the farm’s coins (always true in pens)', () => {
    const c = compileCondition(node('cond.canAfford'));
    const a = soilWorld('sunflower', 1);
    expect(c({ w: a.w } as never)).toBe(false);
    a.w.seedCoins = 2;
    expect(c({ w: a.w } as never)).toBe(true);
    expect(c({ w: soilWorld('pumpkin').w } as never)).toBe(true);
  });

  it('crows go for sunflowers before berries', () => {
    const w = emptyWorld(12, 3);
    addObject(w, 'berry', 3, 1);
    addObject(w, 'sunflower', 9, 1);
    const crow = addObject(w, 'crow', 4, 0); // 2 steps from the berry, 6 from the sunflower
    w.pet.x = 0; w.pet.y = 2;
    const xs: number[] = [];
    for (let i = 0; i < 4; i++) { step(w, 'wait'); xs.push(crow.x); }
    expect(w.objects.find((o) => o.kind === 'berry')!.delivered).toBeFalsy();
    expect(Math.max(...xs)).toBeGreaterThan(4); // it flew toward the sunflower
  });

  it('never stuck: with no coins and nothing growing, a neighbour’s seeds plant the cheapest plot at dawn', () => {
    const s = farmGame();
    s.progress.unlocks.push('carrots');
    for (const o of field(s)) { o.kind = 'soil'; o.crop = 'carrot'; }
    s.resources.coins = 0;
    expect(seedGift(s)).toBe(true);
    expect(field(s).filter((o) => o.kind === 'patch')).toHaveLength(1);
    expect(seedGift(s)).toBe(false); // something is growing now
  });

  it('every field crop is worth planting: a sale pays several times its seed, and slower crops pay more per trip', () => {
    const crops = ['carrot', 'sunflower', 'pumpkin'].map((id) => ({ id, ...OBJECT_BY_ID[id].crop! }));
    for (const c of crops) expect(c.sells).toBeGreaterThanOrEqual(c.seed! * 3);
    for (let i = 1; i < crops.length; i++) {
      expect(crops[i].grows).toBeGreaterThan(crops[i - 1].grows);
      expect(crops[i].sells - crops[i].seed!).toBeGreaterThan(crops[i - 1].sells - crops[i - 1].seed!);
    }
    expect(SELL_PRICE.pumpkin).toBe(12);
  });

  it('the plant ability goes last, so saved policies keep their action indices', () => {
    expect(ABILITY_ORDER).toEqual(['move', 'stay', 'pickup', 'drop', 'water', 'shoo', 'nudge', 'plant', 'lift']);
  });

  it('a farm day with replanting earns more than it spends on seeds', () => {
    const s = farmGame({ fetch: true });
    s.progress.unlocks.push('carrots');
    s.resources.coins = 0;
    const rt = run(s, 2400);
    expect(rt).toBeDefined();
    expect(s.pets[0].stats.planted ?? 0).toBeGreaterThan(3);
    expect(s.resources.coins).toBeGreaterThan(20);
    expect(s.resources.carrots).toBeGreaterThan(3);
  });
});
