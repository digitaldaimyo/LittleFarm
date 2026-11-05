/**
 * The farm's world upkeep (split from farm.ts, polish phase 3): its size, crops and prices, the day and night clock,
 * weather, creatures, regrowing crops, and questions about the world (where to stand by the crops, which basket needs
 * a run, what is on a tile).
 */
import type { Obj, World } from '../sim/world';
import { addObject, isSolidAt, def, emptyStore, emptyWorld, seedPrice, storeCount, inArea, objectsAt, onGround } from '../sim/world';
import { nightfallRequests, postRequests } from './requests';
import type { FarmState, GameState, Plot } from './types';
import { addJournal, addJournalOnce } from './journal';
import type { FarmRuntime, FarmFx } from './farm';

export const FARM_W = 12;

export const FARM_H = 9;

/** Crop economics live on the object definitions (grow time, seed, price); these are views of them. */
export const CROPS = ['berry', 'carrot', 'pumpkin', 'sunflower'] as const;

export const GROW_TICKS: Record<Plot['crop'], number> = Object.fromEntries(CROPS.map((c) => [c, def(c).crop!.grows])) as Record<Plot['crop'], number>;

/** What produce sells for when it reaches the house (the only place coins come from, besides fireflies). */
export const SELL_PRICE: Record<string, number> = { ...Object.fromEntries(CROPS.map((c) => [c, def(c).crop!.sells])), egg: 3 };

/** Kept for older references: a berry's price. */
export const CROP_VALUE = { berry: SELL_PRICE.berry, carrot: SELL_PRICE.carrot, egg: SELL_PRICE.egg };

export const TIRED = 25;

/** Day/night clock: one farm day = 1200 ticks (~5½ minutes at 1×); the last 30% is night. */
export const DAY_TICKS = 1200;

export const NIGHT_FROM = 0.7;

export function dayInfo(tick: number): { day: number; phase: number; night: boolean; label: string } {
  const phase = (tick % DAY_TICKS) / DAY_TICKS;
  const night = phase >= NIGHT_FROM;
  const label = night ? 'night' : phase < 0.3 ? 'morning' : phase < 0.55 ? 'afternoon' : 'evening';
  return { day: Math.floor(tick / DAY_TICKS) + 1, phase, night, label };
}

export const WELL_POS = { x: 3, y: 1 };

export const COOP = { name: 'coop', x: 0, y: 5, w: 2, h: 2 };

const MAX_EGGS = 4;

const FIREFLIES_PER_NIGHT = 4;

export function createFarm(): FarmState {
  const w = emptyWorld(FARM_W, FARM_H);
  addObject(w, 'home', 1, 1);
  addObject(w, 'bin', 2, 3).store = emptyStore('bin');
  addObject(w, 'well', WELL_POS.x, WELL_POS.y);
  for (const [x, y] of [[5, 2], [6, 2], [5, 3], [6, 3], [7, 3], [6, 4], [5, 4]]) addObject(w, 'pond', x, y);
  for (const [x, y] of [[0, 8], [11, 0], [4, 0], [11, 8], [0, 4]]) addObject(w, 'tree', x, y);
  for (const [x, y] of [[8, 6], [3, 5], [9, 3]]) addObject(w, 'rock', x, y);
  const plots: Plot[] = [
    { x: 9, y: 1, crop: 'berry', objId: null, timer: 999 },
    { x: 10, y: 5, crop: 'berry', objId: null, timer: 999 },
    { x: 2, y: 7, crop: 'carrot', objId: null, timer: 999, unlock: 'carrots' },
    { x: 4, y: 7, crop: 'carrot', objId: null, timer: 999, unlock: 'carrots' },
  ];
  for (const p of plots) { const o = addObject(w, p.crop === 'berry' ? 'bush' : 'patch', p.x, p.y); if (p.crop !== 'berry') o.crop = p.crop; }
  w.pet.x = 1;
  w.pet.y = 2;
  w.areas = [{ ...COOP }];
  w.rng = 0xfa53;
  return { world: w, plots, tick: 0, rngState: 12345, dutyPetId: null, stun: 0, queue: [], current: null, production: [], manualMode: false };
}

