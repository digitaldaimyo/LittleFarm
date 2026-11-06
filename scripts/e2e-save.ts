/**
 * Builds the prepared save for the browser test's part 2 (`npm run e2e`, `npm run e2e:cards`): an academy-edition
 * game (Academy roadmap, phase 0) with Pip, a certified Approach and the Harvest routine, trained as a player would
 * in the Lab.
 * Usage: vite-node scripts/e2e-save.ts <out.json>
 */
import { writeFileSync } from 'node:fs';
import { newAcademyGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { serializeGame } from '../src/persistence/save';
import { giveHarvest, recipeStage, trainAndSave } from '../tests/helpers';

const out = process.argv[2];
if (!out) throw new Error('usage: vite-node scripts/e2e-save.ts <out.json>');

const s = newAcademyGame();
const pip = adoptPet(s, 'Pip', 'meadow');
pip.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 };
const rev = trainAndSave(s, pip, recipeStage('go-to-berry'));
giveHarvest(s, pip);
writeFileSync(out, serializeGame(s));
console.log(`prepared academy save: Approach r${rev.rev} (${Math.round(rev.eval.successRate * 100)}%, ${rev.eval.passed ? 'certified' : 'NOT certified'}), skills ${pip.skills.map((k) => k.name).join(', ')}`);
