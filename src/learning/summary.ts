import type { StageSpec } from '../domain/types';
import type { EpisodeTrace, LedgerEntry } from './episodes';
import { cloneWorld, nearest, step, type World } from '../sim/world';

/**
 * What a skill revision actually does, computed from held-out evaluation episodes:
 * where it spends time relative to its target, its action mix, how tries end,
 * and which rules paid. Small enough to store on every revision.
 */
export const HEAT_R = 6;
export const HEAT_N = HEAT_R * 2 + 1;

export interface BehaviorSummary {
  episodes: number;
  steps: number;
  meanTicks: number;
  /** Visits per offset from the nearest target (row-major, HEAT_N×HEAT_N, centre = on the target). Fractions sum to 1. */
  heat: number[];
  actions: Record<string, number>;
  endings: { success: number; fail: number; timeout: number };
  rewardShare: { label: string; share: number; count: number }[];
  /** Fraction of steps spent standing still / on the target / right next to it. */
  stayShare: number;
  onTargetShare: number;
  besideShare: number;
}

function offset(w: World, target: string): [number, number] | null {
  const t = nearest(w, target);
  if (!t) return null;
  return [Math.max(-HEAT_R, Math.min(HEAT_R, w.pet.x - t.x)), Math.max(-HEAT_R, Math.min(HEAT_R, w.pet.y - t.y))];
}

export function summarize(stage: StageSpec, traces: EpisodeTrace[], ledger: LedgerEntry[]): BehaviorSummary {
  const target = stage.learner.focus;
  const heat = new Array(HEAT_N * HEAT_N).fill(0);
  const actions: Record<string, number> = {};
  const endings = { success: 0, fail: 0, timeout: 0 };
  let steps = 0, ticks = 0, stays = 0, on = 0, beside = 0, located = 0;
  for (const t of traces) {
    const w = cloneWorld(t.initial);
    ticks += t.ticks;
    if (t.success) endings.success++;
    else if (t.failed) endings.fail++;
    else endings.timeout++;
    for (const f of t.frames) {
      step(w, f.a);
      steps++;
      actions[f.a] = (actions[f.a] ?? 0) + 1;
      if (f.a === 'wait') stays++;
      const o = offset(w, target);
      if (!o) continue;
      located++;
      heat[(o[1] + HEAT_R) * HEAT_N + (o[0] + HEAT_R)]++;
      const d = Math.abs(o[0]) + Math.abs(o[1]);
      if (d === 0) on++;
      if (d === 1) beside++;
    }
  }
  const pos = ledger.filter((e) => e.total > 0);
  const posTotal = pos.reduce((a, e) => a + e.total, 0);
  return {
    episodes: traces.length,
    steps,
    meanTicks: traces.length ? ticks / traces.length : 0,
    heat: heat.map((v) => (located ? v / located : 0)),
    actions: Object.fromEntries(Object.entries(actions).map(([k, v]) => [k, v / Math.max(1, steps)])),
    endings,
    rewardShare: pos.map((e) => ({ label: e.label, share: posTotal ? e.total / posTotal : 0, count: e.count })).sort((a, b) => b.share - a.share),
    stayShare: steps ? stays / steps : 0,
    onTargetShare: located ? on / located : 0,
    besideShare: located ? beside / located : 0,
  };
}

/**
 * Gentle "huh, interesting" notes when behaviour and rules seem to disagree.
 * Heuristics, phrased as curiosities — never errors.
 */
export function curiosities(stage: StageSpec, s: BehaviorSummary, petName: string): string[] {
  const out: string[] = [];
  const top = s.rewardShare[0];
  const enders = new Set(stage.rules.filter((r) => Array.isArray(r.args.then) && (r.args.then as { cardId: string }[]).some((e) => e.cardId === 'eff.end')).map((r) => String(r.args.label ?? '')));
  if (top && top.share > 0.8 && !enders.has(top.label)) {
    out.push(`${Math.round(top.share * 100)}% of ${petName}'s treats in “${stage.name}” came from “${top.label}”, not from finishing the task.`);
  }
  if (s.stayShare > 0.5) out.push(`${petName} spent ${Math.round(s.stayShare * 100)}% of “${stage.name}” standing still. Patient — or just comfy?`);
  const reachish = stage.outcome !== 'survive' && stage.learner.template !== 'routine';
  if (reachish && s.besideShare > 0.35 && s.besideShare > 2 * s.onTargetShare) {
    out.push(`In “${stage.name}”, ${petName} hangs around right next to the ${stage.learner.focus} far more than on it (${Math.round(s.besideShare * 100)}% vs ${Math.round(s.onTargetShare * 100)}% of the time).`);
  }
  if (s.endings.success / Math.max(1, s.episodes) > 0.7 && s.meanTicks > 0.8 * stage.maxTicks) {
    out.push(`${petName} usually succeeds at “${stage.name}”, but only near the end of the time limit — dawdling, or just thorough?`);
  }
  const moves = ['N', 'E', 'S', 'W'].map((a) => s.actions[a] ?? 0);
  const moveTotal = moves.reduce((a, b) => a + b, 0);
  if (moveTotal > 0.3 && Math.max(...moves) / moveTotal > 0.7) {
    const dir = ['north', 'east', 'south', 'west'][moves.indexOf(Math.max(...moves))];
    out.push(`${petName} walks ${dir} a lot in “${stage.name}” (${Math.round((100 * Math.max(...moves)) / moveTotal)}% of moves). Maybe the target is usually that way in this pen?`);
  }
  return out;
}
