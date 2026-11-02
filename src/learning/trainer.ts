import type { StageSpec } from '../domain/types';
import { compileStage, type CompiledStage } from '../sim/compile';
import { Rng, hashSeed } from '../sim/rng';
import type { World } from '../sim/world';
import { cloneWorld, step } from '../sim/world';
import { DoubleQ, type SerializedQ } from './qtable';
import { FETCH_OPTIONS, FETCH_STATES, fetchObserve, legalOptions } from './features';
import { compileEncoder, legalActionIdx, type SenseEncoder } from './senses';
import { FetchController, NavPolicy, OptionRun, SensePolicy, isDone, type SenseSkillDef } from './policies';
import { senseDefFor, templateOf } from './skilldef';
import { RoutineController, compileRoutine, type CompiledRoutine, type SubSkills } from './routine';
import type { EpisodeTrace, Frame, LedgerEntry, Traits } from './episodes';
import { navTimeout } from './episodes';

export const TRAIN_SEED_MAX = 800000;

export interface TrainConfig {
  stage: StageSpec;
  episodes: number;
  traits: Traits;
  /** Bounded player feedback: "state:action" → bonus in [-1, 1]. */
  feedback?: Record<string, number>;
  /** Resume from an existing policy (same skill). */
  initial?: SerializedQ | null;
  /** For composite skills: the navigator revision used as the movement option. */
  navigator?: SerializedQ | null;
  /** Senses/actions of that navigator revision (defaults to the Approach preset). */
  navigatorDef?: SenseSkillDef;
  /** Routine template: snapshots of the saved skills its options call. */
  subskills?: SubSkills;
  /** Offsets training seeds so "train more" sees new layouts. */
  seedOffset?: number;
}

export interface CurvePoint {
  episode: number;
  success: number;
  reward: number;
}

export interface TrainProgress {
  episode: number;
  total: number;
  successMA: number;
  rewardMA: number;
  epsilon: number;
  simTicks: number;
  curve: CurvePoint[];
  ledger: LedgerEntry[];
  visitedStates: number;
  sample?: EpisodeTrace;
}

export const CAUTION_LABEL = 'Caution (temperament)';
export const FEEDBACK_LABEL = 'Your feedback';

export function trainingSeed(stage: StageSpec, i: number): number {
  return hashSeed(stage.seed, i) % TRAIN_SEED_MAX;
}

export function feedbackKey(state: number, action: number): string {
  return `${state}:${action}`;
}

export class Trainer {
  readonly cfg: TrainConfig;
  readonly cs: CompiledStage;
  readonly q: DoubleQ;
  readonly kind: 'sense' | 'fetch' | 'routine';
  readonly routine: CompiledRoutine | null;
  readonly senseDef: SenseSkillDef | null;
  private encoder: SenseEncoder | null;
  episode = 0;
  simTicks = 0;
  curve: CurvePoint[] = [];
  private recentS: number[] = [];
  private recentR: number[] = [];
  private ledger = new Map<string, LedgerEntry>();
  private rng: Rng;
  private nav: NavPolicy | null;
  private gamma: number;
  private alpha: number;

  constructor(cfg: TrainConfig) {
    this.cfg = cfg;
    this.cs = compileStage(cfg.stage);
    const tpl = templateOf(cfg.stage);
    this.kind = tpl === 'fetch' ? 'fetch' : tpl === 'routine' ? 'routine' : 'sense';
    this.senseDef = this.kind === 'sense' ? senseDefFor(cfg.stage) : null;
    this.encoder = this.senseDef ? compileEncoder(this.senseDef.senses, cfg.stage.learner.focus) : null;
    this.routine = this.kind === 'routine' ? compileRoutine(cfg.stage, cfg.subskills ?? {}, cfg.traits) : null;
    if (this.routine?.missing.length) throw new Error(`This routine uses skills the pet hasn't saved: ${this.routine.missing.join(', ')}.`);
    const [nS, nA] = this.senseDef ? [this.encoder!.size, this.senseDef.actions.length]
      : this.routine ? [this.routine.nStates, this.routine.options.length]
      : [FETCH_STATES, FETCH_OPTIONS.length];
    this.q = cfg.initial ? DoubleQ.deserialize(cfg.initial) : new DoubleQ(nS, nA);
    if (this.q.nS !== nS || this.q.nA !== nA) throw new Error('Policy shape does not match this skill.');
    this.rng = new Rng(hashSeed(cfg.stage.seed, cfg.seedOffset ?? 0, 0x7a11));
    this.nav = this.kind === 'fetch' ? SensePolicy.from(cfg.navigator, cfg.navigatorDef) : null;
    this.gamma = this.kind === 'sense' ? 0.95 : 0.9;
    this.alpha = this.kind === 'sense' ? 0.25 : 0.3;
    if (this.routine && !this.routine.options.length) throw new Error('A routine needs at least one option.');
  }

