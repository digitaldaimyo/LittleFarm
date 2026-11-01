import type { Action, SimEvent, World } from '../sim/world';
import { addObject, bfsPath, emptyWorld, nearest, objectsAt, step } from '../sim/world';
import { Rng } from '../sim/rng';
import { FetchController, FetchRun, NavRun, NavPolicy, isDone, randomMove, type ExecStep } from '../learning/policies';
import { navTimeout } from '../learning/episodes';
import {
  BEHAVIOR_LABEL, describeContext, learnedSelect, rulesSelect, updateExecutive,
  type BehaviorId, type ExecContext, type Invocation,
} from '../learning/executive';
import type { FarmState, GameState, Pet, Plot } from './types';
import { activeRevision, getSkill, navPolicyFor, petById } from './pets';
import { addJournal, addJournalOnce } from './journal';
import { checkUnlocks } from './progression';

export const FARM_W = 12;
export const FARM_H = 9;
export const GROW_TICKS: Record<Plot['crop'], number> = { berry: 28, carrot: 44 };
export const CROP_VALUE = { berry: 1, carrot: 3, berryDelivered: 2 };
export const TIRED = 25;

export function createFarm(): FarmState {
  const w = emptyWorld(FARM_W, FARM_H);
  addObject(w, 'home', 1, 1);
  addObject(w, 'bin', 2, 3);
  for (const [x, y] of [[5, 2], [6, 2], [5, 3], [6, 3], [7, 3], [6, 4], [5, 4]]) addObject(w, 'pond', x, y);
  for (const [x, y] of [[0, 8], [11, 0], [4, 0], [11, 8], [0, 4]]) addObject(w, 'tree', x, y);
  for (const [x, y] of [[8, 6], [3, 5], [9, 3]]) addObject(w, 'rock', x, y);
  const plots: Plot[] = [
    { x: 9, y: 1, crop: 'berry', objId: null, timer: 999 },
    { x: 10, y: 5, crop: 'berry', objId: null, timer: 999 },
    { x: 8, y: 8, crop: 'berry', objId: null, timer: 999, unlock: 'bushes' },
    { x: 10, y: 2, crop: 'berry', objId: null, timer: 999, unlock: 'bushes' },
    { x: 2, y: 7, crop: 'carrot', objId: null, timer: 999, unlock: 'carrots' },
    { x: 4, y: 7, crop: 'carrot', objId: null, timer: 999, unlock: 'carrots' },
    { x: 6, y: 7, crop: 'carrot', objId: null, timer: 999, unlock: 'patch2' },
  ];
  for (const p of plots) addObject(w, p.crop === 'berry' ? 'bush' : 'patch', p.x, p.y);
  w.pet.x = 1;
  w.pet.y = 2;
  return { world: w, plots, tick: 0, rngState: 12345, dutyPetId: null, stun: 0, queue: [], current: null, production: [], manualMode: false };
}

export interface FarmFx {
  type: 'coin' | 'splash' | 'pickup' | 'drop' | 'celebrate' | 'confused' | 'nap' | 'bump';
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
  rng: Rng;
}

export function createRuntime(f: FarmState): FarmRuntime {
  const rng = new Rng(1);
  rng.state = f.rngState >>> 0;
  return { exec: null, inv: null, ctx: null, startCoins: 0, startEnergy: 0, startTick: 0, manual: [], recentFail: false, rng };
}

function plotUnlocked(s: GameState, p: Plot): boolean {
  return !p.unlock || s.progress.unlocks.includes(p.unlock);
}

function regrow(s: GameState): void {
  const w = s.farm.world;
  for (const p of s.farm.plots) {
    if (!plotUnlocked(s, p)) continue;
    if (p.objId !== null) {
      const o = w.objects.find((x) => x.id === p.objId);
      if (o && !o.carried && !o.delivered && o.x === p.x && o.y === p.y) continue;
      p.objId = null;
      p.timer = 0;
    }
    p.timer++;
    if (p.timer >= GROW_TICKS[p.crop] && !objectsAt(w, p.x, p.y).some((o) => o.kind === p.crop)) {
      p.objId = addObject(w, p.crop, p.x, p.y).id;
    }
  }
}

export function farmContext(s: GameState, pet: Pet, recentFail: boolean): ExecContext {
  const w = s.farm.world;
  return {
    energyLow: pet.energy < TIRED,
    berry: !!nearest(w, 'berry'),
    carrot: !!nearest(w, 'carrot'),
    carrying: w.pet.carrying !== null,
    recentFail,
  };
}

