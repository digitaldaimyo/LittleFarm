import { recipeStage } from '../src/domain/recipes';
import type { StageSpec } from '../src/domain/types';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import type { SerializedQ } from '../src/learning/qtable';
import { saveRevision } from '../src/game/pets';
import type { GameState, Pet } from '../src/game/types';

export function trainAndSave(s: GameState, pet: Pet, stage: StageSpec, navigator?: SerializedQ) {
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: pet.traits, navigator });
  while (!t.done) t.runChunk(250, false);
  const policy = t.policy();
  const report = buildReport(stage, pet.traits, null, policy, navigator ?? null);
  pet.stats.trainingRuns++;
  return saveRevision(s, pet, { stage, policy, report, episodes: t.episode, durationMs: 1, simTicks: t.simTicks });
}

export { recipeStage, DEFAULT_TRAITS };
