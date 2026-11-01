import type { ObjectDef } from '../domain/types';
import { OBJECT_BY_ID } from '../domain/packs/farm';

/**
 * Deterministic tick-based gridworld shared by pens, evaluation and the farm.
 * One step = one action by the pet = one tick. Every tick returns an event list
 * that drives rewards, diagnostics, animation and the journal.
 */
export type Action = 'N' | 'E' | 'S' | 'W' | 'pick' | 'drop' | 'wait';
export const MOVES: Action[] = ['N', 'E', 'S', 'W'];
export const DIRS: Record<string, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export interface Obj {
  id: number;
  kind: string;
  x: number;
  y: number;
  carried: boolean;
  delivered: boolean;
}

export interface PetBody {
  x: number;
  y: number;
  carrying: number | null;
  facing: 'N' | 'E' | 'S' | 'W';
}

export interface World {
  w: number;
  h: number;
  tick: number;
  objects: Obj[];
  pet: PetBody;
  nextId: number;
  delivered: Record<string, number>;
}

export type SimEventType = 'tick' | 'move' | 'bump' | 'reach' | 'enter' | 'pickup' | 'drop' | 'deliver' | 'fumble';

export interface SimEvent {
  type: SimEventType;
  x: number;
  y: number;
  kind?: string;
  objId?: number;
  into?: string;
}

export function def(kind: string): ObjectDef {
  const d = OBJECT_BY_ID[kind];
  if (!d) throw new Error(`Unknown object kind ${kind}`);
  return d;
}

export function emptyWorld(w: number, h: number): World {
  return { w, h, tick: 0, objects: [], pet: { x: 0, y: 0, carrying: null, facing: 'S' }, nextId: 1, delivered: {} };
}

export function cloneWorld(w: World): World {
  return {
    ...w,
    objects: w.objects.map((o) => ({ ...o })),
    pet: { ...w.pet },
    delivered: { ...w.delivered },
  };
}

export function addObject(w: World, kind: string, x: number, y: number): Obj {
  const o: Obj = { id: w.nextId++, kind, x, y, carried: false, delivered: false };
  w.objects.push(o);
  return o;
}

/** Objects lying on the grid (not carried, not delivered). */
export function onGround(o: Obj): boolean {
  return !o.carried && !o.delivered;
}

export function objectsAt(w: World, x: number, y: number): Obj[] {
  const out: Obj[] = [];
  for (const o of w.objects) if (o.x === x && o.y === y && onGround(o)) out.push(o);
  return out;
}

export function inBounds(w: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w.w && y < w.h;
}

export function isSolidAt(w: World, x: number, y: number): boolean {
  if (!inBounds(w, x, y)) return true;
  for (const o of w.objects) if (o.x === x && o.y === y && onGround(o) && def(o.kind).solid) return true;
  return false;
}

export function isHazardAt(w: World, x: number, y: number): boolean {
  if (!inBounds(w, x, y)) return false;
  for (const o of w.objects) if (o.x === x && o.y === y && onGround(o) && def(o.kind).hazard) return true;
  return false;
}

export function legalActions(_w: World, abilities: string[]): Action[] {
  const out: Action[] = [];
  if (abilities.includes('move')) out.push(...MOVES);
  if (abilities.includes('pickup')) out.push('pick');
  if (abilities.includes('drop')) out.push('drop');
  if (out.length === 0) out.push('wait');
  return out;
}

export function nearest(w: World, kind: string, x = w.pet.x, y = w.pet.y): Obj | null {
  let best: Obj | null = null;
  let bd = Infinity;
  for (const o of w.objects) {
    if (o.kind !== kind || !onGround(o)) continue;
    const d = Math.abs(o.x - x) + Math.abs(o.y - y);
    if (d < bd || (d === bd && best && o.id < best.id)) {
      bd = d;
      best = o;
    }
  }
  return best;
}

