/**
 * Building a pen's world from its Environment cards for one training or test seed (split from compile.ts, polish
 * phase 3). Layouts are recorded in tests/fixtures/layouts.json, so this must not change what any seed produces.
 */
import type { SpecNode, StageSpec } from '../domain/types';
import { paramOf } from '../domain/spec';
import { Rng, hashSeed } from './rng';
import type { World } from './world';
import { TRAIT_CROPS, addObject, objIs, bfsDistance, blocks, def, emptyStore, emptyWorld, inBounds, isSolidAt } from './world';
import { usesMemory, resolveKind, areaArg } from './compile';

function regionOk(region: string, x: number, y: number, w: number, h: number): boolean {
  switch (region) {
    case 'left': return x < w / 2;
    case 'right': return x >= w / 2;
    case 'top': return y < h / 2;
    case 'bottom': return y >= h / 2;
    case 'center': return x >= Math.floor(w / 4) && x < Math.ceil((3 * w) / 4) && y >= Math.floor(h / 4) && y < Math.ceil((3 * h) / 4);
    default: return true;
  }
}

export function generateWorld(spec: StageSpec, seed: number): World {
  const rng = new Rng(hashSeed(seed, 0x5eed));
  const remembers = usesMemory(spec);
  let last: World | null = null;
  // New options below only draw random numbers when they're used, so existing lessons keep their exact
  // layouts (tests/layouts.test.ts).
  for (let attempt = 0; attempt < 40; attempt++) {
    let { w: W, h: H } = spec.size;
    if (spec.varySize) { const lo = Math.min(6, W); W = H = lo + rng.int(Math.max(1, Math.min(W, H) - lo + 1)); }
    const w = emptyWorld(W, H);
    w.rng = hashSeed(seed, 0xc4ea7);
    // Only lessons that remember events keep a tally (it costs a little on every step).
    if (remembers) w.tally = {};
    const occupied = new Set<number>();
    const key = (x: number, y: number) => y * W + x;
    const areaTiles = new Set<number>();
    for (const z of spec.environment) {
      if (z.cardId !== 'zone.rect') continue;
      const aw = Math.max(1, Math.min(W, paramOf(z, 'w', 2))), ah = Math.max(1, Math.min(H, paramOf(z, 'h', 2)));
      let ax = Math.min(W - aw, paramOf(z, 'x', 0)), ay = Math.min(H - ah, paramOf(z, 'y', 0));
      if (paramOf(z, 'where', 'fixed') === 'random') { ax = rng.int(W - aw + 1); ay = rng.int(H - ah + 1); }
      (w.areas ??= []).push({ name: paramOf(z, 'name', 'coop'), x: ax, y: ay, w: aw, h: ah });
      for (let yy = ay; yy < ay + ah; yy++) for (let xx = ax; xx < ax + aw; xx++) areaTiles.add(key(xx, yy));
    }
    /** Place a thing; a trait aim becomes a real kind each try (any ripe crop → one of the crops; storage → an empty basket). */
    const put = (k: string, x: number, y: number) => {
      if (k === '@crop') return addObject(w, TRAIT_CROPS[rng.int(TRAIT_CROPS.length)], x, y);
      if (k === '@storage') { const b = addObject(w, 'bin', x, y); b.store = emptyStore('bin'); return b; }
      const o = addObject(w, k, x, y);
      // Baskets and sheds hold real storage in pens too (as on the farm), so Stored / Storage of… can count them.
      if (def(k).storage) o.store = emptyStore(k);
      return o;
    };
    for (const p of spec.environment) {
      if (p.cardId !== 'place.fixed') continue;
      const k = resolveKind(p.args.kind, spec.learner.focus);
      const x = paramOf(p, 'x', 0), y = paramOf(p, 'y', 0);
      if (!k || !inBounds(w, x, y)) continue;
      put(k, x, y);
      occupied.add(key(x, y));
    }
    const petNode = spec.environment.find((p) => p.cardId === 'place.pet');
    const freeTiles = (region: string) => {
      const out: [number, number][] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!occupied.has(key(x, y)) && !areaTiles.has(key(x, y)) && regionOk(region, x, y, W, H)) out.push([x, y]);
      return out;
    };
    let petPlaced = true;
    /** Tiles for the newer regions (inside an area, next to / away from a kind, far from the pet); null = old regions. */
    const relTiles = (region: string, n: SpecNode): [number, number][] | null => {
      const free = (x: number, y: number) => !occupied.has(key(x, y)) && !(petPlaced && w.pet.x === x && w.pet.y === y);
      const out: [number, number][] = [];
      if (region === 'inArea') {
        const ar = w.areas?.find((a) => a.name === areaArg(n, 'area'));
        if (ar) for (let y = ar.y; y < ar.y + ar.h; y++) for (let x = ar.x; x < ar.x + ar.w; x++) if (free(x, y)) out.push([x, y]);
        return out;
      }
      if (region === 'nextTo' || region === 'awayFrom') {
        const k = resolveKind(n.args.ref, spec.learner.focus);
        const refs = w.objects.filter((o) => objIs(w, o, k));
        if (!refs.length) return out;
        const away = Math.max(3, Math.floor((W + H) / 4));
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (!free(x, y) || areaTiles.has(key(x, y))) continue;
          const ok = region === 'nextTo'
            ? refs.some((o) => Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) === 1)
            : refs.every((o) => Math.abs(o.x - x) + Math.abs(o.y - y) >= away);
          if (ok) out.push([x, y]);
        }
        return out;
      }
      if (region === 'farFromPet') {
        const far = Math.max(3, Math.floor((W + H) / 3));
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (free(x, y) && !areaTiles.has(key(x, y)) && Math.abs(w.pet.x - x) + Math.abs(w.pet.y - y) >= far) out.push([x, y]);
        return out;
      }
      return null;
    };
    const petMode = petNode ? paramOf(petNode, 'mode', 'random') : 'random';
    if (petMode === 'fixed') {
      w.pet.x = Math.min(W - 1, paramOf(petNode!, 'x', 0));
      w.pet.y = Math.min(H - 1, paramOf(petNode!, 'y', 0));
    } else if (petMode === 'awayFrom') {
      petPlaced = false; // placed after everything else, so it can start away from scattered things too
    } else {
      const t = (petMode === 'inArea' ? relTiles('inArea', petNode!) : null) ?? freeTiles('anywhere');
      const t2 = t.length ? t : freeTiles('anywhere');
      const [x, y] = t2.length ? rng.pick(t2) : [0, 0];
      w.pet.x = x;
      w.pet.y = y;
    }
    if (petPlaced) occupied.add(key(w.pet.x, w.pet.y));
    const timeNode = spec.environment.find((p) => p.cardId === 'place.time');
    const tmode = timeNode ? paramOf(timeNode, 'mode', 'day') : 'day';
    w.night = tmode === 'night' || (tmode === 'random' && rng.next() < 0.5);
    const weatherNode = spec.environment.find((p) => p.cardId === 'place.weather');
    const wmode = weatherNode ? paramOf(weatherNode, 'mode', 'dry') : 'dry';
    w.raining = wmode === 'rain' || (wmode === 'random' && rng.next() < 0.5);
    for (const p of spec.environment) {
      if (p.cardId === 'place.obstacles') {
        // A share of the pen's tiles, as rocks / fences / both.
        const share = { few: 0.05, some: 0.1, many: 0.18 }[paramOf(p, 'amount', 'few')] ?? 0.05;
        const mat = paramOf(p, 'kind', 'rocks');
        const n = Math.max(1, Math.round(W * H * share));
        for (let i = 0; i < n; i++) {
          const t = freeTiles('anywhere');
          if (!t.length) break;
          const [x, y] = rng.pick(t);
          addObject(w, mat === 'fences' ? 'fence' : mat === 'mixed' && i % 2 === 1 ? 'fence' : 'rock', x, y);
          occupied.add(key(x, y));
        }
        continue;
      }
      if (p.cardId === 'place.stocked') {
        // Storage that already holds things (as much as fits; one kind per slot).
        const k = resolveKind(p.args.kind, spec.learner.focus);
        const item = resolveKind(p.args.item, spec.learner.focus);
        if (!k) continue;
        const t = freeTiles(paramOf(p, 'region', 'anywhere'));
        const t2 = t.length ? t : freeTiles('anywhere');
        if (!t2.length) continue;
        const [x, y] = rng.pick(t2);
        const o = put(k, x, y);
        occupied.add(key(x, y));
        const st = def(o.kind).storage;
        const itemKind = item === '@crop' ? TRAIT_CROPS[rng.int(TRAIT_CROPS.length)] : item;
        if (st && itemKind) {
          o.store = emptyStore(o.kind);
          const max = Math.max(1, paramOf(p, 'count', 3));
          let n = paramOf(p, 'vary', 'exact') === 'upTo' ? 1 + rng.int(max) : max;
          for (const slot of o.store!) { const fill = Math.min(n, st.perSlot); if (fill <= 0) break; slot.kind = itemKind; slot.n = fill; n -= fill; }
        }
        continue;
      }
      if (p.cardId !== 'place.random') continue;
      const k = resolveKind(p.args.kind, spec.learner.focus);
      if (!k) continue;
      let count = paramOf(p, 'count', 1);
      const vary = paramOf(p, 'vary', 'exact');
      if (vary !== 'exact') count += rng.int((vary === 'more1' ? 1 : vary === 'more2' ? 2 : 3) + 1);
      if (paramOf(p, 'chance', 'always') === 'sometimes' && rng.next() < 0.5) count = 0;
      const region = paramOf(p, 'region', 'anywhere');
      for (let i = 0; i < count; i++) {
        let t = relTiles(region, p) ?? freeTiles(region);
        if (!t.length) t = freeTiles('anywhere');
        if (!t.length) break;
        const [x, y] = rng.pick(t);
        put(k, x, y);
        occupied.add(key(x, y));
      }
    }
    const energy = spec.environment.find((p) => p.cardId === 'place.energy');
    if (energy) {
      w.energyPen = true;
      w.petEnergy = paramOf(energy, 'vary', 'exact') === 'random' ? 10 + rng.int(91) : Math.max(0, Math.min(100, paramOf(energy, 'level', 30)));
    }
    const purse = spec.environment.find((p) => p.cardId === 'place.purse');
    if (purse) w.seedCoins = Math.max(0, paramOf(purse, 'coins', 5));
    const gates = spec.environment.find((p) => p.cardId === 'place.gates');
    if (gates) {
      const st = paramOf(gates, 'state', 'open');
      for (const o of w.objects) if (o.kind === 'gate') o.open = st === 'open' || (st === 'random' && rng.next() < 0.5);
    }
    if (!petPlaced) {
      const t = relTiles('awayFrom', petNode!) ?? [];
      const t2 = t.length ? t : freeTiles('anywhere');
      const [x, y] = t2.length ? rng.pick(t2) : [0, 0];
      w.pet.x = x;
      w.pet.y = y;
      petPlaced = true;
    }
    if (w.raining) for (const o of w.objects) if (def(o.kind).traits.includes('Plot')) o.wet = true;
    last = w;
    // Every goal-ish object must be reachable by a dry path, so no layout is impossible.
    const ok = w.objects.every((o) => {
      const d = def(o.kind);
      if (d.solid || d.hazard) return true;
      // Closed gates block, so they only need to be reachable from a neighbouring tile.
      if (blocks(o)) return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !isSolidAt(w, o.x + dx, o.y + dy) && bfsDistance(w, w.pet.x, w.pet.y, o.x + dx, o.y + dy, true) >= 0);
      return bfsDistance(w, w.pet.x, w.pet.y, o.x, o.y, true) >= 0;
    });
    if (ok) return w;
  }
  return last!;
}
