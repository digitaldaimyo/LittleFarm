import type { Tally, World } from '../sim/world';
import type { ExecContext } from '../learning/executive';
import { contextKey } from '../learning/executive';
import type { Rng } from '../sim/rng';
import type { Responsibilities, GameState, Pet } from './types';
import { jobPossible, type CompiledRow, type DutyJob } from './responsibilities';
import { execValues, upperKey, upperPrior, lowerKey, LOWER_PRIOR, rankWeight, EXEC_GAMMA_PER_TICK, learnFromPending } from './learnedpicks';
export * from './learnedpicks';
export * from './responsibilities';

/**
 * Responsibilities (learned-farm phase 4; they grew out of the farm plan's IF/DO rows, written with lesson cards).
 * Each row: WHEN conditions hold, work on it with one of the jobs it may USE (its own learned skills), optionally
 * UNTIL a condition holds. Rows are in priority order. The deterministic executive (`chooseDuty`) serves needs
 * first (tired → rest, night → sleep), commits to the most important responsibility that needs doing, picks the job
 * with the best evidence for it, cools down what keeps failing, and records why (the decision trace).
 */

/** Runtime memory for plans (not saved). */
export interface PlanRuntime {
  starts: { tick: number; row: string }[];
  fires: Record<string, number>;
  switches: number;
  guarded: number;
  /** Guard stays on until this tick once dithering is spotted. */
  guardUntil: number;
  /** Tick of the last "hold still" pause. */
  lastHold: number;
  /** What had happened when the current job started ("Has done…" in rows counts from here). */
  base?: Tally;
  /** The current commitment: a responsibility (row id) or a need, since when, and how it's going. */
  commit: { row: string; need?: 'tired' | 'night'; since: number; lastOk: number; lastFailed: boolean } | null;
  /** Cooling down until this tick: `row|job` pairs that kept failing, or a whole row (`row`) that made no progress. */
  cooldown: Record<string, number>;
  /** Failures in a row per `row|job`. */
  fails: Record<string, number>;
  /** The decision trace, newest last. */
  trace: { tick: number; text: string }[];
  /** Learned executive (phase 5): the last choice, and its finished-but-not-yet-learned-from result. */
  decided?: { state: string; row: string; job: string; index: number; tick: number };
  pending?: { state: string; row: string; job: string; index: number; tick: number; r: number };
}

export function newPlanRuntime(): PlanRuntime {
  return { starts: [], fires: {}, switches: 0, guarded: 0, guardUntil: -1, lastHold: -1, commit: null, cooldown: {}, fails: {}, trace: [] };
}
export const GUARD_COOLDOWN = 160;

/** Dithering = the chosen row changed at least this many times within the window. */
export const THRASH_WINDOW = 40;
export const THRASH_SWITCHES = 6;
export const GUARD_HOLD = 8;

export function isThrashing(pr: PlanRuntime, tick: number): boolean {
  const recent = pr.starts.filter((s) => tick - s.tick <= THRASH_WINDOW);
  let changes = 0;
  for (let i = 1; i < recent.length; i++) if (recent[i].row !== recent[i - 1].row) changes++;
  return changes >= THRASH_SWITCHES;
}

/** Commitment rules (phase 4). */
export const MIN_COMMIT = 60;
export const FAIL_LIMIT = 3;
export const COOLDOWN = 200;
export const NO_PROGRESS = 400;
export const RESTED_AT = 90;

/** How the executive chooses among what needs doing: the player's order, learned values, or at random (a baseline). */
export interface ExecHow {
  mode: 'order' | 'learned' | 'random';
  /** Learned: the chance of trying something else (Curiosity; 0 when measuring). */
  eps: number;
}

export interface DutyChoice {
  row: CompiledRow | null;
  job: DutyJob | null;
  need: 'tired' | 'night' | null;
  why: string;
  guarded: boolean;
  learned: boolean;
}

export function traceDecision(pr: PlanRuntime, tick: number, text: string): void {
  if (pr.trace.at(-1)?.text === text) return;
  pr.trace.push({ tick, text });
  if (pr.trace.length > 40) pr.trace.shift();
}

const cooling = (pr: PlanRuntime, key: string, tick: number) => (pr.cooldown[key] ?? -1) > tick;

/** Evidence for a job (how often it worked for this pet, and how long it took), optimistic for untried ones. */
export function jobScore(p: Pet, key: string): number {
  const e = p.evidence?.[key];
  if (!e || e.n === 0) return Infinity;
  return ((e.ok + 1) / (e.n + 2)) / (e.ticks / e.n + 10);
}

