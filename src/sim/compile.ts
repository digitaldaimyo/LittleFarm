import type { SpecNode, StageSpec } from '../domain/types';
import { isNode, paramOf } from '../domain/spec';
import { kindOfCard } from '../domain/registry';
import { Rng, hashSeed } from './rng';
import type { Obj, SimEvent, World } from './world';
import { addObject, bfsDistance, def, distTo, emptyWorld, inArea, inBounds, nearest, objectsAt, onGround } from './world';

export interface RuleHit {
  ruleId: string;
  label: string;
  amount: number;
  objId?: number;
  end?: 'success' | 'fail';
}

export interface RuleState {
  fired: Map<string, number>;
  lastTick: Map<string, number>;
  perObj: Map<string, Set<number>>;
}

export interface StepOutcome {
  reward: number;
  hits: RuleHit[];
  end: 'success' | 'fail' | null;
}

interface CondCtx {
  w: World;
  prev: { x: number; y: number };
  it?: Obj;
}
type Cond = (c: CondCtx) => boolean;
type Quantity = (c: CondCtx) => number;

interface CompiledRule {
  id: string;
  label: string;
  match: (e: SimEvent) => boolean;
  conds: Cond[];
  reward: number;
  end: 'success' | 'fail' | null;
  limit: { kind: string; ticks: number };
}

export interface CompiledStage {
  spec: StageSpec;
  rules: CompiledRule[];
  generate(seed: number): World;
  newRuleState(): RuleState;
  evalStep(w: World, prev: { x: number; y: number }, events: SimEvent[], rs: RuleState): StepOutcome;
  isSuccess(w: World): boolean;
  isFail(w: World): boolean;
}

/** What `ref.target` ("the target") means while compiling — the learner's focus. */
let currentTarget = '';
export function withTarget<T>(target: string, fn: () => T): T {
  const prev = currentTarget;
  currentTarget = target;
  try { return fn(); } finally { currentTarget = prev; }
}
export function resolveKind(v: unknown, target = currentTarget): string {
  if (!isNode(v)) return '';
  if (v.cardId === 'ref.target') return target;
  return kindOfCard(v.cardId) ?? '';
}
const kindArg = (n: SpecNode, key: string): string => resolveKind(n.args[key]);
export const areaArg = (n: SpecNode, key: string): string => {
  const v = n.args[key];
  return isNode(v) ? String(v.args.name ?? '') : '';
};
const nodeArg = (n: SpecNode, key: string): SpecNode | null => {
  const v = n.args[key];
  return isNode(v) ? v : null;
};
const listArg = (n: SpecNode, key: string): SpecNode[] => {
  const v = n.args[key];
  return Array.isArray(v) ? v.filter(isNode) : isNode(v) ? [v] : [];
};

function compileQuantity(n: SpecNode): Quantity {
  switch (n.cardId) {
    case 'q.distance': {
      const k = kindArg(n, 'what');
      return ({ w }) => {
        const d = distTo(w, k);
        return Number.isFinite(d) ? d : 99;
      };
    }
    case 'q.pecks':
      return ({ w }) => w.counts?.pecks ?? 0;
    case 'q.count': {
      const k = kindArg(n, 'what');
      return ({ w }) => w.objects.filter((o) => o.kind === k && onGround(o)).length;
    }
    default:
      throw new Error(`Cannot compile quantity ${n.cardId}`);
  }
}

