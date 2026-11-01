import type { Action, World } from '../sim/world';
import { DIRS, MOVES, isHazardAt, isSolidAt, nearest, objectsAt } from '../sim/world';

/**
 * Navigation observation: a compact, layout-independent state so a skill learned
 * in one pen transfers to unseen layouts and to the bigger farm.
 *   direction to the nearest focus object (9: 8 compass + here)
 * × distance bucket (3: ≤1, 2–3, 4+)
 * × blocked neighbours N/E/S/W (16)
 * × hazard neighbours N/E/S/W (16)
 * × last heading (4) — lets the pet tell "pressing on" from "doubling back"
 */
export const NAV_STATES = 9 * 3 * 16 * 16 * 4;
export const NAV_ACTIONS: Action[] = MOVES;

export interface NavObs {
  index: number;
  heading: number;
  dir: number;
  dist: number;
  blocked: number;
  hazard: number;
}

export function navObserve(w: World, focus: string): NavObs | null {
  const t = nearest(w, focus);
  if (!t) return null;
  const dx = t.x - w.pet.x, dy = t.y - w.pet.y;
  const dir = (Math.sign(dx) + 1) * 3 + (Math.sign(dy) + 1);
  const d = Math.abs(dx) + Math.abs(dy);
  const db = d <= 1 ? 0 : d <= 3 ? 1 : 2;
  let blocked = 0, hazard = 0;
  MOVES.forEach((m, i) => {
    const [mx, my] = DIRS[m];
    const nx = w.pet.x + mx, ny = w.pet.y + my;
    if (isSolidAt(w, nx, ny)) blocked |= 1 << i;
    // A hazard tile that *is* the goal tile isn't something to avoid.
    if (isHazardAt(w, nx, ny) && !(nx === t.x && ny === t.y)) hazard |= 1 << i;
  });
  const heading = MOVES.indexOf(w.pet.facing);
  return { index: navIndex(dir, db, blocked, hazard, heading), heading, dir, dist: d, blocked, hazard };
}

/** Legal movement actions (indices into NAV_ACTIONS): walking into walls/rocks/edges is not allowed. */
export function legalMoves(o: NavObs): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++) if (!(o.blocked & (1 << i))) out.push(i);
  return out.length ? out : [0, 1, 2, 3];
}

export function navIndex(dir: number, db: number, blocked: number, hazard: number, heading: number): number {
  return (((dir * 3 + db) * 16 + blocked) * 16 + hazard) * 4 + heading;
}

export function atFocus(w: World, focus: string): boolean {
  return objectsAt(w, w.pet.x, w.pet.y).some((o) => o.kind === focus);
}

/**
 * Fetch controller observation (16 states): carrying × at item × at destination × item exists.
 */
export const FETCH_STATES = 16;
export type FetchOption = 'goItem' | 'goDest' | 'pick' | 'drop';
export const FETCH_OPTIONS: FetchOption[] = ['goItem', 'goDest', 'pick', 'drop'];

export function fetchObserve(w: World, item: string, dest: string): number {
  const carrying = w.pet.carrying !== null ? 1 : 0;
  const here = objectsAt(w, w.pet.x, w.pet.y);
  const atItem = here.some((o) => o.kind === item) ? 1 : 0;
  const atDest = here.some((o) => o.kind === dest) ? 1 : 0;
  // "Crop visible" only matters while empty-pawed; once carrying, the job is the bin.
  const exists = !carrying && nearest(w, item) ? 1 : 0;
  return carrying | (atItem << 1) | (atDest << 2) | (exists << 3);
}

/** Options that make sense in a controller state (indices into FETCH_OPTIONS). */
export function legalOptions(s: number): number[] {
  const carrying = s & 1, atItem = s & 2, atDest = s & 4, exists = s & 8;
  const out: number[] = [];
  if (!carrying && exists && !atItem) out.push(0);
  if (!atDest) out.push(1);
  if (!carrying && atItem) out.push(2);
  if (carrying) out.push(3);
  return out.length ? out : [1];
}

export function describeFetchState(s: number): string {
  const parts = [s & 1 ? 'carrying' : 'empty-pawed', s & 2 ? 'on the crop' : '', s & 4 ? 'at the bin' : '', s & 8 ? 'crop visible' : s & 1 ? '' : 'no crop in sight'];
  return parts.filter(Boolean).join(', ');
}
