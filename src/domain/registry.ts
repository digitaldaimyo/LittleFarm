import type { CardDef, ObjectDef } from './types';
import { FARM_CARDS, FARM_OBJECTS } from './packs/farm';

export interface Registry {
  cards: Map<string, CardDef>;
  objects: Map<string, ObjectDef>;
  packs: { id: string; version: number }[];
}

export function createRegistry(cards: CardDef[] = FARM_CARDS, objects: ObjectDef[] = FARM_OBJECTS): Registry {
  const map = new Map<string, CardDef>();
  for (const c of cards) {
    if (map.has(c.id)) throw new Error(`Duplicate card id ${c.id}`);
    map.set(c.id, c);
  }
  const packs = [...new Map(cards.map((c) => [c.pack, { id: c.pack, version: c.version }])).values()];
  return { cards: map, objects: new Map(objects.map((o) => [o.id, o])), packs };
}

export const REGISTRY = createRegistry();

export function kindOfCard(cardId: string): string | null {
  return cardId.startsWith('kind:') ? cardId.slice(5) : null;
}
