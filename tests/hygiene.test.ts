/** Polish phase 2: test pets have a fixed temperament unless a test asks for a random one. */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { adoptRandomPet, DEFAULT_TRAITS } from './helpers';

describe('test hygiene', () => {
  it('adoptPet gives the default temperament in tests; adoptRandomPet a random one in the game’s range', () => {
    const g = newGame();
    expect(adoptPet(g, 'Pip', 'meadow').traits).toEqual(DEFAULT_TRAITS);
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const t = adoptRandomPet(g, `R${i}`, 'plum').traits;
      for (const v of Object.values(t)) { expect(v).toBeGreaterThanOrEqual(0.35); expect(v).toBeLessThanOrEqual(0.65); }
      seen.add(JSON.stringify(t));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
