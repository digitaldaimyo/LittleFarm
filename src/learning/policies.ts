import type { Action, World } from '../sim/world';
import { MOVES, isSolidAt, DIRS } from '../sim/world';
import { Rng } from '../sim/rng';
import { DoubleQ, type SerializedQ } from './qtable';
import { FETCH_OPTIONS, FETCH_STATES, NAV_ACTIONS, NAV_STATES, atFocus, fetchObserve, navIndex, navObserve, type FetchOption } from './features';

/** Learned navigation policy (Approach / Avoid). Parameterised by the focus kind at call time. */
export class NavPolicy {
  q: DoubleQ;
  constructor(q?: DoubleQ) {
    this.q = q ?? new DoubleQ(NAV_STATES, NAV_ACTIONS.length);
  }
  static from(s: SerializedQ | null | undefined): NavPolicy | null {
    return s ? new NavPolicy(DoubleQ.deserialize(s)) : null;
  }
  /**
   * Greedy action toward `focus`, or null when arrived / nothing to approach.
   * Unvisited states back off to a factored state (ignore hazards, then walls).
   */
  act(w: World, focus: string): Action | null {
    const o = navObserve(w, focus);
    if (!o || o.dist === 0) return null;
    let s = o.index;
    const db = o.dist <= 1 ? 0 : o.dist <= 3 ? 1 : 2;
    if (this.q.visits[s] === 0) s = navIndex(o.dir, db, o.blocked, 0, o.heading);
    if (this.q.visits[s] === 0) s = navIndex(o.dir, db, 0, 0, o.heading);
    return NAV_ACTIONS[this.q.greedy(s)];
  }
}

/** A pet with no learned movement just ambles randomly (seeded). */
export function randomMove(w: World, rng: Rng): Action {
  const open = MOVES.filter((m) => !isSolidAt(w, w.pet.x + DIRS[m][0], w.pet.y + DIRS[m][1]));
  return rng.pick(open.length ? open : MOVES);
}

export type ExecStatus = { done: 'success' | 'fail'; reason: string };
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
  ) {}
  next(w: World): ExecStep {
    if (atFocus(w, this.focus)) return { done: 'success', reason: 'arrived' };
    if (this.ticks >= this.timeout) return { done: 'fail', reason: 'timeout' };
    this.ticks++;
    const a = this.policy ? this.policy.act(w, this.focus) : randomMove(w, this.rng);
    if (a === null) return { done: 'fail', reason: 'nothing to approach' };
    return a;
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
    return FETCH_OPTIONS[this.q.greedy(fetchObserve(w, item, dest))];
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
  ) {}
  next(w: World): ExecStep {
    if ((w.delivered[this.item] ?? 0) > this.deliveredBefore) return { done: 'success', reason: 'delivered' };
    if (this.ticks >= this.totalTimeout) return { done: 'fail', reason: 'timeout' };
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
