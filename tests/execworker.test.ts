/**
 * Polish phase 2: executive practice runs as small steps (in a worker on the page). The steps give exactly what the
 * one-call practice and comparison give, need only the practising pet, report progress, and stop when cancelled
 * without changing anything.
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { compareExecutives, practiseExecutive } from '../src/game/farm';
import { starterPlan } from '../src/game/plan';
import { execPracticeSteps, practiceState, runExecPractice, type FromExecWorker } from '../src/game/execpractice';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { recipeStage, trainAndSave, giveFarmJobs } from './helpers';
import type { GameState } from '../src/game/types';

function farm(): GameState {
  const g = newGame();
  const p = adoptPet(g, 'Pip', 'meadow');
  p.traits = { ...DEFAULT_TRAITS };
  trainAndSave(g, p, recipeStage('go-to-berry'));
  trainAndSave(g, p, recipeStage('bring-it-home'), activeRevision(getSkill(p, 'Approach'))!.policy);
  giveFarmJobs(g, p);
  g.progress.unlocks.push('fetch', 'carrots');
  g.resources.coins = 30;
  g.farm.dutyPetId = p.id;
  p.plan = starterPlan();
  const q = adoptPet(g, 'Mochi', 'plum'); // a second pet, not on duty: practice doesn't need it
  q.traits = { ...DEFAULT_TRAITS };
  return g;
}

describe('executive practice in steps (polish phase 2)', () => {
  it('gives exactly the values and comparison of the one-call version, from the practising pet alone', () => {
    const g = farm();
    const id = g.pets[0].id;
    const job = { state: structuredClone(practiceState(g, id)), petId: id, days: 2 };
    expect(job.state.pets.map((p) => p.name)).toEqual(['Pip']);
    const it = execPracticeSteps(job);
    const seen: number[] = [];
    let r = it.next();
    while (!r.done) { seen.push(r.value.done); r = it.next(); }
    expect(seen.at(-1)).toBe(2 + 9);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));

    const ref = structuredClone(g);
    practiseExecutive(ref, id, 2);
    expect(r.value.values).toEqual(ref.pets[0].executive.values);
    expect(r.value.rows).toEqual(compareExecutives(ref, id));
  }, 60000);

  it('reports progress, and a cancel stops it before the end with no result', async () => {
    const g = farm();
    const id = g.pets[0].id;
    const msgs: FromExecWorker[] = [];
    let n = 0;
    await runExecPractice({ state: structuredClone(g), petId: id, days: 4 }, (m) => msgs.push(m), () => ++n >= 3, async () => {});
    expect(msgs.filter((m) => m.type === 'progress').length).toBe(3);
    expect(msgs.at(-1)!.type).toBe('cancelled');
    expect(msgs.some((m) => m.type === 'done')).toBe(false);
    expect(g.pets[0].executive.values).toBeUndefined();
    const err: FromExecWorker[] = [];
    await runExecPractice({ state: structuredClone(g), petId: 'gone', days: 1 }, (m) => err.push(m), () => false, async () => {});
    expect(err).toEqual([{ type: 'error', error: 'That pet is not here any more.' }]);
  }, 60000);
});
