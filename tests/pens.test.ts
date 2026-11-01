import { describe, expect, it } from 'vitest';
import { recipeStage } from '../src/domain/recipes';
import { node } from '../src/domain/spec';
import type { SpecNode, StageSpec } from '../src/domain/types';
import { validateStage } from '../src/domain/validate';
import { describe as say, describeRule } from '../src/domain/describe';
import { compileStage, generateWorld } from '../src/sim/compile';
import { step } from '../src/sim/world';

const SEEDS = Array.from({ length: 40 }, (_, i) => 5000 + i * 31);
const pen = (env: SpecNode[], tweak?: (s: StageSpec) => void): StageSpec => {
  const s = recipeStage('go-to-berry');
  s.environment = env;
  tweak?.(s);
  return s;
};
const scatter = (kind: string, args: Record<string, unknown> = {}) => node('place.random', { kind: node(`kind:${kind}`), count: 1, region: 'anywhere', ...(args as object) } as never);
const cheb = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const manh = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

describe('better pens: where things go', () => {
  it('“next to” puts the thing on one of the 8 tiles around one of those', () => {
    const st = pen([scatter('rock', { count: 2 }), scatter('berry', { region: 'nextTo', ref: node('kind:rock') })]);
    for (const seed of SEEDS) {
      const w = generateWorld(st, seed);
      const b = w.objects.find((o) => o.kind === 'berry')!;
      expect(w.objects.filter((o) => o.kind === 'rock').some((r) => cheb(r, b) === 1)).toBe(true);
    }
  });

  it('“away from” keeps a distance from every one of those; “far from the pet” from the pet', () => {
    const st = pen([scatter('pond'), scatter('berry', { region: 'awayFrom', ref: node('kind:pond') }), scatter('bin', { region: 'farFromPet' })]);
    for (const seed of SEEDS) {
      const w = generateWorld(st, seed);
      const b = w.objects.find((o) => o.kind === 'berry')!, p = w.objects.find((o) => o.kind === 'pond')!, bin = w.objects.find((o) => o.kind === 'bin')!;
      expect(manh(b, p)).toBeGreaterThanOrEqual(4);
      expect(manh(bin, w.pet)).toBeGreaterThanOrEqual(5);
    }
  });

  it('“inside” an area, and the pet can start inside an area or away from something', () => {
    const area = () => node('area.named', { name: 'coop' });
    const st = pen([node('zone.rect', { name: 'coop', where: 'random', x: 0, y: 0, w: 2, h: 2 }), node('place.pet', { mode: 'awayFrom', ref: node('kind:berry') }), scatter('berry'), scatter('chicken', { region: 'inArea', area: area() })]);
    const st2 = pen([node('zone.rect', { name: 'coop', where: 'random', x: 0, y: 0, w: 3, h: 2 }), node('place.pet', { mode: 'inArea', area: area() }), scatter('berry')]);
    for (const seed of SEEDS) {
      const w = generateWorld(st, seed);
      const a = w.areas![0];
      const c = w.objects.find((o) => o.kind === 'chicken')!;
      expect(c.x >= a.x && c.x < a.x + a.w && c.y >= a.y && c.y < a.y + a.h).toBe(true);
      expect(manh(w.pet, w.objects.find((o) => o.kind === 'berry')!)).toBeGreaterThanOrEqual(4);
      const w2 = generateWorld(st2, seed);
      const a2 = w2.areas![0];
      expect(w2.pet.x >= a2.x && w2.pet.x < a2.x + a2.w && w2.pet.y >= a2.y && w2.pet.y < a2.y + a2.h).toBe(true);
    }
  });

  it('counts that vary stay in range and really vary; “sometimes” appears on about half the tries', () => {
    const st = pen([scatter('berry'), scatter('rock', { count: 2, vary: 'more2' }), scatter('pond', { chance: 'sometimes' })]);
    const rocks = new Set<number>();
    let ponds = 0;
    for (const seed of SEEDS) {
      const w = generateWorld(st, seed);
      const n = w.objects.filter((o) => o.kind === 'rock').length;
      expect(n >= 2 && n <= 4).toBe(true);
      rocks.add(n);
      if (w.objects.some((o) => o.kind === 'pond')) ponds++;
    }
    expect(rocks.size).toBe(3);
    expect(ponds).toBeGreaterThan(SEEDS.length * 0.25);
    expect(ponds).toBeLessThan(SEEDS.length * 0.75);
  });

  it('pen size varies from 6×6 up to the chosen size; obstacles scale with the pen', () => {
    const st = pen([scatter('berry'), node('place.obstacles', { amount: 'some', kind: 'rocks' })], (s) => { s.size = { w: 10, h: 10 }; s.varySize = true; });
    const sizes = new Set<number>();
    for (const seed of SEEDS) {
      const w = generateWorld(st, seed);
      expect(w.w).toBe(w.h);
      expect(w.w >= 6 && w.w <= 10).toBe(true);
      sizes.add(w.w);
      expect(w.objects.filter((o) => o.kind === 'rock').length).toBe(Math.round(w.w * w.h * 0.1));
    }
    expect(sizes.size).toBeGreaterThanOrEqual(4);
    const mixed = generateWorld(pen([scatter('berry'), node('place.obstacles', { amount: 'many', kind: 'mixed' })]), 1);
    expect(mixed.objects.some((o) => o.kind === 'fence') && mixed.objects.some((o) => o.kind === 'rock')).toBe(true);
  });

  it('new options are deterministic: same seed, same layout', () => {
    const st = pen([scatter('rock', { count: 2, vary: 'more3' }), scatter('berry', { region: 'nextTo', ref: node('kind:rock'), chance: 'sometimes' }), node('place.obstacles', { amount: 'few' })], (s) => { s.varySize = true; s.size = { w: 10, h: 10 }; });
    for (const seed of SEEDS.slice(0, 10)) expect(JSON.stringify(generateWorld(st, seed))).toBe(JSON.stringify(generateWorld(st, seed)));
  });
});

