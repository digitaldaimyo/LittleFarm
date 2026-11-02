import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { createRuntime, farmTick, setOnDuty } from '../src/game/farm';
import { expandFarm } from '../src/game/expand';
import { applyLayout, canMove, canPlace, move, place, plotBudget, previewLayout, remove, startLayout, unreachable } from '../src/game/layout';
import { parseGame, serializeGame } from '../src/persistence/save';
import { buildHand } from '../src/domain/hand';
import { REGISTRY } from '../src/domain/registry';
import { nominal } from '../src/domain/typecheck';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { objectsAt } from '../src/sim/world';
import type { GameState } from '../src/game/types';
import { recipeStage, trainAndSave, giveHarvest } from './helpers';

function farm(coins = 100, unlocks: string[] = []): GameState {
  const s = newGame();
  const p = adoptPet(s, 'Pip', 'meadow');
  p.traits = { ...DEFAULT_TRAITS };
  trainAndSave(s, p, recipeStage('go-to-berry'));
  giveHarvest(s, p);
  p.assignment = { mode: 'auto', job: 'forage', navigator: 'Approach' };
  s.farm.dutyPetId = p.id;
  s.resources.coins = coins;
  s.progress.unlocks.push(...unlocks);
  return s;
}
const kindsAt = (s: GameState, x: number, y: number) => objectsAt(s.farm.world, x, y).map((o) => o.kind);

describe('farm layout: place, pay on apply', () => {
  it('a basket placed in the draft costs nothing until applied, then is empty storage on the farm', () => {
    const s = farm(20);
    const d = startLayout(s);
    expect(place(s, d, 'bin', 9, 2).ok).toBe(true);
    expect(d.cost).toBe(6);
    expect(s.resources.coins).toBe(20);
    expect(kindsAt(s, 9, 2)).toEqual([]); // the real farm is untouched
    expect(applyLayout(s, d).ok).toBe(true);
    expect(s.resources.coins).toBe(14);
    const b = objectsAt(s.farm.world, 9, 2)[0];
    expect(b.kind).toBe('bin');
    expect(b.store).toEqual([{ kind: null, n: 0 }]);
    expect(s.journal.some((j) => j.kind === 'layout')).toBe(true);
  });

  it('refuses with a reason: door, coop, occupied, off the farm, locked, too many, no room, no coins', () => {
    const s = farm(20);
    const d = startLayout(s);
    const why = (id: Parameters<typeof canPlace>[2], x: number, y: number) => { const r = canPlace(s, d, id, x, y); return r.ok ? 'ok' : r.reason; };
    expect(why('bush', 1, 2)).toMatch(/door/);
    expect(why('bush', 0, 5)).toMatch(/coop/);
    expect(why('bush', 2, 3)).toMatch(/already there/);
    expect(why('bush', 20, 3)).toMatch(/off the farm/);
    expect(why('carrot', 6, 8)).toMatch(/not unlocked/);
    expect(why('shed', 6, 8)).toMatch(/not unlocked/);
    for (const [x, y] of [[6, 8], [7, 8], [5, 8]]) expect(place(s, d, 'bin', x, y).ok).toBe(true);
    expect(why('bin', 3, 8)).toMatch(/4 at most/);
    expect(why('bush', 3, 8)).toMatch(/Not enough coins/); // 18 of 20 coins spent, and a bush is 4
    s.resources.coins = 200;
    for (const [x, y] of [[3, 8], [6, 6], [7, 6], [9, 8], [10, 8]]) place(s, d, 'bush', x, y);
    expect(d.plots.length).toBe(plotBudget(d.world));
    expect(why('bush', 1, 8)).toMatch(/fields are full: 8/);
  });

  it('never cuts anything off from the house: walling in the well is refused on the last fence', () => {
    const s = farm(30, ['fences']);
    const d = startLayout(s);
    for (const [x, y] of [[2, 1], [4, 1], [3, 0]]) expect(place(s, d, 'fence', x, y).ok).toBe(true);
    const r = canPlace(s, d, 'fence', 3, 2);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/cut the well off/);
    expect(unreachable(d.world)).toBeNull();
  });
});