export function distTo(w: World, kind: string, x = w.pet.x, y = w.pet.y): number {
  const o = nearest(w, kind, x, y);
  return o ? Math.abs(o.x - x) + Math.abs(o.y - y) : Infinity;
}

/** Advance the world by one tick. Mutates `w`; returns the tick's events. */
export function step(w: World, action: Action): SimEvent[] {
  const p = w.pet;
  const events: SimEvent[] = [{ type: 'tick', x: p.x, y: p.y }];
  if (action === 'N' || action === 'E' || action === 'S' || action === 'W') {
    const [dx, dy] = DIRS[action];
    const nx = p.x + dx, ny = p.y + dy;
    p.facing = action;
    if (isSolidAt(w, nx, ny)) {
      events.push({ type: 'bump', x: nx, y: ny });
    } else {
      p.x = nx;
      p.y = ny;
      events.push({ type: 'move', x: nx, y: ny });
      if (p.carrying !== null) {
        const c = w.objects.find((o) => o.id === p.carrying);
        if (c) { c.x = nx; c.y = ny; }
      }
      for (const o of objectsAt(w, nx, ny)) {
        events.push({ type: def(o.kind).hazard ? 'enter' : 'reach', x: nx, y: ny, kind: o.kind, objId: o.id });
      }
    }
  } else if (action === 'pick') {
    const target = p.carrying === null ? objectsAt(w, p.x, p.y).find((o) => def(o.kind).carryable) : undefined;
    if (target) {
      target.carried = true;
      p.carrying = target.id;
      events.push({ type: 'pickup', x: p.x, y: p.y, kind: target.kind, objId: target.id });
    } else events.push({ type: 'fumble', x: p.x, y: p.y });
  } else if (action === 'drop') {
    const c = p.carrying !== null ? w.objects.find((o) => o.id === p.carrying) : undefined;
    if (c) {
      p.carrying = null;
      c.carried = false;
      c.x = p.x;
      c.y = p.y;
      events.push({ type: 'drop', x: p.x, y: p.y, kind: c.kind, objId: c.id });
      const container = objectsAt(w, p.x, p.y).find((o) => o.id !== c.id && def(o.kind).container);
      if (container) {
        c.delivered = true;
        w.delivered[c.kind] = (w.delivered[c.kind] ?? 0) + 1;
        events.push({ type: 'deliver', x: p.x, y: p.y, kind: c.kind, objId: c.id, into: container.kind });
      }
    } else events.push({ type: 'fumble', x: p.x, y: p.y });
  }
  w.tick++;
  return events;
}

/** BFS path length (or -1) over non-solid tiles, optionally avoiding hazards. */
export function bfsDistance(w: World, fx: number, fy: number, tx: number, ty: number, avoidHazards: boolean): number {
  return bfsPath(w, fx, fy, (x, y) => x === tx && y === ty, avoidHazards)?.length ?? -1;
}

export function bfsPath(w: World, fx: number, fy: number, goal: (x: number, y: number) => boolean, avoidHazards: boolean): Action[] | null {
  const key = (x: number, y: number) => y * w.w + x;
  const prev = new Map<number, [number, Action]>();
  const seen = new Set<number>([key(fx, fy)]);
  const q: [number, number][] = [[fx, fy]];
  while (q.length) {
    const [x, y] = q.shift()!;
    if (goal(x, y)) {
      const path: Action[] = [];
      let k = key(x, y);
      while (prev.has(k)) {
        const [pk, a] = prev.get(k)!;
        path.unshift(a);
        k = pk;
      }
      return path;
    }
    for (const a of MOVES) {
      const [dx, dy] = DIRS[a];
      const nx = x + dx, ny = y + dy;
      const nk = key(nx, ny);
      if (seen.has(nk) || isSolidAt(w, nx, ny)) continue;
      if (avoidHazards && isHazardAt(w, nx, ny) && !goal(nx, ny)) continue;
      seen.add(nk);
      prev.set(nk, [key(x, y), a]);
      q.push([nx, ny]);
    }
  }
  return null;
}
