import { describe, expect, it } from 'vitest';
import { recipeStage } from '../src/domain/recipes';
import { compileStage } from '../src/sim/compile';
import { addObject, emptyWorld, step, type Action } from '../src/sim/world';
import { Rng } from '../src/sim/rng';

function trace(seed: number, actions: Action[]) {
  const cs = compileStage(recipeStage('bring-it-home'));
  const w = cs.generate(seed);
  const rs = cs.newRuleState();
  const out: unknown[] = [JSON.stringify(w)];
  for (const a of actions) {
    const prev = { x: w.pet.x, y: w.pet.y };
    const ev = step(w, a);
    const o = cs.evalStep(w, prev, ev, rs);
    out.push(JSON.stringify({ ev, r: o.reward, end: o.end, pet: w.pet }));
  }
  return out;
}

describe('simulation', () => {
  it('is deterministic for a fixed seed and action sequence', () => {
    const rng = new Rng(7);
    const acts: Action[] = Array.from({ length: 60 }, () => (['N', 'E', 'S', 'W', 'pick', 'drop', 'wait'] as Action[])[rng.int(7)]);
    expect(trace(1234, acts)).toEqual(trace(1234, acts));
    expect(trace(1234, acts)).not.toEqual(trace(4321, acts));
  });

  it('enforces collision, carrying and delivery', () => {
    const w = emptyWorld(4, 4);
    addObject(w, 'rock', 1, 0);
    addObject(w, 'berry', 0, 1);
    addObject(w, 'bin', 0, 3);
    w.pet.x = 0; w.pet.y = 0;
    expect(step(w, 'E').map((e) => e.type)).toContain('bump');
    expect(w.pet.x).toBe(0);
    expect(step(w, 'N').map((e) => e.type)).toContain('bump');
    expect(step(w, 'S').map((e) => e.type)).toContain('reach');
    expect(step(w, 'pick').map((e) => e.type)).toContain('pickup');
    expect(w.pet.carrying).not.toBeNull();
    step(w, 'S'); step(w, 'S');
    const ev = step(w, 'drop');
    expect(ev.map((e) => e.type)).toEqual(['tick', 'drop', 'deliver']);
    expect(w.delivered.berry).toBe(1);
    expect(step(w, 'pick').map((e) => e.type)).toContain('fumble');
  });

  it('generates reachable layouts and honours placement counts', () => {
    const cs = compileStage(recipeStage('avoid-pond'));
    for (let s = 0; s < 30; s++) {
      const w = cs.generate(s);
      expect(w.objects.filter((o) => o.kind === 'pond').length).toBe(5);
      expect(w.objects.filter((o) => o.kind === 'berry').length).toBe(1);
      expect(w.objects.some((o) => o.x === w.pet.x && o.y === w.pet.y)).toBe(false);
    }
  });

  it('limits: once-per-object stops a pickup/drop loop from paying repeatedly', () => {
    const st = recipeStage('pay-per-pickup');
    const run = (limit: string) => {
      const s = structuredClone(st);
      s.rules[0].args.limit = { id: 'l', cardId: limit, args: {} };
      const cs = compileStage(s);
      const w = emptyWorld(4, 4);
      addObject(w, 'berry', 0, 0);
      const rs = cs.newRuleState();
      let r = 0;
      for (let i = 0; i < 10; i++) {
        const a: Action = i % 2 === 0 ? 'pick' : 'drop';
        const prev = { ...w.pet };
        r += cs.evalStep(w, prev, step(w, a), rs).reward;
      }
      return r;
    };
    expect(run('lim.every')).toBeGreaterThan(run('lim.perObject') + 10);
  });
});
