/**
 * Polish phase 4, “Teach what's there”: the new card families are taught by lessons, and the Guide's card reference
 * lists every card with where it fits and how it reads, searchable by title or hint.
 */
import { describe, expect, it } from 'vitest';
import { cardEntries, searchCards } from '../src/domain/cardref';
import { REGISTRY } from '../src/domain/registry';
import { CHAPTERS } from '../src/game/tutorial';
import { selectorText } from '../src/sim/world';
import { resolveKind } from '../src/sim/compile';
import { node } from '../src/domain/spec';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { createRuntime, farmTick, petActivity } from '../src/game/farm';
import { starterPlan } from '../src/game/plan';
import { giveFarmJobs, recipeStage, trainAndSave } from './helpers';

describe('the in-game card reference', () => {
  it('lists every card players can use, each with where it fits and a one-line example', () => {
    const all = cardEntries();
    expect(all.length).toBe([...REGISTRY.cards.values()].filter((c) => !c.retired).length);
    for (const e of all) {
      expect(e.fits.length, e.id).toBeGreaterThan(5);
      expect(e.example.length, e.id).toBeGreaterThan(1);
      expect(e.example, e.id).not.toContain('…'); // the example fills every required slot
    }
    const stored = all.find((e) => e.id === 'q.stored')!;
    expect(stored.fits).toMatch(/Compare/);
    expect(stored.example).toBe('berry stored in any storage');
    expect(all.find((e) => e.id === 'job.harvest')!.fits).toMatch(/USE/);
  });

  it('finds cards by title or by a word in their hint, title matches first', () => {
    expect(searchCards('stored')[0].title).toBe('Stored');
    expect(searchCards('counting by hand').map((e) => e.id)).toContain('q.stored'); // from its hint
    expect(searchCards('NEAREST')[0].title).toBe('Nearest');
    expect(searchCards('furthest from').map((e) => e.id)).toContain('obj.furthest');
    expect(searchCards('')).toHaveLength(cardEntries().length);
    expect(searchCards('zzzz')).toEqual([]);
  });
});

describe('lessons teach the new cards', () => {
  const text = (id: string) => JSON.stringify(CHAPTERS.find((c) => c.id === id)!.steps.map((s) => [s.title, s.text, s.why]));
  it('each new family is used by at least one lesson', () => {
    const families: [string, string, RegExp][] = [
      ['Compare and a measure (Stored)', 'plans', /Compare → Stored/],
      ['UNTIL', 'plans', /UNTIL/],
      ['OR USE', 'plans', /OR USE/],
      ['Which one (qualifiers) as a job’s aim', 'plans', /Nearest → Any ripe crop.*Nearest to/],
      ['Measures vs notes (Stored, Sold)', 'notes', /Compare → Stored.*Compare → Sold/],
      ['Long chain → routines', 'routines', /Long chain/],
      ['Learned picks', 'choose', /Learns what pays off/],
    ];
    for (const [what, lesson, re] of families) expect(text(lesson), what).toMatch(re);
  });
});

describe('building a qualifier while the farm runs', () => {
  it('a half-built “Nearest …” (nothing in What yet) reads as “…” and the farm keeps running', () => {
    expect(selectorText(resolveKind(node('obj.nearest', {})))).toBe('the nearest …');
    expect(selectorText(resolveKind(node('obj.nearest', { what: node('kind:@crop'), from: node('kind:home') })))).toBe('the nearest ripe crop to home');
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    trainAndSave(g, p, recipeStage('go-to-berry'));
    giveFarmJobs(g, p);
    g.farm.dutyPetId = p.id;
    p.plan = starterPlan();
    const ripe = p.plan.rows.find((r) => r.args.label === 'Harvest what’s ripe')!;
    const rt = createRuntime(g.farm);
    for (const aim of [node('obj.nearest', {}), node('obj.nearest', { what: node('kind:@crop') }), node('obj.nearest', { what: node('kind:@crop'), from: node('kind:home') })]) {
      (ripe.args.do as { args: Record<string, unknown> }).args.aim = aim; // the player edits it card by card
      for (let t = 0; t < 200; t++) { farmTick(g, rt); petActivity(g, p.id); }
    }
    expect(g.progress.totalCoins).toBeGreaterThan(0);
  });
});
