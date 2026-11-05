import type { SpecNode, StageSpec } from '../domain/types';
import { REGISTRY } from '../domain/registry';
import { isNode, paramOf, placedKinds, walk } from '../domain/spec';
import { describe } from '../domain/describe';
import { compileCondition, compileStage, withTarget } from '../sim/compile';
import { compileEncoder } from './senses';
import { compileRoutine } from './routine';
import { makeChooser, runEpisode, type EpisodeTrace, type PolicySpec, type Traits } from './episodes';
import { senseDefFor, templateOf } from './skilldef';
import type { World } from '../sim/world';
import { Rng, hashSeed } from '../sim/rng';

/**
 * "Why isn't it learning?" (polish roadmap, phase 1). Plain findings for pens that fail quietly:
 *  - never-happened: the big treat (the rule that ends the try, or pays most) almost never happened in practice;
 *  - cant-tell: in the same sensed situation, something that matters is sometimes true and sometimes not;
 *  - loops: missed tries end pacing between the same few tiles;
 *  - long-chain: SUCCESS needs several deliveries / legs in one try, asked of a single skill.
 */
export interface LearnFinding {
  id: 'never-happened' | 'cant-tell' | 'loops' | 'long-chain';
  text: string;
  /** Field Guide lesson that helps. */
  lesson?: string;
  /** A try to watch (loops). */
  replay?: EpisodeTrace;
}

/** What training saw: tries, and how often each rule fired (from the trainer's ledger). */
export interface PracticeCounts {
  episodes: number;
  counts: Record<string, number>;
}

const ctxText = { petName: 'Your pet', target: '' };

/** The rule whose treat is the point: one that ends the try (not as a failure), else the biggest payer. */
function bigTreat(stage: StageSpec): SpecNode | null {
  const rules = stage.rules.filter((r) => r.cardId === 'rule' && r.args.off !== 1);
  const effects = (r: SpecNode) => (Array.isArray(r.args.then) ? r.args.then.filter(isNode) : []);
  const pay = (r: SpecNode) => effects(r).filter((e) => e.cardId === 'eff.reward').reduce((a, e) => a + paramOf(e, 'amount', 0), 0);
  const ends = rules.filter((r) => effects(r).some((e) => e.cardId === 'eff.end' && paramOf(e, 'outcome', 'judge') !== 'fail') && pay(r) > 0);
  if (ends.length) return ends.sort((a, b) => pay(b) - pay(a))[0];
  const paying = rules.filter((r) => pay(r) > 0).sort((a, b) => pay(b) - pay(a));
  return paying[0] ?? null;
}

/** Does SUCCESS need several of something in one try? Returns a phrase for it, or null. */
function chainOf(stage: StageSpec): string | null {
  let found: string | null = null;
  const roots = [stage.success, ...stage.rules.filter((r) => effectsEnd(r)).flatMap((r) => (Array.isArray(r.args.if) ? r.args.if : []))].filter(isNode);
  for (const root of roots) walk(root, (n) => {
    if (found) return;
    const c = n.cardId;
    const many = (k: string) => paramOf(n, k, 1) >= 2;
    if ((c === 'cond.delivered' || c === 'cond.happened' || c === 'cond.watered') && many('count')) found = describe(n, ctxText);
    else if (c === 'cond.compare' && ['>=', '>', '=='].includes(paramOf(n, 'op', '<=')) && paramOf(n, 'value', 1) >= 2 && isNode(n.args.quantity) && ['q.stored', 'q.sold'].includes(n.args.quantity.cardId)) found = describe(n, ctxText);
    else if (c === 'cond.note' && paramOf(n, 'test', 'on') === 'gte' && paramOf(n, 'value', 1) >= 3) found = describe(n, ctxText);
  });
  return found;
}
function effectsEnd(r: SpecNode): boolean {
  return (Array.isArray(r.args.then) ? r.args.then.filter(isNode) : []).some((e) => e.cardId === 'eff.end' && paramOf(e, 'outcome', 'judge') !== 'fail');
}