function plotUnlocked(s: GameState, p: Plot): boolean {
  return !p.unlock || s.progress.unlocks.includes(p.unlock);
}

export function regrow(s: GameState): void {
  const w = s.farm.world;
  for (const p of s.farm.plots) {
    if (!plotUnlocked(s, p)) continue;
    const plotObj = objectsAt(w, p.x, p.y).find((o) => o.kind === 'bush' || o.kind === 'patch' || o.kind === 'soil');
    const field = p.crop !== 'berry';
    if (p.objId !== null) {
      const o = w.objects.find((x) => x.id === p.objId);
      if (o && !o.carried && !o.delivered && o.x === p.x && o.y === p.y) continue;
      // Harvested (or pecked). Bushes regrow; field plots go back to empty soil and wait to be replanted.
      p.objId = null;
      p.timer = 0;
      if (field && plotObj) { plotObj.kind = 'soil'; plotObj.wet = false; plotObj.crop = p.crop; continue; }
    }
    if (field && (!plotObj || plotObj.kind === 'soil')) { p.timer = 0; if (plotObj) delete plotObj.ripeIn; continue; } // not planted yet
    p.timer += plotObj?.wet ? 2 : 1; // watered plots grow twice as fast
    if (p.timer >= GROW_TICKS[p.crop] && !objectsAt(w, p.x, p.y).some((o) => o.kind === p.crop)) {
      p.objId = addObject(w, p.crop, p.x, p.y).id;
      if (plotObj) plotObj.wet = false; // the soil dries out with each harvest
    }
    // What cards can read (Time until ripe): ticks left, 0 while a ripe crop sits here.
    if (plotObj) plotObj.ripeIn = p.objId !== null ? 0 : Math.max(0, GROW_TICKS[p.crop] - p.timer);
  }
}

/** Empty soil whose seed the farm can afford right now. */
export function canPlantSomewhere(w: World): boolean {
  return w.objects.some((o) => o.kind === 'soil' && onGround(o) && (w.seedCoins ?? 0) >= seedPrice(o.crop ?? 'carrot'));
}

/** Is any basket or shed (on the ground) at least half full? */
export function storeHalfFull(w: World): boolean {
  return w.objects.some((o) => { const st = def(o.kind).storage; return !!o.store && onGround(o) && !!st && storeCount(o) * 2 >= st.slots * st.perSlot; });
}

/** The basket the pet is holding, if any. */
export function heldBasket(w: World): Obj | undefined {
  const c = w.pet.carrying !== null ? w.objects.find((o) => o.id === w.pet.carrying) : undefined;
  return c && def(c.kind).portable ? c : undefined;
}

const PLOT_KINDS = ['bush', 'patch', 'soil'];

const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * The best clear tile to set a basket down among the crops: next to as many (unlocked) plots as possible, then
 * nearest the house (a shorter haul). Null if there's nowhere useful.
 */
export function cropSpot(s: GameState): { x: number; y: number; plot: Obj } | null {
  const w = s.farm.world;
  const plots = s.farm.plots.filter((p) => !p.unlock || s.progress.unlocks.includes(p.unlock))
    .map((p) => objectsAt(w, p.x, p.y).find((o) => PLOT_KINDS.includes(o.kind))).filter((o): o is Obj => !!o);
  const home = w.objects.find((o) => o.kind === 'home' && onGround(o));
  const coop = (w.areas ?? []).find((a) => a.name === 'coop');
  const bodies = [w.pet, ...(w.crew ?? [])];
  let best: { x: number; y: number; plot: Obj; score: number; d: number } | null = null;
  for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
    if (objectsAt(w, x, y).length || isSolidAt(w, x, y) || (x === 1 && y === 2) || (coop && inArea(coop, x, y))) continue;
    if (bodies.some((b) => b.x === x && b.y === y && b !== w.pet)) continue;
    const near = plots.filter((o) => chebyshev(o, { x, y }) === 1);
    if (!near.length) continue;
    const d = home ? Math.abs(home.x - x) + Math.abs(home.y - y) : 0;
    if (!best || near.length > best.score || (near.length === best.score && d < best.d)) best = { x, y, plot: near[0], score: near.length, d };
  }
  return best && best.score >= 2 ? { x: best.x, y: best.y, plot: best.plot } : null;
}