describe('validation and read-back of pens', () => {
  it('“next to …” needs its thing only when that region is chosen; fence obstacles need the shop’s fences', () => {
    const errs = (s: StageSpec, u?: Set<string>) => validateStage(s, undefined, u).filter((d) => d.severity === 'error').map((d) => d.code);
    expect(errs(pen([scatter('berry', { region: 'nextTo' })]))).toContain('missing-input');
    expect(errs(pen([scatter('berry')]))).not.toContain('missing-input');
    expect(errs(pen([scatter('berry'), node('place.obstacles', { kind: 'fences' })]), new Set())).toContain('locked');
    expect(errs(pen([scatter('berry'), node('place.obstacles', { kind: 'fences' })]), new Set(['fences']))).not.toContain('locked');
    expect(validateStage(pen([scatter('berry', { region: 'nextTo', ref: node('kind:pond') })])).some((d) => d.code === 'placement-ref-missing')).toBe(true);
  });

  it('placements read as sentences that skip unused parts', () => {
    const c = { petName: 'Pet' };
    expect(say(scatter('berry', { region: 'nextTo', ref: node('kind:rock'), vary: 'more2' }), c)).toBe('1 × berry next to rock (up to 2 more, every try)');
    expect(say(scatter('berry', { ref: node('kind:rock') }), c)).toBe('1 × berry anywhere (exactly, every try)');
    expect(say(node('place.pet', { mode: 'inArea', area: node('area.named', { name: 'coop' }) }), c)).toBe('pet starts inside the coop');
    expect(say(node('place.obstacles', { amount: 'some', kind: 'mixed' }), c)).toBe('some rocks and fences');
  });
});

describe('new conditions and switched-off rules', () => {
  const at = (s: StageSpec, x: number, y: number) => { const cs = compileStage(s); const w = cs.generate(1); w.objects = w.objects.filter((o) => o.kind !== 'rock'); return { cs, w, set: (px: number, py: number) => { w.pet.x = px; w.pet.y = py; } , x, y }; };
  it('Next to counts diagonals but not standing on it; Thing near thing; Time in try', () => {
    const st = pen([node('place.fixed', { kind: node('kind:berry'), x: 4, y: 4 })]);
    st.success = node('cond.nextTo', { actor: node('actor.pet'), what: node('kind:berry') });
    const { cs, w, set } = at(st, 4, 4);
    set(5, 5); expect(cs.isSuccess(w)).toBe(true);
    set(4, 4); expect(cs.isSuccess(w)).toBe(false);
    set(6, 4); expect(cs.isSuccess(w)).toBe(false);
    const st2 = pen([node('place.fixed', { kind: node('kind:berry'), x: 1, y: 1 }), node('place.fixed', { kind: node('kind:bin'), x: 2, y: 2 })]);
    st2.success = node('cond.kindNear', { what: node('kind:berry'), near: node('kind:bin'), dist: 2 });
    expect(compileStage(st2).isSuccess(compileStage(st2).generate(1))).toBe(true);
    st2.success = node('cond.kindNear', { what: node('kind:berry'), near: node('kind:bin'), dist: 1 });
    expect(compileStage(st2).isSuccess(compileStage(st2).generate(1))).toBe(false);
    const st3 = pen([scatter('berry')]);
    st3.success = node('cond.time', { op: 'after', step: 3 });
    const cs3 = compileStage(st3); const w3 = cs3.generate(1);
    expect(cs3.isSuccess(w3)).toBe(false);
    for (let i = 0; i < 3; i++) step(w3, 'wait');
    expect(cs3.isSuccess(w3)).toBe(true);
  });

  it('a switched-off rule stays on the mat but never runs, and checks ignore it', () => {
    const st = recipeStage('go-to-berry');
    const r0 = st.rules[0];
    expect(compileStage(st).rules.length).toBe(st.rules.length);
    r0.args.off = 1;
    expect(compileStage(st).rules.map((r) => r.id)).not.toContain(r0.id);
    expect(describeRule(r0, { petName: 'Pip' })).toMatch(/^\(Switched off\)/);
    expect(validateStage(st).some((d) => d.code === 'no-reward')).toBe(true); // the only treat is switched off
    expect(validateStage(st).some((d) => d.code === 'unknown-field')).toBe(false);
  });
});
