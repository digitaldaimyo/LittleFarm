import type { StageSpec } from '../domain/types';
import { compileStage, type CompiledStage } from '../sim/compile';
import { Rng, hashSeed } from '../sim/rng';
import type { Action, World } from '../sim/world';
import { bfsPath, cloneWorld, legalActions, nearest, objectsAt, step } from '../sim/world';
import { FetchController, FetchRun, NavPolicy, SensePolicy, isDone, type ExecStep, type SenseSkillDef } from './policies';
import { legalActionIdx } from './senses';
import { summarize, type BehaviorSummary } from './summary';
import { RoutineRun, compileRoutine, type RoutineController, type SubSkills } from './routine';
import { templateOf } from './skilldef';

export type TraceLabel = 'training' | 'evaluation' | 'baseline' | 'scripted' | 'before' | 'transfer';

export interface Frame {
  x: number;
  y: number;
  carrying: boolean;
  a: Action;
  r: number;
  hits?: string[];
}

export interface EpisodeTrace {
  label: TraceLabel;
  seed: number;
  initial: World;
  frames: Frame[];
  success: boolean;
  failed: boolean;
  reward: number;
  ticks: number;
  ruleCounts: Record<string, number>;
  /** Per rule: the most treats one object earned in this try, and what kind it was (the loophole probe). */
  sameObject?: Record<string, { n: number; kind: string }>;
  options?: string[];
}

export interface LedgerEntry {
  ruleId: string;
  label: string;
  count: number;
  total: number;
}

export interface EvalResult {
  label: TraceLabel;
  episodes: number;
  successes: number;
  successRate: number;
  failRate: number;
  meanReward: number;
  meanTicks: number;
  ledger: LedgerEntry[];
  traces: EpisodeTrace[];
  seeds: number[];
  /** What the policy actually did across all these episodes. */
  summary?: BehaviorSummary;
}

export interface Traits {
  curiosity: number;
  persistence: number;
  caution: number;
}

export const DEFAULT_TRAITS: Traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };

export function navTimeout(w: number, h: number, persistence: number): number {
  return Math.round((w + h) * (1 + persistence));
}

/** Chooses the next action given the world; may say it's done. */
export type Chooser = (w: World) => ExecStep;

export interface RunOpts {
  label: TraceLabel;
  record: boolean;
  /** Extra per-step reward hook (temperament/feedback) — kept separate in the ledger. */
  extra?: (w: World, events: ReturnType<typeof step>) => number;
}

/** Run one complete episode of a stage with an arbitrary chooser. */
export function runEpisode(cs: CompiledStage, seed: number, chooser: Chooser, opts: RunOpts): EpisodeTrace {
  const w = cs.generate(seed);
  const initial = opts.record ? cloneWorld(w) : w;
  const rs = cs.newRuleState();
  const frames: Frame[] = [];
  const ruleCounts: Record<string, number> = {};
  const perObj = new Map<string, number>();
  const sameObject: Record<string, { n: number; kind: string }> = {};
  let reward = 0;
  let ended = false;
  while (w.tick < cs.spec.maxTicks) {
    const c = chooser(w);
    const a: Action = isDone(c) ? 'wait' : c;
    if (isDone(c) && c.done !== 'success') break; // executor gave up (timeout / nothing to do)
    const prev = { x: w.pet.x, y: w.pet.y };
    const events = step(w, a);
    const out = cs.evalStep(w, prev, events, rs);
    let r = out.reward;
    if (opts.extra) r += opts.extra(w, events);
    reward += r;
    for (const h of out.hits) {
      ruleCounts[h.ruleId] = (ruleCounts[h.ruleId] ?? 0) + 1;
      if (h.objId === undefined || h.amount <= 0) continue;
      const k = `${h.ruleId}|${h.objId}`;
      const n = (perObj.get(k) ?? 0) + 1;
      perObj.set(k, n);
      if (n > (sameObject[h.ruleId]?.n ?? 0)) sameObject[h.ruleId] = { n, kind: w.objects.find((o) => o.id === h.objId)?.kind ?? 'thing' };
    }
    if (opts.record) frames.push({ x: w.pet.x, y: w.pet.y, carrying: w.pet.carrying !== null, a, r, hits: out.hits.length ? out.hits.map((h) => h.label) : undefined });
    if (out.end) { ended = true; break; }
  }
  void ended;
  return {
    label: opts.label, seed, initial, frames,
    success: cs.isSuccess(w), failed: cs.isFail(w),
    reward, ticks: w.tick, ruleCounts, sameObject,
  };
}

export type PolicySpec =
  | { kind: 'random' }
  | { kind: 'scripted' }
  | { kind: 'sense'; policy: SensePolicy | null; def: SenseSkillDef }
  | { kind: 'fetch'; ctrl: FetchController; nav: NavPolicy | null }
  | { kind: 'routine'; ctrl: RoutineController | null; subskills: SubSkills };

