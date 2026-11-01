import type { SpecNode } from '../domain/types';
import { isNode, node, paramOf } from '../domain/spec';
import { compileCondition, resolveKind, withTarget } from '../sim/compile';
import type { Tally, World } from '../sim/world';
import { nearest } from '../sim/world';
import { atFocus } from '../learning/features';
import type { BehaviorId, ExecContext, Invocation } from '../learning/executive';
import { contextKey } from '../learning/executive';
import type { Rng } from '../sim/rng';
import type { FarmPlan, GameState, NavigatorName, Pet } from './types';
import { activeRevision, getSkill, isCertified, navPolicyFor } from './pets';

/**
 * Farm plans: ordered IF/DO rows written with the same cards as lessons.
 * The first row whose conditions hold *and* whose job is possible runs
 * (or, with the learned chooser, a bandit picks among those rows).
 */

const pet = () => node('actor.pet');
const has = (kind: string) => node('cond.compare', { quantity: node('q.count', { what: node(`kind:${kind}`) }), op: '>=', value: 1 });
const row = (label: string, conds: SpecNode[], job: SpecNode) => node('plan.row', { label, if: conds, do: job });

/** The built-in Auto rules, written as a plan. Behaves exactly like “Simple rules”. */
export function starterPlan(): FarmPlan {
  return {
    chooser: 'first',
    guard: true,
    rows: [
      row('Tired? Nap', [node('cond.energyBelow', { value: 25 })], node('job.nap')),
      row('Fireflies out', [node('cond.night'), has('firefly')], node('job.catch', { navigator: 'Approach' })),
      row('Night: sleep', [node('cond.night'), node('cond.not', { inner: node('cond.carryingAny', { actor: pet() }) })], node('job.nap')),
      row('Finish a delivery', [node('cond.carryingAny', { actor: pet() })], node('job.deliver', { navigator: 'Approach' })),
      row('Carrots ready', [has('carrot')], node('job.deliver', { navigator: 'Approach' })),
      row('Eggs ready', [has('egg')], node('job.deliver', { navigator: 'Approach' })),
      row('Berries ripe', [has('berry')], node('job.forage', { navigator: 'Approach' })),
      row('Otherwise wander', [], node('job.wander')),
      row('Otherwise nap', [], node('job.nap')),
    ],
  };
}

export interface CompiledRow {
  id: string;
  index: number;
  label: string;
  /** `base`: "Has done…" counts from here (the start of the job that is finishing). */
  holds(w: World, base?: Tally): boolean;
  job: { behaviorId: BehaviorId; args: Record<string, string> };
}

const JOB_BEHAVIOR: Record<string, BehaviorId> = {
  'job.forage': 'forage', 'job.deliver': 'deliver', 'job.catch': 'catch', 'job.nap': 'rest',
  'job.wander': 'wander', 'job.goto': 'goto', 'job.skill': 'skill', 'job.gate': 'gate',
};

export function compilePlan(plan: FarmPlan): CompiledRow[] {
  return plan.rows.filter((r) => r.cardId === 'plan.row').map((r, index) => {
    const conds = (Array.isArray(r.args.if) ? r.args.if : []).filter(isNode).map((c) => withTarget('berry', () => compileCondition(c)));
    const j = isNode(r.args.do) ? r.args.do : null;
    const behaviorId = (j && JOB_BEHAVIOR[j.cardId]) || 'rest';
    const args: Record<string, string> = { row: r.id };
    if (j) {
      const nav = paramOf(j, 'navigator', 'Approach');
      if (['forage', 'deliver', 'catch', 'goto', 'gate'].includes(behaviorId)) args.navigator = nav;
      if (behaviorId === 'gate') args.state = paramOf(j, 'state', 'closed');
      if (behaviorId === 'forage') args.target = 'berry';
      if (behaviorId === 'catch') args.target = 'firefly';
      if (behaviorId === 'deliver') args.into = 'bin';
      if (behaviorId === 'goto') args.target = resolveKind(j.args.aim, 'berry') || 'home';
      if (behaviorId === 'skill') { args.skill = paramOf(j, 'skill', ''); const t = resolveKind(j.args.aim, ''); if (t) args.target = t; }
    }
    return {
      id: r.id, index, label: paramOf(r, 'label', `Row ${index + 1}`),
      holds: (w, base) => conds.every((c) => c({ w, prev: w.pet, base })),
      job: { behaviorId, args },
    };
  });
}

