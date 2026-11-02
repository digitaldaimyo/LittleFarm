import type { SpecNode } from '../domain/types';
import { jobCapability } from './capability';
import { isNode, node, paramOf } from '../domain/spec';
import { compileCondition, resolveKind, withTarget } from '../sim/compile';
import type { Tally, World } from '../sim/world';
import { nearest } from '../sim/world';
import { atFocus } from '../learning/features';
import type { BehaviorId, ExecContext, Invocation } from '../learning/executive';
import { BEHAVIOR_LABEL, contextKey } from '../learning/executive';
import type { Rng } from '../sim/rng';
import type { FarmPlan, GameState, NavigatorName, Pet } from './types';
import { activeRevision, getSkill, isCertified, navPolicyFor } from './pets';

/**
 * Responsibilities (learned-farm phase 4; they grew out of the farm plan's IF/DO rows, written with lesson cards).
 * Each row: WHEN conditions hold, work on it with one of the jobs it may USE (its own learned skills), optionally
 * UNTIL a condition holds. Rows are in priority order. The deterministic executive (`chooseDuty`) serves needs
 * first (tired → rest, night → sleep), commits to the most important responsibility that needs doing, picks the job
 * with the best evidence for it, cools down what keeps failing, and records why (the decision trace).
 */

const pet = () => node('actor.pet');
const has = (kind: string) => node('cond.compare', { quantity: node('q.count', { what: node(`kind:${kind}`) }), op: '>=', value: 1 });
const row = (label: string, conds: SpecNode[], job: SpecNode, also: SpecNode[] = [], until?: SpecNode) => node('plan.row', { label, if: conds, do: job, ...(also.length ? { also } : {}), ...(until ? { until } : {}) });

/**
 * The starter responsibilities (what Auto does until the player edits them). Needs — rest when tired, sleep at night —
 * come before every row; a row whose WHEN mentions night (fireflies) may still run at night.
 */
export function starterPlan(): FarmPlan {
  const crop = node('cond.any', { any: [has('berry'), has('carrot'), has('pumpkin'), has('sunflower')] });
  return {
    chooser: 'first',
    guard: true,
    rows: [
      row('Holding a basket', [node('cond.carrying', { actor: pet(), what: node('kind:bin') })], node('job.tote', { navigator: 'Approach' })),
      row('Fireflies out', [node('cond.night'), has('firefly')], node('job.catch', { navigator: 'Approach' })),
      row('Finish what’s in your paws', [node('cond.carryingAny', { actor: pet() })], node('job.deliver', { navigator: 'Approach' }), [node('job.forage', { navigator: 'Approach' })]),
      row('Basket needs a run', [], node('job.tote', { navigator: 'Approach' })),
      row('Storage at most half full', [node('cond.storage', { level: 'half' })], node('job.deliver', { navigator: 'Approach' }), [node('job.tote', { navigator: 'Approach' })], node('cond.not', { inner: node('cond.storage', { level: 'half' }) })),
      row('Every plot planted', [has('soil'), node('cond.canAfford')], node('job.plant', { navigator: 'Approach' })),
      row('Harvest what’s ripe', [crop], node('job.forage', { navigator: 'Approach' })),
      row('Goods waiting', [node('cond.any', { any: [node('cond.storage', { level: 'any' }), has('egg')] })], node('job.deliver', { navigator: 'Approach' })),
      row('Otherwise wander', [], node('job.wander')),
      row('Otherwise nap', [], node('job.nap')),
    ],
  };
}

export interface DutyJob {
  behaviorId: BehaviorId;
  args: Record<string, string>;
  /** Evidence key: the job, or `skill:<name>` for Run a skill. */
  key: string;
  label: string;
}

export interface CompiledRow {
  id: string;
  index: number;
  label: string;
  /** `base`: "Has done…" counts from here (the start of the job that is finishing). */
  holds(w: World, base?: Tally): boolean;
  /** The first job it may use (`jobs[0]`). */
  job: DutyJob;
  /** Every job it may use: USE, then each OR USE. */
  jobs: DutyJob[];
  /** UNTIL: the pet sticks with it until this holds. Null: each finished job counts. */
  until: ((w: World, base?: Tally) => boolean) | null;
  /** Its WHEN mentions night, so it may run when the pet would otherwise sleep. */
  night: boolean;
}

const JOB_BEHAVIOR: Record<string, BehaviorId> = {
  'job.forage': 'forage', 'job.deliver': 'deliver', 'job.catch': 'catch', 'job.nap': 'rest',
  'job.wander': 'wander', 'job.goto': 'goto', 'job.skill': 'skill', 'job.gate': 'gate', 'job.plant': 'plant', 'job.tote': 'tote',
};

