import type { CardDef, StageSpec, TypeExpr } from './types';
import type { Registry } from './registry';
import { kindOfCard } from './registry';
import { fits } from './typecheck';
import { placedKinds } from './spec';

export interface HandContext {
  socket: TypeExpr;
  stage: StageSpec;
  unlocks: Set<string>;
  /** Most recent first. */
  recent: string[];
  favorites: string[];
  /** Is the scoped reference `it` bound here? */
  itBound: boolean;
  /** Placing into the environment (pen) rather than referencing in rules. */
  placing: boolean;
}

export interface HandCard {
  card: CardDef;
  status: 'available' | 'locked';
  reason?: string;
  score: number;
}

export interface Hand {
  /** 3–7 best available cards. */
  recommended: HandCard[];
  /** Remaining compatible cards grouped by sheet (available and locked). */
  bySheet: Record<string, HandCard[]>;
  total: number;
}

const GROUP_BASE: Record<string, number> = {
  kind: 5, actor: 9, event: 5, condition: 4, effect: 5, limit: 4, quantity: 3, reference: 2, placement: 4, rule: 4,
};

const STARTER_FAVORS: Record<string, number> = {
  'ev.reach': 4, 'eff.reward': 4, 'eff.end': 3, 'ev.tick': 2, 'eff.penalty': 2, 'cond.at': 4, 'lim.perObject': 3, 'lim.once': 2,
  'ev.deliver': 2, 'cond.delivered': 2, 'ev.enter': 1, 'ev.pickup': 1,
};

/**
 * Contextual hand: compatible (type fits) → available (inputs/references exist) →
 * relevant (ranked by context, recency, favorites). Deterministic for a given context.
 */
export function buildHand(reg: Registry, ctx: HandContext): Hand {
  const placed = placedKinds(ctx.stage);
  const all: HandCard[] = [];
  for (const card of reg.cards.values()) {
    if (!fits(ctx.socket, card.output)) continue;
    let status: HandCard['status'] = 'available';
    let reason: string | undefined;
    const kind = kindOfCard(card.id);
    const obj = kind ? reg.objects.get(kind) : undefined;
    if (card.unlock && !ctx.unlocks.has(card.unlock)) {
      status = 'locked';
      reason = `Unlock “${card.presentation.title}” in the farm shop.`;
    } else if (obj && ctx.placing && !obj.penPlaceable) {
      continue; // farm-only fixtures never appear in pen hands
    } else if (obj && !ctx.placing && !placed.has(obj.id)) {
      if (!obj.penPlaceable) continue;
      status = 'locked';
      reason = `Place a ${obj.name} in the pen first.`;
    } else if (card.id === 'ref.it' && !ctx.itBound) {
      status = 'locked';
      reason = '“It” needs a WHEN event about an object.';
    }
    let score = GROUP_BASE[card.presentation.group] ?? 1;
    score += STARTER_FAVORS[card.id] ?? 0;
    if (obj && placed.has(obj.id)) score += 6;
    if (obj && obj.id === ctx.stage.learner.focus) score += 4;
    if (obj && obj.id === ctx.stage.learner.destination) score += 3;
    const r = ctx.recent.indexOf(card.id);
    if (r >= 0) score += Math.max(0, 5 - r);
    if (ctx.favorites.includes(card.id)) score += 6;
    if (status === 'locked') score -= 100;
    all.push({ card, status, reason, score });
  }
  all.sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
  const avail = all.filter((c) => c.status === 'available');
  const nRec = Math.min(7, Math.max(Math.min(3, avail.length), avail.filter((c) => c.score >= 8).length));
  const recommended = avail.slice(0, nRec);
  const recIds = new Set(recommended.map((c) => c.card.id));
  const bySheet: Record<string, HandCard[]> = {};
  for (const c of all) {
    if (recIds.has(c.card.id)) continue;
    (bySheet[c.card.presentation.sheet] ??= []).push(c);
  }
  return { recommended, bySheet, total: all.length };
}
