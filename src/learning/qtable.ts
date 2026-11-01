/**
 * Tabular Double Q-learning store. Two estimators (A/B) reduce maximisation bias;
 * acting uses their sum. Serialises sparsely (only visited states) for saves.
 */
export interface SerializedQ {
  format: 'double-q/v1';
  nS: number;
  nA: number;
  /** stateIndex → [qA..., qB..., visits] */
  rows: Record<string, number[]>;
}

export class DoubleQ {
  readonly nS: number;
  readonly nA: number;
  qa: Float32Array;
  qb: Float32Array;
  visits: Uint32Array;

  constructor(nS: number, nA: number) {
    this.nS = nS;
    this.nA = nA;
    this.qa = new Float32Array(nS * nA);
    this.qb = new Float32Array(nS * nA);
    this.visits = new Uint32Array(nS);
  }

  value(s: number, a: number): number {
    const i = s * this.nA + a;
    return this.qa[i] + this.qb[i];
  }

  /** Greedy action among `allowed` (all if omitted). Deterministic tie-break by lowest index. */
  greedy(s: number, allowed?: number[]): number {
    const acts = allowed ?? Array.from({ length: this.nA }, (_, i) => i);
    let best = acts[0];
    let bv = -Infinity;
    for (const a of acts) {
      const v = this.value(s, a);
      if (v > bv + 1e-9) {
        bv = v;
        best = a;
      }
    }
    return best;
  }

  maxValue(s: number): number {
    let m = -Infinity;
    for (let a = 0; a < this.nA; a++) m = Math.max(m, this.value(s, a));
    return m;
  }

  /**
   * Double-Q update. `coin` < 0.5 updates A using B's estimate of A's argmax, and vice versa.
   * `sNext` < 0 means terminal.
   */
  update(s: number, a: number, r: number, sNext: number, gamma: number, alpha: number, coin: number): number {
    const [Q, O] = coin < 0.5 ? [this.qa, this.qb] : [this.qb, this.qa];
    const i = s * this.nA + a;
    let target = r;
    if (sNext >= 0) {
      let bestA = 0, bv = -Infinity;
      for (let b = 0; b < this.nA; b++) {
        const v = Q[sNext * this.nA + b];
        if (v > bv) { bv = v; bestA = b; }
      }
      target += gamma * O[sNext * this.nA + bestA];
    }
    const td = target - Q[i];
    Q[i] += alpha * td;
    this.visits[s] = Math.min(this.visits[s] + 1, 4294967295);
    return td;
  }

  clone(): DoubleQ {
    const c = new DoubleQ(this.nS, this.nA);
    c.qa.set(this.qa);
    c.qb.set(this.qb);
    c.visits.set(this.visits);
    return c;
  }

  serialize(): SerializedQ {
    const rows: Record<string, number[]> = {};
    for (let s = 0; s < this.nS; s++) {
      if (this.visits[s] === 0) continue;
      const row: number[] = [];
      for (let a = 0; a < this.nA; a++) row.push(round(this.qa[s * this.nA + a]));
      for (let a = 0; a < this.nA; a++) row.push(round(this.qb[s * this.nA + a]));
      row.push(this.visits[s]);
      rows[s] = row;
    }
    return { format: 'double-q/v1', nS: this.nS, nA: this.nA, rows };
  }

  static deserialize(d: SerializedQ): DoubleQ {
    if (d.format !== 'double-q/v1') throw new Error(`Unsupported policy format ${d.format}`);
    const q = new DoubleQ(d.nS, d.nA);
    for (const [k, row] of Object.entries(d.rows)) {
      const s = Number(k);
      if (!Number.isInteger(s) || s < 0 || s >= d.nS || !Array.isArray(row)) continue;
      for (let a = 0; a < d.nA; a++) {
        q.qa[s * d.nA + a] = Number(row[a]) || 0;
        q.qb[s * d.nA + a] = Number(row[d.nA + a]) || 0;
      }
      q.visits[s] = Math.max(0, Number(row[2 * d.nA]) || 0);
    }
    return q;
  }

  visitedStates(): number {
    let n = 0;
    for (let s = 0; s < this.nS; s++) if (this.visits[s] > 0) n++;
    return n;
  }
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