/** Facts worth telling apart: carrying (if the pet can pick up), and standing at each thing the rules or SUCCESS name. */
function probes(stage: StageSpec): { text: string; sense: string; test: (w: World) => boolean }[] {
  const out: { text: string; sense: string; test: (w: World) => boolean }[] = [];
  const pet = { id: 'p', cardId: 'actor.pet', args: {} } as SpecNode;
  if (stage.abilities.includes('pickup') || stage.abilities.includes('lift')) {
    const c = compileCondition({ id: 'pc', cardId: 'cond.carryingAny', args: { actor: pet } });
    out.push({ text: 'carrying something', sense: '“Carrying”', test: (w) => c({ w, prev: w.pet }) });
  }
  const placed = placedKinds(stage);
  const named = new Set<string>();
  for (const root of [...stage.rules, ...(stage.success ? [stage.success] : [])]) walk(root, (n) => {
    if (n.cardId.startsWith('kind:')) named.add(n.cardId.slice(5));
    if (n.cardId === 'ref.target') named.add(stage.learner.focus);
  });
  for (const k of named) {
    // (Hazards are left out: stepping into one ends the try, so it is never a situation to act in.)
    if (!placed.has(k) || k.startsWith('@') || REGISTRY.objects.get(k)?.hazard) continue;
    const name = (REGISTRY.objects.get(k)?.name ?? k).toLowerCase();
    const c = withTarget(stage.learner.focus, () => compileCondition({ id: 'pa', cardId: 'cond.at', args: { actor: pet, what: { id: 'k', cardId: `kind:${k}`, args: {} } } }));
    out.push({ text: `standing at the ${name}`, sense: `“Nearest …” → ${name}`, test: (w) => c({ w, prev: w.pet }) });
  }
  return out;
}

/** Diagnose a trained skill on held-out layouts. `practice` (from the trainer) makes "never happened" exact. */
export function diagnose(stage: StageSpec, p: PolicySpec, seeds: number[], traits: Traits, successRate: number, practice?: PracticeCounts): LearnFinding[] {
  const out: LearnFinding[] = [];
  const bar = stage.evaluation.minimumSuccessRate;
  if (successRate >= bar) return out; // passing: nothing to explain
  const template = templateOf(stage);

  // Big treat never happened (in practice, if we know it; else in the held-out tries).
  const big = bigTreat(stage);
  const cs = compileStage(stage);
  const traces: EpisodeTrace[] = [];
  const states: number[][] = [];
  const masks: number[][] = [];
  const pr = probes(stage);
  const enc = template === 'sense' ? compileEncoder(senseDefFor(stage).senses, stage.learner.focus) : null;
  const routine = template === 'routine' && p.kind === 'routine' ? compileRoutine(stage, p.subskills, traits) : null;
  for (const seed of seeds) traces.push(runEpisode(cs, seed, makeChooser(stage, p, seed, traits), { label: 'evaluation', record: true }));
  // To see whether situations can be told apart, sample them widely: the trained pet with 30% random steps
  // (its own tries may loop away from everything that matters).
  for (const seed of seeds) for (const k of [0, 1]) {
    const st: number[] = [], mk: number[] = [];
    const own = makeChooser(stage, p, seed, traits), rand = makeChooser(stage, { kind: 'random' }, seed + 7 + k, traits);
    const rng = new Rng(hashSeed(seed, 0xd1a6 + k));
    runEpisode(cs, seed + k * 100003, (w) => (rng.next() < 0.3 ? rand(w) : own(w)), {
      label: 'evaluation', record: false,
      extra: (w) => {
        st.push(enc ? enc.index(enc.encode(w)) : routine ? routine.observe(w) : 0);
        mk.push(pr.reduce((a, q, i) => a | ((q.test(w) ? 1 : 0) << i), 0));
        return 0;
      },
    });
    states.push(st); masks.push(mk);
  }
  if (big) {
    const fired = practice ? practice.counts[big.id] ?? 0 : traces.reduce((a, t) => a + (t.ruleCounts[big.id] ?? 0), 0);
    const tries = practice ? practice.episodes : traces.length;
    if (tries > 0 && fired / tries < 0.01) {
      out.push({
        id: 'never-happened',
        text: `“${paramOf(big, 'label', 'The big treat')}” — the treat that matters — happened in ${fired === 0 ? 'none' : `only ${fired}`} of ${tries.toLocaleString()} ${practice ? 'practice' : 'test'} tries. A pet can’t learn from what it almost never sees: add stepping-stone treats (once per object for each step on the way), or build the job as a routine from skills it already has.`,
        lesson: 'routines',
      });
    }
  }

  // Long chain: several deliveries / legs in one try, asked of a single skill.
  const chain = template === 'sense' ? chainOf(stage) : null;
  if (chain) out.push({ id: 'long-chain', text: `SUCCESS needs several in one try (“${chain}”). One skill learns long chains slowly; a routine built from smaller skills (walk there, pick up, walk back, put down) learns them quickly.`, lesson: 'routines' });

  // Can't tell apart: the same sensed situation, a relevant fact sometimes true and sometimes not.
  if (pr.length && (enc || routine)) {
    const seen = new Map<number, { n: number; on: number[] }>();
    let total = 0;
    states.forEach((st, e) => st.forEach((s, i) => {
      const m = masks[e][i];
      const x = seen.get(s) ?? { n: 0, on: pr.map(() => 0) };
      x.n++; total++;
      pr.forEach((_, j) => { if (m & (1 << j)) x.on[j]++; });
      seen.set(s, x);
    }));
    // For each fact: of the steps where it held, how many were in a situation the pet also senses when it doesn't
    // hold? If most were, the pet can't know the fact — whatever it should do there, it can't tell when.
    const onAll = pr.map(() => 0), amb = pr.map(() => 0), where = pr.map(() => -1), whereN = pr.map(() => 0);
    for (const [s0, x] of seen) pr.forEach((_, j) => {
      const on = x.on[j], off = x.n - on;
      onAll[j] += on;
      if (on > 0 && off > 0) { amb[j] += on; if (x.n > whereN[j]) { whereN[j] = x.n; where[j] = s0; } }
    });
    let j = -1;
    pr.forEach((_, k) => { if (onAll[k] >= 2 && amb[k] / onAll[k] >= 0.5 && (j < 0 || amb[k] > amb[j])) j = k; });
    if (j >= 0) {
      const senses = senseDefFor(stage).senses;
      const at = enc ? decode(enc.radices, where[j]).map((v, i) => senseWords(senses[i], v)).join('; ') : '';
      const fix = routine ? 'add “Is …” for it to Watches' : `add a sense for it (${pr[j].sense})`;
      out.push({
        id: 'cant-tell',
        text: `Your pet can’t tell when it is ${pr[j].text}: ${Math.round((100 * amb[j]) / onAll[j])}% of the times it was, it sensed exactly what it senses when it isn’t${at ? ` (${at})` : ''}. If what to do next depends on it, ${fix}.`,
        lesson: routine ? 'routines' : 'invent',
      });
    }
    void total;
  }

  // Loops: missed tries ending in a pace between the same few tiles, with no treat.
  const missed = traces.filter((t) => !t.success);
  const looped = missed.filter((t) => {
    const tail = t.frames.slice(-16);
    if (tail.length < 16 || tail.some((f) => f.r > 0)) return false;
    return new Set(tail.map((f) => `${f.x},${f.y}`)).size <= 3;
  });
  if (missed.length >= 2 && looped.length / missed.length >= 0.3) {
    const senses = senseDefFor(stage).senses.map((n) => n.cardId);
    const tip = template === 'sense' && !(senses.includes('sense.blocked') && senses.includes('sense.heading'))
      ? 'Add the Walls and Heading senses, so it can tell it is stuck and which way it was going'
      : 'Practise with some obstacles in the pen (Obstacles: some), so getting around things is part of the job';
    out.push({
      id: 'loops',
      text: `In ${looped.length} of ${missed.length} missed tries your pet ended up pacing between the same few tiles. ${tip}.`,
      lesson: 'where', replay: looped[0],
    });
  }
  return out;
}

