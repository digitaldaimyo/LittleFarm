/**
 * Fingerprints of generated layouts for every recipe and the tutorial pen (and their bigger transfer pens).
 * tests/layouts.test.ts compares against tests/fixtures/layouts.json, so changes to layout generation
 * can't silently move existing lessons. Regenerate only on purpose: PRINT_LAYOUTS=1 npx vite-node scripts/layout-fingerprint.ts > tests/fixtures/layouts.json
 */
import { RECIPES, recipeStage, buildTutorialStage } from '../src/domain/recipes';
import { generateWorld } from '../src/sim/compile';
import { transferVariant } from '../src/learning/episodes';
import type { StageSpec } from '../src/domain/types';
import type { World } from '../src/sim/world';

export function fingerprint(w: World): string {
  const objs = w.objects.map((o) => `${o.kind}@${o.x},${o.y}${o.open ? 'o' : ''}${o.wet ? 'w' : ''}`).join(';');
  const areas = (w.areas ?? []).map((a) => `${a.name}:${a.x},${a.y},${a.w},${a.h}`).join(';');
  return `${w.w}x${w.h}|pet ${w.pet.x},${w.pet.y}|${objs}|${areas}|${w.night ? 'N' : 'D'}${w.raining ? 'R' : ''}|rng ${w.rng}`;
}

export function layoutTable(): Record<string, string[]> {
  const stages: [string, StageSpec][] = [...RECIPES.map((r) => [r.id, recipeStage(r.id)] as [string, StageSpec]), ['tutorial', buildTutorialStage()]];
  const out: Record<string, string[]> = {};
  for (const [id, st] of stages) {
    out[id] = Array.from({ length: 25 }, (_, i) => fingerprint(generateWorld(st, 1000 + i * 37)));
    out[`${id}:transfer`] = Array.from({ length: 5 }, (_, i) => fingerprint(generateWorld(transferVariant(st), 950001 + i * 7)));
  }
  return out;
}

if (process.env.PRINT_LAYOUTS) console.log(JSON.stringify(layoutTable(), null, 1));
