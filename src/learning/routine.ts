import type { SpecNode, StageSpec } from '../domain/types';
import { isNode, paramOf } from '../domain/spec';
import { compileCondition, resolveKind, withTarget } from '../sim/compile';
import type { Action, Tally, World } from '../sim/world';
import { nearest } from '../sim/world';
import type { Rng } from '../sim/rng';
import type { SerializedQ } from './qtable';
import { DoubleQ } from './qtable';
import { NavRun, SensePolicy, SkillRun, isDone, type ExecStep, type SenseSkillDef } from './policies';
import { atFocus } from './features';
import { legalActionIdx } from './senses';
import { navTimeout, type Traits } from './episodes';

/**
 * Routines: an option-level learner (SMDP Double Q) over player-chosen options
 * (Use skill / Do action cards) and up to 4 watched conditions (≤16 states).
 * Skill options call the pet's *current* active revision of that skill.
 */
export const MAX_OPTIONS = 6;
export const MAX_WATCH = 4;

/** A saved sense skill a routine can call (snapshot of its active revision). */
export interface SubSkill {
  name: string;
  rev: number;
  preset: boolean;
  policy: SerializedQ;
  learner?: SenseSkillDef;
  focus?: string;
  success?: SpecNode | null;
  outcome?: 'reach' | 'survive';
  maxTicks?: number;
}
export type SubSkills = Record<string, SubSkill>;

type Cond = (w: World, base?: Tally) => boolean;

export interface CompiledOption {
  label: string;
  /** Can this option start now? (its "only when" card + whether it can do anything here) */
  legal(w: World): boolean;
  makeRun(rng: Rng): { next(w: World): ExecStep };
}

export interface CompiledRoutine {
  nStates: number;
  options: CompiledOption[];
  observe(w: World): number;
  legal(w: World): number[];
  /** Skill names (and revisions) this routine uses. */
  uses: { skill: string; rev: number }[];
  missing: string[];
}

function cond(n: SpecNode | undefined, target: string): Cond | null {
  if (!n || !isNode(n)) return null;
  const c = withTarget(target, () => compileCondition(n));
  return (w, base) => c({ w, prev: w.pet, base });
}

/** Ensure every option consumes at least one tick, so loops always cost time. */
function atLeastOneTick(inner: { next(w: World): ExecStep }) {
  let stepped = false;
  return {
    next(w: World): ExecStep {
      const s = inner.next(w);
      if (isDone(s) && !stepped) { stepped = true; return 'wait'; }
      stepped = true;
      return s;
    },
  };
}

/** `explore`: deployed runs only (the farm) — Curiosity's small chance of a random step inside walking sub-skills. */
export function compileRoutine(stage: StageSpec, subs: SubSkills, traits: Traits, targetOverride?: string, explore = 0): CompiledRoutine {
  const target = targetOverride ?? stage.learner.focus;
  const r = stage.learner.routine ?? { options: [], watch: [] };
  const watch = r.watch.slice(0, MAX_WATCH).map((n) => cond(n, target)!).filter(Boolean);
  const tmo = navTimeout(stage.size.w, stage.size.h, traits.persistence);
  const missing: string[] = [];
  const uses = new Map<string, number>();
  const options: CompiledOption[] = r.options.slice(0, MAX_OPTIONS).map((o) => {
    const when = cond(o.args.when as SpecNode | undefined, target);
    if (o.cardId === 'opt.action') {
      const a = paramOf(o, 'action', 'pick') as Action;
      return {
        label: a,
        // 'wait' is always legal, so checking [a, 'wait'] avoids legalActionIdx's all-illegal fallback.
        legal: (w) => (!when || when(w)) && (a === 'wait' || legalActionIdx(w, [a, 'wait']).includes(0)),
        makeRun: () => {
          let done = false;
          return { next: () => (done ? { done: 'success', reason: 'acted' } : ((done = true), a)) };
        },
      };
    }
    const name = paramOf(o, 'skill', '');
    const sub = subs[name];
    const aim = resolveKind(o.args.aim, target) || sub?.focus || target;
    if (!sub) {
      missing.push(name);
      return { label: name, legal: () => false, makeRun: () => ({ next: () => ({ done: 'fail', reason: 'missing skill' }) }) };
    }
    uses.set(name, sub.rev);
    const policy = SensePolicy.from(sub.policy, sub.learner)!;
    if (sub.preset) {
      // Approach / Avoid: go to the nearest one of `aim`.
      return {
        label: `${name}(${aim})`,
        legal: (w) => (!when || when(w)) && !!nearest(w, aim) && !atFocus(w, aim),
        makeRun: (rng) => atLeastOneTick(new NavRun(policy, aim, tmo, rng, explore)),
      };
    }
    const doneC = sub.success && sub.outcome !== 'survive' ? cond(sub.success, aim) : null;
    const limit = sub.maxTicks ?? 40;
    return {
      label: `${name}(${aim})`,
      legal: (w) => (!when || when(w)) && !(doneC && doneC(w)),
      makeRun: (rng) => atLeastOneTick(new SkillRun(policy, aim, limit, doneC, null, null, explore > 0 ? { eps: explore, rng } : null)),
    };
  });
  return {
    nStates: 1 << watch.length,
    options,
    observe: (w) => watch.reduce((acc, c, i) => acc | ((c(w) ? 1 : 0) << i), 0),
    legal(w) {
      const out: number[] = [];
      options.forEach((o, i) => { if (o.legal(w)) out.push(i); });
      return out;
    },
    uses: [...uses].map(([skill, rev]) => ({ skill, rev })),
    missing,
  };
}

export class RoutineController {
  q: DoubleQ;
  constructor(nS: number, nA: number, q?: DoubleQ) {
    this.q = q ?? new DoubleQ(nS, nA);
  }
  static from(s: SerializedQ | null | undefined, r: CompiledRoutine): RoutineController {
    return new RoutineController(r.nStates, r.options.length, s ? DoubleQ.deserialize(s) : undefined);
  }
}

/** Executes a learned routine: picks the best legal option at each boundary; idles a tick if none is possible. */
export class RoutineRun {
  ticks = 0;
  private cur: { next(w: World): ExecStep } | null = null;
  current: string | null = null;
  constructor(
    private r: CompiledRoutine,
    private ctrl: RoutineController,
    private rng: Rng,
    private totalTimeout: number,
    private done: ((w: World) => boolean) | null,
    /** *Survive* routines: at time-up, did it survive? Absent = time-up is a timeout. */
    private survived: ((w: World) => boolean) | null = null,
  ) {}
  next(w: World): ExecStep {
    if (this.ticks > 0 && this.done?.(w)) return { done: 'success', reason: 'goal reached' };
    if (this.ticks >= this.totalTimeout) return this.survived ? (this.survived(w) ? { done: 'success', reason: 'survived' } : { done: 'fail', reason: 'did not survive' }) : { done: 'timeout', reason: 'time up' };
    for (let guard = 0; guard < 4; guard++) {
      if (!this.cur) {
        const legal = this.r.legal(w);
        if (!legal.length) { this.ticks++; this.current = null; return 'wait'; }
        const o = this.ctrl.q.greedy(this.r.observe(w), legal);
        this.current = this.r.options[o].label;
        this.cur = this.r.options[o].makeRun(this.rng);
      }
      const s = this.cur.next(w);
      if (isDone(s)) { this.cur = null; continue; }
      this.ticks++;
      return s;
    }
    this.ticks++;
    return 'wait';
  }
}