export function eligibleBehaviors(pet: Pet, ctx: ExecContext): BehaviorId[] {
  const out: BehaviorId[] = ['rest'];
  const nav = navPolicyFor(pet, pet.assignment.navigator);
  if (nav && ctx.berry && !ctx.carrying) out.push('forage');
  if (activeRevision(getSkill(pet, 'Fetch')) && nav && (ctx.carrot || ctx.carrying)) out.push('deliver');
  if (!ctx.energyLow) out.push('wander');
  return out;
}

function buildExecutor(s: GameState, pet: Pet, inv: Invocation, rt: FarmRuntime): { next(w: World): ExecStep } {
  const w = s.farm.world;
  const navInfo = navPolicyFor(pet, inv.args.navigator === 'Avoid' ? 'Avoid' : 'Approach');
  const nav = navInfo ? NavPolicy.from(navInfo.rev.policy) : null;
  const tmo = navTimeout(w.w, w.h, pet.traits.persistence);
  switch (inv.behaviorId) {
    case 'forage': {
      const run = new NavRun(nav, 'berry', tmo, rt.rng);
      let picked = false;
      return {
        next(world) {
          if (picked) return { done: 'success', reason: 'gathered' };
          const st = run.next(world);
          if (isDone(st)) {
            if (st.done === 'fail') return st;
            picked = true;
            return 'pick';
          }
          return st;
        },
      };
    }
    case 'deliver': {
      const fetch = activeRevision(getSkill(pet, 'Fetch'));
      const ctrl = FetchController.from(fetch?.policy) ?? new FetchController();
      const item = w.pet.carrying !== null ? (w.objects.find((o) => o.id === w.pet.carrying)?.kind ?? 'carrot') : 'carrot';
      return new FetchRun(ctrl, nav, item, 'bin', tmo, inv.timeout, rt.rng, w.delivered[item] ?? 0);
    }
    case 'rest': {
      let t = 0;
      return {
        next() {
          if (pet.energy >= 98 || t >= inv.timeout) return { done: 'success', reason: 'rested' };
          t++;
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
  const timeouts: Record<BehaviorId, number> = { forage: tmo + 3, deliver: tmo * 3, rest: 30, wander: 6, manual: 1e9 };
  const navigator = pet.assignment.navigator;
  const mk = (b: BehaviorId, chosenBy: Invocation['chosenBy'], why: string): Invocation => ({
    behaviorId: b,
    args: b === 'forage' ? { target: 'berry', navigator } : b === 'deliver' ? { item: ctx.carrying ? 'carried item' : 'carrot', into: 'bin', navigator } : {},
    intention: why,
    timeout: timeouts[b],
    chosenBy,
  });
  if (pet.assignment.mode === 'manual') return mk('manual', 'player', 'Following your lead');
  const eligible = eligibleBehaviors(pet, ctx);
  if (pet.energy <= 5) return mk('rest', 'rules', 'Too sleepy to work — nap first');
  if (pet.assignment.mode === 'job') {
    const j = pet.assignment.job;
    if (eligible.includes(j)) return mk(j, 'player', `You asked for: ${BEHAVIOR_LABEL[j]}`);
    if (ctx.energyLow) return mk('rest', 'rules', 'Tired — resting before the job');
    return mk('rest', 'rules', j === 'rest' ? 'Napping as asked' : `Waiting: ${BEHAVIOR_LABEL[j]} isn't possible right now`);
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
  if (inv.chosenBy === 'learned' && rt.ctx) {
    let r = coins - 0.01 * ticks;
    if (inv.behaviorId === 'rest') r += rt.ctx.energyLow ? 1.5 : -0.5;
    if (result === 'fail') r -= 0.3;
    updateExecutive(pet.executive.table, rt.ctx, inv.behaviorId, r);
  }
  const w = s.farm.world;
  if (result === 'fail' && inv.behaviorId !== 'wander') {
    fx.push({ type: 'confused', x: w.pet.x, y: w.pet.y, text: reason });
  }
  if (result === 'success' && (inv.behaviorId === 'forage' || inv.behaviorId === 'deliver')) fx.push({ type: 'celebrate', x: w.pet.x, y: w.pet.y });
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
  for (const e of events) {
    if (e.type === 'enter') {
      s.farm.stun = 3;
      pet.stats.dips++;
      pet.mood = Math.max(0, pet.mood - 2);
      fx.push({ type: 'splash', x: e.x, y: e.y });
      if (pet.stats.dips === 1) addJournal(s, pet.id, 'first-dip', `${pet.name} walked straight through the pond on the way to work and had to shake dry. Approach takes the shortest path — even a wet one.`, true);
      else if (pet.stats.dips === 5) addJournal(s, pet.id, 'dips-5', `${pet.name} has splashed through the pond 5 times now. An Avoid lesson might keep them dry.`, false);
    } else if (e.type === 'bump') {
      fx.push({ type: 'bump', x: e.x, y: e.y });
    } else if (e.type === 'pickup' && e.kind === 'berry') {
      // Berries go straight into the basket.
      const o = w.objects.find((x) => x.id === e.objId);
      if (o) { o.carried = false; o.delivered = true; }
      w.pet.carrying = null;
      s.resources.berries++;
      pet.stats.berries++;
      earn(s, pet, CROP_VALUE.berry, e.x, e.y, fx);
      fx.push({ type: 'pickup', x: e.x, y: e.y });
      if (addJournalOnce(s, pet.id, 'first-berry', `${pet.name} gathered their first berry on the farm${rt.inv?.chosenBy === 'player' && rt.inv.behaviorId === 'manual' ? ' with your help' : ' all on their own'}.`)) void 0;
    } else if (e.type === 'pickup') {
      fx.push({ type: 'pickup', x: e.x, y: e.y });
    } else if (e.type === 'drop') {
      fx.push({ type: 'drop', x: e.x, y: e.y });
    } else if (e.type === 'deliver') {
      const value = e.kind === 'carrot' ? CROP_VALUE.carrot : CROP_VALUE.berryDelivered;
      if (e.kind === 'carrot') { s.resources.carrots++; pet.stats.carrots++; }
      pet.stats.deliveries++;
      pet.mood = Math.min(100, pet.mood + 3);
      earn(s, pet, value, e.x, e.y, fx);
      addJournalOnce(s, pet.id, 'first-delivery', `${pet.name} made their first delivery to the bin: one ${e.kind}, carried all the way.`);
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
  const pet = petById(s, f.dutyPetId);
  for (const p of s.pets) {
    if (p.id !== f.dutyPetId) p.energy = Math.min(100, p.energy + 0.5); // off-duty pets nap at home
  }
  if (!pet) {
    f.rngState = rt.rng.state;
    return { fx, unlocked: checkUnlocks(s) };
  }
  pet.mood += (60 - pet.mood) * 0.002;
  if (f.stun > 0) {
    f.stun--;
    f.rngState = rt.rng.state;
    return { fx, unlocked: checkUnlocks(s) };
  }
  // Mode change → drop current activity.
  if (rt.inv && ((pet.assignment.mode === 'manual') !== (rt.inv.behaviorId === 'manual'))) { rt.exec = null; rt.inv = null; f.current = null; }
  if (!rt.exec) {
    const inv = chooseInvocation(s, pet, rt);
    rt.inv = inv;
    rt.exec = buildExecutor(s, pet, inv, rt);
    rt.startCoins = s.resources.coins;
    rt.startEnergy = pet.energy;
    rt.startTick = f.tick;
    f.current = inv;
    f.queue = [inv, ...f.queue].slice(0, 6);
    if (inv.behaviorId === 'rest') fx.push({ type: 'nap', x: f.world.pet.x, y: f.world.pet.y });
  }
  const st = rt.exec.next(f.world);
  if (isDone(st)) {
    finishInvocation(s, pet, rt, st.done, st.reason, fx);
  } else {
    const events = step(f.world, st);
    handleEvents(s, pet, events, rt, fx);
  }
  const resting = rt.inv?.behaviorId === 'rest';
  const bed = s.purchases.includes('bed') ? 2 : 1;
  if (resting) pet.energy = Math.min(100, pet.energy + 1.5 * bed);
  else if (st !== 'wait' && rt.inv?.behaviorId !== 'manual') pet.energy = Math.max(0, pet.energy - 0.12);
  else if (rt.inv?.behaviorId === 'manual' && st !== 'wait') pet.energy = Math.max(0, pet.energy - 0.05);
  if (f.production.length && f.tick - f.production[0].tick > 2400) f.production = f.production.filter((p) => f.tick - p.tick <= 2400);
  f.rngState = rt.rng.state;
  return { fx, unlocked: checkUnlocks(s) };
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
