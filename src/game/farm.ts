import type { Action, Obj, PetBody, SimEvent, World } from '../sim/world';
import { addObject, inBounds, isSolidAt, bfsPath, cloneTally, def, emptyStore, emptyWorld, seedPrice, storeAccepts, storeCount, inArea, nearest, nudgeableGate, objectsAt, onGround, step, type StepOptions } from '../sim/world';
import { nightfallRequests, postRequests, trackRequests } from './requests';
import { Rng } from '../sim/rng';
import { FetchController, FetchRun, NavRun, SkillRun, isDone, randomMove, type ExecStep, type NoteRunner } from '../learning/policies';
import { navTimeout } from '../learning/episodes';
import {
  BEHAVIOR_LABEL, describeContext, learnedSelect, rulesSelect, updateExecutive,
  type BehaviorId, type ExecContext, type Invocation,
} from '../learning/executive';
import type { FarmPlan, FarmState, GameState, Helper, Pet, Plot } from './types';
import { activeRevision, getSkill, navPolicyFor, petById, routineRunFor, sensePolicyOf } from './pets';
import { compileCondition, compileStage, withTarget } from '../sim/compile';
import type { SpecNode, StageSpec } from '../domain/types';
import { walk } from '../domain/spec';
import { addJournal, addJournalOnce } from './journal';
import { checkUnlocks } from './progression';
import { GUARD_HOLD, choosePlanRow, compilePlan, newPlanRuntime, planInvocation, planUsesMemory, starterPlan, updatePlanValue, type PlanRuntime } from './plan';

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
  startEnergy: number;
  startTick: number;
  manual: Action[];
  recentFail: boolean;
  /** Recovery after a failed job: a few random sniffing steps so a pet never repeats a stuck loop forever. */
  jitter: number;
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
  return { exec: null, inv: null, ctx: null, startCoins: 0, startEnergy: 0, startTick: 0, manual: [], recentFail: false, jitter: 0, plan: newPlanRuntime(), claim: null, crew: [], rng };
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
    if (field && (!plotObj || plotObj.kind === 'soil')) { p.timer = 0; continue; } // not planted yet
    p.timer += plotObj?.wet ? 2 : 1; // watered plots grow twice as fast
    if (p.timer >= GROW_TICKS[p.crop] && !objectsAt(w, p.x, p.y).some((o) => o.kind === p.crop)) {
      p.objId = addObject(w, p.crop, p.x, p.y).id;
      if (plotObj) plotObj.wet = false; // the soil dries out with each harvest
    }
  }
}

/**
 * A farm walk with the learned movement skill, plus the farm's stuck recovery a little earlier: if the pet keeps
 * revisiting the same tile (3 times in 8 steps: a loop, typically beside an obstacle), it sniffs around for two
 * random steps and carries on. Farm only — pens and reports measure the learned skill as it is.
 */
