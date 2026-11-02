import type { CardDef, StageSpec, TypeExpr } from './types';
import type { Registry } from './registry';
import { kindOfCard } from './registry';
import { fits } from './typecheck';
import { effectiveOutput } from './validate';
import { placedKinds } from './spec';

/** Unlock ids sold in the shop (kept here to avoid a domain → game import). */
const SHOP_UNLOCKS = new Set(['trees', 'fences', 'bed', 'chickens']);
/** Unlocked by placing one on the farm (Layout). */
const LAYOUT_UNLOCKS = new Set(['scarecrow', 'pumpkins', 'sunflowers']);

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
  /** Which part of the lesson the slot belongs to (ranks cards that make sense there). */
  role?: SlotRole;
}

export type SlotRole = 'success' | 'fail' | 'when' | 'if' | 'then' | 'sense' | 'other';

/** The ability an event needs (events your pet can't cause rank low; ones only it can cause rank high). */
export const EVENT_ABILITY: Record<string, string> = {
  'ev.shoo': 'shoo', 'ev.pickup': 'pickup', 'ev.drop': 'drop', 'ev.deliver': 'drop', 'ev.stay': 'stay', 'ev.fill': 'water', 'ev.water': 'water', 'ev.gate': 'nudge', 'ev.plant': 'plant', 'ev.lift': 'lift',
  'ev.reach': 'move', 'ev.enter': 'move', 'ev.bump': 'move',
};

/** "More cards" sub-groups for conditions, so a long list reads as a few short ones. */
const COND_GROUP: Record<string, string> = {
  'cond.at': 'Where', 'cond.near': 'Where', 'cond.nextTo': 'Where', 'cond.kindNear': 'Where', 'cond.farFrom': 'Where', 'cond.itNear': 'Where', 'cond.closer': 'Where', 'cond.petInArea': 'Where', 'cond.inArea': 'Where', 'cond.allInArea': 'Where',
  'cond.happened': 'Has happened', 'cond.just': 'Has happened', 'cond.delivered': 'Has happened', 'cond.watered': 'Has happened', 'cond.stayedFor': 'Has happened', 'cond.compare': 'Has happened',
  'cond.carrying': 'Your pet', 'cond.carryingAny': 'Your pet', 'cond.canAfford': 'Your pet', 'cond.storage': 'Time and world', 'cond.hasWater': 'Your pet', 'cond.energyBelow': 'Your pet',
  'cond.night': 'Time and world', 'cond.raining': 'Time and world', 'cond.gates': 'Time and world', 'cond.time': 'Time and world',
  'cond.and': 'Combine', 'cond.any': 'Combine', 'cond.not': 'Combine',
};
const GROUP_ORDER = ['Combine', 'Has happened', 'Where', 'Your pet', 'Time and world'];

/** Contextual nudges: abilities, the slot's role, and whether the pen has what a card talks about. */
function contextScore(reg: Registry, card: CardDef, ctx: HandContext, placedTraits: Set<string>): number {
  const abilities = new Set(ctx.stage.abilities);
  const actsBeyondMoving = ctx.stage.abilities.some((a) => a !== 'move');
  const template = ctx.stage.learner.template ?? 'sense';
  let s = 0;
  const need = EVENT_ABILITY[card.id];
  if (need && template === 'sense') {
    if (!abilities.has(need)) s -= 5;
    else if (need !== 'move') s += 7; // the thing this lesson is about
  }
  if (card.id === 'cond.happened') s += actsBeyondMoving ? (ctx.role === 'success' ? 9 : 4) : 0;
  if (card.id === 'cond.just' && (ctx.role === 'success' || ctx.role === 'fail')) s -= 3;
  if (card.id === 'cond.closer' && (ctx.role === 'success' || ctx.role === 'fail')) s -= 6; // "got closer" only means something on a step
  if (card.id === 'sense.did') s += walkAny(ctx.stage, (id) => id === 'cond.happened') ? 6 : -2;
  // Notes: once the rules write a note, reading it is the natural next sense (and testing it the natural condition).
  if (card.id === 'sense.note' || card.id === 'cond.note') s += walkAny(ctx.stage, (id) => id === 'eff.note') ? 8 : -1;
  if ((card.id === 'cond.and' || card.id === 'cond.any') && (ctx.role === 'success' || ctx.role === 'fail')) s += 1;
  // Cards that need a kind of thing the pen doesn't have (e.g. "Has delivered" with nothing carryable).
  for (const sock of card.sockets ?? []) {
    if (!sock.required || sock.type.kind !== 'generic' || sock.type.name !== 'Kind') continue;
    const traits = sock.type.args.map((t) => (t.kind === 'nominal' ? t.name : ''));
    if (traits.length && !traits.every((t) => placedTraits.has(t))) { s -= 6; break; }
  }
  void reg;
  return s;
}

