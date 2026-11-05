
/**
 * Tiny executive: chooses which behavior to run at option boundaries.
 * Choices are made by the responsibility executive (game/plan.ts, `chooseDuty`): in the player's order (phase 4) or
 * by learned values (phase 5; it replaced the old contextual bandit). This file keeps the shared invocation contract.
 */
export type BehaviorId = 'harvest' | 'haul' | 'rest' | 'wander' | 'manual' | 'skill' | 'catch' | 'goto' | 'gate' | 'plant' | 'basketRun';

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

export function contextKey(c: ExecContext): string {
  return `${+c.energyLow}${+c.berry}${+c.carrot}${+c.carrying}${+c.recentFail}${+!!c.night}${+!!c.firefly}${c.soil ? 's' : ''}${c.basket ? 'b' : ''}${c.tote ? 't' : ''}`; // (soil appended only when present, so older tables keep their keys)
}

export const BEHAVIOR_LABEL: Record<BehaviorId, string> = {
  harvest: 'Harvest',
  basketRun: 'Basket run',
  haul: 'Haul to the house',
  plant: 'Plant',
  rest: 'Nap',
  wander: 'Wander',
  manual: 'Follow your lead',
  skill: 'Run a skill',
  catch: 'Catch fireflies',
  goto: 'Go to',
  gate: 'Mind the gate',
};