/** Is a basket run worth doing? A basket at least half full (to empty), or an empty one away from the crops (to move). */
export function toteTarget(s: GameState): Obj | null {
  const w = s.farm.world;
  const baskets = w.objects.filter((o) => def(o.kind).portable && o.store && onGround(o));
  const full = baskets.filter((o) => storeCount(o) * 2 >= def(o.kind).storage!.perSlot * def(o.kind).storage!.slots)
    .sort((a, b) => storeCount(b) - storeCount(a) || (Math.abs(a.x - w.pet.x) + Math.abs(a.y - w.pet.y)) - (Math.abs(b.x - w.pet.x) + Math.abs(b.y - w.pet.y)))[0];
  if (full) return full;
  const plotNear = (o: Obj) => s.farm.plots.some((p) => (!p.unlock || s.progress.unlocks.includes(p.unlock)) && chebyshev(p, o) <= 1);
  const stray = baskets.find((o) => storeCount(o) === 0 && !plotNear(o));
  return stray && cropSpot(s) ? stray : null;
}

/** Everything sold at the house so far (the haul job is done when this goes up). */
export function totalSold(w: World): number {
  return w.sold ?? 0;
}

/** Gentle weather: from day 2, the odd daytime shower waters every plot and swells the pond by a tile. */
export function updateWeather(s: GameState, rt: FarmRuntime, fx: FarmFx[]): void {
  const f = s.farm;
  const w = f.world;
  const { night, day } = dayInfo(f.tick);
  if (w.raining && f.rainUntil !== undefined && f.tick >= f.rainUntil) {
    w.raining = false;
    const gone = new Set(f.puddles ?? []);
    w.objects = w.objects.filter((o) => !gone.has(o.id));
    f.puddles = [];
    f.rainUntil = undefined;
    addJournalOnce(s, null, 'first-rain-end', 'The rain stopped. The extra puddle by the pond soaked away.');
  } else if (!w.raining && !night && day >= 2 && rt.rng.next() < 1 / 700) {
    w.raining = true;
    f.rainUntil = f.tick + 180 + rt.rng.int(220);
    w.objects = w.objects.filter((o) => o.kind !== 'crow'); // crows shelter from the rain
    const ponds = w.objects.filter((o) => o.kind === 'pond' && onGround(o));
    const spots: [number, number][] = [];
    for (const p of ponds) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= w.w || y >= w.h || objectsAt(w, x, y).length || (w.pet.x === x && w.pet.y === y)) continue;
      if ((w.areas ?? []).some((a) => inArea(a, x, y))) continue;
      spots.push([x, y]);
    }
    f.puddles = [];
    if (spots.length) {
      const [x, y] = spots[rt.rng.int(spots.length)];
      f.puddles.push(addObject(w, 'pond', x, y).id);
    }
    fx.push({ type: 'splash', x: w.pet.x, y: w.pet.y, text: 'rain' });
    addJournalOnce(s, null, 'first-rain', 'It started to rain! Every bush and patch got a free watering, and the pond swelled by a tile.');
  }
  if (w.raining) for (const o of w.objects) if ((o.kind === 'bush' || o.kind === 'patch') && !o.wet) o.wet = true;
}

