import type { SpecNode } from '../domain/types';
import { REGISTRY } from '../domain/registry';
import { node } from '../domain/spec';
import { compileEvent, countSince, resolveKind, withTarget } from '../sim/compile';
import type { Action, Tally, World } from '../sim/world';
import { DIRS, MOVES, def, inArea, isHazardAt, isSolidAt, nearest, nudgeableGate, objectsAt, type Area } from '../sim/world';

/**
 * Compiles player-chosen Sense cards into a mixed-radix state encoder.
 * The preset [where is target, walls, hazards, heading] yields exactly the
 * legacy Approach/Avoid index, so v1 policies keep working unchanged.
 */
export interface SenseEncoder {
  size: number;
  radices: number[];
  cards: string[];
  encode(w: World, base?: Tally): number[];
  index(values: number[]): number;
  /** Coarser fallbacks for rarely-seen states: zero out droppable senses one by one. */
  backoffs(values: number[]): number[];
  describe(values: number[]): string[];
}

export const STATE_WARN = 50000;
export const STATE_MAX = 100000;
export const MAX_SENSES = 5;

/** Backoff priority: lower drops first. Senses not listed are never dropped. */
const DROP_RANK: Record<string, number> = { 'sense.hazards': 1, 'sense.blocked': 2, 'sense.still': 3, 'sense.carrying': 4, 'sense.here': 5 };

export function presetSenses(): SpecNode[] {
  return [
    node('sense.nearest', { what: node('ref.target') }),
    node('sense.blocked'),
    node('sense.hazards'),
    node('sense.heading'),
  ];
}

export function radixOf(n: SpecNode): number {
  return REGISTRY.cards.get(n.cardId)?.radix ?? 1;
}

export function stateSpaceSize(senses: SpecNode[]): number {
  return senses.reduce((a, s) => a * radixOf(s), 1);
}

