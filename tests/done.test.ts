/**
 * Learned-farm phase 6: the roadmap's definition of done, as tests.
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { adoptPet, getSkill } from '../src/game/pets';
import { createRuntime, farmTick, DAY_TICKS } from '../src/game/farm';
import { jobCapability } from '../src/game/capability';
import { serializeGame, parseGame } from '../src/persistence/save';
import { node } from '../src/domain/spec';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { recipeStage, trainAndSave, giveFarmJobs } from './helpers';
import type { Invocation } from '../src/learning/executive';

describe('definition of done (learned farm)', () => {
  it('a pet with no skills does nothing productive on the farm: it only rests', () => {
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    g.farm.dutyPetId = p.id;
    const rt = createRuntime(g.farm);
    const seen = new Set<string>();
    for (let t = 0; t < DAY_TICKS; t++) { farmTick(g, rt); if (g.farm.current) seen.add(g.farm.current.behaviorId); }
    expect(g.progress.totalCoins).toBe(0);
    expect([...seen]).toEqual(['rest']);
  });

  it('every autonomous action comes from a learned skill or routine (or innate rest): no wandering, no scripted sniffing', () => {
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    const ap = trainAndSave(g, p, recipeStage('go-to-berry'));
    trainAndSave(g, p, recipeStage('bring-it-home'), ap.policy);
    giveFarmJobs(g, p);
    g.progress.unlocks.push('fetch', 'carrots');
    g.farm.dutyPetId = p.id;
    const rt = createRuntime(g.farm);
    const invs: Invocation[] = [];
    for (let t = 0; t < 2 * DAY_TICKS; t++) { const before = g.farm.current; farmTick(g, rt); if (g.farm.current && g.farm.current !== before) invs.push(g.farm.current); }
    const JOB: Record<string, string> = { harvest: 'harvest', haul: 'haul', basketRun: 'basketRun', plant: 'plant' };
    for (const inv of invs) {
      expect(inv.behaviorId).not.toBe('wander');
      expect(inv.intention).not.toMatch(/sniffing/);
      if (JOB[inv.behaviorId]) expect(jobCapability(p, JOB[inv.behaviorId])).not.toBeNull();
      if (inv.behaviorId === 'catch' || inv.behaviorId === 'goto') expect(getSkill(p, 'Approach')).toBeTruthy();
    }
    expect(invs.some((i) => i.behaviorId === 'harvest')).toBe(true);
    expect(g.progress.totalCoins).toBeGreaterThan(40);
  }, 60000);

  it('a player-made skill serves a responsibility without being named in code', () => {
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    trainAndSave(g, p, recipeStage('go-to-berry'));
    trainAndSave(g, p, recipeStage('wait-for-it')); // "Wait for it": the player's own skill
    p.plan = { guard: true, rows: [node('plan.responsibility', { label: 'Sit by the well', if: [], do: node('job.skill', { skill: 'Wait for it', aim: node('kind:well') }) }), node('plan.responsibility', { label: 'Otherwise nap', if: [], do: node('job.nap') })] };
    g.farm.dutyPetId = p.id;
    const rt = createRuntime(g.farm);
    rt.stats = {};
    for (let t = 0; t < 600; t++) farmTick(g, rt);
    expect(rt.stats.skill?.ok ?? 0).toBeGreaterThan(0);
    expect(p.evidence?.['skill:Wait for it']?.n ?? 0).toBeGreaterThan(0);
  }, 60000);

  it('saves v10: an old direct job becomes a responsibility (kept at night), wandering is dropped, every skill is kept', () => {
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    trainAndSave(g, p, recipeStage('go-to-berry'));
    const env = JSON.parse(serializeGame(g));
    env.version = 9; env.game.version = 9;
    const pet = env.game.pets[0];
    pet.assignment = { mode: 'job', job: 'forage', navigator: 'Approach' }; // a v9 save: a direct job, old names
    const adopted = adoptPet(g, 'Mochi', 'plum');
    const env2 = JSON.parse(serializeGame(g)).game.pets[1];
    env2.assignment = { mode: 'plan', job: 'forage', navigator: 'Approach' };
    env2.plan = { chooser: 'learned', guard: true, rows: [node('plan.row', { label: 'Wander', if: [], do: node('job.wander') }), node('plan.row', { label: 'Nap', if: [], do: node('job.nap') })] };
    env.game.pets.push(env2);
    void adopted;
    const r = parseGame(JSON.stringify(env));
    expect(r.ok).toBe(true);
    const [a, b] = r.game!.pets;
    expect(a.assignment.mode).toBe('auto');
    expect(a.plan!.rows.map((x) => (x.args.do as { cardId: string }).cardId)).toEqual(['job.harvest', 'job.nap']);
    expect(a.plan!.rows[0].args.night).toBe('work');
    expect(a.skills.map((k) => k.name)).toEqual(['Approach']); // skills survive
    expect(b.assignment.mode).toBe('auto');
    expect(b.plan!.rows.map((x) => x.args.label)).toEqual(['Nap']);
    expect(b.plan!.rows.map((x) => x.cardId)).toEqual(['plan.responsibility']); // v11: the card's new id
    expect('chooser' in b.plan!).toBe(false); // v11: the retired chooser is dropped
  });
});
