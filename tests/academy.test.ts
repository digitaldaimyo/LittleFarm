/**
 * Academy roadmap, phase 0 gate: a new game is the academy edition (it starts in the Academy), a skill saved in the
 * Lab is the pet's everywhere, and no farm-economy code runs. Plus the school's framing and the new save format.
 */
import { describe, expect, it } from 'vitest';
import { newAcademyGame, newGame, trainingCost, canTrain } from '../src/game/state';
import { adoptPet, getSkill } from '../src/game/pets';
import { createRuntime, farmTick } from '../src/game/farm';
import { jobCapability } from '../src/game/capability';
import { COURSES, RANKS, SCHOOL, petRank, petRecord } from '../src/game/academy';
import { ACADEMY_FORMAT, parseAcademySave, parseGame, serializeGame } from '../src/persistence/save';
import { guide } from '../src/game/tutorial';
import { recipeStage, trainAndSave, giveFarmJobs } from './helpers';
import type { GameState } from '../src/game/types';

function homestead(academy: boolean): GameState {
  const g = academy ? newAcademyGame() : newGame();
  const p = adoptPet(g, 'Pip', 'meadow');
  trainAndSave(g, p, recipeStage('go-to-berry')); // trained in the Lab
  giveFarmJobs(g, p);
  if (!academy) g.progress.unlocks.push('carrots');
  g.farm.dutyPetId = p.id;
  return g;
}

describe('the academy edition (phase 0)', () => {
  it('a new game is the academy edition: Willowbrook’s record, no Field Guide, the Lab open and free', () => {
    const g = newAcademyGame();
    expect(g.academy).toEqual({ acorns: 0, pets: {}, greeted: [] });
    expect(guide(g).active).toBeNull();
    expect(g.progress.unlocks).toEqual(expect.arrayContaining(['custom', 'fetch', 'avoid', 'routines', 'carrots', 'fences', 'trees']));
    const p = adoptPet(g, 'Pip', 'meadow');
    p.energy = 0;
    expect(trainingCost(recipeStage('avoid-pond'), g)).toBe(0);
    expect(canTrain(p, recipeStage('avoid-pond'), g).ok).toBe(true); // practice is free (decision 12)
    expect(trainingCost(recipeStage('avoid-pond'))).toBe(20); // the farm edition still charged energy
  });

  it('a skill saved in the Lab is the pet’s everywhere: its skills, the Homestead’s jobs, its Academy board', () => {
    const g = homestead(true);
    const p = g.pets[0];
    expect(getSkill(p, 'Approach')).toBeTruthy();
    expect(jobCapability(p, 'harvest')?.name).toBe('Harvest'); // the Homestead uses it
    expect(petRank(g, p)).toBe('Novice');
  });

  it('no farm-economy code runs: nothing sells, no requests, free seeds, no unlocks from coins; produce is flavour', () => {
    const g = homestead(true);
    const rt = createRuntime(g.farm);
    let coinFx = 0;
    for (let t = 0; t < 2400; t++) coinFx += farmTick(g, rt).fx.filter((f) => f.type === 'coin').length;
    expect(g.resources.coins).toBe(0);
    expect(g.progress.totalCoins).toBe(0);
    expect(coinFx).toBe(0);
    expect(g.farm.requests ?? []).toEqual([]);
    expect(g.resources.berries).toBeGreaterThan(0); // pets still harvest: flavour, counted
    expect(g.pets[0].stats.planted ?? 0).toBeGreaterThan(0); // and plant, for free
    expect(g.farm.production.every((x) => x.coins >= 0)).toBe(true);
    // The same farm in the farm edition earns coins and posts requests: the switch is the edition.
    const old = homestead(false);
    const rt2 = createRuntime(old.farm);
    for (let t = 0; t < 2400; t++) farmTick(old, rt2);
    expect(old.progress.totalCoins).toBeGreaterThan(0);
    expect((old.farm.requests ?? []).length).toBeGreaterThan(0);
  }, 60000);

  it('saves: a new format, round-trips, and farm-edition saves are refused with a reason', () => {
    const g = homestead(true);
    petRecord(g, g.pets[0].id).exams.push('first-steps');
    g.academy!.acorns = 12;
    const text = serializeGame(g);
    expect(JSON.parse(text).format).toBe(ACADEMY_FORMAT);
    const back = parseAcademySave(text);
    expect(back.ok).toBe(true);
    expect(back.game!.academy!.acorns).toBe(12);
    expect(petRank(back.game!, back.game!.pets[0])).toBe('Apprentice');
    const farm = parseAcademySave(serializeGame(newGame()));
    expect(farm.ok).toBe(false);
    expect(farm.diagnostics[0]).toMatch(/farm edition.*fresh start/);
    expect(parseAcademySave('{"format":"pen-deck-academy","version":99,"game":{}}').diagnostics[0]).toMatch(/newer version/);
    const bad = JSON.parse(text); bad.game.academy.pets = 3;
    expect(parseGame(JSON.stringify(bad)).ok).toBe(false);
  });

  it('the school: five courses with visible exams, ranks rising one per exam', () => {
    expect(SCHOOL.name).toBe('Willowbrook Academy');
    expect(RANKS).toEqual(['Novice', 'Apprentice', 'Journeypet', 'Adept', 'Master']);
    expect(COURSES.map((c) => c.earns)).toEqual(['Apprentice', 'Journeypet', 'Adept', 'Master', null]);
    const g = newAcademyGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    for (const [i, c] of COURSES.slice(0, 4).entries()) {
      petRecord(g, p.id).exams.push(c.id);
      expect(petRank(g, p)).toBe(RANKS[i + 1]);
    }
    petRecord(g, p.id).exams.push('days-work');
    expect(petRank(g, p)).toBe('Master'); // the last course is an honour, not a rank
  });
});