  get total(): number {
    return this.cfg.episodes;
  }
  get done(): boolean {
    return this.episode >= this.cfg.episodes;
  }

  epsilon(): number {
    const floor = 0.02 + 0.1 * this.cfg.traits.curiosity;
    const resume = this.cfg.initial ? 0.4 : 1;
    const frac = Math.min(1, this.episode / Math.max(1, this.cfg.episodes * 0.6));
    return Math.max(floor, resume * (1 - frac) + floor * frac);
  }

  private bonus(w: World, events: ReturnType<typeof step>): number {
    let b = 0;
    if (this.cfg.traits.caution > 0 && events.some((e) => e.type === 'enter')) {
      b -= 3 * this.cfg.traits.caution;
      this.addLedger('caution', CAUTION_LABEL, -3 * this.cfg.traits.caution);
    }
    void w;
    return b;
  }

  private addLedger(id: string, label: string, amount: number) {
    const e = this.ledger.get(id) ?? { ruleId: id, label, count: 0, total: 0 };
    e.count++;
    e.total += amount;
    this.ledger.set(id, e);
  }

  private fb(s: number, a: number): number {
    const v = this.cfg.feedback?.[feedbackKey(s, a)];
    if (!v) return 0;
    const b = Math.max(-1, Math.min(1, v));
    this.addLedger('feedback', FEEDBACK_LABEL, b);
    return b;
  }

