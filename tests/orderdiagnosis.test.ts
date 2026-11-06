/**
 * Polish phase 5: learned picks as a diagnosis of the player's order. Gate: on a bad order (“Otherwise nap” first)
 * the diagnosis names that row; applying its suggestion brings the fixed order within 5% of the learned picks; on a
 * good order it says the order is fine.
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { compareAndDiagnose, compareExecutives, practiseExecutive } from '../src/game/farm';
import { applySuggestion, diagnoseOrder } from '../src/game/orderdiagnosis';
import { compilePlan, starterPlan } from '../src/game/plan';
import { node } from '../src/domain/spec';
import { advanceTutorial, ackStep, currentStep, startChapter } from '../src/game/tutorial';
import { recipeStage, trainAndSave, giveFarmJobs } from './helpers';
import type { GameState } from '../src/game/types';

function farm(seed: number): GameState {
  const g = newGame();
  const p = adoptPet(g, 'Pip', 'meadow');
  const ap = recipeStage('go-to-berry'); ap.seed = seed; trainAndSave(g, p, ap);
  const fe = recipeStage('bring-it-home'); fe.seed = seed; trainAndSave(g, p, fe, activeRevision(getSkill(p, 'Approach'))!.policy);
  giveFarmJobs(g, p);
  g.progress.unlocks.push('fetch', 'carrots');
  g.resources.coins = 30;
  g.farm.dutyPetId = p.id;
  p.plan = starterPlan();
  return g;
}
const coins = (r: ReturnType<typeof compareAndDiagnose>, m: string) => r.rows.find((x) => x.mode === m)!.coins;
const label = (g: GameState) => g.pets[0].plan!.rows.map((r) => r.args.label);

describe('learned picks diagnose the order (polish phase 5)', () => {
  for (const seed of [101, 202]) {
    it(`a bad order (“Otherwise nap” first, seed ${seed}): it names that row, and one tap brings the order within 5% of learned picks`, () => {
      const g = farm(seed);
      const p = g.pets[0];
      const rows = p.plan!.rows;
      rows.unshift(rows.splice(rows.findIndex((x) => x.args.label === 'Otherwise nap'), 1)[0]);
      practiseExecutive(g, p.id, 4);
      const before = compareAndDiagnose(g, p.id);
      expect(before.diagnosis.verdict).toBe('change');
      expect(before.diagnosis.text).toContain('“Otherwise nap”');
      expect(before.diagnosis.suggestion).toMatchObject({ kind: 'move', rowId: rows[0].id });
      expect(applySuggestion(p.plan!, before.diagnosis.suggestion!)).toBe(true);
      expect(label(g).at(-1)).toBe('Otherwise nap'); // it always applies: its place is the bottom
      const after = compareAndDiagnose(g, p.id);
      expect(coins(after, 'order')).toBeGreaterThanOrEqual(0.95 * coins(before, 'learned')); // measured 98–99%
      expect(coins(after, 'order')).toBeGreaterThanOrEqual(0.95 * coins(after, 'learned'));
      expect(after.diagnosis.verdict).toBe('fine');
    }, 60000);
  }

  it('a good order: it says the order is fine', () => {
    for (const seed of [101, 303]) {
      const g = farm(seed);
      practiseExecutive(g, g.pets[0].id, 4);
      const r = compareAndDiagnose(g, g.pets[0].id);
      expect(r.diagnosis.verdict, r.diagnosis.text).toBe('fine');
      expect(r.diagnosis.text).toMatch(/order is fine|no single change/);
      expect(r.diagnosis.suggestion).toBeUndefined();
    }
  }, 60000);

  it('watching for the diagnosis doesn’t change the comparison', () => {
    const g = farm(202);
    practiseExecutive(g, g.pets[0].id, 2);
    expect(compareAndDiagnose(g, g.pets[0].id).rows).toEqual(compareExecutives(g, g.pets[0].id));
  }, 60000);

  it('from a tally: move below the lowest row chosen instead, or use a preferred job first; small or unprofitable differences are fine', () => {
    const plan = starterPlan();
    const id = (l: string) => plan.rows.find((r) => r.args.label === l)!.id;
    const cmp = (order: number, learned: number) => [{ mode: 'order' as const, coins: order, tiredWork: 0, switchesPerMin: 1 }, { mode: 'learned' as const, coins: learned, tiredWork: 0, switchesPerMin: 1 }];
    const ripe = id('Harvest what’s ripe'), planted = id('Every plot planted'), goods = id('Goods waiting');
    // “Every plot planted” (it has a WHEN) is skipped for “Harvest what’s ripe” and “Goods waiting”.
    const t = { n: 100, rows: { [`${planted}>${ripe}`]: 30, [`${planted}>${goods}`]: 12, [`${ripe}>${goods}`]: 2 }, jobs: {} };
    const d = diagnoseOrder(plan, cmp(200, 260), t);
    expect(d.suggestion).toMatchObject({ kind: 'move', rowId: planted, afterRowId: goods });
    expect(d.text).toContain('Move “Every plot planted” below “Goods waiting”');
    expect(applySuggestion(plan, d.suggestion!)).toBe(true);
    expect(plan.rows.findIndex((r) => r.id === planted)).toBe(plan.rows.findIndex((r) => r.id === goods) + 1);
    expect(diagnoseOrder(plan, cmp(250, 260), t).verdict).toBe('fine'); // learned picks barely earn more: fine
    expect(diagnoseOrder(plan, cmp(200, 260), { n: 100, rows: { [`${planted}>${ripe}`]: 5 }, jobs: {} }).verdict).toBe('fine'); // too rare to blame
    // A job preferred over the USE: one tap makes it the USE and keeps the old one as OR USE.
    const half = plan.rows.find((r) => r.args.label === 'Storage at most half full')!;
    const jobs = compilePlan(plan).find((r) => r.id === half.id)!.jobs;
    const jd = diagnoseOrder(plan, cmp(200, 260), { n: 100, rows: {}, jobs: { [`${half.id}|${jobs[0].key}>${jobs[1].key}`]: 20 } });
    expect(jd.suggestion).toMatchObject({ kind: 'job-first', rowId: half.id, jobIndex: 1 });
    expect(jd.text).toMatch(/prefer Basket run over Haul/);
    applySuggestion(plan, jd.suggestion!);
    expect((half.args.do as { cardId: string }).cardId).toBe('job.basketRun');
    expect((half.args.also as { cardId: string }[]).map((j) => j.cardId)).toEqual(['job.haul']);
    expect(applySuggestion(plan, { kind: 'move', rowId: 'gone', afterRowId: goods, text: '', button: '' })).toBe(false);
    void node;
  });

  it('the lesson leads with the diagnosis: check, read, a mistake, the one-tap fix, then the mode', () => {
    const g = farm(101);
    startChapter(g, 'choose');
    expect(currentStep(g)?.id).toBe('practise');
    g.progress.flags.execCompared = true; advanceTutorial(g);
    expect(currentStep(g)?.id).toBe('read');
    ackStep(g);
    expect(currentStep(g)?.id).toBe('mistake');
    g.progress.flags.execSuggested = true; advanceTutorial(g);
    expect(currentStep(g)?.id).toBe('fix');
    g.progress.flags.execApplied = true; advanceTutorial(g);
    expect(currentStep(g)?.id).toBe('mode');
  });
});
