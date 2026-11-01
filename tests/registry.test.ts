import { describe, expect, it } from 'vitest';
import { RECIPES, recipeStage } from '../src/domain/recipes';
import { validateStage, hasErrors } from '../src/domain/validate';
import { REGISTRY } from '../src/domain/registry';
import { buildHand } from '../src/domain/hand';
import { fits, generic, nominal } from '../src/domain/typecheck';
import { node } from '../src/domain/spec';

describe('typed registry', () => {
  it('starter recipes validate without errors', () => {
    for (const r of RECIPES) expect(validateStage(r.build()).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('generic trait constraints', () => {
    expect(fits(generic('Kind', 'Carryable'), generic('Kind', 'Carryable', 'Crop'))).toBe(true);
    expect(fits(generic('Kind', 'Carryable'), generic('Kind', 'Solid'))).toBe(false);
    expect(fits(nominal('Kind'), generic('Kind', 'Solid'))).toBe(true);
    expect(fits(nominal('Event'), nominal('Effect'))).toBe(false);
  });

  it('rejects invalid socket types with a clear message', () => {
    const s = recipeStage('go-to-berry');
    s.rules[0].args.when = node('eff.reward', { amount: 1 });
    const d = validateStage(s);
    expect(hasErrors(d)).toBe(true);
    expect(d.find((x) => x.code === 'type-mismatch')?.message).toMatch(/needs a Event/);
  });

  it('rejects picking up a rock (trait mismatch)', () => {
    const s = recipeStage('bring-it-home');
    s.rules.push(node('rule', { label: 'x', when: node('ev.pickup', { actor: node('actor.pet'), what: node('kind:rock') }), then: [node('eff.reward', { amount: 1 })] }));
    expect(validateStage(s).some((d) => d.code === 'type-mismatch')).toBe(true);
  });

  it('rejects missing references and out-of-scope “it”', () => {
    const s = recipeStage('go-to-berry');
    s.rules.push(node('rule', { label: 'carrot', when: node('ev.reach', { actor: node('actor.pet'), what: node('kind:bin') }), then: [node('eff.reward', { amount: 1 })] }));
    s.rules.push(node('rule', { label: 'it', when: node('ev.tick'), if: [node('cond.itNear', { object: node('ref.it'), what: node('kind:berry'), dist: 1 })], then: [node('eff.reward', { amount: 1 })] }));
    const d = validateStage(s);
    expect(d.some((x) => x.code === 'missing-reference' && /Basket/.test(x.message))).toBe(true);
    expect(d.some((x) => x.code === 'scope')).toBe(true);
  });

  it('flags the exploitable recipe with a repair suggestion', () => {
    const d = validateStage(recipeStage('pay-per-pickup'));
    const w = d.find((x) => x.code === 'repeatable-reward');
    expect(w?.severity).toBe('warning');
    expect(w?.repair?.action).toBe('limit-per-object');
  });

  it('builds a deterministic compatible → available → relevant hand', () => {
    const stage = recipeStage('bring-it-home');
    const ctx = { socket: generic('Kind', 'Carryable'), stage, unlocks: new Set<string>(), recent: [], favorites: [], itBound: false, placing: false };
    const a = buildHand(REGISTRY, ctx);
    const b = buildHand(REGISTRY, ctx);
    expect(a).toEqual(b);
    const ids = a.recommended.map((c) => c.card.id);
    expect(ids[0]).toBe('kind:berry');
    expect(ids).not.toContain('kind:rock');
    const all = [...a.recommended, ...Object.values(a.bySheet).flat()];
    const carrot = all.find((c) => c.card.id === 'kind:carrot');
    expect(carrot?.status).toBe('locked');
    expect(carrot?.reason).toMatch(/Unlock/);
    expect(a.recommended.length).toBeGreaterThanOrEqual(1);
    expect(a.recommended.length).toBeLessThanOrEqual(7);
  });
});