function walkAny(stage: StageSpec, pred: (cardId: string) => boolean): boolean {
  const visit = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(visit);
    if (!v || typeof v !== 'object') return false;
    const o = v as { cardId?: string; args?: Record<string, unknown> };
    if (o.cardId && pred(o.cardId)) return true;
    return !!o.args && Object.values(o.args).some(visit);
  };
  return visit(stage.rules) || visit(stage.success) || visit(stage.fail);
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
  kind: 5, actor: 9, sense: 6, job: 8, event: 5, condition: 4, effect: 5, limit: 4, quantity: 3, reference: 2, placement: 4, rule: 4,
};

const STARTER_FAVORS: Record<string, number> = {
  'ev.reach': 4, 'eff.reward': 4, 'eff.end': 3, 'ev.tick': 2, 'eff.penalty': 2, 'cond.at': 4, 'lim.perObject': 3, 'lim.once': 2,
  'ev.deliver': 2, 'cond.delivered': 2, 'ev.enter': 1, 'ev.pickup': 1,
  'ref.target': 3, 'sense.nearest': 3, 'sense.blocked': 2, 'sense.still': 2, 'sense.distance': 2, 'ev.stay': 1,
};

/**
 * Contextual hand: compatible (type fits) → available (inputs/references exist) →
 * relevant (ranked by context, recency, favorites). Deterministic for a given context.
 */
export function buildHand(reg: Registry, ctx: HandContext): Hand {
  const placed = placedKinds(ctx.stage);
  const placedTraits = new Set<string>();
  for (const k of placed) for (const t of reg.objects.get(k)?.traits ?? []) placedTraits.add(t);
  const all: HandCard[] = [];
  for (const card of reg.cards.values()) {
    if (!fits(ctx.socket, effectiveOutput(reg, card, ctx.stage.learner.focus))) continue;
    if (ctx.placing && card.presentation.group === 'reference') continue;
    let status: HandCard['status'] = 'available';
    let reason: string | undefined;
    const kind = kindOfCard(card.id);
    const obj = kind ? reg.objects.get(kind) : undefined;
    if (card.unlock && !ctx.unlocks.has(card.unlock)) {
      status = 'locked';
      reason = SHOP_UNLOCKS.has(card.unlock) ? `Unlock “${card.presentation.title}” in the farm shop.` : LAYOUT_UNLOCKS.has(card.unlock) ? `Place one on your farm (Farm → Layout) to use it in pens.` : `Unlocks as your farm grows (${card.unlock === 'carrots' ? 'certify Fetch' : 'keep playing'}).`;
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
    if (!ctx.placing) score += contextScore(reg, card, ctx, placedTraits);
    if (status === 'locked') score -= 100;
    all.push({ card, status, reason, score });
  }
  all.sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
  const avail = all.filter((c) => c.status === 'available');
  const nRec = Math.min(7, Math.max(Math.min(3, avail.length), avail.filter((c) => c.score >= 8).length));
  const recommended = avail.slice(0, nRec);
  const recIds = new Set(recommended.map((c) => c.card.id));
  // "More cards": short sub-groups in a fixed order, alphabetical inside (available first), so a card is
  // always in the same place no matter how the recommendations shuffle.
  const sheetOf = (c: HandCard) => (COND_GROUP[c.card.id] ? `${c.card.presentation.sheet} · ${COND_GROUP[c.card.id]}` : c.card.presentation.sheet);
  const rest = all.filter((c) => !recIds.has(c.card.id));
  const rank = (sheet: string) => { const i = GROUP_ORDER.findIndex((g) => sheet.endsWith(`· ${g}`)); return i < 0 ? 99 : i; };
  rest.sort((a, b) => rank(sheetOf(a)) - rank(sheetOf(b)) || sheetOf(a).localeCompare(sheetOf(b)) || (a.status === b.status ? 0 : a.status === 'locked' ? 1 : -1) || a.card.presentation.title.localeCompare(b.card.presentation.title));
  const bySheet: Record<string, HandCard[]> = {};
  for (const c of rest) (bySheet[sheetOf(c)] ??= []).push(c);
  return { recommended, bySheet, total: all.length };
}