export function compileCondition(n: SpecNode): Cond {
  switch (n.cardId) {
    case 'cond.at': {
      const k = kindArg(n, 'what');
      return ({ w }) => objectsAt(w, w.pet.x, w.pet.y).some((o) => o.kind === k);
    }
    case 'cond.near': {
      const k = kindArg(n, 'what');
      const d = paramOf(n, 'dist', 2);
      return ({ w }) => distTo(w, k) <= d;
    }
    case 'cond.carrying': {
      const k = kindArg(n, 'what');
      return ({ w }) => w.pet.carrying !== null && w.objects.find((o) => o.id === w.pet.carrying)?.kind === k;
    }
    case 'cond.delivered': {
      const k = kindArg(n, 'what');
      const c = paramOf(n, 'count', 1);
      return ({ w }) => (w.delivered[k] ?? 0) >= c;
    }
    case 'cond.closer': {
      const k = kindArg(n, 'what');
      return ({ w, prev }) => distTo(w, k) < distTo(w, k, prev.x, prev.y);
    }
    case 'cond.farFrom': {
      const k = kindArg(n, 'what');
      const d = paramOf(n, 'dist', 2);
      return ({ w }) => distTo(w, k) > d;
    }
    case 'cond.stayedFor': {
      const t = paramOf(n, 'ticks', 5);
      return ({ w }) => (w.pet.still ?? 0) >= t;
    }
    case 'cond.watered': {
      const k = kindArg(n, 'what');
      const c = paramOf(n, 'count', 1);
      return ({ w }) => w.objects.filter((o) => o.kind === k && o.wet && onGround(o)).length >= c;
    }
    case 'cond.inArea': {
      const k = kindArg(n, 'what');
      const a = areaArg(n, 'area');
      const c = paramOf(n, 'count', 1);
      return ({ w }) => {
        const ar = w.areas?.find((x) => x.name === a);
        return !!ar && w.objects.filter((o) => o.kind === k && onGround(o) && inArea(ar, o.x, o.y)).length >= c;
      };
    }
    case 'cond.petInArea': {
      const a = areaArg(n, 'area');
      return ({ w }) => { const ar = w.areas?.find((x) => x.name === a); return !!ar && inArea(ar, w.pet.x, w.pet.y); };
    }
    case 'cond.hasWater':
      return ({ w }) => (w.pet.water ?? 0) > 0;
    case 'cond.night':
      return ({ w }) => !!w.night;
    case 'cond.and': {
      const fs = listArg(n, 'all').map(compileCondition);
      return (c) => fs.every((f) => f(c));
    }
    case 'cond.not': {
      const inner = nodeArg(n, 'inner');
      const f = inner ? compileCondition(inner) : () => false;
      return (c) => !f(c);
    }
    case 'cond.itNear': {
      const k = kindArg(n, 'what');
      const d = paramOf(n, 'dist', 1);
      return ({ w, it }) => !!it && distTo(w, k, it.x, it.y) <= d;
    }
    case 'cond.compare': {
      const qn = nodeArg(n, 'quantity');
      const q = qn ? compileQuantity(qn) : () => 0;
      const op = paramOf(n, 'op', '<=');
      const v = paramOf(n, 'value', 1);
      return (c) => {
        const x = q(c);
        return op === '<=' ? x <= v : op === '>=' ? x >= v : x === v;
      };
    }
    default:
      throw new Error(`Cannot compile condition ${n.cardId}`);
  }
}

function compileEvent(n: SpecNode): (e: SimEvent) => boolean {
  const k = kindArg(n, 'what');
  switch (n.cardId) {
    case 'ev.reach': return (e) => e.type === 'reach' && e.kind === k;
    case 'ev.enter': return (e) => e.type === 'enter' && e.kind === k;
    case 'ev.pickup': return (e) => e.type === 'pickup' && e.kind === k;
    case 'ev.drop': return (e) => e.type === 'drop' && e.kind === k;
    case 'ev.deliver': {
      const into = kindArg(n, 'into');
      return (e) => e.type === 'deliver' && e.kind === k && e.into === into;
    }
    case 'ev.tick': return (e) => e.type === 'tick';
    case 'ev.bump': return (e) => e.type === 'bump';
    case 'ev.stay': return (e) => e.type === 'stay';
    case 'ev.fill': return (e) => e.type === 'fill';
    case 'ev.shoo': return (e) => (e.type === 'shoo' || e.type === 'scare') && e.kind === k;
    case 'ev.peck': return (e) => e.type === 'peck' && e.kind === k;
    case 'ev.entersArea': { const a = areaArg(n, 'area'); return (e) => e.type === 'enterArea' && e.kind === k && e.area === a; }
    case 'ev.leavesArea': { const a = areaArg(n, 'area'); return (e) => e.type === 'leaveArea' && e.kind === k && e.area === a; }
    case 'ev.water': return (e) => e.type === 'water' && e.kind === k;
    default:
      throw new Error(`Cannot compile event ${n.cardId}`);
  }
}

function compileRule(n: SpecNode): CompiledRule {
  const ev = nodeArg(n, 'when');
  let reward = 0;
  let end: CompiledRule['end'] = null;
  for (const e of listArg(n, 'then')) {
    if (e.cardId === 'eff.reward') reward += paramOf(e, 'amount', 0);
    else if (e.cardId === 'eff.penalty') reward -= paramOf(e, 'amount', 0);
    else if (e.cardId === 'eff.end') end = paramOf(e, 'outcome', 'success') === 'fail' ? 'fail' : 'success';
  }
  const lim = nodeArg(n, 'limit');
  return {
    id: n.id,
    label: paramOf(n, 'label', 'Rule'),
    match: ev ? compileEvent(ev) : () => false,
    conds: listArg(n, 'if').map(compileCondition),
    reward,
    end,
    limit: { kind: lim?.cardId ?? 'lim.every', ticks: lim ? paramOf(lim, 'ticks', 10) : 0 },
  };
}

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

