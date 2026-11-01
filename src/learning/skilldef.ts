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

/** Do two sense definitions produce the same policy shape and meaning? */
export function sameSenseDef(a: SenseSkillDef | undefined, b: SenseSkillDef): boolean {
  const key = (d: SenseSkillDef) => JSON.stringify([d.senses.map((n) => [n.cardId, (n.args.what as { cardId?: string } | undefined)?.cardId ?? null]), d.actions]);
  return key(a ?? { senses: presetSenses(), actions: MOVES }) === key(b);
}
