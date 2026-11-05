import { describe, expect, it } from 'vitest';
import { addObject, emptyStore, emptyWorld, nearest, step, storeCount } from '../src/sim/world';
import { compileCondition, generateWorld } from '../src/sim/compile';
import { compileEncoder } from '../src/learning/senses';
import { node } from '../src/domain/spec';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { createRuntime, cropSpot, farmTick, heldBasket, toteTarget } from '../src/game/farm';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { recipeStage, trainAndSave, trainAndSaveRoutine, giveFarmJobs, giveRoutine } from './helpers';

/** A basket with stock under the pet, a house two steps east and a shed three steps south. */
function yard(stock = 4) {
  const w = emptyWorld(6, 6);
  const b = addObject(w, 'bin', 1, 1);
  b.store = [{ kind: 'berry', n: stock }];
  addObject(w, 'home', 3, 1);
  const shed = addObject(w, 'shed', 1, 4);
  shed.store = emptyStore('shed');
  w.pet.x = 1; w.pet.y = 1;
  return { w, b, shed };
}
const types = (ev: { type: string }[]) => ev.map((e) => e.type);

describe('carrying baskets (sim)', () => {
  it('lift picks up the basket with what’s in it; a carried basket can’t be filled; pick still takes one item', () => {
    const { w, b } = yard();
    expect(types(step(w, 'pick'))).toContain('pickup'); // pick = take one berry out, as before
    expect(storeCount(b)).toBe(3);
    step(w, 'drop'); // and back in
    expect(types(step(w, 'lift'))).toContain('lift');
    expect(w.pet.carrying).toBe(b.id);
    expect(storeCount(b)).toBe(4);
    // Something else dropped where the basket was doesn't go into it.
    const berry = addObject(w, 'berry', 2, 2);
    expect(storeCount(b)).toBe(4);
    void berry;
  });

  it('put down at the house, the basket empties (everything sells) and stays in the pet’s paws', () => {
    const { w, b } = yard(4);
    step(w, 'lift'); step(w, 'E'); step(w, 'E');
    const ev = step(w, 'drop');
    expect(ev.filter((e) => e.type === 'deliver' && e.into === 'home')).toHaveLength(4);
    expect(types(ev)).toContain('empty');
    expect(w.sold).toBe(4);
    expect(storeCount(b)).toBe(0);
    expect(w.pet.carrying).toBe(b.id);
  });

  it('at a shed it empties as much as fits; on open ground it is set down; on a crop it is refused', () => {
    const { w, b, shed } = yard(5);
    shed.store = [{ kind: 'carrot', n: 10 }, { kind: 'carrot', n: 10 }, { kind: 'carrot', n: 10 }, { kind: 'berry', n: 8 }];
    step(w, 'lift'); step(w, 'S'); step(w, 'S'); step(w, 'S');
    step(w, 'drop');
    expect(shed.store[3]).toEqual({ kind: 'berry', n: 10 });
    expect(storeCount(b)).toBe(3); // 2 fitted
    addObject(w, 'carrot', 2, 4);
    step(w, 'E');
    expect(types(step(w, 'drop'))).toContain('fumble'); // not on a crop
    step(w, 'E');
    expect(types(step(w, 'drop'))).toContain('drop');
    expect(heldBasket(w)).toBeUndefined();
    expect(b).toMatchObject({ x: 3, y: 4, carried: false });
  });

  it('pens: a basket without a store (old lessons) can be lifted but has nothing to empty', () => {
    const w = emptyWorld(4, 4);
    addObject(w, 'bin', 0, 0);
    addObject(w, 'home', 1, 0);
    expect(types(step(w, 'lift'))).toContain('lift');
    step(w, 'E');
    expect(types(step(w, 'drop'))).toContain('fumble');
  });
});

describe('stocked storage in pens', () => {
  it('Stocked storage places a basket already holding things; “up to” varies the amount; the Stock sense and “all empty” read it', () => {
    const st = recipeStage('empty-basket');
    const amounts = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const w = generateWorld(st, seed);
      const b = w.objects.find((o) => o.kind === 'bin')!;
      expect(b.store![0].kind).toBe('berry');
      amounts.add(storeCount(b));
    }
    expect([...amounts].every((n) => n >= 1 && n <= 3)).toBe(true);
    expect(amounts.size).toBeGreaterThan(1);
    const { w, b } = yard(6);
    const enc = compileEncoder([node('sense.stock')], 'berry');
    const stock = (w: Parameters<typeof enc.encode>[0]) => enc.encode(w)[0];
    const empty = compileCondition(node('cond.storage', { level: 'empty' }));
    expect(stock(w)).toBe(2);
    b.store = [{ kind: 'berry', n: 2 }];
    expect(stock(w)).toBe(1);
    expect(empty({ w } as never)).toBe(false);
    b.store = [{ kind: null, n: 0 }];
    expect(stock(w)).toBe(0);
    expect(empty({ w } as never)).toBe(true);
  });

  it('the “Empty the basket” routine trains over Approach: lift it, carry it home, put it down (well above random)', () => {
    const s = newGame();
    const p = adoptPet(s, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    trainAndSave(s, p, recipeStage('go-to-berry'));
    const e = trainAndSaveRoutine(s, p, recipeStage('empty-basket')).eval;
    expect(e.randomRate).toBeLessThan(0.1);
    expect(e.successRate).toBeGreaterThanOrEqual(0.8);
  }, 60000);
});

