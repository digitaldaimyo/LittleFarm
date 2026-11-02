import { recipeStage } from '../src/domain/recipes';
import type { StageSpec } from '../src/domain/types';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import type { SerializedQ } from '../src/learning/qtable';
import { saveRevision, subskillsFor } from '../src/game/pets';
import type { GameState, Pet } from '../src/game/types';

export function trainAndSave(s: GameState, pet: Pet, stage: StageSpec, navigator?: SerializedQ) {
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: pet.traits, navigator });
  while (!t.done) t.runChunk(250, false);
  const policy = t.policy();
  const report = buildReport(stage, pet.traits, null, policy, navigator ?? null);
  pet.stats.trainingRuns++;
  return saveRevision(s, pet, { stage, policy, report, episodes: t.episode, durationMs: 1, simTicks: t.simTicks });
}

/** Train and save a routine over the pet's current skills (routines need their sub-skills). */
export function trainAndSaveRoutine(s: GameState, pet: Pet, stage: StageSpec) {
  const subs = subskillsFor(pet);
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: pet.traits, subskills: subs });
  while (!t.done) t.runChunk(1000, false);
  const report = buildReport(stage, pet.traits, null, t.policy(), null, undefined, subs);
  const uses = Object.values(subs).filter((x) => stage.learner.routine!.options.some((o) => o.args.skill === x.name)).map((x) => ({ skill: x.name, rev: x.rev }));
  return saveRevision(s, pet, { stage, policy: t.policy(), report, episodes: stage.learner.episodes, durationMs: 1, simTicks: 0, uses });
}

export { recipeStage, DEFAULT_TRAITS };
