import type { Action, World } from '../sim/world';
import { cloneWorld, isSolidAt, step } from '../sim/world';
import type { SensePolicy } from './policies';
import { legalActionIdx } from './senses';

/**
 * "What does Pip do when…?" — read the learned Q-values on every free tile of a layout.
 * Confidence = softmax probability of the chosen action among the legal ones (temperature 1),
 * so a big arrow means "clearly prefers this", a small one "could go either way".
 */
export interface ProbeCell {
  x: number;
  y: number;
  action: Action;
  confidence: number;
  /** True when the exact situation was never practised and a coarser view was used. */
  guessed: boolean;
  values: Partial<Record<Action, number>>;
}

export function probeTile(policy: SensePolicy, w: World, target: string): ProbeCell {
  const enc = policy.encoder(target);
  const v = enc.encode(w);
  let s = enc.index(v);
  let guessed = false;
  if (policy.q.visits[s] < 3) {
    guessed = true;
    for (const b of enc.backoffs(v)) { s = b; if (policy.q.visits[s] >= 3) break; }
  }
  const legal = legalActionIdx(w, policy.def.actions);
  const qs = legal.map((a) => policy.q.value(s, a));
  const best = legal[qs.indexOf(Math.max(...qs))];
  const m = Math.max(...qs);
  const exps = qs.map((q) => Math.exp(q - m));
  const z = exps.reduce((a, b) => a + b, 0);
  const values: Partial<Record<Action, number>> = {};
  legal.forEach((a, i) => { values[policy.def.actions[a]] = Math.round(qs[i] * 100) / 100; });
  return { x: w.pet.x, y: w.pet.y, action: policy.def.actions[best], confidence: exps[qs.indexOf(m)] / z, guessed, values };
}

/** The choice on every free tile (pet keeps its current heading/carrying/water). */
export function probeField(policy: SensePolicy, world: World, target: string): ProbeCell[] {
  const out: ProbeCell[] = [];
  const w = cloneWorld(world);
  for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
    if (isSolidAt(w, x, y)) continue;
    w.pet.x = x;
    w.pet.y = y;
    out.push(probeTile(policy, w, target));
  }
  return out;
}

/** Follow the greedy policy from the pet's current spot for up to `n` steps (no rules, just movement). */
export function probePath(policy: SensePolicy, world: World, target: string, n = 30): { x: number; y: number }[] {
  const w = cloneWorld(world);
  const path = [{ x: w.pet.x, y: w.pet.y }];
  for (let i = 0; i < n; i++) {
    step(w, policy.act(w, target));
    path.push({ x: w.pet.x, y: w.pet.y });
  }
  return path;
}