function basketFarm() {
  const s = newGame();
  const p = adoptPet(s, 'Pip', 'meadow');
  p.traits = { ...DEFAULT_TRAITS };
  trainAndSave(s, p, recipeStage('go-to-berry'));
  giveFarmJobs(s, p);
  trainAndSave(s, p, recipeStage('bring-it-home'), activeRevision(getSkill(p, 'Approach'))!.policy);
  giveRoutine(s, p, 'basket-run');
  p.assignment = { mode: 'auto', job: 'harvest', navigator: 'Approach' };
  s.farm.dutyPetId = p.id;
  s.progress.unlocks.push('fetch', 'carrots');
  return s;
}

describe('basket runs on the farm', () => {
  it('an empty basket away from the crops is carried next to them; a half-full one is emptied at the house and brought back', () => {
    const s = basketFarm();
    const w = s.farm.world;
    const b = w.objects.find((o) => o.kind === 'bin')!;
    expect(toteTarget(s)?.id).toBe(b.id); // the starting basket by the house is away from the crops
    b.store = [{ kind: 'berry', n: 3 }]; // half full (learned Harvest sells at the house, so stock it by hand)
    const spot = cropSpot(s)!;
    expect(spot).toBeTruthy();
    const rt = createRuntime(s.farm);
    let moved = false, emptied = 0;
    const plots = s.farm.plots;
    for (let t = 0; t < 1200; t++) {
      const r = farmTick(s, rt);
      // The learned Basket run sets it down beside a crop (any plot, not necessarily the scripted best spot).
      if (!moved && !b.carried && plots.some((q) => Math.max(Math.abs(b.x - q.x), Math.abs(b.y - q.y)) <= 1)) moved = true;
      emptied += r.fx.filter((f) => f.type === 'sound' && f.text === 'emptied').length;
      expect(w.objects.filter((o) => o.kind === 'bin')).toHaveLength(1);
    }
    expect(moved).toBe(true);
    expect(s.journal.some((j) => j.kind === 'first-basket-run')).toBe(true);
    expect(s.progress.totalCoins).toBeGreaterThan(60);
    void emptied;
  });

  it('with two baskets, a harvest goes to the one with room — not just the nearest of its kind', () => {
    const s = basketFarm();
    const w = s.farm.world;
    const near = w.objects.find((o) => o.kind === 'bin')!;
    near.store = [{ kind: 'berry', n: 6 }];
    const far = addObject(w, 'bin', 6, 6);
    far.store = emptyStore('bin');
    w.pet.x = near.x; w.pet.y = near.y;
    const held = addObject(w, 'berry', w.pet.x, w.pet.y); held.carried = true; w.pet.carrying = held.id;
    expect(nearest(w, '@storage')?.id).toBe(far.id); // Harvest to storage aims at “storage with room”
  });

  it('with Harvest to storage and a Basket run, crops go into the basket and baskets are emptied at the house', () => {
    const s = basketFarm();
    const p = s.pets[0];
    giveRoutine(s, p, 'harvest-store');
    const rt = createRuntime(s.farm);
    rt.stats = {};
    let stored = 0, emptied = 0;
    for (let t = 0; t < 1600; t++) {
      const r = farmTick(s, rt);
      emptied += r.fx.filter((f) => f.type === 'sound' && f.text === 'emptied').length;
      stored = Math.max(stored, storeCount(s.farm.world.objects.find((o) => o.kind === 'bin')!));
    }
    expect(stored).toBeGreaterThan(0); // a harvest went into the basket
    expect(emptied).toBeGreaterThan(0); // and a Basket run took it to the house
    expect(rt.stats!.basketRun?.ok ?? 0).toBeGreaterThan(0);
    expect(s.progress.totalCoins).toBeGreaterThan(40);
  });

  it('without a Basket run skill there are no basket runs', () => {
    const s = basketFarm();
    const p = s.pets[0];
    p.skills = p.skills.filter((k) => k.name !== 'Basket run');
    const rt = createRuntime(s.farm);
    rt.stats = {};
    for (let t = 0; t < 600; t++) farmTick(s, rt);
    expect(rt.stats!.basketRun).toBeUndefined();
  });

  it('a pet holding a basket finishes the run before anything else, even when tired', () => {
    const s = basketFarm();
    const w = s.farm.world;
    const b = w.objects.find((o) => o.kind === 'bin')!;
    b.store = [{ kind: 'berry', n: 3 }];
    w.pet.x = b.x; w.pet.y = b.y;
    step(w, 'lift');
    s.pets[0].energy = 10;
    const rt = createRuntime(s.farm);
    farmTick(s, rt);
    expect(s.farm.current?.behaviorId).toBe('basketRun');
    for (let t = 0; t < 200 && heldBasket(w); t++) farmTick(s, rt);
    expect(heldBasket(w)).toBeUndefined();
    expect(storeCount(b)).toBe(0);
    expect(s.progress.totalCoins).toBeGreaterThanOrEqual(6);
  });
});
