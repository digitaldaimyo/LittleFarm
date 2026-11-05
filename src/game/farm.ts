import type { Action, Obj, PetBody, SimEvent, World } from '../sim/world';
import { addObject, inBounds, isSolidAt, bfsPath, cloneTally, def, emptyStore, emptyWorld, seedPrice, storeAccepts, storeCount, inArea, nearest, objectsAt, onGround, step, type StepOptions } from '../sim/world';
import { nightfallRequests, postRequests, trackRequests } from './requests';
import { Rng } from '../sim/rng';
import { SkillRun, isDone, type ExecStep, type Outcome } from '../learning/policies';
import { navTimeout } from '../learning/episodes';
import { atFocus } from '../learning/features';
import type { BehaviorId, ExecContext, Invocation } from '../learning/executive';
import type { FarmPlan, FarmState, GameState, Helper, Pet, Plot } from './types';
import { getSkill, petById } from './pets';
import { deployedRevision, jobCapability, runCapability } from './capability';
import { addJournal, addJournalOnce } from './journal';
import { checkUnlocks } from './progression';
import { GUARD_HOLD, jobPlan, afterDutyJob, chooseDuty, compilePlan, deployExploreExec, execValues, newPlanRuntime, planUsesMemory, starterPlan, traceDecision, type ExecHow, type PlanRuntime } from './plan';

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

export interface FarmFx {
  /** 'sound' marks a moment that is heard but not drawn (text: shoo, firefly, crow, dawn, dusk). */
  type: 'coin' | 'splash' | 'pickup' | 'drop' | 'celebrate' | 'confused' | 'nap' | 'bump' | 'sound';
  x: number;
  y: number;
  amount?: number;
  text?: string;
}

/** Non-serialised runtime attached to the farm (rebuilt after load). */
export interface FarmRuntime {
  exec: { next(w: World): ExecStep } | null;
  inv: Invocation | null;
  ctx: ExecContext | null;
  startCoins: number;
  /** Overrides how Auto chooses (executive practice and comparisons); unset on the real farm. */
  execHow?: ExecHow;
  /** What the world looked like (work done) when the current job started: progress is measured from the world. */
  startWork?: string;
  startEnergy: number;
  startTick: number;
  manual: Action[];
  recentFail: boolean;
  /** Recovery after a failed job: a few random sniffing steps so a pet never repeats a stuck loop forever. */
  /** Farm-plan memory: row starts (for the anti-dithering guard), fire counts, switches. */
  plan: PlanRuntime;
  /** Object this pet is heading for (hidden from the other pets on duty). */
  claim: number | null;
  /** Benchmarks only: per-job outcome counts (absent in play; never affects behaviour). */
  stats?: Record<string, { started: number; ok: number; fail: number; timeout: number; ticks: number }>;
  /** Runtimes of the helpers on duty (`FarmState.helpers`, same order; created on demand). */
  crew: FarmRuntime[];
  rng: Rng;
}

export function createRuntime(f: FarmState): FarmRuntime {
  const rng = new Rng(1);
  rng.state = f.rngState >>> 0;
  return { exec: null, inv: null, ctx: null, startCoins: 0, startEnergy: 0, startTick: 0, manual: [], recentFail: false, plan: newPlanRuntime(), claim: null, crew: [], rng };
}

function plotUnlocked(s: GameState, p: Plot): boolean {
  return !p.unlock || s.progress.unlocks.includes(p.unlock);
}

