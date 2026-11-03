import type { ObjectDef } from '../domain/types';
import { OBJECT_BY_ID } from '../domain/packs/farm';

/**
 * Deterministic tick-based gridworld shared by pens, evaluation and the farm.
 * One step = one action by the pet = one tick. Every tick returns an event list
 * that drives rewards, diagnostics, animation and the journal.
 */
export type Action = 'N' | 'E' | 'S' | 'W' | 'pick' | 'drop' | 'wait' | 'water' | 'shoo' | 'nudge' | 'plant' | 'lift';
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
  /** Transient: claimed by the other pet on duty during this pet's turn (never saved as true). */
  hidden?: boolean;
  /**
   * Farm storage (baskets, sheds): slots of one kind each, up to the kind's `storage.perSlot`. Only objects
   * that have this are limited; pens' containers take anything, as before.
   */
  store?: StoreSlot[];
  /** Field plots (soil / patch): which crop is (or will be) planted here. Default carrot. */
  crop?: string;
  /** Plots on the farm (bush / patch): ticks until the next crop is ripe (the Time until ripe measure). */
  ripeIn?: number;
  /** Farm layout: part of a fixed structure (the orchard's fence and gate) — can't be moved or removed. */
  fixed?: boolean;
}

/** What it costs to plant this crop (perennials and non-crops: 0). */
export function seedPrice(crop: string): number {
  return OBJECT_BY_ID[crop]?.crop?.seed ?? 0;
}

/** Can the pet plant right here, right now? (Empty soil, and coins for the seed if the world tracks coins.) */
export function plantableHere(w: World): Obj | undefined {
  const soil = objectsAt(w, w.pet.x, w.pet.y).find((o) => o.kind === 'soil');
  if (!soil) return undefined;
  return w.seedCoins === undefined || w.seedCoins >= seedPrice(soil.crop ?? 'carrot') ? soil : undefined;
}

/**
 * One storage slot: what kind it holds and how many. `ids` remembers which items went in (most recent last), so an
 * item taken out again is the same item — same id — and "once per object" counts it once wherever it has been.
 * Items whose identity isn't known (old saves, *Stocked storage*) get a new id the first time they come out.
 */
export interface StoreSlot { kind: string | null; n: number; ids?: number[] }

/** Take one item's identity out of a slot (undefined if not known). */
function popId(slot: StoreSlot): number | undefined {
  return slot.ids?.pop();
}

/** Can this container take one `kind` right now? (Unlimited if it has no store.) */
export function storeAccepts(o: Obj, kind: string): boolean {
  if (!o.store) return true;
  const cap = def(o.kind).storage?.perSlot ?? Infinity;
  return o.store.some((s) => (s.kind === kind && s.n < cap) || s.kind === null || s.n === 0);
}

/** Items held, in all slots. */
export function storeCount(o: Obj): number {
  return (o.store ?? []).reduce((a, s) => a + s.n, 0);
}

/** An empty store for a storage object kind (or undefined if the kind isn't storage). */
export function emptyStore(kind: string): StoreSlot[] | undefined {
  const st = def(kind).storage;
  return st ? Array.from({ length: st.slots }, () => ({ kind: null, n: 0 })) : undefined;
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
  /** The other pets on duty (farm only): while one acts, the rest are here. */
  crew?: PetBody[];
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
  /**
   * Present only when something needs it (a lesson with memory cards, or a skill run on the farm).
   * What has happened so far (this try, or since the farm started): notable events counted by what they
   * were — `type|kind|state|area|into` → [count, last tick]. Feeds "Has …" / "Just …" conditions and the
   * "Done … yet?" sense. Moves and ticks aren't counted (too frequent, never asked about).
   */
  tally?: Tally;
  /** Coins available for seed: set each tick by the farm, or by a pen's Seed money card. Unset = planting is free. */
  seedCoins?: number;
  /** Pens with the Energy card: work drains `petEnergy` and staying put restores it (the farm keeps its own). */
  energyPen?: boolean;
  /** Items sold (dropped at a container that sells, i.e. the farm's house). */
  sold?: number;
  /** …and how many of each kind (the Sold measure). */
  soldKinds?: Record<string, number>;
  /** Notes your rules wrote this try (flags and counters, 0–9). Absent until a rule writes one. */
  notes?: Record<string, number>;
  /** Set when a rule ends the try as a success (✓) or a miss (✗); otherwise SUCCESS decides. */
  verdict?: 'success' | 'fail';
}