/** Chickens lay in the coop; crows visit by day once you can teach your own skills. */
export function updateCreatures(s: GameState, rt: FarmRuntime, fx: FarmFx[]): void {
  const w = s.farm.world;
  const coop = w.areas?.find((a) => a.name === 'coop');
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < w.w && y < w.h && !objectsAt(w, x, y).length && !(w.pet.x === x && w.pet.y === y);
  if (coop) {
    const eggs = w.objects.filter((o) => o.kind === 'egg' && onGround(o)).length;
    for (const c of w.objects.filter((o) => o.kind === 'chicken' && onGround(o))) {
      if (!inArea(coop, c.x, c.y) || eggs >= MAX_EGGS || rt.rng.next() >= 1 / 90) continue;
      const spots: [number, number][] = [];
      for (let y = coop.y; y < coop.y + coop.h; y++) for (let x = coop.x; x < coop.x + coop.w; x++) if (free(x, y)) spots.push([x, y]);
      if (!spots.length) continue;
      const [x, y] = spots[rt.rng.int(spots.length)];
      addObject(w, 'egg', x, y);
      fx.push({ type: 'pickup', x, y, text: 'egg' });
      addJournalOnce(s, null, 'first-egg', 'A chicken laid the first egg in the coop. Chickens only lay where they feel safe.');
    }
  }
  const crows = w.objects.filter((o) => o.kind === 'crow' && onGround(o));
  if (w.night) {
    if (crows.length) w.objects = w.objects.filter((o) => o.kind !== 'crow');
  } else if (!crows.length && !w.raining && s.progress.unlocks.includes('custom') && s.farm.tick >= DAY_TICKS && rt.rng.next() < 1 / 250) {
    const edge: [number, number][] = [];
    for (let x = 0; x < w.w; x++) for (const y of [0, w.h - 1]) if (free(x, y)) edge.push([x, y]);
    for (let y = 1; y < w.h - 1; y++) for (const x of [0, w.w - 1]) if (free(x, y)) edge.push([x, y]);
    if (edge.length) {
      const [x, y] = edge[rt.rng.int(edge.length)];
      addObject(w, 'crow', x, y);
      fx.push({ type: 'sound', x, y, text: 'crow' });
      addJournalOnce(s, null, 'first-crow', 'A crow landed at the edge of the farm, eyeing the crops. A pet that can Shoo could send it packing.');
    }
  }
}

/**
 * Never stuck: at dawn, if every empty field plot needs a seed the farm can't afford and nothing in the fields is
 * growing, a neighbour's packet of seeds plants the cheapest one for free. (Berry bushes regrow by themselves too.)
 */
export function seedGift(s: GameState, fx: FarmFx[] = []): boolean {
  const w = s.farm.world;
  const soil = w.objects.filter((o) => o.kind === 'soil' && onGround(o));
  if (!soil.length || soil.some((o) => s.resources.coins >= seedPrice(o.crop ?? 'carrot'))) return false;
  if (w.objects.some((o) => o.kind === 'patch' && onGround(o)) || w.objects.some((o) => ['carrot', 'pumpkin', 'sunflower'].includes(o.kind) && onGround(o))) return false;
  const o = soil.reduce((a, b) => (seedPrice(b.crop ?? 'carrot') < seedPrice(a.crop ?? 'carrot') ? b : a));
  o.kind = 'patch';
  o.wet = false;
  fx.push({ type: 'sound', x: o.x, y: o.y, text: 'plant' });
  addJournal(s, null, 'seed-gift', `A neighbour left a packet of ${o.crop ?? 'carrot'} seeds by the gate and planted them at dawn. (Seeds cost coins; berries are free and always regrow.)`);
  return true;
}

