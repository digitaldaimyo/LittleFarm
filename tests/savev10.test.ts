/**
 * Polish phase 3 gate: a rich v10 save (tests/fixtures/save-v10.json.gz, made by scripts/save-v10-fixture.ts before
 * the renames) loads with every skill and responsibility intact, and the farm then plays out exactly as it did:
 * the pet's path, coins and sales over the next day are pinned (recorded at v10).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseGame } from '../src/persistence/save';
import { createRuntime, farmTick } from '../src/game/farm';
import { describe as words } from '../src/domain/describe';
import type { GameState } from '../src/game/types';
import { exportLessonCard, importLessonCard } from '../src/game/lessoncard';
import { exportSkillCard, importSkillCard } from '../src/game/skillcard';
import { renameOldCards } from '../src/domain/aliases';

const text = gunzipSync(readFileSync(new URL('./fixtures/save-v10.json.gz', import.meta.url))).toString('utf8');
const load = () => { const r = parseGame(text); expect(r.ok).toBe(true); return r.game!; };

/** What a day on the farm looks like, in terms that don't depend on internal names. */
function playDay(g: GameState) {
  const rt = createRuntime(g.farm);
  let h = 2166136261;
  for (let t = 0; t < 1200; t++) {
    farmTick(g, rt);
    const p = g.farm.world.pet;
    h = Math.imul(h ^ (p.x * 64 + p.y + (p.carrying ? 4096 : 0)), 16777619) >>> 0;
  }
  return { path: h.toString(16), coins: g.progress.totalCoins, tick: g.farm.tick, sold: g.farm.world.soldKinds };
}

describe('a v10 save', () => {
  it('loads with every skill, revision and responsibility', () => {
    const g = load();
    expect(g.pets.map((p) => p.name)).toEqual(['Pip', 'Mochi']);
    const pip = g.pets[0];
    expect(pip.skills.map((k) => `${k.name} r${k.activeRev}`)).toEqual(['Approach r1', 'Fetch r1', 'Harvest r1', 'Plant r1', 'Harvest to storage r1', 'Basket run r1']);
    expect(g.pets[1].skills.map((k) => k.name)).toEqual(['Approach']);
    expect(pip.plan!.rows.map((r) => r.args.label)).toEqual(['Holding a basket', 'Furthest berry first', 'Fireflies out', 'Finish what’s in your paws', 'Basket needs a run', 'Storage at most half full', 'Every plot planted', 'Harvest what’s ripe', 'Goods waiting', 'Otherwise nap']);
    const slot = (v: unknown): string => (Array.isArray(v) ? v.map(slot).join(' & ') : v && typeof v === 'object' && 'cardId' in v ? words(v as never, { petName: 'Pip' }) : String(v ?? ''));
    expect(pip.plan!.rows.map((r) => ['if', 'do', 'also', 'until', 'night'].map((k) => `${k}: ${slot(r.args[k])}`).join(' | '))).toMatchSnapshot();
    expect(Object.keys(pip.executive.values!.upper).length).toBeGreaterThan(0);
    expect(pip.executive.values!.practised).toBe(1200);
    expect(g.stages.find((s) => s.id === 'stage-custom')!.rules.at(-1)!.args.label).toBe('Two stored');
  });

  it('comes out as v11: new card and job ids everywhere, retired fields gone, key order kept', () => {
    const g = load();
    const pip = g.pets[0];
    const json = JSON.stringify(g);
    for (const old of ['job.forage', 'job.deliver', 'job.tote', 'plan.row', '"forage"', '|forage', '"tote"', '"chooser"']) expect(json).not.toContain(old);
    expect(pip.plan!.rows.every((r) => r.cardId === 'plan.responsibility')).toBe(true);
    expect(Object.keys(pip.evidence!)).toEqual(['harvest', 'plant', 'haul', 'basketRun', 'catch']); // same order as at v10
    expect(Object.keys(pip.executive.values!.lower).some((k) => k.endsWith('|harvest'))).toBe(true);
    expect(pip.executive.mode).toBe('learned');
    expect(g.pets[1].executive.mode).toBe('order');
    expect('table' in pip.executive).toBe(false);
    expect(g.farm.current?.behaviorId).toBe('harvest');
    expect(g.farm.current?.args.cap).toBe('harvest');
  });

  it('cards with old ids load under the new names (skill cards; lesson cards go through the same rename)', () => {
    const g = load();
    expect(importLessonCard(g, JSON.stringify(exportLessonCard(g.stages.find((s) => s.id === 'stage-custom')!))).ok).toBe(true);
    const sk = JSON.stringify(exportSkillCard(g.pets[0], 'Harvest')).replaceAll('"job.harvest"', '"job.forage"');
    const back = JSON.parse(sk);
    back.revision.stage.rules.push({ id: 'x1', cardId: 'plan.row', args: {} }); // an old id deep inside
    renameOldCards(back);
    expect(JSON.stringify(back)).not.toContain('plan.row');
    expect(importSkillCard(g, g.pets[1], sk).ok).toBe(true);
  });

  it('plays the next farm day exactly as it did at v10', () => {
    expect(playDay(load())).toMatchSnapshot();
  });
});