export function makeChooser(stage: StageSpec, p: PolicySpec, seed: number, traits: Traits): Chooser {
  const rng = new Rng(hashSeed(seed, 0xc0ffee));
  const focus = stage.learner.focus;
  const dest = stage.learner.destination ?? 'bin';
  if (p.kind === 'random') {
    return (w) => {
      const acts = legalActions(w, stage.abilities);
      return acts[rng.int(acts.length)];
    };
  }
  if (p.kind === 'scripted') return scriptedChooser(stage);
  if (p.kind === 'sense') {
    return (w) => {
      if (!p.policy) {
        // Untrained: random among physically possible actions.
        const legal = legalActionIdx(w, p.def.actions);
        return p.def.actions[legal[rng.int(legal.length)]];
      }
      return p.policy.act(w, focus);
    };
  }
  if (p.kind === 'routine') {
    const r = compileRoutine(stage, p.subskills, traits);
    let run: RoutineRun | null = null;
    // ctrl null → "random choice of options" baseline: a random legal option at each boundary.
    const ctrl = p.ctrl ?? null;
    let cur: { next(w: World): ExecStep } | null = null;
    return (w) => {
      if (ctrl) {
        run ??= new RoutineRun(r, ctrl, rng, stage.maxTicks, null);
        const st = run.next(w);
        // In a pen the try's own clock decides: with nothing to do, the pet just waits (as before).
        if (isDone(st) && st.reason === 'no option applies') { const t = run.ticks; run = new RoutineRun(r, ctrl, rng, stage.maxTicks, null); run.ticks = t + 1; return 'wait'; }
        return st;
      }
      for (let guard = 0; guard < 4; guard++) {
        if (!cur) {
          const legal = r.legal(w);
          if (!legal.length) return 'wait';
          cur = r.options[legal[rng.int(legal.length)]].makeRun(rng);
        }
        const st = cur.next(w);
        if (isDone(st)) { cur = null; continue; }
        return st;
      }
      return 'wait';
    };
  }
  let run: FetchRun | null = null;
  return (w) => {
    run ??= new FetchRun(p.ctrl, p.nav, focus, dest, navTimeout(stage.size.w, stage.size.h, traits.persistence), stage.maxTicks, rng, w.delivered[focus] ?? 0);
    return run.next(w);
  };
}

/** Scripted demonstrator (BFS). Used for preflight and as a labelled baseline — never as the pet. */
export function scriptedChooser(stage: StageSpec): Chooser {
  const focus = stage.learner.focus;
  const dest = stage.learner.destination ?? 'bin';
  const avoid = stage.learner.skill !== 'Approach';
  const custom = templateOf(stage) === 'routine' || (templateOf(stage) === 'sense' && stage.learner.skill !== 'Approach' && stage.learner.skill !== 'Avoid');
  return (w) => {
    const goTo = (kind: string): Action => {
      const path = bfsPath(w, w.pet.x, w.pet.y, (x, y) => objectsAt(w, x, y).some((o) => o.kind === kind), avoid) ?? bfsPath(w, w.pet.x, w.pet.y, (x, y) => objectsAt(w, x, y).some((o) => o.kind === kind), false);
      return path && path.length ? path[0] : 'wait';
    };
    if (custom) return { done: 'fail', reason: 'no scripted demo for custom skills' };
    if (stage.learner.skill !== 'Fetch') return goTo(focus);
    const here = objectsAt(w, w.pet.x, w.pet.y);
    if (w.pet.carrying === null) {
      if (here.some((o) => o.kind === focus)) return 'pick';
      return nearest(w, focus) ? goTo(focus) : { done: 'fail', reason: 'nothing to fetch' };
    }
    if (here.some((o) => o.kind === dest)) return 'drop';
    return goTo(dest);
  };
}

export function evaluate(stage: StageSpec, p: PolicySpec, seeds: number[], label: TraceLabel, traits: Traits = DEFAULT_TRAITS, keepTraces = 4): EvalResult {
  const cs = compileStage(stage);
  let successes = 0, fails = 0, reward = 0, ticks = 0;
  const ledger = new Map<string, LedgerEntry>();
  const traces: EpisodeTrace[] = [];
  const all: EpisodeTrace[] = [];
  for (const seed of seeds) {
    const t = runEpisode(cs, seed, makeChooser(stage, p, seed, traits), { label, record: true });
    all.push(t);
    if (t.success) successes++;
    if (t.failed) fails++;
    reward += t.reward;
    ticks += t.ticks;
    for (const [rid, c] of Object.entries(t.ruleCounts)) {
      const rule = cs.rules.find((r) => r.id === rid);
      const e = ledger.get(rid) ?? { ruleId: rid, label: rule?.label ?? rid, count: 0, total: 0 };
      e.count += c;
      e.total += c * (rule?.reward ?? 0);
      ledger.set(rid, e);
    }
  }
  // Keep a representative mix: first success, first failure, then the rest.
  // Prefer the longest success: more interesting to watch than a one-step win.
  const firstOk = all.filter((t) => t.success).sort((a, b) => b.ticks - a.ticks)[0];
  const firstBad = all.find((t) => !t.success);
  for (const t of [firstOk, firstBad, ...all]) if (t && !traces.includes(t) && traces.length < keepTraces) traces.push(t);
  const n = Math.max(1, seeds.length);
  const ledgerList = [...ledger.values()];
  return {
    label, episodes: seeds.length, successes, successRate: successes / n, failRate: fails / n,
    meanReward: reward / n, meanTicks: ticks / n,
    ledger: ledgerList, traces, seeds,
    summary: label === 'evaluation' ? summarize(stage, all, ledgerList) : undefined,
  };
}

/** Bigger, unseen layouts for measuring transfer. */
export function transferVariant(stage: StageSpec): StageSpec {
  const s = structuredClone(stage);
  s.size = { w: Math.min(16, stage.size.w + 3), h: Math.min(16, stage.size.h + 3) };
  s.maxTicks = Math.round(stage.maxTicks * 1.6);
  for (const p of s.environment) {
    if (p.cardId === 'place.random' && typeof p.args.count === 'number') {
      const k = (p.args.kind as { cardId: string }).cardId;
      if (k === 'kind:rock' || k === 'kind:pond') p.args.count = Math.min(8, p.args.count + 2);
    }
  }
  return s;
}
