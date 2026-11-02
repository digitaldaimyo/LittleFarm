/**
 * Learned-farm roadmap, phase 0: the defects found in the audit, pinned before they are fixed (phase 1).
 * `it.fails` passes while the defect exists; when phase 1 fixes it, flip these to plain `it`.
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill, routineRunFor, sensePolicyOf } from '../src/game/pets';
import { SkillRun, isDone } from '../src/learning/policies';
import { compileCondition, generateWorld, withTarget } from '../src/sim/compile';
import { Rng } from '../src/sim/rng';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { recipeStage, trainAndSave } from './helpers';

function petWith(...recipes: string[]) {
  const s = newGame();
  const p = adoptPet(s, 'Pip', 'meadow');
  p.traits = { ...DEFAULT_TRAITS };
  const ap = trainAndSave(s, p, recipeStage('go-to-berry'));
  for (const r of recipes) trainAndSave(s, p, recipeStage(r), ap.policy);
  return { s, p };
}

describe('phase 0 defects (pinned, fixed in phase 1)', () => {
  it.fails('defect 1a: a routine that runs out of time reports a timeout, not success', () => {
    const { p } = petWith('fetch-routine');
    const rev = activeRevision(getSkill(p, 'Fetch routine'))!;
    const run = routineRunFor(p, rev, 'berry', new Rng(1), 3)!; // 3 ticks: never enough to deliver
    const w = generateWorld(recipeStage('fetch-routine'), 5);
    let st = run.next(w);
    for (let i = 0; i < 10 && !isDone(st); i++) st = run.next(w);
    expect(isDone(st) && st.done).not.toBe('success');
  });

  it.fails('defect 1b: a reach skill that runs out of time reports a timeout, not success', () => {
    const { p } = petWith();
    const rev = activeRevision(getSkill(p, 'Approach'))!;
    const st0 = recipeStage('go-to-berry');
    const goal = withTarget('berry', () => compileCondition(st0.success!));
    const run = new SkillRun(sensePolicyOf(rev)!, 'berry', 2, (w) => goal({ w, prev: w.pet }));
    const w = generateWorld(st0, 7);
    let st = run.next(w);
    for (let i = 0; i < 10 && !isDone(st); i++) st = run.next(w); // the world never steps: the berry is never reached
    expect(isDone(st) && st.done).not.toBe('success');
  });

  it.todo('defect 2: option learning discounts by γ^duration (today: undiscounted option reward, flat γ)');
  it.todo('defect 3: a skill can be aimed at a trait ("any ripe crop", "storage with room"), not only one kind');
});
