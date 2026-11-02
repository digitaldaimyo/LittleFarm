import type { Action, SimEvent, World } from '../sim/world';
import type { CompiledStage, RuleState } from '../sim/compile';
import { MOVES, isSolidAt, DIRS, nearest, cloneTally, type Tally } from '../sim/world';
import type { SpecNode } from '../domain/types';
import { compileEncoder, legalActionIdx, presetSenses, stateSpaceSize, type SenseEncoder } from './senses';
import { Rng } from '../sim/rng';
import { DoubleQ, type SerializedQ } from './qtable';
import { FETCH_OPTIONS, FETCH_STATES, atFocus, fetchObserve, legalOptions, type FetchOption } from './features';

const MIN_VISITS = 3;

export interface SenseSkillDef {
  senses: SpecNode[];
  actions: Action[];
}

export const PRESET_NAV: SenseSkillDef = { senses: presetSenses(), actions: MOVES };

/**
 * Learned policy over player-chosen senses (Approach/Avoid are presets).
 * Parameterised by its target at call time: re-aiming needs no retraining.
 */
export class SensePolicy {
  q: DoubleQ;
  readonly def: SenseSkillDef;
  private encoders = new Map<string, SenseEncoder>();
  constructor(def: SenseSkillDef = PRESET_NAV, q?: DoubleQ) {
    this.def = def;
    this.q = q ?? new DoubleQ(stateSpaceSize(def.senses), def.actions.length);
  }
  static from(s: SerializedQ | null | undefined, def: SenseSkillDef = PRESET_NAV): SensePolicy | null {
    return s ? new SensePolicy(def, DoubleQ.deserialize(s)) : null;
  }
  encoder(target: string): SenseEncoder {
    let e = this.encoders.get(target);
    if (!e) { e = compileEncoder(this.def.senses, target); this.encoders.set(target, e); }
    return e;
  }
  /** Greedy legal action. Rarely-seen states back off to coarser views. */
  act(w: World, target: string, base?: Tally): Action {
    const enc = this.encoder(target);
    const v = enc.encode(w, base);
    let s = enc.index(v);
    if (this.q.visits(s) < MIN_VISITS) {
      for (const b of enc.backoffs(v)) { s = b; if (this.q.visits(s) >= MIN_VISITS) break; }
    }
    return this.def.actions[this.q.greedy(s, legalActionIdx(w, this.def.actions))];
  }
}

/** Back-compat name: movement skills are SensePolicies with the preset senses. */
export const NavPolicy = SensePolicy;
export type NavPolicy = SensePolicy;

/** A pet with no learned movement just ambles randomly (seeded). */
export function randomMove(w: World, rng: Rng): Action {
  const open = MOVES.filter((m) => !isSolidAt(w, w.pet.x + DIRS[m][0], w.pet.y + DIRS[m][1]));
  return rng.pick(open.length ? open : MOVES);
}

/**
 * How a run ended. `timeout` is never success: a skill or routine that runs out of time without reaching its goal
 * timed out (only *survive* skills — "stay dry until time's up" — succeed at time-up, and only if they survived).
 */
export type Outcome = 'success' | 'fail' | 'timeout' | 'interrupted' | 'cancelled';
export type ExecStatus = { done: Outcome; reason: string };
/** Ended in success (anything else — failure, timeout, interruption, cancellation — is not). */
export const succeeded = (s: ExecStep): boolean => isDone(s) && s.done === 'success';
export type ExecStep = Action | ExecStatus;
export const isDone = (s: ExecStep): s is ExecStatus => typeof s === 'object';

/** Runs one navigation option: move toward `focus` until there, gone, or timed out. */
export class NavRun {
  ticks = 0;
  constructor(
    private policy: NavPolicy | null,
    private focus: string,
    private timeout: number,
    private rng: Rng,
    /** Deployed (farm) only: a small chance of a random step, set by Curiosity, so a greedy loop can't repeat forever. */
    private explore = 0,
  ) {}
  next(w: World): ExecStep {
    if (atFocus(w, this.focus)) return { done: 'success', reason: 'arrived' };
    if (!nearest(w, this.focus)) return { done: 'fail', reason: 'nothing to approach' };
    if (this.ticks >= this.timeout) return { done: 'timeout', reason: 'timeout' };
    this.ticks++;
    if (this.explore > 0 && this.rng.next() < this.explore) return randomMove(w, this.rng);
    return this.policy ? this.policy.act(w, this.focus) : randomMove(w, this.rng);
  }
}

/** One option of the Fetch controller, executed tick by tick. */
export class OptionRun {
  private nav: NavRun | null = null;
  private stepped = false;
  constructor(
    readonly option: FetchOption,
    nav: NavPolicy | null,
    item: string,
    dest: string,
    timeout: number,
    rng: Rng,
  ) {
    if (option === 'goItem') this.nav = new NavRun(nav, item, timeout, rng);
    if (option === 'goDest') this.nav = new NavRun(nav, dest, timeout, rng);
  }
  next(w: World): ExecStep {
    if (this.nav) {
      const s = this.nav.next(w);
      if (isDone(s) && !this.stepped) {
        // Every option consumes at least one tick so loops always cost time.
        this.stepped = true;
        return 'wait';
      }
      this.stepped = true;
      return s;
    }
    if (this.stepped) return { done: 'success', reason: 'acted' };
    this.stepped = true;
    return this.option === 'pick' ? 'pick' : 'drop';
  }
}

