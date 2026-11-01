import type { Action, SimEvent, World } from '../sim/world';
import { addObject, bfsPath, emptyWorld, inArea, nearest, nudgeableGate, objectsAt, onGround, step } from '../sim/world';
import { nightfallRequests, postRequests, trackRequests } from './requests';
import { Rng } from '../sim/rng';
import { FetchController, FetchRun, NavRun, SkillRun, isDone, randomMove, type ExecStep } from '../learning/policies';
import { navTimeout } from '../learning/episodes';
import {
  BEHAVIOR_LABEL, describeContext, learnedSelect, rulesSelect, updateExecutive,
  type BehaviorId, type ExecContext, type Invocation,
} from '../learning/executive';
import type { FarmPlan, FarmState, GameState, Pet, Plot } from './types';
import { activeRevision, getSkill, navPolicyFor, petById, routineRunFor, sensePolicyOf } from './pets';
import { compileCondition, withTarget } from '../sim/compile';
import { addJournal, addJournalOnce } from './journal';
import { checkUnlocks } from './progression';
import { GUARD_HOLD, choosePlanRow, compilePlan, newPlanRuntime, planInvocation, starterPlan, updatePlanValue, type PlanRuntime } from './plan';

export const FARM_W = 12;
export const FARM_H = 9;
export const GROW_TICKS: Record<Plot['crop'], number> = { berry: 28, carrot: 44 };
export const CROP_VALUE = { berry: 1, carrot: 3, berryDelivered: 2, egg: 2 };
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
  addObject(w, 'bin', 2, 3);
  addObject(w, 'well', WELL_POS.x, WELL_POS.y);
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
  w.areas = [{ ...COOP }];
  w.rng = 0xfa53;
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
  /** Recovery after a failed job: a few random sniffing steps so a pet never repeats a stuck loop forever. */
  jitter: number;
  /** Farm-plan memory: row starts (for the anti-dithering guard), fire counts, switches. */
  plan: PlanRuntime;
  rng: Rng;
}

export function createRuntime(f: FarmState): FarmRuntime {
  const rng = new Rng(1);
  rng.state = f.rngState >>> 0;
  return { exec: null, inv: null, ctx: null, startCoins: 0, startEnergy: 0, startTick: 0, manual: [], recentFail: false, jitter: 0, plan: newPlanRuntime(), rng };
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
    const plotObj = objectsAt(w, p.x, p.y).find((o) => o.kind === 'bush' || o.kind === 'patch');
    p.timer += plotObj?.wet ? 2 : 1; // watered plots grow twice as fast
    if (p.timer >= GROW_TICKS[p.crop] && !objectsAt(w, p.x, p.y).some((o) => o.kind === p.crop)) {
      p.objId = addObject(w, p.crop, p.x, p.y).id;
      if (plotObj) plotObj.wet = false; // the soil dries out with each harvest
    }
  }
}

export function farmContext(s: GameState, pet: Pet, recentFail: boolean): ExecContext {
  const w = s.farm.world;
  return {
    energyLow: pet.energy < TIRED,
    berry: !!nearest(w, 'berry'),
    carrot: !!nearest(w, 'carrot') || !!nearest(w, 'egg'),
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
      addJournalOnce(s, null, 'first-crow', 'A crow landed at the edge of the farm, eyeing the crops. A pet that can Shoo could send it packing.');
    }
  }
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
    addJournalOnce(s, null, 'first-night', `Night fell on the farm for the first time (day ${day}). Fireflies blinked over the grass.`);
  } else {
    w.objects = w.objects.filter((o) => o.kind !== 'firefly');
  }
}

