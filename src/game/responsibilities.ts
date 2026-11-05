/**
 * Responsibilities (split from plan.ts, polish phase 3): the starter list, a job as responsibilities, compiling
 * WHEN / USE / OR USE / UNTIL rows into jobs the farm can run, and warnings about a list.
 */
import type { SpecNode } from '../domain/types';
import { jobCapability } from './capability';
import { isNode, node, paramOf } from '../domain/spec';
import { compileCondition, resolveKind, withTarget } from '../sim/compile';
import type { Tally, World } from '../sim/world';
import { isSelector, nearest, selectorText } from '../sim/world';
import { atFocus } from '../learning/features';
import type { BehaviorId, ExecContext, Invocation } from '../learning/executive';
import { BEHAVIOR_LABEL } from '../learning/executive';
import type { Responsibilities, NavigatorName, Pet } from './types';
import { activeRevision, getSkill, isCertified, navPolicyFor } from './pets';

const pet = () => node('actor.pet');

const has = (kind: string) => node('cond.compare', { quantity: node('q.count', { what: node(`kind:${kind}`) }), op: '>=', value: 1 });

const row = (label: string, conds: SpecNode[], job: SpecNode, also: SpecNode[] = [], until?: SpecNode) => node('plan.responsibility', { label, if: conds, do: job, ...(also.length ? { also } : {}), ...(until ? { until } : {}) });

/**
 * The starter responsibilities (what Auto does until the player edits them). Needs — rest when tired, sleep at night —
 * come before every row; a row whose WHEN mentions night (fireflies) may still run at night.
 */
