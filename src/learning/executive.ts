
/**
 * Tiny executive: chooses which behavior to run at option boundaries.
 * Choices are made by the responsibility executive (game/plan.ts, `chooseDuty`): in the player's order (phase 4) or
 * by learned values (phase 5; it replaced the old contextual bandit). This file keeps the shared invocation contract.
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
