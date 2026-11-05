/**
 * Polish phase 2, test hygiene: pets adopted in tests get the default temperament, so no test depends on the clock
 * (adoption seeds a random temperament from it). A test that wants a random temperament asks with `adoptRandomPet`.
 */
import { vi } from 'vitest';
import { DEFAULT_TRAITS } from '../src/learning/episodes';

vi.mock('../src/game/pets', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/game/pets')>();
  return {
    ...real,
    adoptPet: (...args: Parameters<typeof real.adoptPet>) => {
      const p = real.adoptPet(...args);
      p.traits = { ...DEFAULT_TRAITS };
      return p;
    },
    adoptRandomPet: real.adoptPet,
  };
});