/** An encoder state index back into per-sense values (mixed radix, first sense most significant). */
function decode(radices: number[], index: number): number[] {
  const out = new Array(radices.length).fill(0);
  for (let i = radices.length - 1; i >= 0; i--) { out[i] = index % radices[i]; index = Math.floor(index / radices[i]); }
  return out;
}

/** One sensed value in words ("the basket is north-east, far"); other senses as "title: value". */
function senseWords(n: SpecNode, v: number): string {
  const title = REGISTRY.cards.get(n.cardId)?.presentation.title ?? n.cardId;
  if (n.cardId === 'sense.nearest' || n.cardId === 'sense.nearestDry') {
    const what = describe(isNode(n.args.what) ? n.args.what : null, ctxText).replace(/^the /, '');
    if (v === 14) return `no ${what} in sight`;
    const dir = Math.floor(v / 3), band = v % 3;
    const sx = Math.floor(dir / 3) - 1, sy = (dir % 3) - 1;
    if (sx === 0 && sy === 0) return `on the ${what}`;
    const compass = `${sy < 0 ? 'north' : sy > 0 ? 'south' : ''}${sy !== 0 && sx !== 0 ? '-' : ''}${sx > 0 ? 'east' : sx < 0 ? 'west' : ''}`;
    return `the ${what} is ${compass}, ${['next to it', 'close', 'far'][band]}`;
  }
  if (n.cardId === 'sense.carrying') return v ? 'carrying' : 'empty-pawed';
  return `${title}: ${v}`;
}