class FarmWalk {
  private recent: string[] = [];
  private sniff = 0;
  private inner: NavRun;
  constructor(nav: ReturnType<typeof sensePolicyOf>, focus: string, timeout: number, private rng: Rng) {
    this.inner = new NavRun(nav, focus, timeout, rng);
  }
  next(w: World): ExecStep {
    const st = this.inner.next(w);
    if (isDone(st)) return st;
    const here = `${w.pet.x},${w.pet.y}`;
    this.recent.push(here);
    if (this.recent.length > 8) this.recent.shift();
    if (this.sniff === 0 && this.recent.filter((p) => p === here).length >= 3) { this.sniff = 2; this.recent = []; }
    if (this.sniff > 0) { this.sniff--; return randomMove(w, this.rng); }
    return st;
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

/** A skill's note-writing rules, compiled for the farm (aimed at `target`), or null if it writes none. */
function noteRunnerFor(stage: StageSpec | undefined, target: string): NoteRunner | null {
  if (!stage) return null;
  const writes = (r: SpecNode) => { let w = false; walk(r, (x) => { if (x.cardId === 'eff.note') w = true; }); return w; };
  const rules = stage.rules.filter((r) => r.args.off !== 1 && writes(r));
  if (!rules.length) return null;
  return compileStage({ ...stage, rules, learner: { ...stage.learner, focus: target } });
}

/** Is this object still a valid destination (on the ground)? */
function storeCountOf(w: World, o: Obj): boolean {
  return onGround(o) && w.objects.includes(o);
}

/** Hide the other objects of a kind while `fn` runs, so a learned walk heads for this one. */
function only<T>(w: World, kind: string, id: number, fn: () => T): T {
  const hid = w.objects.filter((o) => o.kind === kind && o.id !== id && onGround(o));
  for (const o of hid) o.hidden = true;
  try { return fn(); } finally { for (const o of hid) delete o.hidden; }
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
    ...(activeRevision(getSkill(pet, 'Fetch')) && toteTarget(s) ? { tote: true } : {}),
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

export function eligibleBehaviors(pet: Pet, ctx: ExecContext): BehaviorId[] {
  const out: BehaviorId[] = ['rest'];
  const nav = navPolicyFor(pet, pet.assignment.navigator);
  const fetch = !!activeRevision(getSkill(pet, 'Fetch'));
  // Harvest: pick something ripe, or (without Fetch) finish carrying it home.
  // (A pet holding something can always finish carrying it; with Fetch, Auto prefers hauling it.)
  if (nav && ((ctx.berry && !ctx.carrying) || (ctx.carrying && !ctx.basket))) out.push('forage');
  if (fetch && nav && ((ctx.carrot && !ctx.carrying) || (ctx.carrying && !ctx.basket))) out.push('deliver');
  // Baskets: a pet holding one finishes the run; otherwise a run when a basket is half full or away from the crops.
  if (fetch && nav && (ctx.basket || (ctx.tote && !ctx.carrying))) out.push('tote');
  if (nav && ctx.soil && !ctx.carrying) out.push('plant');
  if (nav && ctx.firefly && !ctx.carrying) out.push('catch');
  if (!ctx.energyLow) out.push('wander');
  return out;
}

function buildExecutor(s: GameState, pet: Pet, inv: Invocation, rt: FarmRuntime): { next(w: World): ExecStep } {
  const w = s.farm.world;
  const navInfo = navPolicyFor(pet, inv.args.navigator === 'Avoid' ? 'Avoid' : 'Approach');
  const nav = navInfo ? sensePolicyOf(navInfo.rev) : null;
  const tmo = navTimeout(w.w, w.h, pet.traits.persistence);
  switch (inv.behaviorId) {
    case 'forage': {
      // Harvest: walk to the nearest ripe crop, pick it, carry it to storage with room (or the house), drop it.
      const hasFetch = !!activeRevision(getSkill(pet, 'Fetch'));
      const crop = CROPS.map((k) => nearest(w, k)).filter((o): o is NonNullable<typeof o> => !!o)
        .sort((a, b) => (Math.abs(a.x - w.pet.x) + Math.abs(a.y - w.pet.y)) - (Math.abs(b.x - w.pet.x) + Math.abs(b.y - w.pet.y)))[0];
      let phase: 'go' | 'pick' | 'carry' | 'drop' = w.pet.carrying !== null ? 'carry' : 'go';
      // Farm trips are longer now (from the house to the crops and back), so each leg gets a little more patience.
      const leg = Math.round(tmo * 1.5);
      let run: FarmWalk | null = phase === 'go' ? new FarmWalk(nav, crop?.kind ?? 'berry', leg, rt.rng) : null;
      let dest: Obj | undefined;
      const toStore = (world: World) => {
        const kind = world.objects.find((o) => o.id === world.pet.carrying)?.kind ?? '';
        dest = harvestTarget(world, kind, hasFetch);
        run = new FarmWalk(nav, dest?.kind ?? 'home', leg, rt.rng);
        phase = 'carry';
      };
      if (phase === 'carry') toStore(w);
      return {
        next(world) {
          if (phase === 'drop') return { done: 'success', reason: 'stored' };
          if (phase === 'pick') {
            if (world.pet.carrying === null) return { done: 'fail', reason: 'missed it' };
            toStore(world);
          }
          // Carrying: head for the chosen storage, not just the nearest of its kind (there may be several baskets).
          const st = phase === 'carry' && dest && storeCountOf(world, dest) ? only(world, dest.kind, dest.id, () => run!.next(world)) : run!.next(world);
          if (!isDone(st)) return st;
          if (st.done === 'fail') return st;
          if (phase === 'go') { phase = 'pick'; return 'pick'; }
          phase = 'drop';
          return 'drop';
        },
      };
    }
    case 'goto':
      return new NavRun(nav, inv.args.target ?? 'home', tmo, rt.rng);
    case 'tote': {
      // Basket run: lift a basket, empty it at the house (or a shed with room) if it holds anything, then set it
      // down by the crops. Walks use the learned movement skill; the last step onto the chosen tile is instinct.
      const held0 = heldBasket(w);
      const basketId = held0?.id ?? toteTarget(s)?.id ?? null;
      let phase: 'fetch' | 'unload' | 'place' | 'placed' = held0 ? (storeCount(held0) > 0 ? 'unload' : 'place') : 'fetch';
      let walk: FarmWalk | null = null;
      let walkFor = '';
      let spot: { x: number; y: number; plot: Obj } | null = null;
      let fumbles = 0;
      const walkTo = (world: World, kind: string, id: number, tag: string): ExecStep => {
        if (walkFor !== tag) { walk = new FarmWalk(nav, kind, tmo, rt.rng); walkFor = tag; }
        return only(world, kind, id, () => walk!.next(world));
      };
      return {
        next(world) {
          for (let guard = 0; guard < 4; guard++) {
            if (basketId === null) return { done: 'fail', reason: 'no basket to carry' };
            const b = world.objects.find((o) => o.id === basketId);
            if (!b || b.delivered) return { done: 'fail', reason: 'basket gone' };
            if (phase === 'fetch') {
              if (!onGround(b)) return { done: 'fail', reason: 'someone else has it' };
              if (world.pet.x === b.x && world.pet.y === b.y) { phase = storeCount(b) > 0 ? 'unload' : 'place'; return 'lift'; }
              const st = walkTo(world, b.kind, b.id, `b${b.id}`);
              if (isDone(st) && st.done === 'fail') return st;
              if (isDone(st)) continue;
              return st;
            }
            if (phase === 'unload') {
              if (world.pet.carrying !== b.id) return { done: 'fail', reason: 'dropped the basket' };
              if (storeCount(b) === 0) { phase = 'place'; continue; }
              const kinds = (b.store ?? []).filter((x) => x.n > 0).map((x) => x.kind!);
              const dests = world.objects.filter((o) => onGround(o) && (o.kind === 'home' || (o.store && !def(o.kind).portable && kinds.some((k) => storeAccepts(o, k))))); // the house or a shed, never another basket
              dests.sort((a2, b2) => (Math.abs(a2.x - world.pet.x) + Math.abs(a2.y - world.pet.y)) - (Math.abs(b2.x - world.pet.x) + Math.abs(b2.y - world.pet.y)));
              const dest = dests[0];
              if (!dest) return { done: 'fail', reason: 'nowhere to empty it' };
              if (world.pet.x === dest.x && world.pet.y === dest.y) return 'drop';
              const st = walkTo(world, dest.kind, dest.id, `d${dest.id}`);
              if (isDone(st) && st.done === 'fail') return st;
              if (isDone(st)) continue;
              return st;
            }
            if (phase === 'place') {
              if (world.pet.carrying !== b.id) return { done: 'success', reason: 'basket set down' };
              spot ??= cropSpot(s);
              if (!spot) {
                // Nowhere by the crops: set it down on the first clear tile nearby.
                const path = bfsPath(world, world.pet.x, world.pet.y, (x, y) => !objectsAt(world, x, y).length && !(x === 1 && y === 2), true);
                if (!path) return { done: 'fail', reason: 'nowhere to set it down' };
                if (!path.length) { phase = 'placed'; return 'drop'; }
                return path[0];
              }
              if (world.pet.x === spot.x && world.pet.y === spot.y) { phase = 'placed'; return 'drop'; }
              if (chebyshev(world.pet, spot) <= 1 || (world.pet.x === spot.plot.x && world.pet.y === spot.plot.y)) {
                const target = spot;
                const path = bfsPath(world, world.pet.x, world.pet.y, (x, y) => x === target.x && y === target.y, true);
                if (path?.length) return path[0];
              }
              const st = walkTo(world, spot.plot.kind, spot.plot.id, `p${spot.plot.id}`);
              if (isDone(st) && st.done === 'fail') return st;
              if (isDone(st)) { walkFor = 'arrived'; const target = spot; const path = bfsPath(world, world.pet.x, world.pet.y, (x, y) => x === target.x && y === target.y, true); if (path?.length) return path[0]; spot = null; continue; }
              return st;
            }
            // placed: the drop either worked (done) or the tile was taken — find another spot.
            if (world.pet.carrying !== b.id) return { done: 'success', reason: 'basket set down by the crops' };
            if (++fumbles > 3) return { done: 'fail', reason: 'couldn’t set the basket down' };
            spot = null; walkFor = ''; phase = 'place';
          }
          return 'wait';
        },
      };
    }
    case 'plant': {
      // Walk to empty soil, sow it (the farm pays for the seed).
      const walk = new FarmWalk(nav, 'soil', Math.round(tmo * 1.5), rt.rng);
      let sowed = false;
      return {
        next(world) {
          if (sowed) return { done: 'success', reason: 'planted' };
          const st = walk.next(world);
          if (!isDone(st)) return st;
          if (st.done === 'fail') return st;
          sowed = true;
          return 'plant';
        },
      };
    }
    case 'gate': {
      // Walk next to the nearest gate in the wrong state, then nudge it.
      const want = inv.args.state === 'open';
      let t = 0;
      return {
        next(world) {
          const g = world.objects.filter((o) => o.kind === 'gate' && onGround(o) && !!o.open !== want)
            .sort((a, b) => (Math.abs(a.x - world.pet.x) + Math.abs(a.y - world.pet.y)) - (Math.abs(b.x - world.pet.x) + Math.abs(b.y - world.pet.y)))[0];
          if (!g) return { done: 'success', reason: 'gate set' };
          if (t++ >= inv.timeout) return { done: 'fail', reason: 'timeout' };
          if (Math.abs(g.x - world.pet.x) + Math.abs(g.y - world.pet.y) <= 1 && nudgeableGate(world) === g) return 'nudge';
          if (Math.abs(g.x - world.pet.x) + Math.abs(g.y - world.pet.y) === 0) return randomMove(world, rt.rng); // step out to shut it
          return nav ? nav.act(world, 'gate') : randomMove(world, rt.rng);
        },
      };
    }
    case 'catch': {
      // Fireflies are caught by walking into them (see handleEvents).
      return new NavRun(nav, 'firefly', tmo, rt.rng);
    }
    case 'deliver': {
      // Haul: with the learned Fetch controller, take eggs or stored goods (fullest storage first) to the house.
      const fetch = activeRevision(getSkill(pet, 'Fetch'));
      const ctrl = FetchController.from(fetch?.policy) ?? new FetchController();
      const fullest = w.objects.filter((o) => o.store && storeCount(o) > 0).sort((a, b) => storeCount(b) - storeCount(a))[0];
      const item = w.pet.carrying !== null ? (w.objects.find((o) => o.id === w.pet.carrying)?.kind ?? 'carrot') : nearest(w, 'egg') ? 'egg' : fullest?.kind ?? 'bin';
      const soldBefore = totalSold(w);
      return new FetchRun(ctrl, nav, item, 'home', tmo, inv.timeout, rt.rng, soldBefore, totalSold);
    }
    case 'skill': {
      const rev = activeRevision(getSkill(pet, inv.args.skill ?? ''));
      if (rev?.stage && getSkill(pet, inv.args.skill ?? '')?.kind === 'routine') {
        const run = routineRunFor(pet, rev, inv.args.target || undefined, rt.rng, inv.timeout);
        return run ?? { next: () => ({ done: 'fail', reason: 'routine missing' }) };
      }
      const policy = rev ? sensePolicyOf(rev) : null;
      if (!rev || !policy) return { next: () => ({ done: 'fail', reason: 'skill missing' }) };
      const target = inv.args.target || rev.focus || 'berry';
      const cond = rev.success && rev.outcome !== 'survive' ? withTarget(target, () => compileCondition(rev.success!)) : null;
      return new SkillRun(policy, target, inv.timeout, cond ? (world, base) => cond({ w: world, prev: world.pet, base }) : null, noteRunnerFor(rev.stage, target));
    }
    case 'rest': {
      let t = 0;
      return {
        next(world) {
          if ((pet.energy >= 98 && t >= 6) || t >= inv.timeout) return { done: 'success', reason: 'rested' };
          t++;
          // With another pet on duty, nap at the house (a tile both may share) rather than in someone's way.
          if (world.crew?.length && world.pet.carrying === null && !objectsAt(world, world.pet.x, world.pet.y).some((o) => o.kind === 'home')) {
            const path = bfsPath(world, world.pet.x, world.pet.y, (x, y) => objectsAt(world, x, y).some((o) => o.kind === 'home'), true);
            if (path?.length) return path[0];
          }
          return 'wait';
        },
      };
    }
    case 'wander': {
      let t = 0;
      return {
        next(world) {
          if (t >= inv.timeout) return { done: 'success', reason: 'wandered' };
          t++;
          return randomMove(world, rt.rng);
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
  const timeouts: Record<BehaviorId, number> = { forage: tmo * 3 + 6, // farm life: walk to the crop, then carry it to storage or the house
    deliver: tmo * 3, plant: Math.round(tmo * 1.5) + 4, tote: tmo * 4 + 10, rest: 30, wander: 6, manual: 1e9, skill: 60, catch: tmo, goto: tmo, gate: tmo + 2 };
  const custom = pet.assignment.skillName ? activeRevision(getSkill(pet, pet.assignment.skillName)) : null;
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
  const eligible = eligibleBehaviors(pet, ctx);
  if (pet.energy <= 5) return mk('rest', 'rules', 'Too sleepy to work — nap first');
  if (pet.assignment.mode === 'plan') {
    const plan = (pet.plan ??= starterPlan());
    const rows = compilePlan(plan);
    const { row, guarded, learned } = choosePlanRow(s, pet, plan, rows, ctx, rt.plan, rt.rng);
    if (guarded) rt.plan.guarded++;
    if (!row) {
      return guarded
        ? { ...mk('rest', 'plan', 'Holding still for a moment — plan rows were flip-flopping'), timeout: GUARD_HOLD }
        : mk('rest', 'plan', 'No plan row applies right now — napping');
    }
    const prev = rt.plan.starts.at(-1)?.row;
    if (prev && prev !== row.id) rt.plan.switches++;
    rt.plan.starts.push({ tick: s.farm.tick, row: row.id });
    if (rt.plan.starts.length > 60) rt.plan.starts.shift();
    rt.plan.fires[row.id] = (rt.plan.fires[row.id] ?? 0) + 1;
    let t = timeouts[row.job.behaviorId];
    if (row.job.behaviorId === 'skill') t = Math.round((activeRevision(getSkill(pet, row.job.args.skill ?? ''))?.maxTicks ?? 40) * (1 + pet.traits.persistence));
    const why = `Plan row ${row.index + 1}: ${row.label}${guarded ? ' (sticking with it — rows were flip-flopping)' : learned ? ' (learned pick)' : ''}`;
    const inv = planInvocation(row, t, why);
    if (row.job.behaviorId === 'deliver') inv.args.item = ctx.carrying ? 'carried item' : 'carrot or egg';
    if (learned) inv.args.learned = '1';
    return inv;
  }
  if (pet.assignment.mode === 'job' && pet.assignment.job === 'skill') {
    if (custom && !ctx.energyLow) return mk('skill', 'player', `You asked for: ${pet.assignment.skillName} → ${pet.assignment.target || custom.focus}`);
    return mk('rest', 'rules', custom ? 'Tired — resting before running the skill' : 'Pick a saved skill to run');
  }
  if (pet.assignment.mode === 'job') {
    const j = pet.assignment.job as Exclude<typeof pet.assignment.job, 'skill'>;
    if (eligible.includes(j)) return mk(j, 'player', `You asked for: ${BEHAVIOR_LABEL[j]}`);
    if (ctx.energyLow) return mk('rest', 'rules', 'Tired — resting before the job');
    const why = j === 'rest' ? 'Napping as asked'
      : j === 'forage' && !ctx.berry ? 'Nothing ripe yet — resting while crops regrow'
      : j === 'deliver' && !ctx.carrot ? 'Nothing to haul — the basket and shed are empty'
      : j === 'tote' && !activeRevision(getSkill(pet, 'Fetch')) ? 'Basket runs need a saved Fetch skill'
      : j === 'tote' ? 'No basket needs a run — none is half full or away from the crops'
      : j === 'plant' && ctx.carrying ? 'Hands full — put it down before planting'
      : j === 'plant' ? 'Nothing to plant — no empty soil, or not enough coins for its seed'
      : `Can't ${BEHAVIOR_LABEL[j].toLowerCase()} yet — check the skill it needs`;
    return mk('rest', 'rules', why);
  }
  pet.executive.decisions++;
  if (pet.executive.mode === 'learned') {
    const { choice, explored } = learnedSelect(ctx, eligible, pet.executive.table, rt.rng, pet.traits.curiosity);
    return mk(choice, 'learned', `${explored ? 'Trying something (curious)' : 'Best so far'} — ${describeContext(ctx)}`);
  }
  const choice = rulesSelect(ctx, eligible);
  return mk(choice, 'rules', describeContext(ctx));
}

function finishInvocation(s: GameState, pet: Pet, rt: FarmRuntime, result: 'success' | 'fail', reason: string, fx: FarmFx[]): void {
  const inv = rt.inv!;
  const coins = s.resources.coins - rt.startCoins;
  const ticks = s.farm.tick - rt.startTick;
  rt.recentFail = result === 'fail';
  if (rt.stats) {
    const st = (rt.stats[inv.behaviorId] ??= { started: 0, ok: 0, fail: 0, timeout: 0, ticks: 0 });
    st.started++; st.ticks += ticks;
    if (result === 'success') st.ok++; else if (reason === 'timeout') st.timeout++; else st.fail++;
  }
  if (inv.chosenBy === 'learned' && rt.ctx) {
    let r = coins - 0.01 * ticks;
    if (inv.behaviorId === 'rest') r += rt.ctx.energyLow ? 1.5 : -0.5;
    if (result === 'fail') r -= 0.3;
    updateExecutive(pet.executive.table, rt.ctx, inv.behaviorId, r);
  }
  if (inv.chosenBy === 'plan' && inv.args.learned && pet.plan && rt.ctx && inv.args.row) {
    let r = coins - 0.01 * ticks;
    if (inv.behaviorId === 'rest') r += rt.ctx.energyLow ? 1.5 : -0.5;
    if (result === 'fail') r -= 0.3;
    updatePlanValue(pet.plan, rt.ctx, inv.args.row, r);
  }
  const w = s.farm.world;
  if (result === 'fail' && inv.behaviorId !== 'wander') {
    fx.push({ type: 'confused', x: w.pet.x, y: w.pet.y, text: reason });
    if (reason === 'timeout') rt.jitter = 3 + rt.rng.int(3);
  }
  if (result === 'success' && (inv.behaviorId === 'forage' || inv.behaviorId === 'deliver' || (inv.behaviorId === 'skill' && reason === 'goal reached'))) fx.push({ type: 'celebrate', x: w.pet.x, y: w.pet.y });
  s.farm.current = null;
  rt.exec = null;
  rt.inv = null;
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
  rt.exec = null; rt.inv = null; rt.jitter = 0; rt.manual = []; rt.claim = null;
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
  if (!rt.exec && rt.jitter > 0 && pet.assignment.mode !== 'manual') {
    rt.jitter--;
    f.current = { behaviorId: 'wander', args: {}, intention: 'Confused after getting stuck — sniffing around before trying again', timeout: 1, chosenBy: 'rules' };
    handleEvents(s, pet, step(f.world, randomMove(f.world, rt.rng), opts), rt, fx);
    return;
  }
  if (!rt.exec) {
    // Plans with "Has done…" rows need the farm to remember events; they count from each job's start.
    const remembers = pet.assignment.mode === 'plan' && !!pet.plan && planUsesMemory(pet.plan);
    if (remembers) f.world.tally ??= {};
    const inv = chooseInvocation(s, pet, rt);
    if (remembers) rt.plan.base = cloneTally(f.world.tally);
    rt.inv = inv;
    rt.exec = buildExecutor(s, pet, inv, rt);
    rt.startCoins = s.resources.coins;
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
  p.assignment.mode = 'plan';
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
  rt.jitter = 0;
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
