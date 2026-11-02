import type { GameState, Plot } from './types';
import { addObject, def, emptyStore, inArea, onGround, type Obj, type World } from '../sim/world';
import { addJournal } from './journal';
import { createRuntime, farmTick } from './farm';

/**
 * Farm life phase C: your farm layout. The player edits a *draft* of the farm (the real farm pauses while the
 * Layout panel is open), sees each placement validated as they go, can preview the draft against the current
 * farm, and then applies it, paying for what was added (removed items refund half their price).
 */

export type LayoutItemId = 'bush' | 'carrot' | 'sunflower' | 'pumpkin' | 'bin' | 'shed' | 'scarecrow' | 'fence';

export interface LayoutItem {
  id: LayoutItemId;
  label: string;
  /** The object placed (field crops are placed as a planted patch: the first seeds come with it). */
  kind: string;
  price: number;
  /** The crop plot this places (counts toward the plot budget). */
  crop?: Plot['crop'];
  requires?: string;
  /** Most of these the farm may have. */
  max?: number;
  /** Pen-card unlock this placement grants (so the thing can be used in pens too). */
  grants?: string;
  describe: string;
}

export const LAYOUT_ITEMS: LayoutItem[] = [
  { id: 'bush', label: 'Berry bush', kind: 'bush', price: 4, crop: 'berry', describe: 'Perennial: regrows by itself, no seeds. Berries sell for 2.' },
  { id: 'carrot', label: 'Carrot patch', kind: 'patch', price: 3, crop: 'carrot', requires: 'carrots', describe: 'Seed 1, grows in 44 ticks, sells for 5. Replant after each harvest.' },
  { id: 'sunflower', label: 'Sunflower patch', kind: 'patch', price: 5, crop: 'sunflower', requires: 'carrots', grants: 'sunflowers', describe: 'Seed 2, grows in 70, sells for 7. Crows love them.' },
  { id: 'pumpkin', label: 'Pumpkin patch', kind: 'patch', price: 6, crop: 'pumpkin', requires: 'carrots', grants: 'pumpkins', describe: 'Seed 3, grows in 120, sells for 12.' },
  { id: 'bin', label: 'Basket', kind: 'bin', price: 6, max: 4, describe: 'Stores 6 of one kind. Pets with Fetch store harvests in the nearest one with room.' },
  { id: 'shed', label: 'Shed', kind: 'shed', price: 25, max: 2, requires: 'fetch', describe: 'Stores 4 kinds, 10 each.' },
  { id: 'scarecrow', label: 'Scarecrow', kind: 'scarecrow', price: 8, max: 2, requires: 'custom', grants: 'scarecrow', describe: 'Crows won’t come within 2 tiles of it.' },
  { id: 'fence', label: 'Fence', kind: 'fence', price: 1, requires: 'fences', describe: 'A wall piece. Pets walk around it.' },
];
export const LAYOUT_BY_ID = Object.fromEntries(LAYOUT_ITEMS.map((i) => [i.id, i])) as Record<LayoutItemId, LayoutItem>;

/** Kinds that can be moved (placeable things plus trees and rocks). The house, well, pond, gate and coop stay put. */
const MOVABLE = new Set(['bush', 'patch', 'soil', 'bin', 'shed', 'scarecrow', 'fence', 'tree', 'rock']);
/** Kinds whose position the layout checks are reachable from the house. */
const MUST_REACH = new Set(['home', 'well', 'bin', 'shed', 'bush', 'patch', 'soil', 'gate']);
const CROP_KINDS = new Set(['berry', 'carrot', 'pumpkin', 'sunflower']);
/** The tile below the house: its door. Nothing may block it. */
export const DOOR = { x: 1, y: 2 };

export interface LayoutDraft {
  world: World;
  plots: Plot[];
  /** Net coins: positive = to pay on apply, negative = a refund. */
  cost: number;
  /** Ids of objects placed in this draft (removing one refunds its full price: it's an undo). */
  placed: number[];
  /** Pen-card unlocks the placements grant on apply. */
  grants: string[];
  /** What changed, in words (shown in the panel and the journal). */
  changes: string[];
}

