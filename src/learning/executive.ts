import { Rng } from '../sim/rng';

/**
 * Tiny executive: chooses which behavior to run at option boundaries.
 * Two interchangeable selectors share one invocation contract:
 *   - a deterministic rules baseline
 *   - a locally trained contextual bandit (tabular, ε-greedy, running means)
 */
export type BehaviorId = 'forage' | 'deliver' | 'rest' | 'wander' | 'manual' | 'skill' | 'catch' | 'goto' | 'gate' | 'plant';

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
}

export interface ExecutiveTable {
  /** contextKey|behavior → running mean reward and count */
  [key: string]: { n: number; v: number };
}

export function contextKey(c: ExecContext): string {
  return `${+c.energyLow}${+c.berry}${+c.carrot}${+c.carrying}${+c.recentFail}${+!!c.night}${+!!c.firefly}${c.soil ? 's' : ''}`; // (soil appended only when present, so older tables keep their keys)
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

export function rulesSelect(c: ExecContext, eligible: BehaviorId[]): BehaviorId {
  const has = (b: BehaviorId) => eligible.includes(b);
  if (c.energyLow && has('rest')) return 'rest';
  if (c.night && c.firefly && has('catch')) return 'catch';
  if (c.night && !c.carrying && has('rest')) return 'rest'; // pets prefer sleeping at night
  // Farm life: "berry" = something ripe to harvest, "carrot" = goods to haul (eggs or stored produce).
  if (c.carrying && has('deliver')) return 'deliver';
  if (c.carrying && has('forage')) return 'forage'; // no Fetch yet: carry the harvest home
  if (c.storeHalf && has('deliver')) return 'deliver';
  if (c.soil && has('plant')) return 'plant'; // sow first: a seed in the ground is growing while you harvest
  if (c.berry && has('forage')) return 'forage';
  if (c.carrot && has('deliver')) return 'deliver';
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
  forage: 'Harvest',
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