export class FetchController {
  q: DoubleQ;
  constructor(q?: DoubleQ) {
    this.q = q ?? new DoubleQ(FETCH_STATES, FETCH_OPTIONS.length);
  }
  static from(s: SerializedQ | null | undefined): FetchController | null {
    return s ? new FetchController(DoubleQ.deserialize(s)) : null;
  }
  choose(w: World, item: string, dest: string): FetchOption {
    const s = fetchObserve(w, item, dest);
    return FETCH_OPTIONS[this.q.greedy(s, legalOptions(s))];
  }
}

/**
 * Deterministic composite executor for Fetch(item, dest): the learned controller
 * picks options at boundaries; movement options delegate to the learned navigator.
 */
export class FetchRun {
  private cur: OptionRun | null = null;
  ticks = 0;
  options: FetchOption[] = [];
  constructor(
    private ctrl: FetchController,
    private nav: NavPolicy | null,
    private item: string,
    private dest: string,
    private optionTimeout: number,
    private totalTimeout: number,
    private rng: Rng,
    private deliveredBefore: number,
    /** How to count deliveries (default: of this item kind). The farm's Haul counts sales at the house. */
    private countFn?: (w: World) => number,
  ) {}
  next(w: World): ExecStep {
    if ((this.countFn ? this.countFn(w) : w.delivered[this.item] ?? 0) > this.deliveredBefore) return { done: 'success', reason: 'delivered' };
    if (this.ticks >= this.totalTimeout) return { done: 'timeout', reason: 'timeout' };
    for (let guard = 0; guard < 4; guard++) {
      if (!this.cur) {
        const o = this.ctrl.choose(w, this.item, this.dest);
        this.options.push(o);
        this.cur = new OptionRun(o, this.nav, this.item, this.dest, this.optionTimeout, this.rng);
      }
      const s = this.cur.next(w);
      if (isDone(s)) {
        this.cur = null;
        continue;
      }
      this.ticks++;
      return s;
    }
    this.ticks++;
    return 'wait';
  }
  get currentOption(): FetchOption | null {
    return this.cur?.option ?? null;
  }
}

/**
 * Runs any sense skill until its own termination condition holds, it times out,
 * or (optionally) a target-arrival check succeeds. Used for player-made skills on the farm.
 */
export class SkillRun {
  ticks = 0;
  /** What had already happened when this run started: "Has …" and "Done … yet?" count from here. */
  private base: Tally | undefined;
  /** This run's notebook (notes start empty each run, as each try starts empty in the pen). */
  private notes: Record<string, number> = {};
  private noteRules: RuleState | null = null;
  constructor(
    private policy: SensePolicy,
    private target: string,
    private timeout: number,
    private done: ((w: World, base?: Tally) => boolean) | null,
    /** The skill's rules that write notes: they run on the farm too (their treats don't). */
    private noteRunner: NoteRunner | null = null,
    /** *Survive* skills: at time-up, did it survive (its FAIL never held)? Absent = time-up is a timeout. */
    private survived: ((w: World) => boolean) | null = null,
    /** Deployed (farm) only: Curiosity's small chance of a random step (see NavRun). */
    private explore: { eps: number; rng: Rng } | null = null,
  ) {}
  /** Lend the run's notes to the shared farm world while it reads or writes them. */
  private withNotes<T>(w: World, fn: () => T): T {
    const before = w.notes;
    w.notes = this.notes;
    try { return fn(); } finally { this.notes = w.notes ?? {}; if (before === undefined) delete w.notes; else w.notes = before; }
  }
  next(w: World): ExecStep {
    if (this.ticks === 0) { w.tally ??= {}; this.base = cloneTally(w.tally); } // start remembering from here
    return this.withNotes(w, () => {
      if (this.ticks > 0 && this.done?.(w, this.base)) return { done: 'success', reason: 'goal reached' };
      if (this.ticks >= this.timeout) return this.survived ? (this.survived(w) ? { done: 'success', reason: 'survived' } : { done: 'fail', reason: 'did not survive' }) : { done: 'timeout', reason: 'time up' };
      this.ticks++;
      if (this.explore && this.explore.rng.next() < this.explore.eps) return randomMove(w, this.explore.rng);
      return this.policy.act(w, this.target, this.base);
    });
  }
  /** After the farm stepped: run the note-writing rules on what happened. */
  observe(w: World, prev: { x: number; y: number }, events: SimEvent[]): void {
    if (!this.noteRunner) return;
    this.noteRules ??= this.noteRunner.newRuleState();
    const rs = this.noteRules;
    const verdict = w.verdict;
    this.withNotes(w, () => this.noteRunner!.evalStep(w, prev, events, rs));
    if (verdict === undefined) delete w.verdict; else w.verdict = verdict; // ending a try means nothing on the farm
  }
}

/** The part of a compiled lesson that writes notes (see SkillRun). */
export type NoteRunner = Pick<CompiledStage, 'newRuleState' | 'evalStep'>;