export type LayoutResult = { ok: true } | { ok: false; reason: string };

export function startLayout(s: GameState): LayoutDraft {
  return { world: structuredClone(s.farm.world), plots: structuredClone(s.farm.plots), cost: 0, placed: [], grants: [], changes: [] };
}

/** How many crop plots the farm may have: 8 on the starting farm, 14 once the orchard expansion grows it. */
export function plotBudget(w: World): number {
  return w.w >= 16 ? 14 : 8;
}

export function plotCount(d: LayoutDraft): number {
  return d.plots.length;
}

/** The "thing" on a tile, for moving and removing: a plot base or a placed object (not crops, creatures or carried items). */
export function layoutObjectAt(w: World, x: number, y: number): Obj | undefined {
  return w.objects.find((o) => o.x === x && o.y === y && onGround(o) && !CROP_KINDS.has(o.kind) && !['chicken', 'crow', 'egg', 'firefly', 'buddy'].includes(o.kind));
}

function itemFor(o: Obj): LayoutItem | undefined {
  if (o.kind === 'patch' || o.kind === 'soil') return LAYOUT_ITEMS.find((i) => i.crop === (o.crop ?? 'carrot'));
  return LAYOUT_ITEMS.find((i) => i.kind === o.kind);
}

/** Why a thing on this tile can't be moved or removed (or null if it can). */
export function fixedReason(o: Obj | undefined): string | null {
  if (!o) return 'There’s nothing here to move.';
  if (o.fixed) return 'The orchard’s fence and gate stay where the expansion put them.';
  if (o.kind === 'home') return 'The house stays put.';
  if (o.kind === 'well') return 'The well stays put.';
  if (o.kind === 'pond') return 'The pond stays put.';
  if (o.kind === 'gate') return 'Gates stay put.';
  if (!MOVABLE.has(o.kind)) return 'That can’t be moved.';
  return null;
}

function inCoop(w: World, x: number, y: number): boolean {
  return (w.areas ?? []).some((a) => a.name === 'coop' && inArea(a, x, y));
}

/** Why nothing can go on this tile (or null if it's free). */
function tileReason(w: World, x: number, y: number, ignore?: Obj): string | null {
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 'That’s off the farm.';
  if (x === DOOR.x && y === DOOR.y) return 'That’s the house’s door — keep it clear.';
  if (inCoop(w, x, y)) return 'The coop stays a 2×2 space for the chickens.';
  if (w.objects.some((o) => o !== ignore && o.x === x && o.y === y && onGround(o))) return 'Something is already there.';
  if ((w.pet.x === x && w.pet.y === y) || (w.crew ?? []).some((b) => b.x === x && b.y === y)) return 'A pet is standing there.';
  return null;
}

/**
 * Is everything that matters reachable from the house's door? Walks over non-solid tiles (gates count as
 * open — pets can nudge them). A solid thing that matters counts as reached when a walkable tile touches it.
 */
export function unreachable(w: World): Obj | null {
  const solid = (x: number, y: number) => w.objects.some((o) => o.x === x && o.y === y && onGround(o) && o.kind !== 'gate' && def(o.kind).solid);
  const seen = new Set<number>();
  const key = (x: number, y: number) => y * w.w + x;
  const q: [number, number][] = [[DOOR.x, DOOR.y]];
  seen.add(key(DOOR.x, DOOR.y));
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h || seen.has(key(nx, ny)) || solid(nx, ny)) continue;
      seen.add(key(nx, ny));
      q.push([nx, ny]);
    }
  }
  const reached = (x: number, y: number) => seen.has(key(x, y)) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(key(x + dx, y + dy)));
  for (const o of w.objects) if (onGround(o) && MUST_REACH.has(o.kind) && !reached(o.x, o.y)) return o;
  for (const a of w.areas ?? []) if (a.name === 'coop' && !reached(a.x, a.y)) return { id: -1, kind: 'coop', x: a.x, y: a.y, carried: false, delivered: false };
  return null;
}