/**
 * The deterministic executive. Needs first; then the most important responsibility that needs doing — but a
 * commitment to an UNTIL responsibility holds for at least MIN_COMMIT ticks unless its last job failed; then the
 * eligible job with the best evidence (cooled-down ones skipped).
 */
export function chooseDuty(
  s: GameState, p: Pet, plan: Responsibilities, rows: CompiledRow[], ctx: ExecContext, pr: PlanRuntime, rng: Rng, how: ExecHow = { mode: 'order', eps: 0 },
): DutyChoice {
  const w = s.farm.world;
  const tick = s.farm.tick;
  const none = (why: string, need: DutyChoice['need'] = null, guarded = false): DutyChoice => ({ row: null, job: null, need, why, guarded, learned: false });
  // Needs: rest when tired (until refreshed) — a basket in the paws is put down first.
  const resting = pr.commit?.need === 'tired' && p.energy < RESTED_AT;
  if (!ctx.basket && (ctx.energyLow || resting)) {
    if (pr.commit?.need !== 'tired') pr.commit = { row: '', need: 'tired', since: tick, lastOk: tick, lastFailed: false };
    return none(ctx.energyLow ? 'Tired — resting comes first' : `Resting until refreshed (${Math.round(p.energy)} of ${RESTED_AT})`, 'tired');
  }
  const usable = (r: CompiledRow) => r.jobs.filter((j) => !cooling(pr, `${r.id}|${j.key}`, tick) && jobPossible(p, w, ctx, j));
  const active = rows.filter((r) => !cooling(pr, r.id, tick) && r.holds(w, pr.base) && !(r.until && r.until(w, pr.base)) && usable(r).length > 0);
  const nightNeed = !!ctx.night && !ctx.carrying;
  const candidates = nightNeed ? active.filter((r) => r.night) : active;
  const state = contextKey(ctx);
  if (!candidates.length) {
    if (nightNeed) {
      if (pr.commit?.need !== 'night') pr.commit = { row: '', need: 'night', since: tick, lastOk: tick, lastFailed: false };
      return none('Night — time to sleep', 'night');
    }
    pr.commit = null;
    return none('Nothing needs doing right now — napping');
  }
  // Anti-dithering guard: once responsibilities flip-flop, stick with the last one for a while.
  if (plan.guard && isThrashing(pr, tick)) pr.guardUntil = tick + GUARD_COOLDOWN;
  let row = candidates[0];
  let why = `“${row.label}” is the most important thing that needs doing`;
  let guarded = false, learned = false;
  const c = pr.commit && !pr.commit.need ? pr.commit : null;
  const cur = c ? candidates.find((r) => r.id === c.row) : undefined;
  if (plan.guard && tick < pr.guardUntil) {
    const last = pr.starts.at(-1);
    const keep = candidates.find((r) => r.id === last?.row);
    if (keep) { row = keep; guarded = true; why = `Sticking with “${keep.label}” — responsibilities were flip-flopping`; }
    else if (!last || pr.lastHold < last.tick) { pr.lastHold = tick; return none('Holding still for a moment — responsibilities were flip-flopping', null, true); }
    else guarded = true;
  } else if (cur && cur !== row) {
    if (tick - c!.since < MIN_COMMIT && !c!.lastFailed) { row = cur; why = `Sticking with “${cur.label}” — not done yet`; }
    else why = `“${row.label}” matters more than “${cur.label}”${c!.lastFailed ? ' (and that just failed)' : ''}`;
  } else if (cur) {
    why = `Still working on “${row.label}”`;
  } else if (how.mode === 'random') {
    row = candidates[rng.int(candidates.length)];
    why = `Picked “${row.label}” at random (a baseline)`;
  } else if (how.mode === 'learned' && candidates.length > 1) {
    learned = true;
    const v = execValues(p);
    if (rng.next() < how.eps) { row = candidates[rng.int(candidates.length)]; why = `Trying “${row.label}” (curious)`; }
    else {
      let bv = -Infinity;
      for (const r of candidates) { const q = v.upper[upperKey(state, r.id)]?.q ?? upperPrior(r.index); if (q > bv) { bv = q; row = r; } }
      why = row === candidates[0] ? `“${row.label}” — learned it’s the best pick here, as listed` : `“${row.label}” — learned it pays off more here than “${candidates[0].label}”`;
    }
  }
  const jobs = usable(row);
  let job = jobs[0];
  if (how.mode === 'random') job = jobs[rng.int(jobs.length)];
  else if (how.mode === 'learned' && jobs.length > 1) {
    const v = execValues(p);
    if (rng.next() < how.eps) job = jobs[rng.int(jobs.length)];
    else {
      // Learned value first; ties (e.g. nothing learned yet here) go to the farm-wide evidence.
      const q = (j: DutyJob) => v.lower[lowerKey(state, row.id, j.key)]?.q ?? LOWER_PRIOR;
      for (const j of jobs) if (q(j) > q(job) + 1e-9 || (Math.abs(q(j) - q(job)) <= 1e-9 && jobScore(p, j.key) > jobScore(p, job.key))) job = j;
    }
    why += ` — using ${job.label} (learned)`;
  } else {
    for (const j of jobs) if (jobScore(p, j.key) > jobScore(p, job.key)) job = j;
    if (jobs.length > 1) why += ` — using ${job.label}${jobScore(p, job.key) === Infinity ? ' (not tried yet)' : ' (it has worked best)'}`;
  }
  if (!c || c.row !== row.id) pr.commit = { row: row.id, since: tick, lastOk: tick, lastFailed: false };
  pr.decided = { state, row: row.id, job: job.key, index: row.index, tick };
  return { row, job, need: null, why, guarded, learned };
}