export function starterPlan(): Responsibilities {
  const crop = node('cond.any', { any: [has('berry'), has('carrot'), has('pumpkin'), has('sunflower')] });
  return {
    guard: true,
    rows: [
      row('Holding a basket', [node('cond.carrying', { actor: pet(), what: node('kind:bin') })], node('job.basketRun', { navigator: 'Approach' })),
      row('Fireflies out', [node('cond.night'), has('firefly')], node('job.catch', { navigator: 'Approach' })),
      row('Finish what’s in your paws', [node('cond.carryingAny', { actor: pet() })], node('job.haul', { navigator: 'Approach' }), [node('job.harvest', { navigator: 'Approach' })]),
      row('Basket needs a run', [], node('job.basketRun', { navigator: 'Approach' })),
      row('Storage at most half full', [node('cond.storage', { level: 'half' })], node('job.haul', { navigator: 'Approach' }), [node('job.basketRun', { navigator: 'Approach' })], node('cond.not', { inner: node('cond.storage', { level: 'half' }) })),
      row('Every plot planted', [has('soil'), node('cond.canAfford')], node('job.plant', { navigator: 'Approach' })),
      row('Harvest what’s ripe', [crop], node('job.harvest', { navigator: 'Approach' })),
      row('Goods waiting', [node('cond.any', { any: [node('cond.storage', { level: 'any' }), has('egg')] })], node('job.haul', { navigator: 'Approach' })),
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

/** The card for a job (the old direct jobs, as a responsibility's USE). */
export function jobCard(job: string, opts: { skill?: string; target?: string; navigator?: string } = {}): SpecNode {
  const nav = { navigator: opts.navigator ?? 'Approach' };
  switch (job) {
    case 'harvest': return node('job.harvest', nav);
    case 'haul': return node('job.haul', nav);
    case 'plant': return node('job.plant', nav);
    case 'basketRun': return node('job.basketRun', nav);
    case 'skill': return node('job.skill', { skill: opts.skill ?? '', ...(opts.target ? { aim: node(`kind:${opts.target}`) } : {}) });
    default: return node('job.nap');
  }
}

/**
 * A direct job, written as responsibilities (learned-farm phase 6 retired direct jobs): do this job whenever it can
 * do anything, otherwise nap. Old saves' direct jobs become this.
 */
export function jobPlan(job: string, opts: { skill?: string; target?: string; navigator?: string } = {}): Responsibilities {
  const label = job === 'skill' ? `Run ${opts.skill || 'a skill'}` : BEHAVIOR_LABEL[(job === 'rest' ? 'rest' : job) as BehaviorId] ?? 'Job';
  const work = row(label, [], jobCard(job, opts));
  work.args.night = 'work'; // a direct job kept going at night
  return { guard: true, rows: job === 'rest' ? [row('Nap', [], node('job.nap'))] : [work, row('Otherwise nap', [], node('job.nap'))] };
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
  /** It may run when the pet would otherwise sleep: “At night: keep at it”, or its WHEN mentions night. */
  night: boolean;
}

const JOB_BEHAVIOR: Record<string, BehaviorId> = {
  'job.harvest': 'harvest', 'job.haul': 'haul', 'job.catch': 'catch', 'job.nap': 'rest',
  'job.wander': 'rest' /* retired (phase 6): a pet only does what it learned */, 'job.goto': 'goto', 'job.skill': 'skill', 'job.gate': 'gate', 'job.plant': 'plant', 'job.basketRun': 'basketRun',
};

function compileJob(j: SpecNode | null, rowId: string): DutyJob {
  const behaviorId = (j && JOB_BEHAVIOR[j.cardId]) || 'rest';
  const args: Record<string, string> = { row: rowId };
  if (j) {
    const nav = paramOf(j, 'navigator', 'Approach');
    if (['harvest', 'haul', 'catch', 'goto', 'gate', 'plant', 'basketRun'].includes(behaviorId)) args.navigator = nav;
    if (behaviorId === 'plant') args.target = 'soil';
    if (behaviorId === 'gate') args.state = paramOf(j, 'state', 'closed');
    if (behaviorId === 'harvest') args.target = 'berry';
    if (behaviorId === 'catch') args.target = 'firefly';
    if (behaviorId === 'haul') args.into = 'bin';
    if (behaviorId === 'goto') args.target = resolveKind(j.args.aim, 'berry') || 'home';
    if (behaviorId === 'skill') { args.skill = paramOf(j, 'skill', ''); const t = resolveKind(j.args.aim, ''); if (t) args.target = t; }
    // A job aimed at something particular (e.g. Harvest → the crop nearest the basket; a qualifier or a kind).
    if (['harvest', 'haul', 'plant', 'basketRun'].includes(behaviorId)) { const t = resolveKind(j.args.aim, ''); if (t) args.aim = t; }
  }
  const key = behaviorId === 'skill' ? `skill:${args.skill ?? ''}` : behaviorId === 'goto' ? `goto:${args.target}` : behaviorId === 'gate' ? `gate:${args.state}` : behaviorId;
  const label = behaviorId === 'skill' ? (args.skill || 'a skill') : behaviorId === 'goto' ? `Go to ${isSelector(args.target) ? selectorText(args.target) : args.target}` : behaviorId === 'gate' ? `Mind the gate (${args.state})` : BEHAVIOR_LABEL[behaviorId];
  args.cap = key;
  // Aimed at a qualifier: say which one ("Harvest → the berry nearest to basket").
  const aimed = args.aim ?? (behaviorId === 'skill' ? args.target : undefined);
  return { behaviorId, args, key, label: aimed && isSelector(aimed) ? `${label} → ${selectorText(aimed)}` : label };
}

export function compilePlan(plan: Responsibilities): CompiledRow[] {
  return plan.rows.filter((r) => r.cardId === 'plan.responsibility').map((r, index) => {
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
      night: paramOf(r, 'night', 'sleep') === 'work' || JSON.stringify(condNodes).includes('"cond.night"'),
    };
  });
}

/** Can this row's job do anything right now? (same eligibility as the built-in executive) */
export function jobPossible(p: Pet, w: World, ctx: ExecContext, job: { behaviorId: BehaviorId; args: Record<string, string> }): boolean {
  const nav = navPolicyFor(p, (job.args.navigator as NavigatorName) ?? p.assignment.navigator);
  // Aimed at something particular: only while there is one to aim at (or something is already in the paws).
  if (job.args.aim && !ctx.carrying && !ctx.basket && !nearest(w, job.args.aim)) return false;
  switch (job.behaviorId) {
    case 'rest': return true;
    case 'harvest': return !!jobCapability(p, 'harvest') && ((ctx.berry && !ctx.carrying) || (ctx.carrying && !ctx.basket));
    case 'haul': return !!jobCapability(p, 'haul') && !!nav && ((ctx.carrot && !ctx.carrying) || (ctx.carrying && !ctx.basket));
    case 'basketRun': return !!jobCapability(p, 'basketRun') && (!!ctx.basket || (!!ctx.tote && !ctx.carrying));
    case 'catch': return !!nav && !!ctx.firefly && !ctx.carrying;
    case 'plant': return !!jobCapability(p, 'plant') && !!ctx.soil && !ctx.carrying;
    case 'goto': return !!nav && !!nearest(w, job.args.target) && !atFocus(w, job.args.target);
    case 'skill': return !!activeRevision(getSkill(p, job.args.skill ?? ''));
    case 'gate': return !!jobCapability(p, job.args.state === 'open' ? 'gateOpen' : 'gateShut') && w.objects.some((o) => o.kind === 'gate' && !o.carried && !o.delivered && !!o.open !== (job.args.state === 'open'));
    default: return false;
  }
}

/** Does any row remember events? Only then does the farm keep a tally (so plans without memory are unchanged). */
export function planUsesMemory(plan: Responsibilities): boolean {
  return /"cardId":"cond\.(happened|just)"/.test(JSON.stringify(plan.rows));
}

export function planInvocation(row: CompiledRow, timeout: number, why: string): Invocation {
  return { behaviorId: row.job.behaviorId, args: { ...row.job.args }, intention: why, timeout, chosenBy: 'plan' };
}

/** Static + pet-aware warnings about a plan (before running it). */
export function planWarnings(p: Pet, plan: Responsibilities): { rowId?: string; message: string }[] {
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
  const needNav = rows.filter((r) => ['harvest', 'catch', 'goto', 'haul', 'plant', 'basketRun'].includes(r.job.behaviorId) && !navPolicyFor(p, 'Approach'));
  const needFetch = rows.filter((r) => (r.job.behaviorId === 'haul' || r.job.behaviorId === 'basketRun') && !activeRevision(getSkill(p, 'Fetch')));
  const list = (rs: CompiledRow[]) => `${rs.length > 1 ? 'Rows' : 'Row'} ${rs.map((r) => r.index + 1).join(', ')}`;
  if (needNav.length) out.push({ message: `${list(needNav)} need${needNav.length > 1 ? '' : 's'} a movement skill (Approach or Avoid) — skipped until ${p.name} learns one.` });
  if (needFetch.length) out.push({ message: `${list(needFetch)} need${needFetch.length > 1 ? '' : 's'} Fetch — skipped until ${p.name} learns it.` });
  const firstAlways = plan.rows.findIndex((r) => r.cardId === 'plan.responsibility' && !(Array.isArray(r.args.if) && r.args.if.length) && isNode(r.args.do) && r.args.do.cardId === 'job.nap');
  if (firstAlways >= 0 && firstAlways < plan.rows.length - 1) out.push({ message: `Rows below row ${firstAlways + 1} (an unconditional nap) can never run.` });
  return out;
}