function senseFn(n: SpecNode, target: string): (w: World, base?: Tally) => number {
  const kind = resolveKind(n.args.what, target);
  switch (n.cardId) {
    case 'sense.did': {
      // "Done … yet?": has this event happened (this try, or since a skill run started on the farm)?
      const ev = n.args.event;
      const m = ev && typeof ev === 'object' && !Array.isArray(ev) ? withTarget(target, () => compileEvent(ev as SpecNode)) : () => false;
      return (w, base) => (countSince(w, base, m) > 0 ? 1 : 0);
    }
    case 'sense.nearest':
      return (w) => {
        const t = nearest(w, kind);
        if (!t) return 4 * 3 + 2; // "none": direction here + far bucket (never otherwise used)
        const dx = t.x - w.pet.x, dy = t.y - w.pet.y;
        const dir = (Math.sign(dx) + 1) * 3 + (Math.sign(dy) + 1);
        const d = Math.abs(dx) + Math.abs(dy);
        return dir * 3 + (d <= 1 ? 0 : d <= 3 ? 1 : 2);
      };
    case 'sense.nearestDry':
      return (w) => {
        let t = null as null | { x: number; y: number };
        let bd = Infinity;
        for (const o of w.objects) {
          if (o.kind !== kind || o.wet || o.carried || o.delivered) continue;
          const d = Math.abs(o.x - w.pet.x) + Math.abs(o.y - w.pet.y);
          if (d < bd) { bd = d; t = o; }
        }
        if (!t) return 4 * 3 + 2;
        const dx = t.x - w.pet.x, dy = t.y - w.pet.y;
        return ((Math.sign(dx) + 1) * 3 + (Math.sign(dy) + 1)) * 3 + (bd <= 1 ? 0 : bd <= 3 ? 1 : 2);
      };
    case 'sense.area': {
      const a = isNodeArea(n);
      return (w) => {
        const ar = w.areas?.find((x) => x.name === a);
        if (!ar) return 4 * 3 + 2;
        // Nearest tile of the area (clamp the pet's position into the rectangle).
        const tx = Math.max(ar.x, Math.min(ar.x + ar.w - 1, w.pet.x)), ty = Math.max(ar.y, Math.min(ar.y + ar.h - 1, w.pet.y));
        const dx = tx - w.pet.x, dy = ty - w.pet.y, d = Math.abs(dx) + Math.abs(dy);
        return ((Math.sign(dx) + 1) * 3 + (Math.sign(dy) + 1)) * 3 + (d <= 1 ? 0 : d <= 3 ? 1 : 2);
      };
    }
    case 'sense.outside': {
      const a = isNodeArea(n);
      return (w) => {
        const ar = w.areas?.find((x) => x.name === a);
        const t = ar ? nearestOutside(w, kind, ar) : nearest(w, kind);
        if (!t) return 4 * 3 + 2;
        const dx = t.x - w.pet.x, dy = t.y - w.pet.y, d = Math.abs(dx) + Math.abs(dy);
        return ((Math.sign(dx) + 1) * 3 + (Math.sign(dy) + 1)) * 3 + (d <= 1 ? 0 : d <= 3 ? 1 : 2);
      };
    }
    case 'sense.areaFrom': {
      const a = isNodeArea(n);
      return (w) => {
        const ar = w.areas?.find((x) => x.name === a);
        const t = ar ? nearestOutside(w, kind, ar) : null;
        if (!ar || !t) return 4 * 3 + 2;
        const tx = Math.max(ar.x, Math.min(ar.x + ar.w - 1, t.x)), ty = Math.max(ar.y, Math.min(ar.y + ar.h - 1, t.y));
        const dx = tx - t.x, dy = ty - t.y, d = Math.abs(dx) + Math.abs(dy);
        return ((Math.sign(dx) + 1) * 3 + (Math.sign(dy) + 1)) * 3 + (d <= 1 ? 0 : d <= 3 ? 1 : 2);
      };
    }
    case 'sense.gate':
      return (w) => { const g = nearest(w, 'gate'); return !g ? 0 : g.open ? 1 : 2; };
    case 'sense.rain':
      return (w) => (w.raining ? 1 : 0);
    case 'sense.water':
      return (w) => ((w.pet.water ?? 0) > 0 ? 1 : 0);
    case 'sense.night':
      return (w) => (w.night ? 1 : 0);
    case 'sense.distance':
      return (w) => {
        const t = nearest(w, kind);
        if (!t) return 4;
        const d = Math.abs(t.x - w.pet.x) + Math.abs(t.y - w.pet.y);
        return d === 0 ? 0 : d === 1 ? 1 : d <= 3 ? 2 : 3;
      };
    case 'sense.here':
      return (w) => (objectsAt(w, w.pet.x, w.pet.y).some((o) => o.kind === kind) ? 1 : 0);
    case 'sense.blocked':
      return (w) => {
        let b = 0;
        MOVES.forEach((m, i) => { if (isSolidAt(w, w.pet.x + DIRS[m][0], w.pet.y + DIRS[m][1])) b |= 1 << i; });
        return b;
      };
    case 'sense.hazards':
      return (w) => {
        // A hazard tile that *is* the target tile isn't something to avoid.
        const t = target ? nearest(w, target) : null;
        let b = 0;
        MOVES.forEach((m, i) => {
          const nx = w.pet.x + DIRS[m][0], ny = w.pet.y + DIRS[m][1];
          if (isHazardAt(w, nx, ny) && !(t && t.x === nx && t.y === ny)) b |= 1 << i;
        });
        return b;
      };
    case 'sense.heading':
      return (w) => MOVES.indexOf(w.pet.facing);
    case 'sense.carrying':
      return (w) => (w.pet.carrying !== null ? 1 : 0);
    case 'sense.still':
      return (w) => { const s = w.pet.still ?? 0; return s === 0 ? 0 : s < 5 ? 1 : 2; };
    default:
      throw new Error(`Unknown sense ${n.cardId}`);
  }
}

