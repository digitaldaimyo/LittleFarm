/**
 * Polish phase 3: made once, at save version 10 (before the renames), to build tests/fixtures/save-v10.json.gz — a
 * rich save to prove that renames and the v11 migration keep every skill and responsibility. Kept for the record;
 * running it now writes the current version, not v10.
 * Usage: npx tsx scripts/save-v10-fixture.ts <out.json>
 */
import { writeFileSync } from 'node:fs';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { serializeGame } from '../src/persistence/save';
import { createRuntime, farmTick, practiseExecutive } from '../src/game/farm';
import { starterPlan } from '../src/game/plan';
import { node } from '../src/domain/spec';
import { validateNodes, validateStage } from '../src/domain/validate';
import { nominal } from '../src/domain/typecheck';
import { FARM_OBJECTS } from '../src/domain/packs/farm';
import { giveFarmJobs, giveRoutine, recipeStage, trainAndSave, DEFAULT_TRAITS } from '../tests/helpers';

const s = newGame();
const pip = adoptPet(s, 'Pip', 'meadow');
pip.traits = { ...DEFAULT_TRAITS };
trainAndSave(s, pip, recipeStage('go-to-berry'));
trainAndSave(s, pip, recipeStage('bring-it-home'), activeRevision(getSkill(pip, 'Approach'))!.policy);
giveFarmJobs(s, pip);
giveRoutine(s, pip, 'harvest-store');
giveRoutine(s, pip, 'basket-run');
s.progress.unlocks.push('fetch', 'carrots');
s.resources.coins = 30;
s.farm.dutyPetId = pip.id;
pip.plan = starterPlan();
// An aimed job with a qualifier, a night row, and the learned picks practised.
pip.plan.rows.splice(1, 0, node('plan.row', {
  label: 'Furthest berry first', if: [node('cond.at', { actor: node('actor.pet'), what: node('kind:home') })],
  do: node('job.forage', { navigator: 'Approach', aim: node('obj.furthest', { what: node('kind:berry'), from: node('kind:home') }) }),
  night: 'work',
}));
pip.executive.mode = 'learned';
practiseExecutive(s, pip.id, 1);
const mochi = adoptPet(s, 'Mochi', 'plum');
mochi.traits = { ...DEFAULT_TRAITS };
trainAndSave(s, mochi, recipeStage('go-to-berry'));
// A custom lesson with a Compare measure, kept in the save.
const st = recipeStage('bring-it-home'); st.id = 'stage-custom'; st.name = 'My fetch'; st.recipeId = 'custom';
st.rules.push(node('rule', { label: 'Two stored', when: node('ev.tick'), if: [node('cond.compare', { quantity: node('q.stored', { what: node('kind:berry') }), op: '>=', value: 2 })], then: [node('eff.reward', { amount: 1 })], limit: node('lim.once') }));
s.stages.push(st);
// Run the farm so storage holds ids, evidence builds up and a job is under way.
const rt = createRuntime(s.farm);
for (let t = 0; t < 900 || s.farm.current?.behaviorId !== 'forage'; t++) farmTick(s, rt);
const errs = [...validateStage(st), ...validateNodes(pip.plan.rows, nominal('PlanRow'), { placed: new Set(FARM_OBJECTS.map((o) => o.id)), areas: new Set(['coop']) })].filter((d) => d.severity === 'error');
if (errs.length) throw new Error(JSON.stringify(errs));
writeFileSync(process.argv[2], serializeGame(s));
console.log(`v${s.version}: coins ${s.progress.totalCoins}, current ${s.farm.current?.behaviorId ?? 'none'}, skills ${pip.skills.map((k) => k.name).join(', ')}, evidence ${Object.keys(pip.evidence ?? {}).join(', ')}`);