export type Tally = Record<string, [number, number]>;

const UNTALLIED = new Set<SimEventType>(['tick', 'move']);

export function tallyKey(e: SimEvent): string {
  return `${e.type}|${e.kind ?? ''}|${e.state ?? ''}|${e.area ?? ''}|${e.into ?? ''}`;
}

/** Rebuild the event a tally key stands for (enough for event matchers, which never look at position). */
export function eventOfKey(key: string): SimEvent {
  const [type, kind, state, area, into] = key.split('|');
  return { type: type as SimEventType, x: 0, y: 0, ...(kind ? { kind } : {}), ...(state ? { state: state as 'open' | 'closed' } : {}), ...(area ? { area } : {}), ...(into ? { into } : {}) };
}

function recordTally(t: Tally, w: World, events: SimEvent[]): void {
  for (const e of events) {
    if (UNTALLIED.has(e.type)) continue;
    const k = tallyKey(e);
    const cur = t[k];
    if (cur) { cur[0]++; cur[1] = w.tick; } else t[k] = [1, w.tick];
  }
}

export function cloneTally(t: Tally | undefined): Tally {
  const out: Tally = {};
  if (t) for (const k in t) out[k] = [t[k][0], t[k][1]];
  return out;
}

export type SimEventType = 'tick' | 'move' | 'bump' | 'reach' | 'enter' | 'pickup' | 'drop' | 'deliver' | 'fumble' | 'stay' | 'fill' | 'water' | 'shoo' | 'scare' | 'peck' | 'enterArea' | 'leaveArea' | 'gate' | 'full' | 'plant' | 'lift' | 'empty';

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
    pet: { ...w.pet },
    ...(w.crew ? { crew: w.crew.map((b) => ({ ...b })) } : {}),
    delivered: { ...w.delivered },
    ...(w.areas ? { areas: w.areas.map((a) => ({ ...a })) } : {}),
    ...(w.counts ? { counts: { ...w.counts } } : {}),
    objects: w.objects.map((o) => (o.store ? { ...o, store: o.store.map((s) => ({ ...s })) } : { ...o })),
    ...(w.tally ? { tally: cloneTally(w.tally) } : {}),
    ...(w.notes ? { notes: { ...w.notes } } : {}),
  };
}

export function addObject(w: World, kind: string, x: number, y: number): Obj {
  const o: Obj = { id: w.nextId++, kind, x, y, carried: false, delivered: false };
  w.objects.push(o);
  return o;
}

