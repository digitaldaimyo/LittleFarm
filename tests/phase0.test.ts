/**
 * Learned-farm roadmap, phase 0: the defects found in the audit, pinned before they are fixed (phase 1).
 * Phase 1 fixed 1a and 1b (they were `it.fails` in phase 0).
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill, routineRunFor, sensePolicyOf } from '../src/game/pets';
import { SkillRun, isDone } from '../src/learning/policies';
import { compileCondition, generateWorld, withTarget } from '../src/sim/compile';
import { Rng } from '../src/sim/rng';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { recipeStage, trainAndSave, trainAndSaveRoutine } from './helpers';

function petWith(routine?: string) {
  const s = newGame();
  const p = adoptPet(s, 'Pip', 'meadow');
  p.traits = { ...DEFAULT_TRAITS };
  trainAndSave(s, p, recipeStage('go-to-berry'));
  if (routine) trainAndSaveRoutine(s, p, recipeStage(routine));
  return { s, p };
}

describe('phase 0 defects (pinned, fixed in phase 1)', () => {
  it('defect 1a: a routine that runs out of time reports a timeout, not success', () => {
    const { p } = petWith('fetch-routine');
    const rev = activeRevision(getSkill(p, 'Fetch routine'))!;
    const run = routineRunFor(p, rev, 'berry', new Rng(1), 3)!; // 3 ticks: never enough to deliver
    const w = generateWorld(recipeStage('fetch-routine'), 5);
    let st = run.next(w);
    for (let i = 0; i < 10 && !isDone(st); i++) st = run.next(w); // the world never steps
    expect(isDone(st) && st.done).toBe('timeout');
  });

  it('defect 1b: a reach skill that runs out of time reports a timeout, not success', () => {
    const { p } = petWith();
    const rev = activeRevision(getSkill(p, 'Approach'))!;
    const st0 = recipeStage('go-to-berry');
    const goal = withTarget('berry', () => compileCondition(st0.success!));
    const run = new SkillRun(sensePolicyOf(rev)!, 'berry', 2, (w) => goal({ w, prev: w.pet }));
    const w = generateWorld(st0, 7);
    let st = run.next(w);
    for (let i = 0; i < 10 && !isDone(st); i++) st = run.next(w); // the world never steps: the berry is never reached
    expect(isDone(st) && st.done).toBe('timeout');
  });

  // Defects 2 (duration-aware option learning) and 3 (trait aims) are tested in tests/capability.test.ts.
});
