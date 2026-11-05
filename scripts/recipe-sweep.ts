/**
 * Recipe sweep (polish roadmap, phase 1): every built-in recipe at default traits on 6 training seeds (its own and
 * 5 more), with the skills it builds on trained first. Prints success per seed (the gate: ≥80% on each).
 * Training a missed recipe in the game shows its "why isn't it learning?" findings. Run: npx tsx scripts/recipe-sweep.ts [recipe ids…]
 * EPS_X=2 multiplies the recipe's practice, to tell "too little practice" from a missing sense.
 */
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { RECIPES, recipeStage } from '../src/domain/recipes';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { trainAndSave, trainAndSaveRoutine } from '../tests/helpers';
import type { GameState, Pet } from '../src/game/types';

const SKIP = new Set(['pay-per-pickup', 'shoo-loophole']); // experiments built to be exploited
const NEEDS: Record<string, string[]> = { 'morning-chores': ['herd-chicken', 'water-garden', 'keep-clear', 'wait-for-it'] };
const only = process.argv.slice(2);
const X = Number(process.env.EPS_X ?? 1); // practice multiplier, to tell "too little practice" from noise
function learn(g: GameState, p: Pet, id: string, seed: number, main = false) {
  const st = recipeStage(id); if (seed) st.seed = seed;
  if (main) st.learner.episodes = Math.round(st.learner.episodes * X);
  if (st.learner.template === 'routine') return trainAndSaveRoutine(g, p, st);
  if (st.learner.template === 'fetch') return trainAndSave(g, p, st, activeRevision(getSkill(p, 'Approach'))!.policy);
  return trainAndSave(g, p, st);
}
for (const r of RECIPES) {
  if (SKIP.has(r.id) || (only.length && !only.includes(r.id))) continue;
  const rates: number[] = [];
  for (const seed of [0, 11, 22, 33, 44, 55]) {
    const g = newGame(); const p = adoptPet(g, 'Pip', 'meadow'); p.traits = { ...DEFAULT_TRAITS };
    const ap = recipeStage('go-to-berry'); if (seed) ap.seed = seed;
    trainAndSave(g, p, ap);
    for (const dep of NEEDS[r.id] ?? []) learn(g, p, dep, seed);
    if (r.id === 'go-to-berry') { rates.push(activeRevision(getSkill(p, 'Approach'))!.eval.successRate); continue; }
    const rev = learn(g, p, r.id, seed, true);
    rates.push(rev.eval.successRate);
  }
  const min = Math.min(...rates);
  console.log(`${min >= 0.8 ? 'ok  ' : 'LOW '} ${r.id.padEnd(16)} ${rates.map((x) => Math.round(x * 100)).join(' ')}`);
}