/** Objects lying on the grid (not carried, not delivered). */
export function onGround(o: Obj): boolean {
  return !o.carried && !o.delivered && !o.hidden;
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

/** Every action a lesson's abilities allow (the random baseline picks among these). */
export function legalActions(_w: World, abilities: string[]): Action[] {
  const out: Action[] = [];
  if (abilities.includes('move')) out.push(...MOVES);
  if (abilities.includes('stay')) out.push('wait');
  if (abilities.includes('pickup')) out.push('pick');
  if (abilities.includes('drop')) out.push('drop');
  if (abilities.includes('water')) out.push('water');
  if (abilities.includes('shoo')) out.push('shoo');
  if (abilities.includes('nudge')) out.push('nudge');
  if (abilities.includes('plant')) out.push('plant');
  if (abilities.includes('lift')) out.push('lift');
  if (out.length === 0) out.push('wait');
  return out;
}

/**
 * Trait aims: besides one kind ("berry"), a skill can be aimed at any ripe crop or at storage with room for what
 * the pet carries. They're written `@crop` / `@storage` wherever a kind goes.
 */
export const TRAIT_AIMS: Record<string, string> = { '@crop': 'any ripe crop', '@storage': 'storage with room' };
/** The crops "any ripe crop" stands for. */
export const TRAIT_CROPS = ['berry', 'carrot', 'pumpkin', 'sunflower'];

/**
 * Qualifiers (pen & cards phase 3) turn a kind into one specific object: the nearest / furthest X (from the pet, or
 * from another thing), the fullest / emptiest storage, the thing being carried. They travel as selector strings,
 * `#["nearest","berry","home"]`, wherever a kind does, and are resolved against the world when read.
 */
export type QualifierOp = 'nearest' | 'furthest' | 'fullest' | 'emptiest' | 'carried';
export function selector(op: QualifierOp, what = '', from = ''): string {
  return `#${JSON.stringify([op, what, from])}`;
}
const SEL = new Map<string, [QualifierOp, string, string]>();
function parseSel(sel: string): [QualifierOp, string, string] {
  let p = SEL.get(sel);
  if (!p) { p = JSON.parse(sel.slice(1)) as [QualifierOp, string, string]; SEL.set(sel, p); }
  return p;
}
export const isSelector = (k: string) => k.charCodeAt(0) === 35; /* # */
/** The kind a qualifier picks from ("the nearest berry" → berry; storage qualifiers → storage). */
export function selectorKind(sel: string): string {
  const [op, what] = parseSel(sel);
  return op === 'carried' ? '' : what || (op === 'fullest' || op === 'emptiest' ? '@storage' : '');
}
/** The one object a qualifier points at right now, or undefined (nothing to point at). Ties: the lowest id. */
export function resolveSelector(w: World, sel: string): Obj | undefined {
  const [op, what, from] = parseSel(sel);
  if (op === 'carried') return w.pet.carrying !== null ? w.objects.find((o) => o.id === w.pet.carrying) : undefined;
  if (op === 'fullest' || op === 'emptiest') {
    const k = what || '@storage';
    let best: Obj | undefined;
    for (const o of w.objects) {
      if (!o.store || o.delivered || (!onGround(o) && w.pet.carrying !== o.id) || !aimIs(o.kind, k)) continue;
      const n = storeCount(o);
      if (!best || (op === 'fullest' ? n > storeCount(best) : n < storeCount(best)) || (n === storeCount(best) && o.id < best.id)) best = o;
    }
    return best;
  }
  const ref = from ? nearest(w, from) : w.pet;
  if (!ref) return undefined;
  let best: Obj | undefined;
  let bd = 0;
  for (const o of w.objects) {
    if (!onGround(o) || o === ref || !objIs(w, o, what)) continue;
    const d = Math.abs(o.x - ref.x) + Math.abs(o.y - ref.y);
    if (!best || (op === 'nearest' ? d < bd : d > bd) || (d === bd && o.id < best.id)) { best = o; bd = d; }
  }
  return best;
}

/** Is this kind what the aim means? (Kind level: "any crop" / "any storage"; plain aims are one kind.) */
export function aimIs(kind: string | undefined, aim: string): boolean {
  if (kind === undefined) return false;
  if (isSelector(aim)) { const k = selectorKind(aim); return k ? aimIs(kind, k) : true; } // kind level: what it picks from
  if (aim.charCodeAt(0) !== 64 /* @ */) return kind === aim;
  const d = def(kind);
  return aim === '@crop' ? d.traits.includes('Crop') && d.carryable : aim === '@storage' ? !!d.storage : false;
}

/** Does this object match the aim right now? (`@storage` also needs room for whatever the pet is carrying.) */
export function objIs(w: World, o: Obj, aim: string): boolean {
  if (isSelector(aim)) return resolveSelector(w, aim)?.id === o.id;
  if (aim.charCodeAt(0) !== 64) return o.kind === aim;
  if (!aimIs(o.kind, aim)) return false;
  if (aim !== '@storage' || !o.store) return true;
  const held = w.pet.carrying !== null ? w.objects.find((x) => x.id === w.pet.carrying) : undefined;
  if (held && !def(held.kind).portable) return storeAccepts(o, held.kind);
  return o.store.some((s) => s.kind === null || s.n === 0 || s.n < (def(o.kind).storage?.perSlot ?? Infinity));
}

export function nearest(w: World, kind: string, x = w.pet.x, y = w.pet.y): Obj | null {
  if (isSelector(kind)) { const o = resolveSelector(w, kind); return o && onGround(o) ? o : null; } // the one it points at
  let best: Obj | null = null;
  let bd = Infinity;
  const trait = kind.charCodeAt(0) === 64 || isSelector(kind);
  for (const o of w.objects) {
    if ((trait ? !objIs(w, o, kind) : o.kind !== kind) || !onGround(o)) continue;
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
export interface StepOptions {
  /** Move creatures and advance the clock (false for a second pet's turn within the same tick). */
  advance?: boolean;
}

export function step(w: World, action: Action, opts: StepOptions = {}): SimEvent[] {
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
    // Storage: take one item out of the fullest slot of a basket or shed here.
    const store = !target && p.carrying === null ? objectsAt(w, p.x, p.y).find((o) => o.store && storeCount(o) > 0) : undefined;
    if (target) {
      target.carried = true;
      p.carrying = target.id;
      events.push({ type: 'pickup', x: p.x, y: p.y, kind: target.kind, objId: target.id });
    } else if (store) {
      const slot = store.store!.filter((s) => s.n > 0).sort((a, b) => b.n - a.n)[0];
      // The same item that went in (revived, or recreated with its id if the farm tidied it away), else a new one.
      const id = popId(slot);
      const old = id !== undefined ? w.objects.find((o) => o.id === id) : undefined;
      const item = old ?? addObject(w, slot.kind!, p.x, p.y);
      if (id !== undefined && !old) item.id = id;
      item.kind = slot.kind!;
      item.x = p.x; item.y = p.y;
      item.delivered = false;
      slot.n--;
      if (slot.n === 0) slot.kind = null;
      item.carried = true;
      p.carrying = item.id;
      events.push({ type: 'pickup', x: p.x, y: p.y, kind: item.kind, objId: item.id, into: store.kind });
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
  } else if (action === 'lift') {
    // Lift a basket (with whatever is in it). While carried it can't be filled.
    const b = p.carrying === null ? objectsAt(w, p.x, p.y).find((o) => def(o.kind).portable) : undefined;
    if (b) {
      b.carried = true;
      p.carrying = b.id;
      events.push({ type: 'lift', x: p.x, y: p.y, kind: b.kind, objId: b.id });
    } else events.push({ type: 'fumble', x: p.x, y: p.y });
  } else if (action === 'plant') {
    // Sow empty soil: it becomes a growing patch of its crop (the farm pays for the seed).
    const soil = plantableHere(w);
    if (soil) {
      soil.kind = 'patch';
      soil.wet = false;
      if (w.seedCoins !== undefined) w.seedCoins -= seedPrice(soil.crop ?? 'carrot'); // pens with Seed money (the farm resets it each tick)
      events.push({ type: 'plant', x: p.x, y: p.y, kind: soil.crop ?? 'carrot', objId: soil.id });
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
    if (c && def(c.kind).portable) dropBasket(w, c, events);
    else if (c) {
      p.carrying = null;
      c.carried = false;
      c.x = p.x;
      c.y = p.y;
      events.push({ type: 'drop', x: p.x, y: p.y, kind: c.kind, objId: c.id });
      const container = objectsAt(w, p.x, p.y).find((o) => o.id !== c.id && def(o.kind).container);
      if (container && storeAccepts(container, c.kind)) {
        if (container.store) {
          const cap = def(container.kind).storage?.perSlot ?? Infinity;
          const slot = container.store.find((s) => s.kind === c.kind && s.n < cap) ?? container.store.find((s) => s.kind === null || s.n === 0)!;
          slot.kind = c.kind;
          slot.n++;
          (slot.ids ??= []).push(c.id);
        }
        c.delivered = true;
        w.delivered[c.kind] = (w.delivered[c.kind] ?? 0) + 1;
        if (def(container.kind).sells) { w.sold = (w.sold ?? 0) + 1; (w.soldKinds ??= {})[c.kind] = (w.soldKinds[c.kind] ?? 0) + 1; }
        events.push({ type: 'deliver', x: p.x, y: p.y, kind: c.kind, objId: c.id, into: container.kind });
      } else if (container) {
        events.push({ type: 'full', x: p.x, y: p.y, kind: c.kind, objId: c.id, into: container.kind });
      }
    } else events.push({ type: 'fumble', x: p.x, y: p.y });
  }
  // Pens with the Energy card: the same economy as the farm's (work costs 0.12, staying put restores 1.5).
  if (w.energyPen && w.petEnergy !== undefined) w.petEnergy = Math.max(0, Math.min(100, w.petEnergy + (action === 'wait' ? 1.5 : -0.12)));
  if (opts.advance !== false) {
    moveCreatures(w, events);
    w.tick++;
  }
  if (w.tally) recordTally(w.tally, w, events); // only worlds that remember (see generateWorld / SkillRun)
  return events;
}

/**
 * Putting down a carried basket. At the house or a shed it is emptied there (sold / stored, as much as fits) and
 * stays in the pet's paws; anywhere else it is set down, if the tile is clear.
 */
function dropBasket(w: World, b: Obj, events: SimEvent[]): void {
  const p = w.pet;
  const here = objectsAt(w, p.x, p.y);
  const into = here.find((o) => def(o.kind).container);
  if (into) {
    let moved = 0;
    for (const slot of b.store ?? []) {
      while (slot.kind && slot.n > 0 && storeAccepts(into, slot.kind)) {
        const kind = slot.kind;
        const id = popId(slot);
        if (into.store) {
          const cap = def(into.kind).storage?.perSlot ?? Infinity;
          const to = into.store.find((s) => s.kind === kind && s.n < cap) ?? into.store.find((s) => s.kind === null || s.n === 0)!;
          to.kind = kind;
          to.n++;
          if (id !== undefined) (to.ids ??= []).push(id); // identity moves with the item (the house sells it: gone)
        }
        slot.n--;
        if (slot.n === 0) slot.kind = null;
        moved++;
        w.delivered[kind] = (w.delivered[kind] ?? 0) + 1;
        if (def(into.kind).sells) { w.sold = (w.sold ?? 0) + 1; (w.soldKinds ??= {})[kind] = (w.soldKinds[kind] ?? 0) + 1; }
        events.push({ type: 'deliver', x: p.x, y: p.y, kind, into: into.kind, ...(id !== undefined ? { objId: id } : {}) });
      }
    }
    if (moved) events.push({ type: 'empty', x: p.x, y: p.y, kind: b.kind, objId: b.id, into: into.kind });
    else if (storeCount(b) > 0) events.push({ type: 'full', x: p.x, y: p.y, kind: b.kind, objId: b.id, into: into.kind });
    else events.push({ type: 'fumble', x: p.x, y: p.y });
    return;
  }
  // Set it down: only on a clear tile (not on a crop, a plot or anything else).
  if (here.length) { events.push({ type: 'fumble', x: p.x, y: p.y }); return; }
  p.carrying = null;
  b.carried = false;
  b.x = p.x;
  b.y = p.y;
  events.push({ type: 'drop', x: p.x, y: p.y, kind: b.kind, objId: b.id });
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

const CROPS = ['berry', 'carrot', 'pumpkin', 'sunflower'];

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
        // Crows go for sunflowers first (they spot them from much further away).
        const d = Math.abs(c.x - o.x) + Math.abs(c.y - o.y) - (c.kind === 'sunflower' ? 8 : 0);
        if (d < bd) { bd = d; target = c; }
      }
      if (!target) continue;
      bd = Math.abs(target.x - o.x) + Math.abs(target.y - o.y);
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