describe('farm layout: remove and move', () => {
  it('removing refunds half (all of it if placed in this draft); full storage, the house and rocks can’t go', () => {
    const s = farm(10);
    const d = startLayout(s);
    expect(remove(d, 9, 1).ok).toBe(true); // a starting bush (worth 4): +2
    expect(d.cost).toBe(-2);
    place(s, d, 'bin', 9, 2);
    remove(d, 9, 2);
    expect(d.cost).toBe(-2); // undo is free
    expect(remove(d, 1, 1).ok).toBe(false);
    expect(remove(d, 8, 6).ok).toBe(false); // a rock: move it instead
    d.world.objects.find((o) => o.kind === 'bin')!.store = [{ kind: 'berry', n: 2 }];
    const r = remove(d, 2, 3);
    expect(!r.ok && r.reason).toMatch(/Empty it first/);
    applyLayout(s, d);
    expect(s.resources.coins).toBe(12);
    expect(s.farm.plots.some((p) => p.x === 9 && p.y === 1)).toBe(false);
  });

  it('moving a bush takes its plot (and a ripe berry) along; it keeps growing at the new spot', () => {
    const s = farm();
    s.farm.dutyPetId = null;
    const rt = createRuntime(s.farm);
    farmTick(s, rt); // bushes fruit
    expect(kindsAt(s, 10, 5)).toEqual(expect.arrayContaining(['bush', 'berry']));
    const d = startLayout(s);
    expect(move(d, 10, 5, 7, 7).ok).toBe(true);
    applyLayout(s, d);
    expect(kindsAt(s, 7, 7).sort()).toEqual(['berry', 'bush']);
    expect(kindsAt(s, 10, 5)).toEqual([]);
    s.farm.world.objects.find((o) => o.kind === 'berry' && o.x === 7)!.delivered = true; // picked
    for (let i = 0; i < 40; i++) farmTick(s, createRuntime(s.farm));
    expect(kindsAt(s, 7, 7)).toContain('berry');
  });

  it('the orchard’s fence and gate, the house, the well and the pond stay put', () => {
    const s = farm(100, ['custom']);
    expandFarm(s);
    const d = startLayout(s);
    for (const [x, y] of [[12, 0], [12, 4], [1, 1], [3, 1], [5, 2]]) expect(canMove(d, x, y, 7, 8).ok, `${x},${y}`).toBe(false);
    expect(canMove(d, 8, 6, 7, 8).ok).toBe(true); // a rock can move
    expect(plotBudget(d.world)).toBe(14);
  });
});

