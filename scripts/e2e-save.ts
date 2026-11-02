/**
 * Builds the prepared save used by the browser test for Field Guide lessons 4–9 (`npm run e2e`).
 * A farm a player would have after lessons 1–4: Pip with a certified Approach and the Harvest routine, 20 coins earned
 * (so Fetch, Avoid and “Your own skills” are unlocked) and two splashes through the pond.
 * Usage: vite-node scripts/e2e-save.ts <out.json>
 */
import { writeFileSync } from 'node:fs';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { serializeGame } from '../src/persistence/save';
import { checkUnlocks } from '../src/game/progression';
import { advanceTutorial, guide } from '../src/game/tutorial';
import { giveHarvest, recipeStage, trainAndSave } from '../tests/helpers';

const out = process.argv[2];
if (!out) throw new Error('usage: vite-node scripts/e2e-save.ts <out.json>');

const s = newGame();
const pip = adoptPet(s, 'Pip', 'meadow');
pip.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
const rev = trainAndSave(s, pip, recipeStage('go-to-berry'));
giveHarvest(s, pip); // the Harvest lesson (learned farm: the job a pet does is a skill it was taught)
pip.stats.dips = 2;
s.resources.coins = 20;
s.progress.totalCoins = 20;
const g = guide(s);
for (const id of ['first', 'harvest', 'practice', 'scatter']) g.status[id] = 'done';
g.active = null;
g.step = 0;
s.progress.tutorialDone = true;
checkUnlocks(s);
advanceTutorial(s);
writeFileSync(out, serializeGame(s));
console.log(`prepared save: Approach r${rev.rev} (${Math.round(rev.eval.successRate * 100)}%, ${rev.eval.passed ? "certified" : "NOT certified"}), unlocks ${s.progress.unlocks.join(', ')}, lessons ${JSON.stringify(g.status)}`);