function nearestOutside(w: World, kind: string, ar: Area) {
  let best: ReturnType<typeof nearest> = null, bd = Infinity;
  for (const o of w.objects) {
    if (o.kind !== kind || o.carried || o.delivered || inArea(ar, o.x, o.y)) continue;
    const d = Math.abs(o.x - w.pet.x) + Math.abs(o.y - w.pet.y);
    if (d < bd || (d === bd && best && o.id < best.id)) { bd = d; best = o; }
  }
  return best;
}

function isNodeArea(n: SpecNode): string {
  const v = n.args.area;
  return v && typeof v === 'object' && !Array.isArray(v) ? String((v as SpecNode).args.name ?? '') : '';
}

export function compileEncoder(senses: SpecNode[], target: string): SenseEncoder {
  const fns = senses.map((s) => senseFn(s, target));
  const radices = senses.map(radixOf);
  const cards = senses.map((s) => s.cardId);
  const index = (v: number[]) => v.reduce((acc, x, i) => acc * radices[i] + x, 0);
  const order = cards.map((c, i) => [DROP_RANK[c] ?? 0, i] as const).filter(([r]) => r > 0).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  return {
    size: radices.reduce((a, b) => a * b, 1),
    radices,
    cards,
    encode: (w, base) => fns.map((f) => f(w, base)),
    index,
    backoffs(values) {
      const v = [...values];
      const out: number[] = [];
      for (const i of order) { v[i] = 0; out.push(index(v)); }
      return out;
    },
    describe(values) {
      return values.map((x, i) => `${REGISTRY.cards.get(cards[i])?.presentation.title ?? cards[i]}=${x}`);
    },
  };
}

/** Ability cards → ordered primitive action set. Order is fixed so presets keep the legacy 4-action layout. */
export const ABILITY_ACTIONS: Record<string, Action[]> = { move: MOVES, stay: ['wait'], pickup: ['pick'], drop: ['drop'], water: ['water'], shoo: ['shoo'], nudge: ['nudge'] };
export const ABILITY_LABELS: Record<string, string> = { move: 'Move', stay: 'Stay', pickup: 'Pick up', drop: 'Put down', water: 'Water', shoo: 'Shoo', nudge: 'Nudge gate' };
export const ABILITY_ORDER = ['move', 'stay', 'pickup', 'drop', 'water', 'shoo', 'nudge'];

export function actionsFor(abilities: string[]): Action[] {
  const out: Action[] = [];
  for (const a of ABILITY_ORDER) if (abilities.includes(a)) out.push(...ABILITY_ACTIONS[a]);
  return out.length ? out : ['wait'];
}

/** Physically possible actions right now (indices into `actions`). */
export function legalActionIdx(w: World, actions: Action[]): number[] {
  const out: number[] = [];
  actions.forEach((a, i) => {
    if (a === 'N' || a === 'E' || a === 'S' || a === 'W') {
      if (!isSolidAt(w, w.pet.x + DIRS[a][0], w.pet.y + DIRS[a][1])) out.push(i);
    } else if (a === 'pick') {
      if (w.pet.carrying === null && objectsAt(w, w.pet.x, w.pet.y).some((o) => def(o.kind).carryable)) out.push(i);
    } else if (a === 'drop') {
      if (w.pet.carrying !== null) out.push(i);
    } else if (a === 'nudge') {
      if (nudgeableGate(w)) out.push(i);
    } else if (a === 'shoo') {
      if (w.objects.some((o) => !o.carried && !o.delivered && def(o.kind).mover && Math.abs(o.x - w.pet.x) + Math.abs(o.y - w.pet.y) <= 1)) out.push(i);
    } else if (a === 'water') {
      const here = objectsAt(w, w.pet.x, w.pet.y);
      if (here.some((o) => def(o.kind).traits.includes('WaterSource')) || ((w.pet.water ?? 0) > 0 && here.some((o) => def(o.kind).traits.includes('Plot') && !o.wet))) out.push(i);
    } else out.push(i);
  });
  return out.length ? out : actions.map((_, i) => i);
}