const NAME = (k: string) => (k === 'coop' ? 'the coop' : k === 'home' ? 'the house' : `the ${def(k).name.toLowerCase()}`);

/** Try a change on a copy of the draft's world; if it leaves something unreachable, say what. */
function checkReach(w: World, change: (w: World) => void): string | null {
  const copy = structuredClone(w);
  change(copy);
  const bad = unreachable(copy);
  return bad ? `That would cut ${NAME(bad.kind)} off from the house.` : null;
}

export function canPlace(s: GameState, d: LayoutDraft, id: LayoutItemId, x: number, y: number): LayoutResult {
  const it = LAYOUT_BY_ID[id];
  if (!it) return { ok: false, reason: 'Unknown item.' };
  if (it.requires && !s.progress.unlocks.includes(it.requires)) return { ok: false, reason: `${it.label}: not unlocked yet.` };
  if (it.max && d.world.objects.filter((o) => onGround(o) && o.kind === it.kind).length >= it.max) return { ok: false, reason: `The farm has room for ${it.max} at most.` };
  if (it.crop && plotCount(d) >= plotBudget(d.world)) return { ok: false, reason: `The fields are full: ${plotBudget(d.world)} crop plots at most${d.world.w < 16 ? ' (the orchard expansion adds room)' : ''}. Remove one first.` };
  if (s.resources.coins < d.cost + it.price) return { ok: false, reason: `Not enough coins (${it.price} more needed).` };
  const tile = tileReason(d.world, x, y);
  if (tile) return { ok: false, reason: tile };
  const r = checkReach(d.world, (w) => { addObject(w, it.kind, x, y); });
  if (r) return { ok: false, reason: r };
  return { ok: true };
}

export function place(s: GameState, d: LayoutDraft, id: LayoutItemId, x: number, y: number): LayoutResult {
  const ok = canPlace(s, d, id, x, y);
  if (!ok.ok) return ok;
  const it = LAYOUT_BY_ID[id];
  const o = addObject(d.world, it.kind, x, y);
  if (it.crop && it.crop !== 'berry') o.crop = it.crop;
  const st = emptyStore(it.kind);
  if (st) o.store = st;
  if (it.crop) d.plots.push({ x, y, crop: it.crop, objId: null, timer: 0 });
  d.cost += it.price;
  d.placed.push(o.id);
  if (it.grants && !d.grants.includes(it.grants)) d.grants.push(it.grants);
  d.changes.push(`placed a ${it.label.toLowerCase()} (${it.price})`);
  return { ok: true };
}

/** What removing the thing on this tile would refund (half its price; a thing placed in this draft: all of it). */
export function refundFor(d: LayoutDraft, o: Obj): number {
  const it = itemFor(o);
  if (!it || ['tree', 'rock'].includes(o.kind)) return 0;
  return d.placed.includes(o.id) ? it.price : Math.floor(it.price / 2);
}

export function canRemove(d: LayoutDraft, x: number, y: number): LayoutResult {
  const o = layoutObjectAt(d.world, x, y);
  const fixed = fixedReason(o);
  if (fixed) return { ok: false, reason: fixed };
  if (!itemFor(o!) || ['tree', 'rock'].includes(o!.kind)) return { ok: false, reason: 'Trees and rocks can be moved, not removed.' };
  if (o!.store?.some((sl) => sl.n > 0)) return { ok: false, reason: 'Empty it first: haul what’s inside to the house.' };
  return { ok: true };
}

