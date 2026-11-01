import { describe, expect, it } from 'vitest';
import { recipeStage } from '../src/domain/recipes';
import { REGISTRY } from '../src/domain/registry';
import { buildHand } from '../src/domain/hand';
import { nominal } from '../src/domain/typecheck';
import { createNode, setSlot, slotInfo, slotInSenses } from '../src/ui/edit';

describe('editing senses (regression: the hand vanished after picking “How far is…”)', () => {
  it('keeps the sense editor’s hand open for slots inside a sense card, and fills them', () => {
    const st = recipeStage('wait-for-it');
    // Pick “How far is…” into a new sense slot, as the hand does.
    const sense = createNode('sense.distance');
    const added = setSlot(st, { parentId: '#senses', socket: 'senses', index: null }, sense);
    expect(added?.index).toBe(st.learner.senses!.length - 1);
    // Focus then moves to its empty “What” slot — still part of the senses editor.
    const what = { parentId: sense.id, socket: 'what', index: null };
    expect(slotInSenses(st, what)).toBe(true);
    expect(slotInfo(st, what)?.socket.type).toEqual(nominal('Kind'));
    // The hand offers Rock (placed in this pen), and choosing it fills the sense.
    const hand = buildHand(REGISTRY, { socket: nominal('Kind'), stage: st, unlocks: new Set(), recent: [], favorites: [], itBound: false, placing: false });
    expect([...hand.recommended, ...Object.values(hand.bySheet).flat()].find((h) => h.card.id === 'kind:rock')?.status).toBe('available');
    setSlot(st, what, createNode('kind:rock'));
    expect((sense.args.what as { cardId: string }).cardId).toBe('kind:rock');
    // Slots elsewhere (rules) are not the senses editor's business.
    expect(slotInSenses(st, { parentId: st.rules[0].id, socket: 'when', index: null })).toBe(false);
  });

  it('recommends the senses the Field Guide asks for (Patience, How far is…) without opening “More cards”', () => {
    const st = recipeStage('wait-for-it');
    const hand = buildHand(REGISTRY, { socket: nominal('Sense'), stage: st, unlocks: new Set(), recent: [], favorites: [], itBound: false, placing: false });
    const ids = hand.recommended.map((h) => h.card.id);
    expect(ids).toContain('sense.still');
    expect(ids).toContain('sense.distance');
  });
});
