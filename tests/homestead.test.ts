/**
 * Academy roadmap, phase 2: a minimal Homestead. Acorns buy decorations, placed by the house and never in the way;
 * pets at home practise what the Academy certified them in; the farm edition is untouched.
 */
import { describe, expect, it } from 'vitest';
import { newAcademyGame, newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { createRuntime, farmTick } from '../src/game/farm';
import { DECOR, buyDecoration, decorations, homeLife } from '../src/game/homestead';
import { challengeById, challengeBase } from '../src/game/challenges';
import { petRecord } from '../src/game/academy';
import { parseAcademySave, serializeGame } from '../src/persistence/save';
import { objectsAt } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { trainAndSave } from './helpers';

describe('the Homestead (Academy phase 2)', () => {
  it('acorns buy decorations, placed on free tiles by the house (not on things, the door or the coop); they save', () => {
    const g = newAcademyGame();
    adoptPet(g, 'Pip', 'meadow');
    expect(buyDecoration(g, 'bench').reason).toMatch(/costs 6 acorns; you have 0/);
    g.academy!.acorns = 30;
    for (const id of ['flowers', 'bench', 'lantern', 'bunting']) expect(buyDecoration(g, id).ok, id).toBe(true);
    expect(g.academy!.acorns).toBe(30 - 3 - 6 - 5 - 8);
    const d = decorations(g);
    expect(d.map((x) => x.item)).toEqual(['flowers', 'bench', 'lantern', 'bunting']);
    expect(new Set(d.map((x) => `${x.x},${x.y}`)).size).toBe(4);
    const w = g.farm.world;
    const home = w.objects.find((o) => o.kind === 'home')!;
    for (const x of d) {
      expect(objectsAt(w, x.x, x.y)).toEqual([]);
      expect(Math.abs(x.x - home.x) + Math.abs(x.y - home.y)).toBeGreaterThan(1);
      expect((w.areas ?? []).some((a) => x.x >= a.x && x.x < a.x + a.w && x.y >= a.y && x.y < a.y + a.h)).toBe(false);
    }
    expect(buyDecoration(g, 'ribbons').reason).toMatch(/costs 10/); // 8 left
    expect(DECOR.every((x) => x.price > 0)).toBe(true);
    const back = parseAcademySave(serializeGame(g)).game!;
    expect(decorations(back)).toEqual(d);
  });

  it('a pet certified in “Sit and stay” sits by the well at home when there is nothing to do', () => {
    const g = newAcademyGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    const ch = challengeById('fs-stay')!;
    const st = ch.reference(challengeBase(ch));
    const rev = trainAndSave(g, p, st);
    expect(rev.eval.passed).toBe(true);
    petRecord(g, p.id).certificates['fs-stay'] = { challengeId: 'fs-stay', at: 0, badges: [] }; // certified (tested in challenges.test.ts)
    g.farm.dutyPetId = p.id;
    const rt = createRuntime(g.farm);
    const seen = new Set<string>();
    for (let t = 0; t < 1000; t++) { farmTick(g, rt); const c = g.farm.current; if (c?.behaviorId === 'skill') seen.add(c.intention); }
    expect([...seen].some((x) => /sitting nicely by the well \(Wait for it/.test(x))).toBe(true);
  }, 60000);

  it('no home life without a certificate, and none in the farm edition', () => {
    const g = newAcademyGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    const rng = new Rng(1);
    for (let i = 0; i < 20; i++) expect(homeLife(g, p, rng)).toBeNull();
    const old = newGame();
    const q = adoptPet(old, 'Mochi', 'plum');
    for (let i = 0; i < 20; i++) expect(homeLife(old, q, rng)).toBeNull();
  });
});
