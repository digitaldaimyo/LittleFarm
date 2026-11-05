/**
 * The in-game card reference (polish phase 4): every card, where it fits and a one-line example, searchable by title
 * or hint. Built from the registry, as docs/CARD_REFERENCE.md is, so it can't drift from the cards themselves.
 */
import type { CardDef, SpecNode, TypeExpr } from './types';
import { REGISTRY } from './registry';
import { fits } from './typecheck';
import { node } from './spec';
import { describe } from './describe';

/** Where a card of each output type goes, in the player's words. */
const FITS: Record<string, string> = {
  Kind: 'Any slot that names a thing (what, where, aimed at)',
  Actor: 'Who does it: your pet',
  Area: 'A slot that names a zone (in the coop…)',
  Object: 'A slot that names a thing, to pick one particular object',
  Placement: 'Teach → Environment (what is in the pen, and where)',
  Rule: 'Teach → Rules',
  Event: 'A rule’s WHEN',
  Condition: 'A rule’s IF, SUCCESS or FAIL, a routine’s Watches, a responsibility’s WHEN or UNTIL',
  Sense: 'Teach → Pet → Senses',
  Option: 'Teach → Pet → a routine’s options',
  Responsibility: 'Farm → Edit responsibilities',
  Job: 'A responsibility’s USE or OR USE',
  Quantity: 'Inside Compare (its Measure, or Than)',
  Effect: 'A rule’s THEN',
  Limit: 'A rule’s LIMIT',
};

export interface CardEntry {
  id: string;
  title: string;
  sheet: string;
  hint: string;
  fits: string;
  example: string;
}

/** Sample fillings for the example, preferred in this order when they fit a slot. */
const SAMPLES = ['actor.pet', 'kind:berry', 'kind:bin', 'kind:home', 'kind:chicken', 'kind:well', 'kind:soil', 'area.named', 'q.stored', 'ev.pickup', 'cond.carryingAny', 'eff.reward', 'opt.action'];

function sampleFor(t: TypeExpr, depth: number): SpecNode | null {
  const cards = [...REGISTRY.cards.values()].filter((c) => !c.retired && fits(t, c.output));
  const pick = SAMPLES.map((id) => cards.find((c) => c.id === id)).find(Boolean) ?? cards.find((c) => c.sockets.every((s) => !s.required)) ?? cards[0];
  return pick ? example(pick, depth + 1) : null;
}

/** The card with its settings at their defaults and its required slots filled with simple cards. */
export function example(card: CardDef, depth = 0): SpecNode {
  const n = node(card.id);
  for (const p of card.params ?? []) n.args[p.id] = p.default;
  for (const s of card.sockets) {
    if (!s.required || depth > 2) { if (s.many) n.args[s.id] = []; continue; }
    const v = sampleFor(s.type, depth);
    if (v) n.args[s.id] = s.many ? [v] : v;
  }
  if (card.id === 'rule' || card.id === 'plan.responsibility') n.args.label = 'Example';
  return n;
}

let entries: CardEntry[] | null = null;
/** Every card players can use (not retired), by sheet then title. */
export function cardEntries(): CardEntry[] {
  return (entries ??= [...REGISTRY.cards.values()]
    .filter((c) => !c.retired)
    .map((c) => ({
      id: c.id,
      title: c.presentation.title,
      sheet: c.presentation.sheet,
      hint: c.presentation.hint ?? '',
      fits: FITS[c.output.name] ?? c.output.name,
      example: describe(example(c), { petName: 'Pip' }),
    }))
    .sort((a, b) => a.sheet.localeCompare(b.sheet) || a.title.localeCompare(b.title)));
}

/** Cards whose title, hint or sheet has every word of the query (any case). An empty query lists them all. */
export function searchCards(query: string): CardEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return cardEntries();
  return cardEntries().filter((e) => {
    const text = `${e.title} ${e.hint} ${e.sheet}`.toLowerCase();
    return words.every((w) => text.includes(w));
  }).sort((a, b) => Number(!a.title.toLowerCase().includes(words[0])) - Number(!b.title.toLowerCase().includes(words[0])));
}
