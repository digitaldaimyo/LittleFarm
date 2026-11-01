import { Rng } from '../sim/rng';

/**
 * Tiny executive: chooses which behavior to run at option boundaries.
 * Two interchangeable selectors share one invocation contract:
 *   - a deterministic rules baseline
 *   - a locally trained contextual bandit (tabular, ε-greedy, running means)
 */
export type BehaviorId = 'forage' | 'deliver' | 'rest' | 'wander' | 'manual' | 'skill' | 'catch';

export interface Invocation {
  behaviorId: BehaviorId;
  args: Record<string, string>;
  intention: string;
  timeout: number;
  chosenBy: 'player' | 'rules' | 'learned';
}

export interface ExecContext {
  energyLow: boolean;
  berry: boolean;
  carrot: boolean;
  carrying: boolean;
  recentFail: boolean;
  /** Added with day/night: optional so older code paths still type-check. */
  night?: boolean;
  firefly?: boolean;
}

export interface ExecutiveTable {
  /** contextKey|behavior → running mean reward and count */
  [key: string]: { n: number; v: number };
}

export function contextKey(c: ExecContext): string {
  return `${+c.energyLow}${+c.berry}${+c.carrot}${+c.carrying}${+c.recentFail}${+!!c.night}${+!!c.firefly}`;
}

export function describeContext(c: ExecContext): string {
  const p: string[] = [];
  p.push(c.night ? 'night' : 'day');
  p.push(c.energyLow ? 'tired' : 'rested');
  if (c.carrying) p.push('carrying something');
  if (c.berry) p.push('berries ripe');
  if (c.carrot) p.push('carrots/eggs ready');
  if (c.firefly) p.push('fireflies out');
  if (c.recentFail) p.push('just had a setback');
  return p.join(', ');
}

export function rulesSelect(c: ExecContext, eligible: BehaviorId[]): BehaviorId {
  const has = (b: BehaviorId) => eligible.includes(b);
  if (c.energyLow && has('rest')) return 'rest';
  if (c.night && c.firefly && has('catch')) return 'catch';
  if (c.night && !c.carrying && has('rest')) return 'rest'; // pets prefer sleeping at night
  if (c.carrying && has('deliver')) return 'deliver';
  if (c.carrot && has('deliver')) return 'deliver';
  if (c.berry && has('forage')) return 'forage';
  if (has('wander') && !c.energyLow) return 'wander';
  return 'rest';
}

export function learnedSelect(c: ExecContext, eligible: BehaviorId[], table: ExecutiveTable, rng: Rng, curiosity: number): { choice: BehaviorId; explored: boolean } {
  const eps = 0.05 + 0.25 * curiosity;
  if (rng.next() < eps) return { choice: eligible[rng.int(eligible.length)], explored: true };
  const k = contextKey(c);
  let best = eligible[0];
  let bv = -Infinity;
  for (const b of eligible) {
    const e = table[`${k}|${b}`];
    const v = e ? e.v : 1.0; // optimistic for untried behaviors
    if (v > bv) { bv = v; best = b; }
  }
  return { choice: best, explored: false };
}

export function updateExecutive(table: ExecutiveTable, c: ExecContext, b: BehaviorId, reward: number): void {
  const key = `${contextKey(c)}|${b}`;
  const e = table[key] ?? { n: 0, v: 0 };
  e.n++;
  e.v += (reward - e.v) / Math.min(e.n, 30);
  table[key] = e;
}

export const BEHAVIOR_LABEL: Record<BehaviorId, string> = {
  forage: 'Forage berries',
  deliver: 'Deliver carrots & eggs',
  rest: 'Nap',
  wander: 'Wander',
  manual: 'Follow your lead',
  skill: 'Run a skill',
  catch: 'Catch fireflies',
};
