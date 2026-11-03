/**
 * Pen & cards roadmap, phase 4: where the card picker goes after a pick (it jumps into required slots, depth first,
 * and closes when nothing required is left).
 */
import { describe, expect, it } from 'vitest';
import { node } from '../src/domain/spec';
import { nextEmptySlot, setSlot } from '../src/ui/edit';
import { store } from '../src/ui/store';
import { recipeStage } from './helpers';

describe('the picker jumps into required slots', () => {
  it('a card with an empty required slot: jump into it; a full one: nothing left (close)', () => {
    const st = recipeStage('go-to-berry');
    const r = node('rule', { label: 'r', then: [] });
    st.rules.push(r);
    const slot = { parentId: r.id, socket: 'when', index: null };
    const ev = node('ev.pickup');
    expect(nextEmptySlot(st, slot, ev, null)).toEqual({ parentId: ev.id, socket: 'actor', index: null }); // depth first: Who, then What
    const full = node('ev.tick');
    expect(nextEmptySlot(st, slot, full, null)).toBeNull();
  });

  it('nested: Compare → Measure (Stored) → What, then back up the chain; optional slots never hold it open', () => {
    const st = recipeStage('go-to-berry');
    const r = node('rule', { label: 'r', when: node('ev.tick'), if: [], then: [node('eff.reward', { amount: 1 })] });
    st.rules.push(r);
    const ifSlot = { parentId: r.id, socket: 'if', index: null };
    const cmp = node('cond.compare', { op: '>=', value: 3 });
    const at1 = nextEmptySlot(st, ifSlot, cmp, null)!;
    expect(at1).toEqual({ parentId: cmp.id, socket: 'quantity', index: null });
    const root = setSlot(st, ifSlot, cmp); // the chain began here
    const stored = node('q.stored');
    const at2 = nextEmptySlot(st, at1, stored, root)!;
    expect(at2).toEqual({ parentId: stored.id, socket: 'what', index: null }); // “In this one” is optional: skipped
    setSlot(st, at1, stored);
    expect(nextEmptySlot(st, at2, node('kind:berry'), root)).toBeNull(); // Compare's “Than” is optional too: done
  });

  it('back up the chain: after finishing one required slot, the next empty required slot of the first card', () => {
    const st = recipeStage('go-to-berry');
    const r = node('rule', { label: 'r', then: [] });
    st.rules.push(r);
    const when = { parentId: r.id, socket: 'when', index: null };
    const at = node('cond.at'); // Who and What, both required
    st.success = null;
    const succ = { parentId: '#success', socket: 'success', index: null };
    const root = setSlot(st, succ, at);
    const s1 = nextEmptySlot(st, succ, at, root)!;
    expect(s1.socket).toBe('actor');
    expect(nextEmptySlot(st, s1, node('actor.pet'), root)).toEqual({ parentId: at.id, socket: 'what', index: null }); // back up to What
    void when;
  });

  it('tapping a slot by hand starts afresh (no chain, the full hand)', () => {
    store.setUi({ slot: { parentId: 'x', socket: 'y', index: null }, pickRoot: { parentId: 'r', socket: 's', index: null }, sleeveCompact: true });
    expect(store.ui.pickRoot).toEqual({ parentId: 'r', socket: 's', index: null });
    store.setUi({ slot: { parentId: 'a', socket: 'b', index: null } });
    expect(store.ui.pickRoot).toBeNull();
    expect(store.ui.sleeveCompact).toBe(false);
    store.setUi({ slot: null });
  });
});
