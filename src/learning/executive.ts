import { Rng } from '../sim/rng';

/**
 * Tiny executive: chooses which behavior to run at option boundaries.
 * The deterministic choice is the responsibility executive (game/plan.ts, `chooseDuty`; it replaced the old rule
 * list in learned-farm phase 4). This file keeps the shared invocation contract and the learned bandit (phase 5
 * replaces it).
 */
export type BehaviorId = 'forage' | 'deliver' | 'rest' | 'wander' | 'manual' | 'skill' | 'catch' | 'goto' | 'gate' | 'plant' | 'tote';

export interface Invocation {
  behaviorId: BehaviorId;
  args: Record<string, string>;
  intention: string;
  timeout: number;
  chosenBy: 'player' | 'rules' | 'learned' | 'plan';
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
  /** Farm life: a basket or shed is at least half full (haul before harvesting more). */
  storeHalf?: boolean;
  /** Farm life: empty soil whose seed can be afforded. */
  soil?: boolean;
  /** Baskets: the pet is holding a basket. */
  basket?: boolean;
  /** Baskets: a basket run would help (one at least half full, or an empty one away from the crops). */
  tote?: boolean;
}

export interface ExecutiveTable {
  /** contextKey|behavior → running mean reward and count */
  [key: string]: { n: number; v: number };
}

export function contextKey(c: ExecContext): string {
  return `${+c.energyLow}${+c.berry}${+c.carrot}${+c.carrying}${+c.recentFail}${+!!c.night}${+!!c.firefly}${c.soil ? 's' : ''}${c.basket ? 'b' : ''}${c.tote ? 't' : ''}`; // (soil appended only when present, so older tables keep their keys)
}

export function describeContext(c: ExecContext): string {
  const p: string[] = [];
  p.push(c.night ? 'night' : 'day');
  p.push(c.energyLow ? 'tired' : 'rested');
  if (c.carrying) p.push('carrying something');
  if (c.berry) p.push('something ripe');
  if (c.carrot) p.push(c.storeHalf ? 'storage filling up' : 'goods to haul');
  if (c.soil) p.push('empty soil');
  if (c.firefly) p.push('fireflies out');
  if (c.recentFail) p.push('just had a setback');
  return p.join(', ');
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
  forage: 'Harvest',
  tote: 'Basket run',
  deliver: 'Haul to the house',
  plant: 'Plant',
  rest: 'Nap',
  wander: 'Wander',
  manual: 'Follow your lead',
  skill: 'Run a skill',
  catch: 'Catch fireflies',
  goto: 'Go to',
  gate: 'Mind the gate',
};
