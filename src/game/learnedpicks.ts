/**
 * Learned picks (split from plan.ts, polish phase 3): the values a pet learns for which responsibility, and which
 * job for it, gets something done in each situation, weighted by the player's order; when it keeps exploring.
 */
import type { Pet } from './types';
import type { PlanRuntime } from './plan';

/** Learned executive values (phase 5): upper = which responsibility, lower = which job for it. Kept on the pet. */
export interface ExecValues {
  upper: Record<string, { q: number; n: number }>;
  lower: Record<string, { q: number; n: number }>;
  /** Farm ticks practised in executive lessons, and learning updates so far. */
  practised: number;
  updates: number;
}

/** Per-tick discount on what a job achieved: quicker progress is worth a little more. */
export const EXEC_GAMMA_PER_TICK = 0.995;

/** What progress on a responsibility is worth follows the player's order (higher in the list counts more). */
export const rankWeight = (index: number) => 1 / (1 + 0.15 * index);

/** Untrained values follow the player's order: each choice is assumed to work (so a new learner starts out like the fixed order). */
export const upperPrior = (index: number) => 0.8 * rankWeight(index);

export const LOWER_PRIOR = 0.8;

export const upperKey = (state: string, row: string) => `${state}|${row}`;

export const lowerKey = (state: string, row: string, job: string) => `${state}|${row}|${job}`;

export function execValues(p: Pet): ExecValues {
  return (p.executive.values ??= { upper: {}, lower: {}, practised: 0, updates: 0 });
}

/**
 * On the farm, learned picks try something else now and then (Curiosity: 1–5%) so they keep learning; the player can
 * turn that off (phase 6: exploring on the job cost 10–20% against a good order at the earlier 2–10%).
 */
export function deployExploreExec(p: Pet): number {
  return keepsLearning(p) ? 0.01 + 0.04 * p.traits.curiosity : 0;
}

/**
 * Does the pet keep trying other picks on the farm? The player's choice if they made one; otherwise yes until the
 * pet has practised in an executive lesson (pen & cards phase 5: exploring on the job cost 10–20% of a good order).
 */
export function keepsLearning(p: Pet): boolean {
  return p.executive.explore ?? !(p.executive.values?.practised ?? 0);
}

/**
 * Learn from the last finished job (an option-level value, duration-discounted): what choosing this responsibility
 * (upper) and this job for it (lower) in this situation achieved — progress and completion, measured in the world and
 * weighted by the responsibility's place in the list, times γ^ticks, minus a failure penalty. One-step (no
 * bootstrapping): with bootstrapped values, a quick job that achieves nothing (wandering) scored almost as well as a
 * productive one, and practice made the farm worse (measured; see the roadmap).
 */
export function learnFromPending(p: Pet, pr: PlanRuntime): void {
  const t = pr.pending;
  if (!t) return;
  pr.pending = undefined;
  const v = execValues(p);
  const upd = (tab: ExecValues['upper'], key: string, prior: number, target: number) => {
    const e = (tab[key] ??= { q: prior, n: 0 });
    e.n++;
    e.q += Math.max(0.1, 1 / (e.n + 1)) * (target - e.q);
  };
  upd(v.upper, upperKey(t.state, t.row), upperPrior(t.index), t.r);
  upd(v.lower, lowerKey(t.state, t.row, t.job), LOWER_PRIOR, t.r / rankWeight(t.index));
  v.updates++;
}