describe('farm layout: crops, previews, pens and saves', () => {
  it('a pumpkin patch comes planted and ripens; placing it lets pumpkins into pens', () => {
    const s = farm(40, ['carrots']);
    s.farm.dutyPetId = null;
    const hand = () => { const h = buildHand(REGISTRY, { socket: nominal('Kind'), stage: recipeStage('go-to-berry'), unlocks: new Set(s.progress.unlocks), recent: [], favorites: [], itBound: false, placing: true }); return [...h.recommended, ...Object.values(h.bySheet).flat()].find((c) => c.card.id === 'kind:pumpkin'); };
    expect(hand()?.status).toBe('locked');
    expect(hand()?.reason).toMatch(/Layout/);
    const d = startLayout(s);
    expect(place(s, d, 'pumpkin', 6, 8).ok).toBe(true);
    expect(place(s, d, 'sunflower', 7, 8).ok).toBe(true);
    applyLayout(s, d);
    expect(kindsAt(s, 6, 8)).toEqual(['patch']);
    expect(s.progress.unlocks).toEqual(expect.arrayContaining(['pumpkins', 'sunflowers']));
    expect(hand()?.status).not.toBe('locked');
    const rt = createRuntime(s.farm);
    for (let i = 0; i < 130; i++) farmTick(s, rt);
    expect(kindsAt(s, 6, 8)).toContain('pumpkin');
  });

  it('a shed (after Fetch) is placed as 4 empty slots', () => {
    const s = farm(30, ['fetch']);
    const d = startLayout(s);
    expect(place(s, d, 'shed', 2, 2).ok).toBe(true);
    applyLayout(s, d);
    expect(objectsAt(s.farm.world, 2, 2)[0].store).toHaveLength(4);
  });

  it('preview compares the farm as it is with the draft, from the same moment, without changing anything', () => {
    const s = farm(30);
    const before = JSON.stringify(s);
    const d = startLayout(s);
    remove(d, 9, 1);
    remove(d, 10, 5); // no bushes: nothing to harvest
    const pv = previewLayout(s, d, 400);
    expect(pv.current).toBeGreaterThan(pv.draft);
    expect(pv.draft).toBe(0);
    expect(previewLayout(s, d, 400)).toEqual(pv); // deterministic
    expect(JSON.stringify(s)).toBe(before);
  });

  it('v6 saves: plots that waited for old shop items are removed; bought ones stay', () => {
    const s = farm();
    const old = JSON.parse(serializeGame(s));
    old.version = 6; old.game.version = 6;
    const w = old.game.farm.world;
    old.game.farm.plots.push({ x: 8, y: 8, crop: 'berry', objId: null, timer: 999, unlock: 'bushes' }, { x: 6, y: 7, crop: 'carrot', objId: null, timer: 999, unlock: 'patch2' });
    w.objects.push({ id: 900, kind: 'bush', x: 8, y: 8, carried: false, delivered: false }, { id: 901, kind: 'patch', x: 6, y: 7, carried: false, delivered: false });
    old.game.progress.unlocks.push('patch2');
    const r = parseGame(JSON.stringify(old));
    expect(r.ok).toBe(true);
    const f = r.game!.farm;
    expect(f.plots.some((p) => p.x === 8 && p.y === 8)).toBe(false);
    expect(f.world.objects.some((o) => o.x === 8 && o.y === 8)).toBe(false);
    expect(f.plots.some((p) => p.x === 6 && p.y === 7)).toBe(true);
  });
});

describe('farm layout: two pets and the Field Guide', () => {
  it('with two pets on duty, a resting pet naps at the house instead of in the other’s way', () => {
    const s = farm();
    const b = adoptPet(s, 'Mochi', 'plum');
    b.traits = { ...DEFAULT_TRAITS };
    b.assignment = { mode: 'job', job: 'rest', navigator: 'Approach' };
    setOnDuty(s, b.id, true);
    const rt = createRuntime(s.farm);
    for (let i = 0; i < 40; i++) farmTick(s, rt);
    const w = s.farm.world;
    expect(objectsAt(w, w.crew![0].x, w.crew![0].y).some((o) => o.kind === 'home')).toBe(true);
  });

  it('lesson 10 opens once a pet has Fetch and walks through basket → preview → crop closer → apply', async () => {
    const { CHAPTERS, startChapter, currentStep, advanceTutorial } = await import('../src/game/tutorial');
    const { getSkill } = await import('../src/game/pets');
    const s = farm();
    const ch = CHAPTERS.find((c) => c.id === 'layout')!;
    expect(ch.offered(s)).toBe(false);
    trainAndSave(s, s.pets[0], recipeStage('bring-it-home'));
    expect(getSkill(s.pets[0], 'Fetch')).toBeTruthy();
    expect(ch.offered(s)).toBe(true);
    startChapter(s, 'layout');
    const ids: string[] = [];
    for (const f of ['layoutOpened', 'layoutBasketByBushes', 'layoutPreviewed', 'layoutPreviewedCloser', 'layoutApplied']) {
      ids.push(currentStep(s)!.id);
      s.progress.flags[f] = true;
      advanceTutorial(s);
    }
    expect(ids).toEqual(['open', 'basket', 'preview', 'closer', 'apply']);
    expect(currentStep(s)!.id).toBe('room');
  });
});
