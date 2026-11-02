import { it } from 'vitest';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { createRuntime, farmTick } from '../src/game/farm';
import { node } from '../src/domain/spec';
import { recipeStage, trainAndSave, trainAndSaveRoutine } from './helpers';
it('approach variants', () => {
  for (const variant of ['recipe', 'obstacles-some', 'obstacles-some+3000']) {
    const out: string[] = [];
    for (const seed of [101, 202, 303]) {
      const g = newGame(); const p = adoptPet(g, 'Pip', 'meadow'); p.traits = { ...DEFAULT_TRAITS };
      const ap = recipeStage('go-to-berry'); ap.seed = seed;
      if (variant !== 'recipe') { ap.environment = ap.environment.filter((e) => !(e.cardId === 'place.random' && (e.args.kind as any)?.cardId === 'kind:rock')); ap.environment.push(node('place.obstacles', { amount: 'some', kind: 'rocks' })); }
      if (variant.endsWith('3000')) ap.learner.episodes = 3000;
      trainAndSave(g, p, ap);
      const hv = recipeStage('harvest'); hv.seed = seed; trainAndSaveRoutine(g, p, hv);
      g.progress.unlocks.push('carrots'); g.resources.coins = 30;
      p.assignment = { mode: 'job', job: 'skill', navigator: 'Approach', skillName: 'Harvest', target: '@crop' };
      g.farm.dutyPetId = p.id;
      const rt = createRuntime(g.farm); const c0 = g.progress.totalCoins;
      for (let t = 0; t < 2400; t++) farmTick(g, rt);
      out.push(String(g.progress.totalCoins - c0));
    }
    console.log(variant, out.join(' / '));
  }
}, 600000);
