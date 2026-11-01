import type { Diagnostic, StageSpec } from '../domain/types';
import { EVAL_SEED_BASE, TRANSFER_SEED_BASE, evalSeeds } from '../domain/recipes';
import type { SerializedQ } from './qtable';
import { FetchController, NavPolicy } from './policies';
import { evaluate, transferVariant, type EvalResult, type EpisodeTrace, type PolicySpec, type Traits } from './episodes';

export interface TrainingReport {
  before: EvalResult;
  after: EvalResult;
  random: EvalResult;
  transfer: EvalResult;
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

export function policySpecFor(stage: StageSpec, q: SerializedQ | null, navigator: SerializedQ | null): PolicySpec {
  if (stage.learner.skill === 'Fetch') {
    return { kind: 'fetch', ctrl: FetchController.from(q) ?? new FetchController(), nav: NavPolicy.from(navigator) };
  }
  return { kind: 'nav', nav: NavPolicy.from(q) };
}

/** Held-out seeds are disjoint from training seeds by construction (≥ 900000 vs < 800000). */
export function heldOutSeeds(stage: StageSpec): number[] {
  const s = stage.evaluation.seedSet.filter((x) => x >= EVAL_SEED_BASE);
  return s.length >= 10 ? s : evalSeeds(Math.max(10, stage.evaluation.episodes));
}

export function buildReport(stage: StageSpec, traits: Traits, before: SerializedQ | null, after: SerializedQ, navigator: SerializedQ | null): TrainingReport {
  const seeds = heldOutSeeds(stage);
  const beforeR = evaluate(stage, policySpecFor(stage, before, navigator), seeds, 'before', traits);
  const afterR = evaluate(stage, policySpecFor(stage, after, navigator), seeds, 'evaluation', traits);
  const random = evaluate(stage, { kind: 'random' }, seeds, 'baseline', traits, 1);
  const tStage = transferVariant(stage);
  const transfer = evaluate(tStage, policySpecFor(tStage, after, navigator), evalSeeds(10, TRANSFER_SEED_BASE), 'transfer', traits, 2);
  return {
    before: beforeR, after: afterR, random, transfer,
    exploits: findExploits(stage, afterR),
    passed: afterR.successRate >= stage.evaluation.minimumSuccessRate,
    evalSeeds: seeds,
  };
}

/**
 * Heuristic exploit finder: a positive, non-terminal rule that pays many times per try
 * while the actual task mostly fails. This is a hint, not a proof of safety.
 */
export function findExploits(stage: StageSpec, r: EvalResult): ExploitFinding[] {
  const out: ExploitFinding[] = [];
  for (const e of r.ledger) {
    const perEp = e.count / Math.max(1, r.episodes);
    const amount = e.count ? e.total / e.count : 0;
    if (amount <= 0 || perEp < 2.5) continue;
    if (r.successRate >= 0.5) continue;
    let replay: EpisodeTrace | undefined;
    for (const t of r.traces) if (!replay || (t.ruleCounts[e.ruleId] ?? 0) > (replay.ruleCounts[e.ruleId] ?? 0)) replay = t;
    out.push({
      ruleId: e.ruleId, perEpisode: perEp, replay,
      diagnostic: {
        severity: 'warning', code: 'reward-exploit', nodeId: e.ruleId,
        message: `Your pet found a loophole: “${e.label}” paid about ${perEp.toFixed(1)} times per try, but the task succeeded only ${Math.round(r.successRate * 100)}% of the time. The pet is doing exactly what the treats asked for — just not what you meant.`,
        repair: { label: 'Pay only once per object', action: 'limit-per-object', ruleId: e.ruleId },
      },
    });
  }
  void stage;
  return out;
}
