import type { ObjectDef } from '../domain/types';
import { OBJECT_BY_ID } from '../domain/packs/farm';

/**
 * Deterministic tick-based gridworld shared by pens, evaluation and the farm.
 * One step = one action by the pet = one tick. Every tick returns an event list
 * that drives rewards, diagnostics, animation and the journal.
 */
export type Action = 'N' | 'E' | 'S' | 'W' | 'pick' | 'drop' | 'wait' | 'water' | 'shoo' | 'nudge';
export const MOVES: Action[] = ['N', 'E', 'S', 'W'];
export const DIRS: Record<string, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export interface Obj {
  id: number;
  kind: string;
  x: number;
  y: number;
  carried: boolean;
  delivered: boolean;
  /** Plots: watered (grows faster until the next crop appears). */
  wet?: boolean;
  /** Gates: open (walkable) or closed (solid). Undefined = closed. */
  open?: boolean;
}

export interface PetBody {
  x: number;
  y: number;
  carrying: number | null;
  facing: 'N' | 'E' | 'S' | 'W';
  /** Consecutive ticks spent deliberately staying put (the 'wait' action). Optional for old saves. */
  still?: number;
  /** Splashes of water carried (0–3). */
  water?: number;
}

export const WATER_CAPACITY = 3;

export interface Area {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function inArea(a: Area, x: number, y: number): boolean {
  return x >= a.x && y >= a.y && x < a.x + a.w && y < a.y + a.h;
}

export interface World {
  w: number;
  h: number;
  tick: number;
  objects: Obj[];
  pet: PetBody;
  nextId: number;
  delivered: Record<string, number>;
  /** Night-time (set from the pen's Time of day card or the farm clock). */
  night?: boolean;
  /** Named areas (coop, garden…). */
  areas?: Area[];
  /** PRNG state for creatures (mulberry32), so creature motion is deterministic. */
  rng?: number;
  /** Raining (farm weather, or the Weather card in pens). */
  raining?: boolean;
  /** Energy of the pet on duty (farm only), so plan conditions can read it. */
  petEnergy?: number;
  /** Running counters (e.g. pecks). */
  counts?: Record<string, number>;
}

export type SimEventType = 'tick' | 'move' | 'bump' | 'reach' | 'enter' | 'pickup' | 'drop' | 'deliver' | 'fumble' | 'stay' | 'fill' | 'water' | 'shoo' | 'scare' | 'peck' | 'enterArea' | 'leaveArea' | 'gate';

export interface SimEvent {
  type: SimEventType;
  x: number;
  y: number;
  kind?: string;
  objId?: number;
  into?: string;
  area?: string;
  /** Gates: the state after a nudge. */
  state?: 'open' | 'closed';
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
    ...(w.areas ? { areas: w.areas.map((a) => ({ ...a })) } : {}),
    ...(w.counts ? { counts: { ...w.counts } } : {}),
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

export function blocks(o: Obj): boolean {
  return def(o.kind).solid || (o.kind === 'gate' && !o.open);
}

export function isSolidAt(w: World, x: number, y: number): boolean {
  if (!inBounds(w, x, y)) return true;
  for (const o of w.objects) if (o.x === x && o.y === y && onGround(o) && blocks(o)) return true;
  return false;
}

/** The gate a pet could nudge from where it stands (on it or next to it), if any. */
export function nudgeableGate(w: World): Obj | null {
  const p = w.pet;
  const gates = w.objects.filter((o) => o.kind === 'gate' && onGround(o) && Math.abs(o.x - p.x) + Math.abs(o.y - p.y) <= 1).sort((a, b) => a.id - b.id);
  for (const g of gates) {
    // An open gate can only be shut if nobody is standing in it.
    if (g.open && ((p.x === g.x && p.y === g.y) || w.objects.some((o) => o !== g && onGround(o) && o.x === g.x && o.y === g.y && def(o.kind).mover))) continue;
    return g;
  }
  return null;
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
  if (abilities.includes('water')) out.push('water');
  if (abilities.includes('nudge')) out.push('nudge');
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
  if (action === 'wait') {
    p.still = (p.still ?? 0) + 1;
    events.push({ type: 'stay', x: p.x, y: p.y });
  } else p.still = 0;
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
  } else if (action === 'water') {
    const here = objectsAt(w, p.x, p.y);
    const plot = here.find((o) => def(o.kind).traits.includes('Plot') && !o.wet);
    if (here.some((o) => def(o.kind).traits.includes('WaterSource'))) {
      p.water = WATER_CAPACITY;
      events.push({ type: 'fill', x: p.x, y: p.y });
    } else if ((p.water ?? 0) > 0 && plot) {
      plot.wet = true;
      p.water = (p.water ?? 0) - 1;
      events.push({ type: 'water', x: p.x, y: p.y, kind: plot.kind, objId: plot.id });
    } else events.push({ type: 'fumble', x: p.x, y: p.y });
  } else if (action === 'nudge') {
    const g = nudgeableGate(w);
    if (g) {
      g.open = !g.open;
      events.push({ type: 'gate', x: g.x, y: g.y, kind: 'gate', objId: g.id, state: g.open ? 'open' : 'closed' });
    } else events.push({ type: 'fumble', x: p.x, y: p.y });
  } else if (action === 'shoo') {
    const near = w.objects.filter((o) => onGround(o) && def(o.kind).mover && Math.abs(o.x - p.x) + Math.abs(o.y - p.y) <= 1).sort((a, b) => a.id - b.id);
    if (!near.length) events.push({ type: 'fumble', x: p.x, y: p.y });
    for (const o of near) {
      if (def(o.kind).mover === 'crow') {
        o.delivered = true; // flies off
        events.push({ type: 'scare', x: o.x, y: o.y, kind: o.kind, objId: o.id });
        continue;
      }
      const nx = o.x + (o.x - p.x), ny = o.y + (o.y - p.y);
      const before = { x: o.x, y: o.y };
      if (creatureCanEnter(w, nx, ny)) { o.x = nx; o.y = ny; }
      events.push({ type: 'shoo', x: o.x, y: o.y, kind: o.kind, objId: o.id });
      areaEvents(w, o, before, events);
    }
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
  moveCreatures(w, events);
  w.tick++;
  return events;
}

/** Deterministic creature PRNG (mulberry32 on world.rng). */
function crand(w: World): number {
  let t = (w.rng = ((w.rng ?? 0x2545f491) + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function hasCreature(w: World, x: number, y: number): boolean {
  return w.objects.some((o) => onGround(o) && o.x === x && o.y === y && !!def(o.kind).mover);
}

/** Chickens walk; they never step onto the pet, walls, hazards or other creatures. */
export function creatureCanEnter(w: World, x: number, y: number): boolean {
  return inBounds(w, x, y) && !isSolidAt(w, x, y) && !isHazardAt(w, x, y) && !(w.pet.x === x && w.pet.y === y) && !hasCreature(w, x, y);
}

export function areaOf(w: World, x: number, y: number): Area[] {
  return (w.areas ?? []).filter((a) => inArea(a, x, y));
}

function areaEvents(w: World, o: Obj, before: { x: number; y: number }, events: SimEvent[]) {
  for (const a of w.areas ?? []) {
    const was = inArea(a, before.x, before.y), now = inArea(a, o.x, o.y);
    if (!was && now) events.push({ type: 'enterArea', x: o.x, y: o.y, kind: o.kind, objId: o.id, area: a.name });
    if (was && !now) events.push({ type: 'leaveArea', x: o.x, y: o.y, kind: o.kind, objId: o.id, area: a.name });
  }
}

const CROPS = ['berry', 'carrot'];

function moveCreatures(w: World, events: SimEvent[]) {
  const movers = w.objects.filter((o) => onGround(o) && def(o.kind).mover).sort((a, b) => a.id - b.id);
  for (const o of movers) {
    if (!onGround(o)) continue;
    const before = { x: o.x, y: o.y };
    if (def(o.kind).mover === 'wander') {
      // Chickens like their coop: they wander less once inside one.
      const homey = (w.areas ?? []).some((a) => a.name === 'coop' && inArea(a, o.x, o.y));
      if (crand(w) >= (homey ? 0.06 : 0.25)) continue;
      const dirs = MOVES.filter((m) => creatureCanEnter(w, o.x + DIRS[m][0], o.y + DIRS[m][1]));
      if (!dirs.length) continue;
      const m = dirs[Math.floor(crand(w) * dirs.length)];
      o.x += DIRS[m][0];
      o.y += DIRS[m][1];
      areaEvents(w, o, before, events);
    } else {
      // Crows flap toward the nearest crop every other tick (flying over walls), keeping clear of scarecrows.
      if (crand(w) >= 0.5) continue;
      const scary = w.objects.filter((s) => onGround(s) && def(s.kind).traits.includes('Scary'));
      const safe = (x: number, y: number) => !scary.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) <= 2);
      let target: Obj | null = null, bd = Infinity;
      for (const c of w.objects) {
        if (!onGround(c) || !CROPS.includes(c.kind) || !safe(c.x, c.y)) continue;
        const d = Math.abs(c.x - o.x) + Math.abs(c.y - o.y);
        if (d < bd) { bd = d; target = c; }
      }
      if (!target) continue;
      if (bd > 0) {
        const opts = MOVES.map((m) => [o.x + DIRS[m][0], o.y + DIRS[m][1]] as const)
          .filter(([x, y]) => inBounds(w, x, y) && !(w.pet.x === x && w.pet.y === y) && safe(x, y) && !w.objects.some((c) => onGround(c) && c !== o && c.x === x && c.y === y && def(c.kind).mover))
          .sort((a, b) => (Math.abs(a[0] - target!.x) + Math.abs(a[1] - target!.y)) - (Math.abs(b[0] - target!.x) + Math.abs(b[1] - target!.y)));
        if (opts.length && Math.abs(opts[0][0] - target.x) + Math.abs(opts[0][1] - target.y) < bd) { o.x = opts[0][0]; o.y = opts[0][1]; }
      }
      if (o.x === target.x && o.y === target.y) {
        target.delivered = true;
        w.counts = { ...(w.counts ?? {}), pecks: (w.counts?.pecks ?? 0) + 1 };
        events.push({ type: 'peck', x: o.x, y: o.y, kind: target.kind, objId: target.id });
        o.delivered = true; // flies off with its prize
      }
    }
  }
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
