import type { GameState, Plot } from './types';
import { addObject } from '../sim/world';
import { addJournal } from './journal';

export const BIG_W = 16;
export const BIG_H = 12;
export const ORCHARD = { name: 'orchard', x: 13, y: 0, w: 3, h: 9 };
export const ORCHARD_GATE = { x: 12, y: 4 };

/**
 * The orchard expansion: the farm grows from 12×9 to 16×12. A fence runs down column 12 with a gate,
 * the orchard (3 berry bushes) lies behind it, and a meadow opens along the bottom.
 * Existing objects keep their positions, so learned skills face a bigger but familiar farm.
 */
export function expandFarm(s: GameState): boolean {
  const f = s.farm;
  const w = f.world;
  if (w.w >= BIG_W) return false;
  w.w = BIG_W;
  w.h = BIG_H;
  for (let y = 0; y <= 9; y++) {
    if (y === ORCHARD_GATE.y) continue;
    addObject(w, 'fence', 12, y);
  }
  for (let x = 13; x < BIG_W; x++) addObject(w, 'fence', x, 9);
  const gate = addObject(w, 'gate', ORCHARD_GATE.x, ORCHARD_GATE.y);
  gate.open = true;
  w.areas = [...(w.areas ?? []).filter((a) => a.name !== 'orchard'), { ...ORCHARD }];
  const bushes: Plot[] = [
    { x: 14, y: 1, crop: 'berry', objId: null, timer: 999, unlock: 'orchard' },
    { x: 13, y: 4, crop: 'berry', objId: null, timer: 999, unlock: 'orchard' },
    { x: 14, y: 7, crop: 'berry', objId: null, timer: 999, unlock: 'orchard' },
  ];
  for (const p of bushes) { addObject(w, 'bush', p.x, p.y); f.plots.push(p); }
  for (const [x, y] of [[0, 11], [15, 11], [6, 11]]) addObject(w, 'tree', x, y);
  for (const [x, y] of [[9, 10], [3, 10]]) addObject(w, 'rock', x, y);
  addJournal(s, null, 'expand', 'The farm grew! A fenced orchard with three berry bushes now lies behind a gate on the east side, and a meadow opens to the south. Chickens love an open gate…', true);
  return true;
}

/** Spots for bought crop plots, tried in order (the first free one wins). */
const CROP_SPOTS: Record<'pumpkin' | 'sunflower', [number, number][]> = {
  pumpkin: [[3, 8], [5, 8], [1, 8], [7, 7], [2, 6], [4, 6]],
  sunflower: [[9, 7], [10, 7], [7, 8], [9, 8], [6, 6], [4, 8]],
};

/** A bought pumpkin or sunflower patch: a new field plot, planted (the first seeds come with it). */
export function addCropPlot(s: GameState, crop: 'pumpkin' | 'sunflower'): boolean {
  const w = s.farm.world;
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < w.w && y < w.h
    && !w.objects.some((o) => !o.carried && !o.delivered && o.x === x && o.y === y)
    && !(w.pet.x === x && w.pet.y === y) && !(w.pet2 && w.pet2.x === x && w.pet2.y === y)
    && !s.farm.plots.some((p) => p.x === x && p.y === y);
  let spot = CROP_SPOTS[crop].find(([x, y]) => free(x, y));
  for (let y = w.h - 1; !spot && y >= 0; y--) for (let x = 0; !spot && x < w.w; x++) if (free(x, y)) spot = [x, y];
  if (!spot) return false;
  const o = addObject(w, 'patch', spot[0], spot[1]);
  o.crop = crop;
  s.farm.plots.push({ x: spot[0], y: spot[1], crop, objId: null, timer: 0 });
  return true;
}
