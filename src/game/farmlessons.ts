/**
 * Farm lessons on copies of the farm (split from farm.ts, polish phase 3): previews of responsibilities, and the
 * executive lessons — practice and comparisons — which never change the real farm except the pet's learned values.
 */
import type { Responsibilities, GameState, Pet } from './types';
import { petById } from './pets';
import { execValues, newPickTally, starterPlan, type ExecHow, type PickTally } from './plan';
import { addTally, diagnoseOrder, emptyTally, type OrderDiagnosis } from './orderdiagnosis';
import { createRuntime, applyPlan, farmTick, DAY_TICKS, TIRED, type FarmRuntime } from './farm';

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
export function previewPlan(s: GameState, petId: string, plan: Responsibilities, ticks = 300): PlanPreview {
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

export const EXEC_MODES = ['order', 'learned', 'random'] as const;

/** One way of choosing on one held-out farm copy (a step of the comparison). */
export interface ExecRun { coins: number; tiredWork: number; switches: number; /** Learned runs: where they differed from the order. */ picks?: PickTally }

export function compareExecutiveRun(s: GameState, petId: string, mode: ExecHow['mode'], seed: number, ticks = DAY_TICKS): ExecRun {
  const { g, rt, p } = executiveCopy(s, petId, seed, { mode, eps: 0 });
  if (mode === 'learned') rt.plan.picks = newPickTally(); // polish phase 5: the diagnosis of the order
  const c0 = g.progress.totalCoins;
  let tiredWork = 0;
  for (let t = 0; t < ticks; t++) {
    const before = g.farm.current;
    farmTick(g, rt);
    const cur = g.farm.current;
    if (cur && cur !== before && p.energy < TIRED && !['rest', 'basketRun', 'wander'].includes(cur.behaviorId)) tiredWork++;
  }
  return { coins: g.progress.totalCoins - c0, tiredWork, switches: rt.plan.switches, ...(rt.plan.picks ? { picks: rt.plan.picks } : {}) };
}

/** Sum a mode's runs into its comparison row. */
export function comparisonRow(mode: ExecHow['mode'], runs: ExecRun[], ticks = DAY_TICKS): ExecComparisonRow {
  const sum = (k: 'coins' | 'tiredWork' | 'switches') => runs.reduce((a, r) => a + r[k], 0);
  return { mode, coins: sum('coins'), tiredWork: sum('tiredWork'), switchesPerMin: Math.round(((sum('switches') * 214) / (ticks * runs.length)) * 10) / 10 };
}

/** Compare the player's order, the learned values and random picks on held-out copies of the farm (no exploring). */
export function compareExecutives(s: GameState, petId: string, ticks = DAY_TICKS, seeds = EXEC_EVAL_SEEDS): ExecComparisonRow[] {
  return EXEC_MODES.map((mode) => comparisonRow(mode, seeds.map((seed) => compareExecutiveRun(s, petId, mode, seed, ticks)), ticks));
}

/**
 * The comparison plus what it says about the player's order (polish phase 5): which responsibility learned picks
 * skip, and a one-tap change — or that the order is fine.
 */
export function compareAndDiagnose(s: GameState, petId: string, ticks = DAY_TICKS, seeds = EXEC_EVAL_SEEDS): { rows: ExecComparisonRow[]; diagnosis: OrderDiagnosis } {
  const picks = emptyTally();
  const rows = EXEC_MODES.map((mode) => comparisonRow(mode, seeds.map((seed) => { const r = compareExecutiveRun(s, petId, mode, seed, ticks); addTally(picks, r.picks); return r; }), ticks));
  const pet = petById(s, petId)!;
  return { rows, diagnosis: diagnoseOrder(pet.plan ?? starterPlan(), rows, picks) };
}
