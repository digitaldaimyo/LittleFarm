import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { parseGame, serializeGame } from '../src/persistence/save';
import { recipeStage, trainAndSave } from './helpers';
import { NavPolicy } from '../src/learning/policies';
import { compileStage } from '../src/sim/compile';

describe('save / load', () => {
  it('round-trips pets, policies, stages, templates, farm and progress', () => {
    const s = newGame();
    const p = adoptPet(s, 'Pip', 'meadow');
    trainAndSave(s, p, recipeStage('go-to-berry'));
    s.templates.push({ id: 't1', name: 'Berry treat', revision: 1, createdAt: 1, output: { kind: 'nominal', name: 'Rule' }, root: s.stages[0].environment[0], exposed: [] });
    s.resources.coins = 7;
    s.progress.unlocks.push('fetch');
    (s as any).futureField = { keep: true };
    s.stages[0].rules.push({ id: 'x', cardId: 'rule', args: { label: 'r' }, extensions: { color: 'teal' } });
    const text = serializeGame(s);
    const r = parseGame(text);
    expect(r.ok).toBe(true);
    expect(JSON.parse(serializeGame(r.game!)).game).toEqual(JSON.parse(text).game);
    expect((r.game as any).futureField).toEqual({ keep: true });

    // Restored policy behaves identically.
    const a = NavPolicy.from(s.pets[0].skills[0].revisions[0].policy)!;
    const b = NavPolicy.from(r.game!.pets[0].skills[0].revisions[0].policy)!;
    const cs = compileStage(recipeStage('go-to-berry'));
    for (let i = 0; i < 20; i++) {
      const w = cs.generate(500 + i);
      expect(a.act(w, 'berry')).toEqual(b.act(w, 'berry'));
    }
  });

  it('reports unknown cards instead of silently dropping them', () => {
    const s = newGame();
    s.stages[0].rules.push({ id: 'z', cardId: 'future.card', args: {} });
    const r = parseGame(serializeGame(s));
    expect(r.ok).toBe(true);
    expect(r.diagnostics.some((d) => d.includes('future.card'))).toBe(true);
    expect(r.game!.stages[0].rules.some((x) => x.cardId === 'future.card')).toBe(true);
  });

  it('rejects garbage and newer versions', () => {
    expect(parseGame('nope').ok).toBe(false);
    expect(parseGame(JSON.stringify({ format: 'other' })).ok).toBe(false);
    const s = newGame();
    s.version = 99;
    expect(parseGame(serializeGame(s)).ok).toBe(false);
  });
});
