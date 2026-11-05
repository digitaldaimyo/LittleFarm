/** Building blocks for recipes (split from recipes.ts, polish phase 3): seeds kept for evaluation, and a card maker. */
import type { SpecNode } from './types';
import { idFactory } from './spec';

/** Held-out evaluation seeds live in [900000, 999999]; training seeds are always < 800000. */
export const EVAL_SEED_BASE = 900000;

export const TRANSFER_SEED_BASE = 950000;

export function evalSeeds(n: number, base = EVAL_SEED_BASE): number[] {
  return Array.from({ length: n }, (_, i) => base + 1 + i * 7);
}

type Mk = (cardId: string, args?: SpecNode['args']) => SpecNode;

export function maker(prefix: string): Mk {
  const id = idFactory(prefix);
  return (cardId, args = {}) => ({ id: id(), cardId, args });
}

export const pet = (n: Mk) => n('actor.pet');

export const k = (n: Mk, kind: string) => n(`kind:${kind}`);

export const coopArea = (n: Mk) => n('area.named', { name: 'coop' });