/** Build a concrete world from the environment spec for one layout seed. */
export function generateWorld(spec: StageSpec, seed: number): World {
  const rng = new Rng(hashSeed(seed, 0x5eed));
  const { w: W, h: H } = spec.size;
  let last: World | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const w = emptyWorld(W, H);
    w.rng = hashSeed(seed, 0xc4ea7);
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
    for (const p of spec.environment) {
      if (p.cardId !== 'place.fixed') continue;
      const k = resolveKind(p.args.kind, spec.learner.focus);
      const x = paramOf(p, 'x', 0), y = paramOf(p, 'y', 0);
      if (!k || !inBounds(w, x, y)) continue;
      addObject(w, k, x, y);
      occupied.add(key(x, y));
    }
    const petNode = spec.environment.find((p) => p.cardId === 'place.pet');
    const freeTiles = (region: string) => {
      const out: [number, number][] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!occupied.has(key(x, y)) && !areaTiles.has(key(x, y)) && regionOk(region, x, y, W, H)) out.push([x, y]);
      return out;
    };
    if (petNode && paramOf(petNode, 'mode', 'random') === 'fixed') {
      w.pet.x = Math.min(W - 1, paramOf(petNode, 'x', 0));
      w.pet.y = Math.min(H - 1, paramOf(petNode, 'y', 0));
    } else {
      const t = freeTiles('anywhere');
      const [x, y] = t.length ? rng.pick(t) : [0, 0];
      w.pet.x = x;
      w.pet.y = y;
    }
    occupied.add(key(w.pet.x, w.pet.y));
    const timeNode = spec.environment.find((p) => p.cardId === 'place.time');
    const tmode = timeNode ? paramOf(timeNode, 'mode', 'day') : 'day';
    w.night = tmode === 'night' || (tmode === 'random' && rng.next() < 0.5);
    for (const p of spec.environment) {
      if (p.cardId !== 'place.random') continue;
      const k = resolveKind(p.args.kind, spec.learner.focus);
      if (!k) continue;
      const count = paramOf(p, 'count', 1);
      const region = paramOf(p, 'region', 'anywhere');
      for (let i = 0; i < count; i++) {
        let t = freeTiles(region);
        if (!t.length) t = freeTiles('anywhere');
        if (!t.length) break;
        const [x, y] = rng.pick(t);
        addObject(w, k, x, y);
        occupied.add(key(x, y));
      }
    }
    last = w;
    // Every goal-ish object must be reachable by a dry path, so no layout is impossible.
    const ok = w.objects.every((o) => {
      const d = def(o.kind);
      if (d.solid || d.hazard) return true;
      return bfsDistance(w, w.pet.x, w.pet.y, o.x, o.y, true) >= 0;
    });
    if (ok) return w;
  }
  return last!;
}

export function compileStage(spec: StageSpec): CompiledStage {
  return withTarget(spec.learner.focus, () => compileStageInner(spec));
}

function compileStageInner(spec: StageSpec): CompiledStage {
  const survive = spec.outcome === 'survive';
  const rules = spec.rules.filter((r) => r.cardId === 'rule').map(compileRule);
  const success = spec.success ? compileCondition(spec.success) : () => false;
  const fail = spec.fail ? compileCondition(spec.fail) : () => false;
  return {
    spec,
    rules,
    generate: (seed) => generateWorld(spec, seed),
    newRuleState: () => ({ fired: new Map(), lastTick: new Map(), perObj: new Map() }),
    // 'survive' lessons: success is judged at the end of the try, and only if nothing failed.
    isSuccess: (w) => success({ w, prev: w.pet }) && (!survive || !fail({ w, prev: w.pet })),
    isFail: (w) => fail({ w, prev: w.pet }),
    evalStep(w, prev, events, rs) {
      let reward = 0;
      let end: StepOutcome['end'] = null;
      const hits: RuleHit[] = [];
      for (const r of rules) {
        for (const e of events) {
          if (!r.match(e)) continue;
          const it = e.objId !== undefined ? w.objects.find((o) => o.id === e.objId) : undefined;
          const ctx = { w, prev, it };
          if (!r.conds.every((c) => c(ctx))) continue;
          const fired = rs.fired.get(r.id) ?? 0;
          if (r.limit.kind === 'lim.once' && fired > 0) continue;
          if (r.limit.kind === 'lim.cooldown' && w.tick - (rs.lastTick.get(r.id) ?? -1e9) < r.limit.ticks) continue;
          if (r.limit.kind === 'lim.perObject') {
            const set = rs.perObj.get(r.id) ?? new Set<number>();
            const oid = e.objId ?? -1;
            if (set.has(oid)) continue;
            set.add(oid);
            rs.perObj.set(r.id, set);
          }
          rs.fired.set(r.id, fired + 1);
          rs.lastTick.set(r.id, w.tick);
          reward += r.reward;
          if (r.end && !end) end = r.end;
          hits.push({ ruleId: r.id, label: r.label, amount: r.reward, objId: e.objId, end: r.end ?? undefined });
          if (r.limit.kind === 'lim.once') break;
        }
      }
      if (!end && !survive && success({ w, prev })) end = 'success';
      if (!end && fail({ w, prev })) end = 'fail';
      return { reward, hits, end };
    },
  };
}

export { nearest };