function compileJob(j: SpecNode | null, rowId: string): DutyJob {
  const behaviorId = (j && JOB_BEHAVIOR[j.cardId]) || 'rest';
  const args: Record<string, string> = { row: rowId };
  if (j) {
    const nav = paramOf(j, 'navigator', 'Approach');
    if (['forage', 'deliver', 'catch', 'goto', 'gate', 'plant', 'tote'].includes(behaviorId)) args.navigator = nav;
    if (behaviorId === 'plant') args.target = 'soil';
    if (behaviorId === 'gate') args.state = paramOf(j, 'state', 'closed');
    if (behaviorId === 'forage') args.target = 'berry';
    if (behaviorId === 'catch') args.target = 'firefly';
    if (behaviorId === 'deliver') args.into = 'bin';
    if (behaviorId === 'goto') args.target = resolveKind(j.args.aim, 'berry') || 'home';
    if (behaviorId === 'skill') { args.skill = paramOf(j, 'skill', ''); const t = resolveKind(j.args.aim, ''); if (t) args.target = t; }
  }
  const key = behaviorId === 'skill' ? `skill:${args.skill ?? ''}` : behaviorId === 'goto' ? `goto:${args.target}` : behaviorId === 'gate' ? `gate:${args.state}` : behaviorId;
  const label = behaviorId === 'skill' ? (args.skill || 'a skill') : behaviorId === 'goto' ? `Go to ${args.target}` : behaviorId === 'gate' ? `Mind the gate (${args.state})` : BEHAVIOR_LABEL[behaviorId];
  args.cap = key;
  return { behaviorId, args, key, label };
}

export function compilePlan(plan: FarmPlan): CompiledRow[] {
  return plan.rows.filter((r) => r.cardId === 'plan.row').map((r, index) => {
    const condNodes = (Array.isArray(r.args.if) ? r.args.if : []).filter(isNode);
    const conds = condNodes.map((c) => withTarget('berry', () => compileCondition(c)));
    const jobs = [isNode(r.args.do) ? r.args.do : null, ...(Array.isArray(r.args.also) ? r.args.also.filter(isNode) : [])].map((j) => compileJob(j, r.id));
    const untilNode = isNode(r.args.until) ? r.args.until : null;
    const until = untilNode ? withTarget('berry', () => compileCondition(untilNode)) : null;
    if (until) for (const j of jobs) j.args.until = '1';
    return {
      id: r.id, index, label: paramOf(r, 'label', `Row ${index + 1}`),
      holds: (w, base) => conds.every((c) => c({ w, prev: w.pet, base })),
      job: jobs[0], jobs,
      until: until ? (w, base) => until({ w, prev: w.pet, base }) : null,
      night: JSON.stringify(condNodes).includes('"cond.night"'),
    };
  });
}

/** Can this row's job do anything right now? (same eligibility as the built-in executive) */
export function jobPossible(p: Pet, w: World, ctx: ExecContext, job: { behaviorId: BehaviorId; args: Record<string, string> }): boolean {
  const nav = navPolicyFor(p, (job.args.navigator as NavigatorName) ?? p.assignment.navigator);
  switch (job.behaviorId) {
    case 'rest': return true;
    case 'wander': return !ctx.energyLow;
    case 'forage': return !!jobCapability(p, 'forage') && ((ctx.berry && !ctx.carrying) || (ctx.carrying && !ctx.basket));
    case 'deliver': return !!jobCapability(p, 'deliver') && !!nav && ((ctx.carrot && !ctx.carrying) || (ctx.carrying && !ctx.basket));
    case 'tote': return !!jobCapability(p, 'tote') && (!!ctx.basket || (!!ctx.tote && !ctx.carrying));
    case 'catch': return !!nav && !!ctx.firefly && !ctx.carrying;
    case 'plant': return !!jobCapability(p, 'plant') && !!ctx.soil && !ctx.carrying;
    case 'goto': return !!nav && !!nearest(w, job.args.target) && !atFocus(w, job.args.target);
    case 'skill': return !!activeRevision(getSkill(p, job.args.skill ?? ''));
    case 'gate': return !!jobCapability(p, job.args.state === 'open' ? 'gateOpen' : 'gateShut') && w.objects.some((o) => o.kind === 'gate' && !o.carried && !o.delivered && !!o.open !== (job.args.state === 'open'));
    default: return false;
  }
}

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
}

