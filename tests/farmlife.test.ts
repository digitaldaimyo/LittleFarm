import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { createRuntime, farmTick, harvestDestination, SELL_PRICE } from '../src/game/farm';
import { buy } from '../src/game/progression';
import { farmTips } from '../src/game/coach';
import { trackRequests } from '../src/game/requests';
import { parseGame, serializeGame } from '../src/persistence/save';
import { addObject, emptyStore, emptyWorld, step, storeCount, type World } from '../src/sim/world';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import type { GameState } from '../src/game/types';
import { recipeStage, trainAndSave } from './helpers';

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

  it('a pet with Fetch on Auto harvests into the basket and hauls it to the house, where it sells', () => {
    const s = farmGame({ fetch: true });
    s.progress.unlocks.push('carrots');
    run(s, 1500);
    expect(s.journal.some((j) => j.kind === 'first-store')).toBe(true);
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
  it('the shop’s shed is placed by the house as empty storage', () => {
    const s = farmGame({ fetch: true });
    s.progress.unlocks.push('fetch');
    s.resources.coins = 30;
    expect(buy(s, 'shed').ok).toBe(true);
    const shed = s.farm.world.objects.find((o) => o.kind === 'shed')!;
    expect(shed.store).toHaveLength(4);
    expect(Math.abs(shed.x - 1) + Math.abs(shed.y - 1)).toBeLessThanOrEqual(2);
  });

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