export function eligibleBehaviors(pet: Pet, ctx: ExecContext): BehaviorId[] {
  const out: BehaviorId[] = ['rest'];
  const nav = navPolicyFor(pet, pet.assignment.navigator);
  if (nav && ctx.berry && !ctx.carrying) out.push('forage');
  if (activeRevision(getSkill(pet, 'Fetch')) && nav && (ctx.carrot || ctx.carrying)) out.push('deliver');
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
    case 'goto':
      return new NavRun(nav, inv.args.target ?? 'home', tmo, rt.rng);
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
      const fetch = activeRevision(getSkill(pet, 'Fetch'));
      const ctrl = FetchController.from(fetch?.policy) ?? new FetchController();
      const nearestOf = (ks: string[]) => ks.map((k) => nearest(w, k)).filter((o): o is NonNullable<typeof o> => !!o).sort((a, b) => (Math.abs(a.x - w.pet.x) + Math.abs(a.y - w.pet.y)) - (Math.abs(b.x - w.pet.x) + Math.abs(b.y - w.pet.y)))[0];
      const item = w.pet.carrying !== null ? (w.objects.find((o) => o.id === w.pet.carrying)?.kind ?? 'carrot') : nearestOf(['carrot', 'egg'])?.kind ?? 'carrot';
      return new FetchRun(ctrl, nav, item, 'bin', tmo, inv.timeout, rt.rng, w.delivered[item] ?? 0);
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
      return new SkillRun(policy, target, inv.timeout, cond ? (world) => cond({ w: world, prev: world.pet }) : null);
    }
    case 'rest': {
      let t = 0;
      return {
        next() {
          if ((pet.energy >= 98 && t >= 6) || t >= inv.timeout) return { done: 'success', reason: 'rested' };
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
  const timeouts: Record<BehaviorId, number> = { forage: tmo + 3, deliver: tmo * 3, rest: 30, wander: 6, manual: 1e9, skill: 60, catch: tmo, goto: tmo, gate: tmo + 2 };
  const custom = pet.assignment.skillName ? activeRevision(getSkill(pet, pet.assignment.skillName)) : null;
  if (custom) timeouts.skill = Math.round((custom.maxTicks ?? 40) * (1 + pet.traits.persistence));
  const navigator = pet.assignment.navigator;
  const mk = (b: BehaviorId, chosenBy: Invocation['chosenBy'], why: string): Invocation => ({
    behaviorId: b,
    args: b === 'forage' ? { target: 'berry', navigator }
      : b === 'deliver' ? { item: ctx.carrying ? 'carried item' : 'carrot or egg', into: 'bin', navigator }
      : b === 'catch' ? { target: 'firefly', navigator }
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
      : j === 'forage' && !ctx.berry ? 'No ripe berries yet — resting while they regrow'
      : j === 'deliver' && !ctx.carrot ? 'No carrots ready — resting while they grow'
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
      addJournalOnce(s, pet.id, 'first-firefly', `${pet.name} caught a firefly by moonlight and let it glow in the jar.`);
    } else if (e.type === 'water') {
      pet.stats.waterings = (pet.stats.waterings ?? 0) + 1;
      fx.push({ type: 'drop', x: e.x, y: e.y, text: 'watered' });
      addJournalOnce(s, pet.id, 'first-water', `${pet.name} watered the ${e.kind === 'bush' ? 'berry bush' : 'carrot patch'} — it will grow back twice as fast.`);
    } else if (e.type === 'scare') {
      fx.push({ type: 'celebrate', x: e.x, y: e.y, text: 'shoo!' });
      pet.stats.crowsShooed = (pet.stats.crowsShooed ?? 0) + 1;
      addJournalOnce(s, pet.id, 'first-scare', `${pet.name} shooed a crow off the farm. It flapped away, empty-beaked.`);
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
      const value = e.kind === 'carrot' ? CROP_VALUE.carrot : e.kind === 'egg' ? CROP_VALUE.egg : CROP_VALUE.berryDelivered;
      if (e.kind === 'carrot') { s.resources.carrots++; pet.stats.carrots++; }
      if (e.kind === 'egg') { s.resources.eggs = (s.resources.eggs ?? 0) + 1; addJournalOnce(s, pet.id, 'first-egg-delivery', `${pet.name} carried an egg all the way to the bin without dropping it.`); }
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
  updateClock(s, rt, fx);
  updateWeather(s, rt, fx);
  updateCreatures(s, rt, fx);
  const pet = petById(s, f.dutyPetId);
  for (const p of s.pets) {
    if (p.id !== f.dutyPetId) p.energy = Math.min(100, p.energy + 0.5); // off-duty pets nap at home
  }
  if (!pet) {
    f.rngState = rt.rng.state;
    return { fx, unlocked: checkUnlocks(s) };
  }
  pet.mood += (60 - pet.mood) * 0.002;
  f.world.petEnergy = pet.energy;
  if (f.stun > 0) {
    f.stun--;
    f.rngState = rt.rng.state;
    return { fx, unlocked: checkUnlocks(s) };
  }
  // Mode change → drop current activity.
  if (rt.inv && ((pet.assignment.mode === 'manual') !== (rt.inv.behaviorId === 'manual'))) { rt.exec = null; rt.inv = null; f.current = null; }
  if (!rt.exec && rt.jitter > 0 && pet.assignment.mode !== 'manual') {
    rt.jitter--;
    f.current = { behaviorId: 'wander', args: {}, intention: 'Confused after getting stuck — sniffing around before trying again', timeout: 1, chosenBy: 'rules' };
    handleEvents(s, pet, step(f.world, randomMove(f.world, rt.rng)), rt, fx);
    f.rngState = rt.rng.state;
    return { fx, unlocked: checkUnlocks(s) };
  }
  if (!rt.exec) {
    const inv = chooseInvocation(s, pet, rt);
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
    const events = step(f.world, st);
    handleEvents(s, pet, events, rt, fx);
  }
  const resting = rt.inv?.behaviorId === 'rest';
  const bed = s.purchases.includes('bed') ? 2 : 1;
  const nightK = f.world.night ? 1.5 : 1; // night work is tiring, night naps are deep
  if (resting) pet.energy = Math.min(100, pet.energy + 1.5 * bed * nightK);
  else if (st !== 'wait' && rt.inv?.behaviorId !== 'manual') pet.energy = Math.max(0, pet.energy - 0.12 * nightK);
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

/** Switch a pet to its farm plan, starting from a clean slate (so a preview from here matches reality). */
export function applyPlan(s: GameState, rt: FarmRuntime, petId: string): void {
  const p = petById(s, petId);
  if (!p) return;
  p.plan ??= starterPlan();
  p.assignment.mode = 'plan';
  s.farm.dutyPetId = petId;
  s.farm.current = null;
  rt.exec = null;
  rt.inv = null;
  rt.jitter = 0;
  rt.recentFail = false;
  rt.manual = [];
  rt.plan = newPlanRuntime();
  rt.rng.state = s.farm.rngState >>> 0;
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