/** Does any row remember events? Only then does the farm keep a tally (so plans without memory are unchanged). */
export function planUsesMemory(plan: FarmPlan): boolean {
  return /"cardId":"cond\.(happened|just)"/.test(JSON.stringify(plan.rows));
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
  s: GameState, p: Pet, plan: FarmPlan, rows: CompiledRow[], ctx: ExecContext, pr: PlanRuntime, rng: Rng,
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
  } else if (plan.chooser === 'learned' && candidates.length > 1) {
    const table = (plan.table ??= {});
    learned = true;
    if (rng.next() < 0.05 + 0.25 * p.traits.curiosity) { row = candidates[rng.int(candidates.length)]; why = `Trying “${row.label}” (curious)`; }
    else {
      const k = contextKey(ctx);
      let bv = -Infinity;
      for (const r of candidates) { const v = table[`${k}|row:${r.id}`]?.v ?? 1; if (v > bv) { bv = v; row = r; } }
      why = `“${row.label}” has paid best here`;
    }
  }
  const jobs = usable(row);
  let job = jobs[0];
  for (const j of jobs) if (jobScore(p, j.key) > jobScore(p, job.key)) job = j;
  if (jobs.length > 1) why += ` — using ${job.label}${jobScore(p, job.key) === Infinity ? ' (not tried yet)' : ' (it has worked best)'}`;
  if (!c || c.row !== row.id) pr.commit = { row: row.id, since: tick, lastOk: tick, lastFailed: false };
  return { row, job, need: null, why, guarded, learned };
}

/**
 * After a job for a responsibility ends: record the evidence (on the pet), count failures — jobs that made no
 * progress in the world — (cooling a job down after FAIL_LIMIT in a row), and release the commitment when an each-time responsibility's job is done, or when an
 * UNTIL responsibility has made no progress for NO_PROGRESS ticks.
 */
export function afterDutyJob(p: Pet, pr: PlanRuntime, rows: CompiledRow[], args: Record<string, string>, ok: boolean, ticks: number, tick: number, progressed = ok): void {
  const key = args.cap;
  if (!key || !args.row) return;
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

export function updatePlanValue(plan: FarmPlan, ctx: ExecContext, rowId: string, reward: number): void {
  const table = (plan.table ??= {});
  const key = `${contextKey(ctx)}|row:${rowId}`;
  const e = table[key] ?? { n: 0, v: 0 };
  e.n++;
  e.v += (reward - e.v) / Math.min(e.n, 30);
  table[key] = e;
}

export function planInvocation(row: CompiledRow, timeout: number, why: string): Invocation {
  return { behaviorId: row.job.behaviorId, args: { ...row.job.args }, intention: why, timeout, chosenBy: 'plan' };
}

/** Static + pet-aware warnings about a plan (before running it). */
export function planWarnings(p: Pet, plan: FarmPlan): { rowId?: string; message: string }[] {
  const out: { rowId?: string; message: string }[] = [];
  const rows = compilePlan(plan);
  if (!rows.length) out.push({ message: 'The plan is empty — the pet will just nap.' });
  rows.forEach((r) => {
    if (r.job.behaviorId === 'skill') {
      const k = getSkill(p, r.job.args.skill ?? '');
      if (!r.job.args.skill) out.push({ rowId: r.id, message: `Row ${r.index + 1} doesn’t say which skill to run.` });
      else if (!k) out.push({ rowId: r.id, message: `Row ${r.index + 1}: ${p.name} hasn’t learned “${r.job.args.skill}”.` });
      else if (!isCertified(k)) out.push({ rowId: r.id, message: `Row ${r.index + 1}: “${k.name}” isn’t certified yet — it may not work well.` });
    }
  });
  const needNav = rows.filter((r) => ['forage', 'catch', 'goto', 'deliver', 'plant', 'tote'].includes(r.job.behaviorId) && !navPolicyFor(p, 'Approach'));
  const needFetch = rows.filter((r) => (r.job.behaviorId === 'deliver' || r.job.behaviorId === 'tote') && !activeRevision(getSkill(p, 'Fetch')));
  const list = (rs: CompiledRow[]) => `${rs.length > 1 ? 'Rows' : 'Row'} ${rs.map((r) => r.index + 1).join(', ')}`;
  if (needNav.length) out.push({ message: `${list(needNav)} need${needNav.length > 1 ? '' : 's'} a movement skill (Approach or Avoid) — skipped until ${p.name} learns one.` });
  if (needFetch.length) out.push({ message: `${list(needFetch)} need${needFetch.length > 1 ? '' : 's'} Fetch — skipped until ${p.name} learns it.` });
  const firstAlways = plan.rows.findIndex((r) => r.cardId === 'plan.row' && !(Array.isArray(r.args.if) && r.args.if.length) && isNode(r.args.do) && r.args.do.cardId === 'job.nap');
  if (firstAlways >= 0 && firstAlways < plan.rows.length - 1) out.push({ message: `Rows below row ${firstAlways + 1} (an unconditional nap) can never run.` });
  return out;
}