/**
 * After a job for a responsibility ends: record the evidence (on the pet), count failures — jobs that made no
 * progress in the world — (cooling a job down after FAIL_LIMIT in a row), and release the commitment when an each-time responsibility's job is done, or when an
 * UNTIL responsibility has made no progress for NO_PROGRESS ticks.
 */
export function afterDutyJob(p: Pet, pr: PlanRuntime, rows: CompiledRow[], args: Record<string, string>, ok: boolean, ticks: number, tick: number, progressed = ok, w?: World): void {
  const key = args.cap;
  if (!key || !args.row) return;
  // The learned executive's reward: progress on the responsibility (measured in the world), completion, minus
  // time and failure. Coins are not the reward. Learned from at the next decision (see learnFromPending).
  const d = pr.decided;
  if (d && d.row === args.row && d.job === key) {
    const row = rows.find((r) => r.id === args.row);
    // Done = the responsibility got served: its UNTIL now holds, or (each-time ones) a job that made progress.
    const done = row?.until ? !!w && row.until(w, pr.base) : ok && progressed;
    // What the progress is worth follows the player's order: higher responsibilities count more (a job that got
    // nothing done earns nothing wherever it is listed).
    const achieved = ((progressed ? 1 : 0) + (done ? 1 : 0)) / 2;
    const r = rankWeight(row?.index ?? 0) * achieved * EXEC_GAMMA_PER_TICK ** ticks - (!progressed && !ok ? 0.5 : 0);
    pr.pending = { ...d, r };
    pr.decided = undefined;
    learnFromPending(p, pr);
  }
  const e = ((p.evidence ??= {})[key] ??= { n: 0, ok: 0, ticks: 0 });
  e.n++; e.ticks += ticks; if (ok) e.ok++;
  if (e.n > 200) { e.n /= 2; e.ok /= 2; e.ticks /= 2; } // recent evidence counts more
  const label = rows.find((r) => r.id === args.row)?.label ?? 'that';
  const fk = `${args.row}|${key}`;
  const c = pr.commit && pr.commit.row === args.row ? pr.commit : null;
  if (ok || progressed) {
    // Progress is measured from the world: a job that ended early but changed the farm (picked something up,
    // sold, planted…) isn't a failure — another job may finish what it started.
    pr.fails[fk] = 0;
    if (c) { c.lastOk = tick; c.lastFailed = !ok; }
    if (!args.until) pr.commit = null;
    return;
  }
  pr.fails[fk] = (pr.fails[fk] ?? 0) + 1;
  if (c) c.lastFailed = true;
  if (pr.fails[fk] >= FAIL_LIMIT) {
    pr.cooldown[fk] = tick + COOLDOWN;
    pr.fails[fk] = 0;
    traceDecision(pr, tick, `${args.cap.replace(/^skill:/, '')} failed ${FAIL_LIMIT}× in a row for “${label}” — giving it a rest for ${COOLDOWN} ticks`);
  }
  if (c && args.until && tick - c.lastOk > NO_PROGRESS) {
    pr.cooldown[args.row] = tick + COOLDOWN;
    pr.commit = null;
    traceDecision(pr, tick, `No progress on “${label}” for ${NO_PROGRESS} ticks — setting it aside for ${COOLDOWN}`);
  }
}