/** Can this row's job do anything right now? (same eligibility as the built-in executive) */
export function jobPossible(p: Pet, w: World, ctx: ExecContext, job: CompiledRow['job']): boolean {
  const nav = navPolicyFor(p, (job.args.navigator as NavigatorName) ?? p.assignment.navigator);
  switch (job.behaviorId) {
    case 'rest': return true;
    case 'wander': return !ctx.energyLow;
    case 'forage': return !!nav && ctx.berry && !ctx.carrying;
    case 'deliver': return !!activeRevision(getSkill(p, 'Fetch')) && !!nav && (ctx.carrot || ctx.carrying);
    case 'catch': return !!nav && !!ctx.firefly && !ctx.carrying;
    case 'goto': return !!nav && !!nearest(w, job.args.target) && !atFocus(w, job.args.target);
    case 'skill': return !!activeRevision(getSkill(p, job.args.skill ?? ''));
    case 'gate': return w.objects.some((o) => o.kind === 'gate' && !o.carried && !o.delivered && !!o.open !== (job.args.state === 'open'));
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
}

/** Does any row remember events? Only then does the farm keep a tally (so plans without memory are unchanged). */
export function planUsesMemory(plan: FarmPlan): boolean {
  return /"cardId":"cond\.(happened|just)"/.test(JSON.stringify(plan.rows));
}
export function newPlanRuntime(): PlanRuntime {
  return { starts: [], fires: {}, switches: 0, guarded: 0, guardUntil: -1, lastHold: -1 };
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

export function choosePlanRow(
  s: GameState, p: Pet, plan: FarmPlan, rows: CompiledRow[], ctx: ExecContext, pr: PlanRuntime, rng: Rng,
): { row: CompiledRow | null; guarded: boolean; learned: boolean } {
  const w = s.farm.world;
  const applicable = rows.filter((r) => r.holds(w, pr.base) && jobPossible(p, w, ctx, r.job));
  if (!applicable.length) return { row: null, guarded: false, learned: false };
  // Anti-dithering: once rows flip-flop, the guard stays on for a while. While it is on, the pet sticks with
  // the previous row if it still applies; otherwise it must pause briefly before switching (minimum commitment).
  const tick = s.farm.tick;
  if (plan.guard && isThrashing(pr, tick)) pr.guardUntil = tick + GUARD_COOLDOWN;
  if (plan.guard && tick < pr.guardUntil) {
    const last = pr.starts.at(-1);
    const keep = applicable.find((r) => r.id === last?.row);
    if (keep) return { row: keep, guarded: true, learned: false };
    if (!last || pr.lastHold < last.tick) { pr.lastHold = tick; return { row: null, guarded: true, learned: false }; }
    return { row: applicable[0], guarded: true, learned: false };
  }
  if (plan.chooser === 'learned' && applicable.length > 1) {
    const table = (plan.table ??= {});
    const eps = 0.05 + 0.25 * p.traits.curiosity;
    if (rng.next() < eps) return { row: applicable[rng.int(applicable.length)], guarded: false, learned: true };
    const k = contextKey(ctx);
    let best = applicable[0], bv = -Infinity;
    for (const r of applicable) {
      const v = table[`${k}|row:${r.id}`]?.v ?? 1;
      if (v > bv) { bv = v; best = r; }
    }
    return { row: best, guarded: false, learned: true };
  }
  return { row: applicable[0], guarded: false, learned: false };
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
  const needNav = rows.filter((r) => ['forage', 'catch', 'goto', 'deliver'].includes(r.job.behaviorId) && !navPolicyFor(p, 'Approach'));
  const needFetch = rows.filter((r) => r.job.behaviorId === 'deliver' && !activeRevision(getSkill(p, 'Fetch')));
  const list = (rs: CompiledRow[]) => `${rs.length > 1 ? 'Rows' : 'Row'} ${rs.map((r) => r.index + 1).join(', ')}`;
  if (needNav.length) out.push({ message: `${list(needNav)} need${needNav.length > 1 ? '' : 's'} a movement skill (Approach or Avoid) — skipped until ${p.name} learns one.` });
  if (needFetch.length) out.push({ message: `${list(needFetch)} need${needFetch.length > 1 ? '' : 's'} Fetch — skipped until ${p.name} learns it.` });
  const firstAlways = plan.rows.findIndex((r) => r.cardId === 'plan.row' && !(Array.isArray(r.args.if) && r.args.if.length) && isNode(r.args.do) && r.args.do.cardId === 'job.nap');
  if (firstAlways >= 0 && firstAlways < plan.rows.length - 1) out.push({ message: `Rows below row ${firstAlways + 1} (an unconditional nap) can never run.` });
  return out;
}