function regrow(s: GameState): void {
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


/** Where a harvested item goes: without Fetch straight to the house; with it, the nearest storage with room (or the house). */
export function harvestDestination(w: World, kind: string, hasFetch: boolean): string {
  return harvestTarget(w, kind, hasFetch)?.kind ?? 'home';
}

/** The exact storage (or house) a harvest goes to — with several baskets, the walk must head for this one. */
export function harvestTarget(w: World, kind: string, hasFetch: boolean): Obj | undefined {
  const options = w.objects.filter((o) => onGround(o) && (o.kind === 'home' || (hasFetch && o.store && storeAccepts(o, kind))));
  options.sort((a, b) => (Math.abs(a.x - w.pet.x) + Math.abs(a.y - w.pet.y)) - (Math.abs(b.x - w.pet.x) + Math.abs(b.y - w.pet.y)));
  return options[0];
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
function totalSold(w: World): number {
  return w.sold ?? 0;
}

export function farmContext(s: GameState, pet: Pet, recentFail: boolean): ExecContext {
  const w = s.farm.world;
  return {
    energyLow: pet.energy < TIRED,
    // "berry": something ripe to harvest; "carrot": goods to haul (eggs, or anything in storage).
    berry: CROPS.some((c) => !!nearest(w, c)),
    carrot: !!nearest(w, 'egg') || w.objects.some((o) => o.store && onGround(o) && storeCount(o) > 0),
    storeHalf: storeHalfFull(w),
    soil: canPlantSomewhere(w),
    ...(heldBasket(w) ? { basket: true } : {}),
    ...(jobCapability(pet, 'tote') && toteTarget(s) ? { tote: true } : {}),
    carrying: w.pet.carrying !== null,
    recentFail,
    night: !!w.night,
    firefly: !!nearest(w, 'firefly'),
  };
}

/** Gentle weather: from day 2, the odd daytime shower waters every plot and swells the pond by a tile. */
function updateWeather(s: GameState, rt: FarmRuntime, fx: FarmFx[]): void {
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
function updateCreatures(s: GameState, rt: FarmRuntime, fx: FarmFx[]): void {
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
function updateClock(s: GameState, rt: FarmRuntime, fx: FarmFx[]): void {
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

function buildExecutor(s: GameState, pet: Pet, inv: Invocation, rt: FarmRuntime): { next(w: World): ExecStep } {
  const w = s.farm.world;
  // The walking skill errands, fireflies and the walk home use: Avoid if asked for and learned, else Approach.
  const walker = (inv.args.navigator ?? pet.assignment.navigator) === 'Avoid' && getSkill(pet, 'Avoid') ? 'Avoid' : 'Approach';
  switch (inv.behaviorId) {
    case 'forage': {
      // Harvest: the pet's own Harvest skill or routine, aimed at any ripe crop (learned-farm phase 3).
      const cap = jobCapability(pet, 'forage', s);
      if (!cap) return { next: () => ({ done: 'fail', reason: 'no Harvest skill' }) };
      return runCapability(s, pet, cap.name, inv.args.aim ?? cap.aim, rt.rng, inv.timeout);
    }
    case 'goto': {
      // An errand: the pet's own walking skill (Approach, or Avoid), aimed at the target — through the one runtime.
      const target = inv.args.target ?? 'home';
      return runCapability(s, pet, walker, target, rt.rng, inv.timeout, { goal: (world) => atFocus(world, target) });
    }
    case 'tote': {
      // Basket run: the pet's own Basket run routine (learned-farm phase 3b). The job is done once a basket it
      // lifted is set down again (the routine's own goal also needs every basket empty, which a farm rarely is).
      const cap = jobCapability(pet, 'tote');
      if (!cap) return { next: () => ({ done: 'fail', reason: 'no Basket run skill' }) };
      let lifted = !!heldBasket(w);
      const goal = (world: World) => { if (heldBasket(world)) lifted = true; return lifted && world.pet.carrying === null; };
      return runCapability(s, pet, cap.name, inv.args.aim ?? cap.aim, rt.rng, inv.timeout, { goal });
    }
    case 'plant': {
      // Plant: the pet's own Plant routine (learned-farm phase 3c). Done once a plot has been sown.
      const cap = jobCapability(pet, 'plant');
      if (!cap) return { next: () => ({ done: 'fail', reason: 'no Plant skill' }) };
      const soil = (world: World) => world.objects.filter((o) => o.kind === 'soil' && onGround(o)).length;
      const before = soil(w);
      return runCapability(s, pet, cap.name, inv.args.aim ?? cap.aim, rt.rng, inv.timeout, { goal: (world) => soil(world) < before });
    }
    case 'gate': {
      // Mind the gate: the pet's own gate skill (it learned to nudge a gate from beside it). Done when every gate is
      // as asked; nudging toggles, so the same skill opens and shuts.
      const want = inv.args.state === 'open';
      const cap = jobCapability(pet, want ? 'gateOpen' : 'gateShut');
      if (!cap) return { next: () => ({ done: 'fail', reason: 'no gate skill' }) };
      return runCapability(s, pet, cap.name, cap.aim, rt.rng, inv.timeout, { goal: (world) => !world.objects.some((o) => o.kind === 'gate' && onGround(o) && !!o.open !== want) });
    }
    case 'catch': {
      // Fireflies are caught by walking into them (see handleEvents): the pet's own walking skill, aimed at one.
      const before = w.objects.filter((o) => o.kind === 'firefly' && onGround(o)).length;
      return runCapability(s, pet, walker, 'firefly', rt.rng, inv.timeout, { goal: (world) => world.objects.filter((o) => o.kind === 'firefly' && onGround(o)).length < before });
    }
    case 'deliver': {
      // Haul: the pet's own Fetch, aimed at eggs or stored goods (fullest storage first), delivered to the house.
      const cap = jobCapability(pet, 'deliver');
      if (!cap) return { next: () => ({ done: 'fail', reason: 'no Fetch skill' }) };
      const fullest = w.objects.filter((o) => o.store && storeCount(o) > 0).sort((a, b) => storeCount(b) - storeCount(a))[0];
      const item = w.pet.carrying !== null ? (w.objects.find((o) => o.id === w.pet.carrying)?.kind ?? 'carrot') : inv.args.aim ?? (nearest(w, 'egg') ? 'egg' : fullest?.kind ?? 'bin');
      return runCapability(s, pet, cap.name, item, rt.rng, inv.timeout, { dest: 'home', count: totalSold });
    }
    case 'skill':
      // One runtime for every learned skill, routine or Fetch (direct jobs and plan rows alike).
      return runCapability(s, pet, inv.args.skill ?? '', inv.args.target || undefined, rt.rng, inv.timeout);
    case 'rest': {
      // Resting is innate (Stay). With another pet on duty, it naps at the house (a tile both may share) rather than
      // in someone's way: the walk there is the pet's own walking skill, through the one runtime.
      let t = 0;
      const walkHome = w.crew?.length && w.pet.carrying === null && !atFocus(w, 'home') && getSkill(pet, walker)
        ? runCapability(s, pet, walker, 'home', rt.rng, 40, { goal: (world) => atFocus(world, 'home') }) : null;
      let walking = !!walkHome;
      return {
        next(world) {
          if ((pet.energy >= 98 && t >= 6) || t >= inv.timeout + (walkHome ? 40 : 0)) return { done: 'success', reason: 'rested' };
          t++;
          if (walking) { const st = walkHome!.next(world); if (!isDone(st)) return st; walking = false; }
          return 'wait';
        },
      };
    }
    case 'manual':
    default:
      return {
        next() {
          return rt.manual.shift() ?? 'wait';
        },
      };
  }
}

function chooseInvocation(s: GameState, pet: Pet, rt: FarmRuntime): Invocation {
  const ctx = farmContext(s, pet, rt.recentFail);
  rt.ctx = ctx;
  const w = s.farm.world;
  const tmo = navTimeout(w.w, w.h, pet.traits.persistence);
  const harvestRev = deployedRevision(jobCapability(pet, 'forage') ? getSkill(pet, jobCapability(pet, 'forage')!.name) : null);
  const timeouts: Record<BehaviorId, number> = { forage: Math.max(tmo * 3 + 6, Math.round((harvestRev?.stage?.maxTicks ?? 0) * (1 + pet.traits.persistence))), // a whole harvest trip (the routine's own time per try)
    deliver: tmo * 3, plant: Math.round(tmo * 1.5) + 4, tote: tmo * 4 + 10, rest: 30, wander: 0, manual: 1e9, skill: 60, catch: tmo, goto: tmo, gate: tmo + 2 };
  const custom = pet.assignment.skillName ? deployedRevision(getSkill(pet, pet.assignment.skillName)) : null;
  if (custom) timeouts.skill = Math.round((custom.maxTicks ?? 40) * (1 + pet.traits.persistence));
  const navigator = pet.assignment.navigator;
  const mk = (b: BehaviorId, chosenBy: Invocation['chosenBy'], why: string): Invocation => ({
    behaviorId: b,
    args: b === 'forage' ? { target: 'berry', navigator }
      : b === 'deliver' ? { item: ctx.carrying ? 'carried item' : 'carrot or egg', into: 'bin', navigator }
      : b === 'catch' ? { target: 'firefly', navigator }
      : b === 'plant' ? { target: 'soil', navigator }
      : b === 'tote' ? { target: 'bin', navigator }
      : b === 'skill' ? { skill: pet.assignment.skillName ?? '', target: pet.assignment.target || custom?.focus || 'berry' }
      : {},
    intention: why,
    timeout: timeouts[b],
    chosenBy,
  });
  if (pet.assignment.mode === 'manual') return mk('manual', 'player', 'Following your lead');
  if (pet.energy <= 5) return mk('rest', 'rules', 'Too sleepy to work — nap first');
  // Direct jobs were retired in phase 6: an old one becomes a responsibility (do it, otherwise nap).
  if (pet.assignment.mode === 'job' || pet.assignment.mode === 'plan') retireDirectJob(pet);
  // Auto: the responsibility executive (phase 4) — needs first, then the pet's responsibilities (or the starter ones).
  pet.executive.decisions++;
  const plan = (pet.plan ??= starterPlan());
  const rows = compilePlan(plan);
  // Learned (phase 5): learned values, exploring with Curiosity; practice and comparisons set their own (rt.execHow).
  const how: ExecHow = rt.execHow ?? (pet.executive.mode === 'learned' ? { mode: 'learned', eps: deployExploreExec(pet) } : { mode: 'rules', eps: 0 });
  const d = chooseDuty(s, pet, plan, rows, ctx, rt.plan, rt.rng, how);
  if (d.guarded) rt.plan.guarded++;
  traceDecision(rt.plan, s.farm.tick, d.row ? `${d.row.label} → ${d.job!.label}: ${d.why}` : d.why);
  if (!d.row) return d.guarded && !d.need ? { ...mk('rest', 'plan', d.why), timeout: GUARD_HOLD } : mk('rest', 'plan', d.why);
  const row = d.row, job = d.job!;
  const prev = rt.plan.starts.at(-1)?.row;
  if (prev && prev !== row.id) rt.plan.switches++;
  rt.plan.starts.push({ tick: s.farm.tick, row: row.id });
  if (rt.plan.starts.length > 60) rt.plan.starts.shift();
  rt.plan.fires[row.id] = (rt.plan.fires[row.id] ?? 0) + 1;
  let t = timeouts[job.behaviorId];
  if (job.behaviorId === 'skill') t = Math.round((deployedRevision(getSkill(pet, job.args.skill ?? ''))?.maxTicks ?? 40) * (1 + pet.traits.persistence));
  const inv: Invocation = { behaviorId: job.behaviorId, args: { ...job.args }, intention: `${row.label}: ${d.why}`, timeout: t, chosenBy: 'plan' };
  if (job.behaviorId === 'deliver') inv.args.item = ctx.carrying ? 'carried item' : 'carrot or egg';
  if (d.learned) inv.args.learned = '1';
  return inv;
}

function finishInvocation(s: GameState, pet: Pet, rt: FarmRuntime, result: Outcome, reason: string, fx: FarmFx[]): void {
  const inv = rt.inv!;
  const ticks = s.farm.tick - rt.startTick;
  rt.recentFail = result !== 'success';
  if (rt.stats) {
    const st = (rt.stats[inv.behaviorId] ??= { started: 0, ok: 0, fail: 0, timeout: 0, ticks: 0 });
    st.started++; st.ticks += ticks;
    if (result === 'success') st.ok++; else if (result === 'timeout') st.timeout++; else st.fail++;
  }
  if (inv.chosenBy === 'plan' && inv.args.row && pet.plan) afterDutyJob(pet, rt.plan, compilePlan(pet.plan), inv.args, result === 'success', ticks, s.farm.tick, workDone(s.farm.world) !== rt.startWork, s.farm.world);
  const w = s.farm.world;
  if (result !== 'success') {
    fx.push({ type: 'confused', x: w.pet.x, y: w.pet.y, text: reason });
  }
  if (result === 'success' && (inv.behaviorId === 'forage' || inv.behaviorId === 'deliver' || (inv.behaviorId === 'skill' && reason === 'goal reached'))) fx.push({ type: 'celebrate', x: w.pet.x, y: w.pet.y });
  s.farm.current = null;
  rt.exec = null;
  rt.inv = null;
}

/**
 * A fingerprint of work done on the farm: sales, deliveries, what's in the pet's paws, sown plots, fireflies, gates.
 * A job that changed it made progress, whatever it reported.
 */
function workDone(w: World): string {
  const n = (k: string) => w.objects.filter((o) => o.kind === k && onGround(o)).length;
  const delivered = Object.values(w.delivered).reduce((a, b) => a + b, 0);
  return `${w.sold ?? 0}|${delivered}|${w.pet.carrying}|${n('soil')}|${n('firefly')}|${w.objects.filter((o) => o.kind === 'gate' && o.open).length}`;
}

function earn(s: GameState, pet: Pet, amount: number, x: number, y: number, fx: FarmFx[]) {
  s.resources.coins += amount;
  s.progress.totalCoins += amount;
  pet.stats.coins += amount;
  s.farm.production.push({ tick: s.farm.tick, coins: amount });
  fx.push({ type: 'coin', x, y, amount });
}

function handleEvents(s: GameState, pet: Pet, events: SimEvent[], rt: FarmRuntime, fx: FarmFx[]): void {
  const w = s.farm.world;
  trackRequests(s, events);
  for (const e of events) {
    if (e.type === 'enter') {
      s.farm.stun = 3;
      pet.stats.dips++;
      pet.mood = Math.max(0, pet.mood - 2);
      fx.push({ type: 'splash', x: e.x, y: e.y });
      if (pet.stats.dips === 1) addJournal(s, pet.id, 'first-dip', `${pet.name} walked straight through the pond on the way to work and had to shake dry. Approach takes the shortest path — even a wet one.`, true);
      else if (pet.stats.dips === 5) addJournal(s, pet.id, 'dips-5', `${pet.name} has splashed through the pond 5 times now. An Avoid lesson might keep them dry.`, false);
    } else if (e.type === 'reach' && e.kind === 'firefly') {
      const o = w.objects.find((x) => x.id === e.objId);
      if (o) o.delivered = true;
      s.resources.fireflies = (s.resources.fireflies ?? 0) + 1;
      pet.stats.fireflies = (pet.stats.fireflies ?? 0) + 1;
      earn(s, pet, 1, e.x, e.y, fx);
      fx.push({ type: 'sound', x: e.x, y: e.y, text: 'firefly' });
      addJournalOnce(s, pet.id, 'first-firefly', `${pet.name} caught a firefly by moonlight and let it glow in the jar.`);
    } else if (e.type === 'water') {
      pet.stats.waterings = (pet.stats.waterings ?? 0) + 1;
      fx.push({ type: 'drop', x: e.x, y: e.y, text: 'watered' });
      addJournalOnce(s, pet.id, 'first-water', `${pet.name} watered the ${e.kind === 'bush' ? 'berry bush' : 'carrot patch'} — it will grow back twice as fast.`);
    } else if (e.type === 'scare') {
      fx.push({ type: 'celebrate', x: e.x, y: e.y, text: 'shoo!' });
      pet.stats.crowsShooed = (pet.stats.crowsShooed ?? 0) + 1;
      addJournalOnce(s, pet.id, 'first-scare', `${pet.name} shooed a crow off the farm. It flapped away, empty-beaked.`);
    } else if (e.type === 'shoo') {
      fx.push({ type: 'sound', x: e.x, y: e.y, text: 'shoo' });
    } else if (e.type === 'peck') {
      fx.push({ type: 'confused', x: e.x, y: e.y, text: 'pecked' });
      addJournalOnce(s, null, 'first-peck', `A crow pecked a ${e.kind} and flew off with it. It will regrow — but a guard would help.`);
    } else if (e.type === 'enterArea' && e.kind === 'chicken' && e.area === 'coop' && events.some((x) => x.type === 'shoo' && x.objId === e.objId)) {
      addJournalOnce(s, pet.id, 'first-herd', `${pet.name} shooed a chicken back into the coop.`);
    } else if (e.type === 'gate') {
      fx.push({ type: 'drop', x: e.x, y: e.y, text: e.state === 'open' ? 'gate open' : 'gate shut' });
      addJournalOnce(s, pet.id, `first-gate-${e.state}`, e.state === 'open' ? `${pet.name} nudged the orchard gate open.` : `${pet.name} nudged the gate shut — nothing’s wandering through now.`);
    } else if (e.type === 'fill') {
      fx.push({ type: 'drop', x: e.x, y: e.y, text: 'filled' });
    } else if (e.type === 'bump') {
      fx.push({ type: 'bump', x: e.x, y: e.y });
    } else if (e.type === 'pickup' && e.kind === 'berry' && !e.into) {
      // Picked, not sold: it travels to storage or the house first.
      fx.push({ type: 'pickup', x: e.x, y: e.y });
      addJournalOnce(s, pet.id, 'first-berry', `${pet.name} picked their first berry on the farm${rt.inv?.chosenBy === 'player' && rt.inv.behaviorId === 'manual' ? ' with your help' : ' all on their own'}. It earns coins once it reaches the house.`);
    } else if (e.type === 'plant') {
      // Sowing costs the seed; the plot starts growing.
      const price = seedPrice(e.kind ?? 'carrot');
      s.resources.coins -= price;
      s.farm.production.push({ tick: s.farm.tick, coins: -price });
      pet.stats.planted = (pet.stats.planted ?? 0) + 1;
      fx.push({ type: 'sound', x: e.x, y: e.y, text: 'plant' });
      addJournalOnce(s, pet.id, 'first-plant', `${pet.name} planted ${e.kind === 'pumpkin' ? 'a pumpkin' : e.kind === 'sunflower' ? 'a sunflower' : 'carrots'} (seed: ${price} coin${price === 1 ? '' : 's'}). Field crops are replanted after every harvest; berry bushes regrow by themselves.`);
    } else if (e.type === 'full') {
      fx.push({ type: 'confused', x: e.x, y: e.y, text: 'full' });
      addJournalOnce(s, null, 'first-full', `The ${e.into === 'shed' ? 'shed' : 'basket'} was full (or held something else), so the ${e.kind} was left beside it. Someone with Fetch can haul storage to the house.`);
    } else if (e.type === 'pickup') {
      fx.push({ type: 'pickup', x: e.x, y: e.y });
    } else if (e.type === 'drop') {
      fx.push({ type: 'drop', x: e.x, y: e.y });
    } else if (e.type === 'lift') {
      fx.push({ type: 'pickup', x: e.x, y: e.y });
      addJournalOnce(s, pet.id, 'first-lift', `${pet.name} lifted a basket. A carried basket can’t be filled — put it down by the crops, or at the house or a shed to empty it there.`);
    } else if (e.type === 'empty') {
      fx.push({ type: 'sound', x: e.x, y: e.y, text: 'emptied' });
      addJournalOnce(s, pet.id, 'first-basket-run', `${pet.name} carried a whole basket to the ${e.into === 'shed' ? 'shed' : 'house'} and emptied it there — several crops in one trip.`, true);
    } else if (e.type === 'deliver' && e.into === 'home') {
      // Sold at the house: the only place produce turns into coins.
      const value = SELL_PRICE[e.kind ?? ''] ?? 1;
      if (e.kind === 'berry') { s.resources.berries++; pet.stats.berries++; }
      if (e.kind === 'carrot') { s.resources.carrots++; pet.stats.carrots++; }
      if (e.kind === 'egg') { s.resources.eggs = (s.resources.eggs ?? 0) + 1; addJournalOnce(s, pet.id, 'first-egg-delivery', `${pet.name} carried an egg all the way to the house without dropping it.`); }
      pet.stats.deliveries++;
      pet.mood = Math.min(100, pet.mood + 2);
      earn(s, pet, value, e.x, e.y, fx);
      addJournalOnce(s, pet.id, 'first-sale', `${pet.name} brought a ${e.kind} to the house and sold it for ${value} coin${value === 1 ? '' : 's'}. Produce only earns once it reaches the house.`, true);
    } else if (e.type === 'deliver') {
      fx.push({ type: 'drop', x: e.x, y: e.y, text: 'stored' });
      addJournalOnce(s, pet.id, 'first-store', `${pet.name} put a ${e.kind} in the ${e.into === 'shed' ? 'shed' : 'basket'}. It's safe there until someone hauls it to the house.`);
    }
  }
  // Delivered/collected objects leave the world.
  if (w.objects.some((o) => o.delivered)) w.objects = w.objects.filter((o) => !o.delivered);
}

export interface TickResult {
  fx: FarmFx[];
  unlocked: string[];
}

/** Advance the farm by one tick. Deterministic given state + runtime RNG + inputs. */
export function farmTick(s: GameState, rt: FarmRuntime): TickResult {
  const fx: FarmFx[] = [];
  const f = s.farm;
  f.tick++;
  regrow(s);
  updateClock(s, rt, fx);
  updateWeather(s, rt, fx);
  updateCreatures(s, rt, fx);
  const pet = petById(s, f.dutyPetId);
  const helpers = tidyHelpers(s);
  const onDuty = new Set([f.dutyPetId, ...helpers.map((h) => h.petId)]);
  for (const p of s.pets) {
    if (!onDuty.has(p.id)) p.energy = Math.min(100, p.energy + 0.5); // off-duty pets nap at home
  }
  if (!pet) {
    f.rngState = rt.rng.state;
    return { fx, unlocked: checkUnlocks(s) };
  }
  syncCrew(s, rt, helpers);
  withOthers(s, rt, -1, () => petTurn(s, pet, rt, fx, {}));
  f.rngState = rt.rng.state;
  for (let i = 0; i < helpers.length; i++) helperTurn(s, i, rt, fx);
  if (f.production.length && f.tick - f.production[0].tick > 2400) f.production = f.production.filter((p) => f.tick - p.tick <= 2400);
  return { fx, unlocked: checkUnlocks(s) };
}

/** A pet's job changed: drop what it's doing so it decides afresh next tick (lead or helper). */
export function restartPet(s: GameState, rt: FarmRuntime, petId: string): void {
  const f = s.farm;
  if (f.dutyPetId === petId) { rt.exec = null; rt.inv = null; f.current = null; return; }
  const i = (f.helpers ?? []).findIndex((h) => h.petId === petId);
  if (i < 0) return;
  f.helpers![i].current = null;
  const r = rt.crew[i];
  if (r) { r.exec = null; r.inv = null; }
}

/** What a pet on the farm is doing right now (null = off duty). */
export function petActivity(s: GameState, petId: string): { current: Invocation | null; stun: number; lead: boolean } | null {
  const f = s.farm;
  if (f.dutyPetId === petId) return { current: f.current, stun: f.stun, lead: true };
  const h = (f.helpers ?? []).find((x) => x.petId === petId);
  return h ? { current: h.current, stun: h.stun, lead: false } : null;
}

/** "Who does what" across the pets on duty, e.g. "2 harvesting, 1 hauling". */
export function crewSummary(s: GameState): string {
  const VERB: Partial<Record<BehaviorId, string>> = { forage: 'harvesting', deliver: 'hauling', plant: 'planting', tote: 'on a basket run', rest: 'napping', catch: 'catching fireflies', wander: 'sniffing around', skill: 'running a skill', goto: 'on an errand', gate: 'minding the gate', manual: 'steered by you' };
  const n = new Map<string, number>();
  for (const p of dutyPets(s)) {
    const a = petActivity(s, p.id);
    const v = a?.stun ? 'drying off' : a?.current ? VERB[a.current.behaviorId] ?? a.current.behaviorId : 'thinking';
    n.set(v, (n.get(v) ?? 0) + 1);
  }
  return [...n].map(([v, k]) => `${k} ${v}`).join(', ') || 'nobody on duty';
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

/** Pets on duty: the lead first, then helpers. */
export function dutyPets(s: GameState): Pet[] {
  const f = s.farm;
  return [f.dutyPetId, ...(f.helpers ?? []).map((h) => h.petId)].map((id) => petById(s, id)).filter((p): p is Pet => !!p);
}

/** Put a pet on duty (as a helper, or as the lead if nobody leads) or take it off. Returns a reason if it can't. */
export function setOnDuty(s: GameState, petId: string, on: boolean, rt?: FarmRuntime): string | null {
  const f = s.farm;
  const helpers = f.helpers ?? [];
  const i = helpers.findIndex((h) => h.petId === petId);
  if (on) {
    if (f.dutyPetId === petId || i >= 0) return null;
    if (!f.dutyPetId || !petById(s, f.dutyPetId)) { f.dutyPetId = petId; resetLead(s, rt); return null; }
    if (dutyPets(s).length >= MAX_ON_DUTY) return `At most ${MAX_ON_DUTY} pets can work at once.`;
    // A new helper gets its own RNG stream (the first keeps the seed the second pet always had).
    const used = new Set(helpers.map((h) => h.rngState));
    let seed = HELPER_SEED;
    for (let k = 0; used.has(seed); k++) seed = HELPER_SEED + (k + 1) * 0x1000;
    f.helpers = [...helpers, { petId, current: null, stun: 0, queue: [], rngState: seed }];
    return null;
  }
  if (i >= 0) {
    f.helpers = helpers.filter((_, k) => k !== i);
    f.world.crew?.splice(i, 1);
    rt?.crew.splice(i, 1);
    if (!f.helpers.length) { delete f.helpers; delete f.world.crew; }
    return null;
  }
  if (f.dutyPetId === petId) {
    if (!helpers.length) return 'Someone has to mind the farm — put another pet on duty first.';
    makeLead(s, helpers[0].petId, rt);
    return setOnDuty(s, petId, false, rt);
  }
  return null;
}

/** Make a helper the lead (the pet you steer and whose plan previews run first); the old lead becomes that helper. */
export function makeLead(s: GameState, petId: string, rt?: FarmRuntime): void {
  const f = s.farm;
  const i = (f.helpers ?? []).findIndex((h) => h.petId === petId);
  if (i < 0 || !f.dutyPetId) return;
  const h = f.helpers![i];
  const w = f.world;
  [w.pet, w.crew![i]] = [w.crew![i], w.pet];
  h.petId = f.dutyPetId;
  f.dutyPetId = petId;
  s.activePetId = petId;
  h.current = null; h.queue = []; h.stun = 0;
  resetLead(s, rt);
}

function resetLead(s: GameState, rt?: FarmRuntime): void {
  s.farm.current = null;
  s.farm.stun = 0;
  for (const h of s.farm.helpers ?? []) h.current = null;
  if (!rt) return;
  rt.exec = null; rt.inv = null; rt.manual = []; rt.claim = null;
  rt.crew = [];
}

/** Most pets on duty at once (the lead + 3 helpers). */
export const MAX_ON_DUTY = 4;
const HELPER_SEED = 0x5ec0d;

/** Drop helpers that aren't valid any more (gone, the lead, duplicates, too many), with their bodies and runtimes. */
function tidyHelpers(s: GameState): Helper[] {
  const f = s.farm;
  const list = f.helpers ?? [];
  const seen = new Set<string | null>([f.dutyPetId]);
  const keep: number[] = [];
  list.forEach((h, i) => { if (!seen.has(h.petId) && s.pets.some((p) => p.id === h.petId) && keep.length < MAX_ON_DUTY - 1) { seen.add(h.petId); keep.push(i); } });
  if (keep.length !== list.length) {
    f.helpers = keep.map((i) => list[i]);
    if (f.world.crew) f.world.crew = keep.map((i) => f.world.crew![i]).filter(Boolean);
  }
  if (!f.helpers?.length) delete f.helpers;
  return f.helpers ?? [];
}

/** Bodies (and runtimes) for every helper; a new helper starts beside the lead. */
function syncCrew(s: GameState, rt: FarmRuntime, helpers: Helper[]): void {
  const w = s.farm.world;
  if (!helpers.length) {
    if (w.crew) delete w.crew;
    rt.crew = [];
    return;
  }
  w.crew ??= [];
  if (w.crew.length > helpers.length) w.crew.length = helpers.length;
  while (w.crew.length < helpers.length) w.crew.push(startBody(w, w.crew.length));
  if (rt.crew.length > helpers.length) rt.crew.length = helpers.length;
  for (let i = 0; i < helpers.length; i++) {
    if (!rt.crew[i]) {
      const r = createRuntime(s.farm);
      r.rng.state = (helpers[i].rngState ?? HELPER_SEED + i * 0x1000) >>> 0;
      rt.crew[i] = r;
    }
  }
}

function startBody(w: World, i: number): PetBody {
  const first = { x: w.pet.x, y: Math.min(w.h - 1, w.pet.y + 1), carrying: null, facing: 'S' as const };
  if (i === 0) return first; // where the second pet always started
  const taken = (x: number, y: number) => (w.pet.x === x && w.pet.y === y) || (w.crew ?? []).some((b) => b.x === x && b.y === y) || isSolidAt(w, x, y);
  for (let r = 1; r < w.w + w.h; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.abs(dx) + Math.abs(dy) !== r) continue;
    const x = w.pet.x + dx, y = w.pet.y + dy;
    if (inBounds(w, x, y) && !taken(x, y)) return { x, y, carrying: null, facing: 'S' };
  }
  return first;
}

/**
 * While one pet acts, the others are solid obstacles and whatever they're heading for is hidden,
 * so no two pets chase the same thing. `acting` is -1 for the lead, else the helper's index.
 */
function withOthers(s: GameState, rt: FarmRuntime, acting: number, fn: () => void): void {
  const w = s.farm.world;
  const others = acting < 0 ? rt.crew : [rt, ...rt.crew.filter((_, i) => i !== acting)];
  const bodies = w.crew ?? [];
  const buddies: Obj[] = [];
  const hidden: Obj[] = [];
  for (const body of bodies) {
    // Another pet is an obstacle, except at the house and storage, which pets may use at once
    // (a pet napping in the house mustn't stop another selling).
    const shared = objectsAt(w, body.x, body.y).some((o) => def(o.kind).container);
    if (!shared) buddies.push(addObject(w, 'buddy', body.x, body.y));
  }
  for (const other of others) {
    const claimed = other.claim !== null ? w.objects.find((o) => o.id === other.claim && !o.carried && !o.delivered) : undefined;
    if (claimed) { claimed.hidden = true; hidden.push(claimed); }
  }
  try { fn(); } finally {
    for (const o of hidden) delete o.hidden;
    if (buddies.length) w.objects = w.objects.filter((o) => !buddies.includes(o));
  }
}

/** A helper's turn: swap its body, job, stun and queue into the primary slots and reuse the same logic. */
function helperTurn(s: GameState, i: number, rt: FarmRuntime, fx: FarmFx[]): void {
  const f = s.farm;
  const w = f.world;
  const h = f.helpers![i];
  const pet = petById(s, h.petId)!;
  const rtH = rt.crew[i];
  const swap = () => {
    [w.pet, w.crew![i]] = [w.crew![i], w.pet];
    [f.current, h.current] = [h.current ?? null, f.current];
    [f.stun, h.stun] = [h.stun ?? 0, f.stun];
    [f.queue, h.queue] = [h.queue ?? [], f.queue];
  };
  swap();
  try {
    withOthers(s, rt, i, () => petTurn(s, pet, rtH, fx, { advance: false }));
  } finally {
    swap();
  }
  h.rngState = rtH.rng.state;
}

function claimFor(w: World, inv: Invocation | null): number | null {
  if (!inv) return null;
  // Harvesters claim the crop they're heading for; haulers claim eggs. Storage is shared, never claimed
  // (hiding a basket would stop the other pet storing there).
  const kinds = inv.behaviorId === 'forage' && w.pet.carrying === null ? [...CROPS] : inv.behaviorId === 'plant' ? ['soil'] : inv.behaviorId === 'tote' && w.pet.carrying === null ? ['bin'] : inv.behaviorId === 'catch' ? ['firefly'] : inv.behaviorId === 'goto' ? [inv.args.target ?? ''] : inv.behaviorId === 'deliver' && w.pet.carrying === null ? ['egg'] : [];
  let best: number | null = null, bd = Infinity;
  for (const k of kinds) {
    const o = nearest(w, k);
    if (!o) continue;
    const d = Math.abs(o.x - w.pet.x) + Math.abs(o.y - w.pet.y);
    if (d < bd) { bd = d; best = o.id; }
  }
  return best;
}

/** One pet's decision + action for this tick (the original single-pet logic, unchanged). */
function petTurn(s: GameState, pet: Pet, rt: FarmRuntime, fx: FarmFx[], opts: StepOptions): void {
  const f = s.farm;
  pet.mood += (60 - pet.mood) * 0.002;
  f.world.petEnergy = pet.energy;
  f.world.seedCoins = s.resources.coins; // what planting may spend
  if (f.stun > 0) {
    f.stun--;
    return;
  }
  // Mode change → drop current activity.
  if (rt.inv && ((pet.assignment.mode === 'manual') !== (rt.inv.behaviorId === 'manual'))) { rt.exec = null; rt.inv = null; f.current = null; }
  if (!rt.exec) {
    // Plans with "Has done…" rows need the farm to remember events; they count from each job's start.
    const remembers = (pet.assignment.mode === 'plan' || pet.assignment.mode === 'auto') && !!pet.plan && planUsesMemory(pet.plan);
    if (remembers) f.world.tally ??= {};
    const inv = chooseInvocation(s, pet, rt);
    if (remembers) rt.plan.base = cloneTally(f.world.tally);
    rt.inv = inv;
    rt.exec = buildExecutor(s, pet, inv, rt);
    rt.startCoins = s.resources.coins;
    rt.startWork = workDone(f.world);
    rt.startEnergy = pet.energy;
    rt.startTick = f.tick;
    f.current = inv;
    f.queue = [inv, ...f.queue].slice(0, 6);
    if (inv.behaviorId === 'rest' && pet.energy < 90) fx.push({ type: 'nap', x: f.world.pet.x, y: f.world.pet.y });
  }
  const st = rt.exec.next(f.world);
  if (isDone(st)) {
    finishInvocation(s, pet, rt, st.done, st.reason, fx);
  } else {
    const prev = { x: f.world.pet.x, y: f.world.pet.y };
    const exec = rt.exec;
    const events = step(f.world, st, opts);
    (exec as { observe?: SkillRun['observe'] }).observe?.call(exec, f.world, prev, events); // skills with notes keep writing them
    handleEvents(s, pet, events, rt, fx);
  }
  rt.claim = claimFor(f.world, rt.inv);
  const resting = rt.inv?.behaviorId === 'rest';
  const bed = s.purchases.includes('bed') ? 2 : 1;
  const nightK = f.world.night ? 1.5 : 1; // night work is tiring, night naps are deep
  if (resting) pet.energy = Math.min(100, pet.energy + 1.5 * bed * nightK);
  else if (st !== 'wait' && rt.inv?.behaviorId !== 'manual') pet.energy = Math.max(0, pet.energy - 0.12 * nightK);
  else if (rt.inv?.behaviorId === 'manual' && st !== 'wait') pet.energy = Math.max(0, pet.energy - 0.05);
}

/** Coins earned over the last `window` ticks. */
export function recentProduction(f: FarmState, window = 480): number {
  return f.production.filter((p) => f.tick - p.tick <= window).reduce((a, b) => a + b.coins, 0);
}

/** Player tapped a tile in manual mode: queue a walking path (a pet following you is instinct, not a trained skill). */
export function queueManualPath(s: GameState, rt: FarmRuntime, x: number, y: number): boolean {
  const w = s.farm.world;
  const path = bfsPath(w, w.pet.x, w.pet.y, (a, b) => a === x && b === y, false);
  if (!path) return false;
  rt.manual = path.slice(0, 30);
  return true;
}

export function queueManual(rt: FarmRuntime, a: Action): void {
  if (rt.manual.length < 8) rt.manual.push(a);
}

/** Switch a pet to its farm plan, starting from a clean slate (so a preview from here matches reality). */
export function applyPlan(s: GameState, rt: FarmRuntime, petId: string): void {
  const p = petById(s, petId);
  if (!p) return;
  p.plan ??= starterPlan();
  p.assignment.mode = 'auto'; // Auto works on the pet's responsibilities
  p.executive.mode = 'rules';
  s.progress.flags.dutiesApplied = true;
  const hi = (s.farm.helpers ?? []).findIndex((h) => h.petId === petId);
  if (hi >= 0) {
    // A helper: it starts its plan from a clean slate; the lead carries on.
    s.farm.helpers![hi].current = null;
    if (rt.crew[hi]) rt.crew[hi] = undefined as unknown as FarmRuntime; // recreated next tick from its saved RNG state
    return;
  }
  s.farm.dutyPetId = petId;
  s.farm.current = null;
  rt.exec = null;
  rt.inv = null;
  rt.recentFail = false;
  rt.manual = [];
  rt.plan = newPlanRuntime();
  rt.claim = null;
  rt.rng.state = s.farm.rngState >>> 0;
  // Helpers start their current decisions afresh too, so previews from here match reality.
  if (rt.crew.length) { rt.crew = []; for (const h of s.farm.helpers ?? []) h.current = null; }
}

export interface PlanPreview {
  ticks: number;
  coins: number;
  energyStart: number;
  energyEnd: number;
  naps: number;
  fires: Record<string, number>;
  switchesPerMinute: number;
  guarded: number;
  dips: number;
  final: { coins: number; tick: number; petX: number; petY: number };
}

/**
 * Dry-run a plan on a copy of the farm. The simulator is deterministic, so this is exactly
 * what the real farm will do over the same ticks if the plan is applied now.
 */
export function previewPlan(s: GameState, petId: string, plan: FarmPlan, ticks = 300): PlanPreview {
  const copy: GameState = structuredClone(s);
  const p = petById(copy, petId)!;
  p.plan = structuredClone(plan);
  const rt = createRuntime(copy.farm);
  applyPlan(copy, rt, petId);
  const coins0 = copy.resources.coins, e0 = p.energy, dips0 = p.stats.dips;
  let naps = 0;
  for (let i = 0; i < ticks; i++) {
    const before = copy.farm.current;
    farmTick(copy, rt);
    if (copy.farm.current && copy.farm.current !== before && copy.farm.current.behaviorId === 'rest') naps++;
  }
  return {
    ticks, coins: copy.resources.coins - coins0, energyStart: e0, energyEnd: p.energy, naps,
    fires: { ...rt.plan.fires }, switchesPerMinute: (rt.plan.switches * 214) / ticks, guarded: rt.plan.guarded,
    dips: p.stats.dips - dips0,
    final: { coins: copy.resources.coins, tick: copy.farm.tick, petX: copy.farm.world.pet.x, petY: copy.farm.world.pet.y },
  };
}

/**
 * Executive lessons (learned-farm phase 5). Practice and comparisons run on copies of the farm with only this pet on
 * duty, each copy with its own seed (weather, creatures, the pet's own random steps), so nothing on the real farm
 * changes except the pet's learned executive values.
 */
function executiveCopy(s: GameState, petId: string, seed: number, how: ExecHow): { g: GameState; rt: FarmRuntime; p: Pet } {
  const g: GameState = structuredClone(s);
  const p = petById(g, petId)!;
  p.plan ??= starterPlan();
  p.assignment.mode = 'auto';
  g.farm.dutyPetId = petId;
  delete g.farm.helpers;
  delete g.farm.world.crew;
  g.farm.current = null;
  g.farm.queue = [];
  g.farm.rngState = seed >>> 0;
  g.farm.world.rng = (Math.imul(seed, 2654435761) >>> 0) || 1;
  const rt = createRuntime(g.farm);
  rt.execHow = how;
  return { g, rt, p };
}

/** Practise deciding: `days` farm days on copies, exploring with Curiosity; the values learned are kept. */
export function practiseExecutive(s: GameState, petId: string, days = 4): { ticks: number; updates: number } {
  const pet = petById(s, petId);
  if (!pet) return { ticks: 0, updates: 0 };
  const before = execValues(pet).updates;
  const seedBase = execValues(pet).practised;
  for (let d = 0; d < days; d++) practiseExecutiveDay(s, petId, d, seedBase);
  return { ticks: days * DAY_TICKS, updates: execValues(pet).updates - before };
}

/**
 * One farm day of practice (polish phase 2: practice runs a day at a time, so a worker can report progress and stop
 * between days). `seedBase` is the pet's practised ticks when the practice began, so the days get the same seeds.
 */
export function practiseExecutiveDay(s: GameState, petId: string, d: number, seedBase: number): void {
  const pet = petById(s, petId);
  if (!pet) return;
  const seed = 1000 + seedBase / DAY_TICKS + d * 7919;
  const { g, rt, p } = executiveCopy(s, petId, seed, { mode: 'learned', eps: 0.1 + 0.3 * pet.traits.curiosity });
  p.executive.values = execValues(pet);
  for (let t = 0; t < DAY_TICKS; t++) farmTick(g, rt);
  pet.executive.values = structuredClone(execValues(p));
  pet.executive.values.practised += DAY_TICKS;
}

export interface ExecComparisonRow {
  mode: ExecHow['mode'];
  coins: number;
  /** Jobs started while tired (other than resting, finishing a basket run, or sniffing around): a safety check (should be 0). */
  tiredWork: number;
  switchesPerMin: number;
}
/** Held-out farm seeds for comparisons (practice never uses them). */
export const EXEC_EVAL_SEEDS = [900101, 900202, 900303];
export const EXEC_MODES = ['rules', 'learned', 'random'] as const;

/** One way of choosing on one held-out farm copy (a step of the comparison). */
export interface ExecRun { coins: number; tiredWork: number; switches: number }
export function compareExecutiveRun(s: GameState, petId: string, mode: ExecHow['mode'], seed: number, ticks = DAY_TICKS): ExecRun {
  const { g, rt, p } = executiveCopy(s, petId, seed, { mode, eps: 0 });
  const c0 = g.progress.totalCoins;
  let tiredWork = 0;
  for (let t = 0; t < ticks; t++) {
    const before = g.farm.current;
    farmTick(g, rt);
    const cur = g.farm.current;
    if (cur && cur !== before && p.energy < TIRED && !['rest', 'tote', 'wander'].includes(cur.behaviorId)) tiredWork++;
  }
  return { coins: g.progress.totalCoins - c0, tiredWork, switches: rt.plan.switches };
}
/** Sum a mode's runs into its comparison row. */
export function comparisonRow(mode: ExecHow['mode'], runs: ExecRun[], ticks = DAY_TICKS): ExecComparisonRow {
  const sum = (k: keyof ExecRun) => runs.reduce((a, r) => a + r[k], 0);
  return { mode, coins: sum('coins'), tiredWork: sum('tiredWork'), switchesPerMin: Math.round(((sum('switches') * 214) / (ticks * runs.length)) * 10) / 10 };
}

/** Compare the player's order, the learned values and random picks on held-out copies of the farm (no exploring). */
export function compareExecutives(s: GameState, petId: string, ticks = DAY_TICKS, seeds = EXEC_EVAL_SEEDS): ExecComparisonRow[] {
  return EXEC_MODES.map((mode) => comparisonRow(mode, seeds.map((seed) => compareExecutiveRun(s, petId, mode, seed, ticks)), ticks));
}

/** Phase 6 retired direct jobs: a pet on one (an old save) gets it as responsibilities instead and goes on Auto. */
export function retireDirectJob(p: Pet): void {
  if (p.assignment.mode === 'job') {
    p.plan = jobPlan(p.assignment.job, { skill: p.assignment.skillName, target: p.assignment.target, navigator: p.assignment.navigator });
    p.executive.mode = 'rules';
  }
  if (p.assignment.mode === 'job' || p.assignment.mode === 'plan') p.assignment.mode = 'auto';
}
