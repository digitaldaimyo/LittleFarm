import { REGISTRY } from '../domain/registry';
import type { Diagnostic, StageSpec } from '../domain/types';
import { EVAL_SEED_BASE, TRANSFER_SEED_BASE, evalSeeds } from '../domain/recipes';
import type { SerializedQ } from './qtable';
import { FetchController, SensePolicy, type SenseSkillDef } from './policies';
import { senseDefFor, templateOf } from './skilldef';
import { DEFAULT_TRAITS, evaluate, transferVariant, type EvalResult, type EpisodeTrace, type PolicySpec, type Traits } from './episodes';
import { RoutineController, compileRoutine, type SubSkills } from './routine';

export interface TrainingReport {
  before: EvalResult;
  after: EvalResult;
  random: EvalResult;
  transfer: EvalResult;
  /** Routines only: the same options chosen at random (a fairer baseline than random steps). */
  randomOptions?: EvalResult;
  /** Pens that pin the target or the start: the same lesson with those positions scattered. */
  scattered?: EvalResult;
  exploits: ExploitFinding[];
  passed: boolean;
  evalSeeds: number[];
}

export interface ExploitFinding {
  diagnostic: Diagnostic;
  ruleId: string;
  perEpisode: number;
  replay?: EpisodeTrace;
}

export function policySpecFor(stage: StageSpec, q: SerializedQ | null, navigator: SerializedQ | null, navigatorDef?: SenseSkillDef, selfDef?: SenseSkillDef, subskills?: SubSkills, traits: Traits = DEFAULT_TRAITS): PolicySpec {
  if (templateOf(stage) === 'routine') {
    const subs = subskills ?? {};
    return { kind: 'routine', ctrl: RoutineController.from(q, compileRoutine(stage, subs, traits)), subskills: subs };
  }
  if (templateOf(stage) === 'fetch') {
    return { kind: 'fetch', ctrl: FetchController.from(q) ?? new FetchController(), nav: SensePolicy.from(navigator, navigatorDef) };
  }
  // A saved revision is always evaluated with the senses it was trained with.
  const def = selfDef ?? senseDefFor(stage);
  return { kind: 'sense', policy: SensePolicy.from(q, def), def };
}

/** Held-out seeds are disjoint from training seeds by construction (≥ 900000 vs < 800000). */
export function heldOutSeeds(stage: StageSpec): number[] {
  const s = stage.evaluation.seedSet.filter((x) => x >= EVAL_SEED_BASE);
  return s.length >= 10 ? s : evalSeeds(Math.max(10, stage.evaluation.episodes));
}

export function buildReport(stage: StageSpec, traits: Traits, before: SerializedQ | null, after: SerializedQ, navigator: SerializedQ | null, navigatorDef?: SenseSkillDef, subskills?: SubSkills): TrainingReport {
  const seeds = heldOutSeeds(stage);
  const spec = (q: SerializedQ | null, st: StageSpec = stage) => policySpecFor(st, q, navigator, navigatorDef, undefined, subskills, traits);
  const beforeR = evaluate(stage, spec(before), seeds, 'before', traits);
  const afterR = evaluate(stage, spec(after), seeds, 'evaluation', traits);
  const randomOptions = templateOf(stage) === 'routine' ? evaluate(stage, { kind: 'routine', ctrl: null, subskills: subskills ?? {} }, seeds, 'baseline', traits, 1) : undefined;
  const random = evaluate(stage, { kind: 'random' }, seeds, 'baseline', traits, 1);
  const tStage = transferVariant(stage);
  const sv = scatteredVariant(stage);
  const scattered = sv ? evaluate(sv, spec(after, sv), seeds, 'baseline', traits, 3) : undefined;
  if (scattered) scattered.label = 'evaluation';
  const transfer = evaluate(tStage, spec(after, tStage), evalSeeds(10, TRANSFER_SEED_BASE), 'transfer', traits, 2);
  return {
    before: beforeR, after: afterR, random, transfer, randomOptions, scattered,
    exploits: findExploits(stage, afterR),
    passed: afterR.successRate >= stage.evaluation.minimumSuccessRate,
    evalSeeds: seeds,
  };
}

/**
 * Heuristic exploit finder: a positive, non-terminal rule that pays many times per try
 * while the actual task mostly fails. This is a hint, not a proof of safety.
 */
/** A thing's name for messages ("berry"). */
const OBJ_NAME = (kind: string) => (REGISTRY.objects.get(kind)?.name ?? kind).toLowerCase();

export function findExploits(stage: StageSpec, r: EvalResult): ExploitFinding[] {
  const out: ExploitFinding[] = [];
  for (const e of r.ledger) {
    const perEp = e.count / Math.max(1, r.episodes);
    const amount = e.count ? e.total / e.count : 0;
    if (amount <= 0 || perEp < 2.5) continue;
    // Below the lesson's own bar (not just below 50%): a loophole can coexist with lucky successes.
    if (r.successRate >= Math.max(0.5, stage.evaluation.minimumSuccessRate)) continue;
    let replay: EpisodeTrace | undefined;
    for (const t of r.traces) if (!replay || (t.ruleCounts[e.ruleId] ?? 0) > (replay.ruleCounts[e.ruleId] ?? 0)) replay = t;
    // The loophole probe: did one object keep paying? (Then "once per object" is the repair; if it already has
    // it, something is wrong with the pen — say so plainly.)
    let same: { n: number; kind: string } | undefined;
    for (const t of r.traces) { const x = t.sameObject?.[e.ruleId]; if (x && (!same || x.n > same.n)) same = x; }
    const repeat = same && same.n >= 3 ? ` The same ${OBJ_NAME(same.kind)} earned ${same.n} treats in one try.` : '';
    out.push({
      ruleId: e.ruleId, perEpisode: perEp, replay,
      diagnostic: {
        severity: 'warning', code: 'reward-exploit', nodeId: e.ruleId,
        message: `Your pet found a loophole: “${e.label}” paid about ${perEp.toFixed(1)} times per try, but the task succeeded only ${Math.round(r.successRate * 100)}% of the time.${repeat} The pet is doing exactly what the treats asked for — just not what you meant.`,
        repair: { label: 'Pay only once per object', action: 'limit-per-object', ruleId: e.ruleId },
      },
    });
  }
  return out;
}

/**
 * If a pen pins the skill's target or the pet's start, every "new layout" looks the same, so the usual
 * held-out score can't reveal overfitting. This variant scatters exactly those positions.
 */
export function scatteredVariant(stage: StageSpec): StageSpec | null {
  const focus = `kind:${stage.learner.focus}`;
  let changed = false;
  const s = structuredClone(stage);
  s.environment = s.environment.map((p) => {
    const k = p.args.kind as { cardId?: string } | undefined;
    if (p.cardId === 'place.fixed' && k?.cardId === focus) { changed = true; return { ...p, cardId: 'place.random', args: { kind: p.args.kind, count: 1, region: 'anywhere' } }; }
    if (p.cardId === 'place.pet' && p.args.mode === 'fixed') { changed = true; return { ...p, args: { ...p.args, mode: 'random' } }; }
    return p;
  });
  return changed ? s : null;
}
