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
    addObject(w, 'fence', 12, y).fixed = true;
  }
  for (let x = 13; x < BIG_W; x++) addObject(w, 'fence', x, 9).fixed = true;
  const gate = addObject(w, 'gate', ORCHARD_GATE.x, ORCHARD_GATE.y);
  gate.open = true;
  gate.fixed = true;
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