export function remove(d: LayoutDraft, x: number, y: number): LayoutResult {
  const ok = canRemove(d, x, y);
  if (!ok.ok) return ok;
  const o = layoutObjectAt(d.world, x, y)!;
  const refund = refundFor(d, o);
  const it = itemFor(o)!;
  // A plot goes with whatever grows on it.
  d.world.objects = d.world.objects.filter((x2) => !(x2.x === o.x && x2.y === o.y && onGround(x2) && (x2 === o || (it.crop && CROP_KINDS.has(x2.kind)))));
  if (it.crop) d.plots = d.plots.filter((p) => !(p.x === o.x && p.y === o.y));
  d.cost -= refund;
  d.placed = d.placed.filter((i) => i !== o.id);
  d.changes.push(`removed a ${it.label.toLowerCase()} (+${refund})`);
  return { ok: true };
}

export function canMove(d: LayoutDraft, fx: number, fy: number, tx: number, ty: number): LayoutResult {
  const o = layoutObjectAt(d.world, fx, fy);
  const fixed = fixedReason(o);
  if (fixed) return { ok: false, reason: fixed };
  if (fx === tx && fy === ty) return { ok: false, reason: 'Pick a different tile.' };
  const movers = d.world.objects.filter((x) => x.x === fx && x.y === fy && onGround(x) && (x === o || CROP_KINDS.has(x.kind)));
  const tile = tileReason(d.world, tx, ty);
  if (tile) return { ok: false, reason: tile };
  const r = checkReach(d.world, (w) => { for (const m of w.objects) if (movers.some((x) => x.id === m.id)) { m.x = tx; m.y = ty; } });
  if (r) return { ok: false, reason: r };
  return { ok: true };
}

export function move(d: LayoutDraft, fx: number, fy: number, tx: number, ty: number): LayoutResult {
  const ok = canMove(d, fx, fy, tx, ty);
  if (!ok.ok) return ok;
  const o = layoutObjectAt(d.world, fx, fy)!;
  for (const m of d.world.objects) if (m.x === fx && m.y === fy && onGround(m) && (m === o || CROP_KINDS.has(m.kind))) { m.x = tx; m.y = ty; }
  for (const p of d.plots) if (p.x === fx && p.y === fy) { p.x = tx; p.y = ty; }
  d.changes.push(`moved the ${def(o.kind).name.toLowerCase()}`);
  return { ok: true };
}

/** Pay (or refund) and make the draft the farm. */
export function applyLayout(s: GameState, d: LayoutDraft): LayoutResult {
  if (s.resources.coins < d.cost) return { ok: false, reason: `Not enough coins: this layout costs ${d.cost}.` };
  const bad = unreachable(d.world);
  if (bad) return { ok: false, reason: `${NAME(bad.kind)} can’t be reached from the house.` };
  s.farm.world = d.world;
  s.farm.plots = d.plots;
  s.resources.coins -= d.cost;
  for (const g of d.grants) if (!s.progress.unlocks.includes(g)) s.progress.unlocks.push(g);
  s.farm.layoutEdits = (s.farm.layoutEdits ?? 0) + 1;
  if (d.changes.length) addJournal(s, null, 'layout', `New farm layout: ${d.changes.join(', ')}${d.cost > 0 ? ` — ${d.cost} coins` : d.cost < 0 ? ` — ${-d.cost} coins back` : ''}.`);
  return { ok: true };
}

export interface LayoutPreview { ticks: number; current: number; draft: number }

/**
 * Run the farm as it is and as drafted, from the same moment, with the same pets and jobs, and compare the
 * coins earned (sales and fireflies, minus seeds). The draft's price isn't included.
 */
export function previewLayout(s: GameState, d: LayoutDraft, ticks = 600): LayoutPreview {
  const run = (world: World, plots: Plot[]) => {
    const copy: GameState = structuredClone(s);
    copy.farm.world = structuredClone(world);
    copy.farm.plots = structuredClone(plots);
    copy.journal = [];
    const rt = createRuntime(copy.farm);
    const c0 = copy.resources.coins;
    for (let i = 0; i < ticks; i++) farmTick(copy, rt);
    return copy.resources.coins - c0;
  };
  return { ticks, current: run(s.farm.world, s.farm.plots), draft: run(d.world, d.plots) };
}