  /** Train one episode; optionally record a trace for the replay viewer. */
  private runOne(record: boolean): EpisodeTrace {
    const seed = trainingSeed(this.cfg.stage, (this.cfg.seedOffset ?? 0) + this.episode);
    const cs = this.cs;
    const w = cs.generate(seed);
    const initial = record ? cloneWorld(w) : w;
    const rs = cs.newRuleState();
    const frames: Frame[] = [];
    const ruleCounts: Record<string, number> = {};
    const eps = this.epsilon();
    let total = 0;
    const maxT = cs.spec.maxTicks;
    const applyStep = (a: Parameters<typeof step>[1]) => {
      const prev = { x: w.pet.x, y: w.pet.y };
      const events = step(w, a);
      const out = cs.evalStep(w, prev, events, rs);
      for (const h of out.hits) {
        ruleCounts[h.ruleId] = (ruleCounts[h.ruleId] ?? 0) + 1;
        this.addLedger(h.ruleId, h.label, h.amount);
      }
      const r = out.reward + this.bonus(w, events);
      if (record) frames.push({ x: w.pet.x, y: w.pet.y, carrying: w.pet.carrying !== null, a, r, hits: out.hits.length ? out.hits.map((h) => h.label) : undefined });
      return { r, end: out.end };
    };

    const options: string[] = [];
    if (this.kind === 'sense') {
      const enc = this.encoder!;
      const actions = this.senseDef!.actions;
      let s = enc.index(enc.encode(w));
      while (w.tick < maxT) {
        const legal = legalActionIdx(w, actions);
        const a = this.rng.next() < eps ? legal[this.rng.int(legal.length)] : this.q.greedy(s, legal);
        const { r, end } = applyStep(actions[a]);
        const rr = r + this.fb(s, a);
        total += rr;
        const next = enc.index(enc.encode(w));
        this.q.update(s, a, rr, end !== null ? -1 : next, this.gamma, this.alpha, this.rng.next());
        s = next;
        if (end) break;
      }
    } else {
      // Option-level (SMDP) learning, shared by Fetch and player-built routines.
      const item = cs.spec.learner.focus, dest = cs.spec.learner.destination ?? 'bin';
      const tmo = navTimeout(cs.spec.size.w, cs.spec.size.h, this.cfg.traits.persistence);
      const R0 = this.routine;
      const observe = R0 ? (x: World) => R0.observe(x) : (x: World) => fetchObserve(x, item, dest);
      const legalOf = R0 ? (x: World) => R0.legal(x) : (_x: World, st: number) => legalOptions(st);
      const runOf = R0 ? (o: number) => R0.options[o].makeRun(this.rng) : (o: number) => new OptionRun(FETCH_OPTIONS[o], this.nav, item, dest, tmo, this.rng);
      const labelOf = R0 ? (o: number) => R0.options[o].label : (o: number) => FETCH_OPTIONS[o];
      let s = observe(w);
      let ended = false;
      while (w.tick < maxT && !ended) {
        const lo = legalOf(w, s);
        if (!lo.length) {
          // Nothing the routine can do right now: idle a tick (no decision to learn from).
          const { end } = applyStep('wait');
          if (end) ended = true;
          s = observe(w);
          continue;
        }
        const o = this.rng.next() < eps ? lo[this.rng.int(lo.length)] : this.q.greedy(s, lo);
        options.push(labelOf(o));
        const run = runOf(o);
        let R = 0;
        while (w.tick < maxT) {
          const st = run.next(w);
          if (isDone(st)) break;
          const { r, end } = applyStep(st);
          R += r;
          if (end) { ended = true; break; }
        }
        R += this.fb(s, o);
        total += R;
        const s2 = observe(w);
        this.q.update(s, o, R, ended ? -1 : s2, this.gamma, this.alpha, this.rng.next());
        s = s2;
      }
    }
    this.simTicks += w.tick;
    const success = cs.isSuccess(w);
    this.episode++;
    this.recentS.push(success ? 1 : 0);
    this.recentR.push(total);
    if (this.recentS.length > 50) { this.recentS.shift(); this.recentR.shift(); }
    return { label: 'training', seed, initial, frames, success, failed: cs.isFail(w), reward: total, ticks: w.tick, ruleCounts, options: options.length ? options : undefined };
  }

  runChunk(n: number, recordSample: boolean): TrainProgress {
    let sample: EpisodeTrace | undefined;
    const stop = Math.min(this.cfg.episodes, this.episode + n);
    while (this.episode < stop) {
      const rec = recordSample && this.episode === stop - 1;
      const t = this.runOne(rec);
      if (rec) sample = t;
      // About 400 curve points at most (every 25 tries up to 10,000 tries, as before).
      const every = Math.max(25, Math.round(this.cfg.episodes / 400 / 25) * 25);
      if (this.episode % every === 0 || this.episode === this.cfg.episodes) {
        this.curve.push({ episode: this.episode, success: this.successMA(), reward: this.rewardMA() });
      }
    }
    return this.progress(sample);
  }

  successMA(): number {
    return this.recentS.length ? this.recentS.reduce((a, b) => a + b, 0) / this.recentS.length : 0;
  }
  rewardMA(): number {
    return this.recentR.length ? this.recentR.reduce((a, b) => a + b, 0) / this.recentR.length : 0;
  }

  progress(sample?: EpisodeTrace): TrainProgress {
    return {
      episode: this.episode, total: this.cfg.episodes,
      successMA: this.successMA(), rewardMA: this.rewardMA(), epsilon: this.epsilon(),
      simTicks: this.simTicks, curve: [...this.curve],
      ledger: [...this.ledger.values()].map((e) => ({ ...e })),
      visitedStates: this.q.visitedStates(), sample,
    };
  }

  policy(): SerializedQ {
    return this.q.serialize();
  }

  /** Runtime policy object for evaluation. */
  runtime(): SensePolicy | FetchController | RoutineController {
    if (this.routine) return new RoutineController(this.routine.nStates, this.routine.options.length, this.q.clone());
    return this.kind === 'sense' ? new SensePolicy(this.senseDef!, this.q.clone()) : new FetchController(this.q.clone());
  }
}
