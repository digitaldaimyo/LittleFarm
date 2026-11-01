import type { LearnerTemplate, StageSpec } from '../domain/types';
import { MOVES } from '../sim/world';
import { actionsFor, presetSenses } from './senses';
import type { SenseSkillDef } from './policies';

/** Template of a stage (older stages lack the field: Fetch → 'fetch', everything else → 'sense'). */
export function templateOf(stage: StageSpec): LearnerTemplate {
  return stage.learner.template ?? (stage.learner.skill === 'Fetch' ? 'fetch' : 'sense');
}

export function senseDefFor(stage: StageSpec): SenseSkillDef {
  const senses = stage.learner.senses?.length ? structuredClone(stage.learner.senses) : presetSenses();
  const actions = actionsFor(stage.abilities);
  return { senses, actions: actions.length ? actions : MOVES };
}