/** Night falls → fireflies appear on open tiles; dawn → the uncaught ones drift away. */
export function updateClock(s: GameState, rt: FarmRuntime, fx: FarmFx[]): void {
  const w = s.farm.world;
  const { night, day } = dayInfo(s.farm.tick);
  if (!s.farm.requests && s.pets.length) postRequests(s, rt.rng, day); // first board of the game
  if (night === !!w.night) return;
  w.night = night;
  if (night) nightfallRequests(s);
  else postRequests(s, rt.rng, day);
  if (night) {
    const free: [number, number][] = [];
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
      if (objectsAt(w, x, y).length || (w.pet.x === x && w.pet.y === y)) continue;
      free.push([x, y]);
    }
    for (let i = 0; i < FIREFLIES_PER_NIGHT && free.length; i++) {
      const [x, y] = free.splice(rt.rng.int(free.length), 1)[0];
      addObject(w, 'firefly', x, y);
    }
    fx.push({ type: 'nap', x: w.pet.x, y: w.pet.y, text: 'night' });
    fx.push({ type: 'sound', x: w.pet.x, y: w.pet.y, text: 'dusk' });
    addJournalOnce(s, null, 'first-night', `Night fell on the farm for the first time (day ${day}). Fireflies blinked over the grass.`);
  } else {
    w.objects = w.objects.filter((o) => o.kind !== 'firefly');
    fx.push({ type: 'sound', x: w.pet.x, y: w.pet.y, text: 'dawn' });
    seedGift(s, fx);
  }
}

/** What's on a farm tile, in words (storage contents, plot stage and timer), or null if nothing to say. */
export function describeTile(s: GameState, x: number, y: number): string | null {
  const w = s.farm.world;
  const here = objectsAt(w, x, y);
  const store = here.find((o) => o.store);
  if (store) {
    const st = def(store.kind).storage!;
    const slots = store.store!.map((sl) => (sl.kind ? `${sl.n} ${def(sl.kind).plural}` : 'empty')).join(' · ');
    return `${def(store.kind).name}: ${slots} (${st.perSlot} per ${st.slots > 1 ? 'slot' : 'kind'}).`;
  }
  const plot = s.farm.plots.find((p) => p.x === x && p.y === y);
  if (plot) {
    const crop = def(plot.crop);
    const ripe = here.some((o) => o.kind === plot.crop);
    const base = here.find((o) => ['bush', 'patch', 'soil'].includes(o.kind));
    const name = plot.crop === 'berry' ? 'Berry bush' : `${crop.name} patch`;
    if (!plotUnlockedFor(s, plot)) return `${name}: waiting for ${plot.unlock === 'carrots' ? 'carrots to unlock (certify Fetch)' : 'an unlock'}.`;
    if (ripe) return `${name}: ripe — ready to harvest (sells for ${SELL_PRICE[plot.crop]}).`;
    if (base?.kind === 'soil') return `${name}: empty soil — plant it (seed ${seedPrice(plot.crop)}).`;
    const left = Math.max(0, GROW_TICKS[plot.crop] - plot.timer);
    return `${name}: growing — ripe in about ${base?.wet ? Math.ceil(left / 2) : left} ticks${base?.wet ? ' (watered: twice as fast)' : ''}.`;
  }
  const o = here.find((x2) => !['buddy'].includes(x2.kind));
  if (!o) return null;
  if (o.kind === 'well') return 'Well: pets with Water fill up here (3 splashes).';
  if (o.kind === 'pond') return 'Pond: pets that walk in get wet and lose a few ticks.';
  if (o.kind === 'gate') return `Gate: ${o.open ? 'open' : 'shut'}. Pets with Nudge can open or shut it.`;
  return `${def(o.kind).name}.`;
}

function plotUnlockedFor(s: GameState, p: Plot): boolean {
  return !p.unlock || s.progress.unlocks.includes(p.unlock);
}

/** Coins earned over the last `window` ticks. */
export function recentProduction(f: FarmState, window = 480): number {
  return f.production.filter((p) => f.tick - p.tick <= window).reduce((a, b) => a + b.coins, 0);
}
