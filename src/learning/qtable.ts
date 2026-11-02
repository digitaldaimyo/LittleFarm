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

/** Above this many situations a table is kept sparsely (only visited rows) — the "Big" brain. */
export const DENSE_MAX_STATES = 100000;

export class DoubleQ {
  readonly nS: number;
  readonly nA: number;
  /** Dense storage (Standard brain). Empty when sparse. */
  qa: Float32Array;
  qb: Float32Array;
  private vis: Uint32Array;
  /** Sparse storage (Big brain): state → [qA..., qB...] and visit counts, only for visited states. */
  private rowsA: Map<number, Float32Array> | null = null;
  private visMap: Map<number, number> | null = null;

  constructor(nS: number, nA: number, sparse = nS > DENSE_MAX_STATES) {
    this.nS = nS;
    this.nA = nA;
    if (sparse) {
      this.qa = new Float32Array(0);
      this.qb = new Float32Array(0);
      this.vis = new Uint32Array(0);
      this.rowsA = new Map();
      this.visMap = new Map();
    } else {
      this.qa = new Float32Array(nS * nA);
      this.qb = new Float32Array(nS * nA);
      this.vis = new Uint32Array(nS);
    }
  }

  get sparse(): boolean {
    return this.rowsA !== null;
  }

  /** How often a situation was practised. */
  visits(s: number): number {
    return this.visMap ? this.visMap.get(s) ?? 0 : this.vis[s] ?? 0;
  }

  /** The [qA..., qB...] row of a sparse table (created on write). */
  private row(s: number, create: boolean): Float32Array | undefined {
    let r = this.rowsA!.get(s);
    if (!r && create) { r = new Float32Array(2 * this.nA); this.rowsA!.set(s, r); }
    return r;
  }

  private qA(s: number, a: number): number {
    return this.rowsA ? this.rowsA.get(s)?.[a] ?? 0 : this.qa[s * this.nA + a];
  }
  private qB(s: number, a: number): number {
    return this.rowsA ? this.rowsA.get(s)?.[this.nA + a] ?? 0 : this.qb[s * this.nA + a];
  }

  value(s: number, a: number): number {
    if (this.rowsA) { const r = this.rowsA.get(s); return r ? r[a] + r[this.nA + a] : 0; }
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
    const useA = coin < 0.5;
    let target = r;
    if (sNext >= 0) {
      let bestA = 0, bv = -Infinity;
      for (let b = 0; b < this.nA; b++) {
        const v = useA ? this.qA(sNext, b) : this.qB(sNext, b);
        if (v > bv) { bv = v; bestA = b; }
      }
      target += gamma * (useA ? this.qB(sNext, bestA) : this.qA(sNext, bestA));
    }
    if (this.rowsA) {
      const row = this.row(s, true)!;
      const i = useA ? a : this.nA + a;
      // Float32 storage, like the dense arrays, so both brains compute identical values.
      const td = target - row[i];
      row[i] += alpha * td;
      this.visMap!.set(s, Math.min((this.visMap!.get(s) ?? 0) + 1, 4294967295));
      return td;
    }
    const Q = useA ? this.qa : this.qb;
    const i = s * this.nA + a;
    const td = target - Q[i];
    Q[i] += alpha * td;
    this.vis[s] = Math.min(this.vis[s] + 1, 4294967295);
    return td;
  }

  clone(): DoubleQ {
    const c = new DoubleQ(this.nS, this.nA, this.sparse);
    if (this.rowsA) {
      for (const [k, r] of this.rowsA) c.rowsA!.set(k, r.slice());
      for (const [k, v] of this.visMap!) c.visMap!.set(k, v);
      return c;
    }
    c.qa.set(this.qa);
    c.qb.set(this.qb);
    c.vis.set(this.vis);
    return c;
  }

  /** Visited states, in increasing order. */
  private visitedList(): number[] {
    if (this.visMap) return [...this.visMap.keys()].filter((k) => this.visMap!.get(k)! > 0).sort((a, b) => a - b);
    const out: number[] = [];
    for (let s = 0; s < this.nS; s++) if (this.vis[s] > 0) out.push(s);
    return out;
  }

  serialize(): SerializedQ {
    const rows: Record<string, number[]> = {};
    for (const s of this.visitedList()) {
      const row: number[] = [];
      for (let a = 0; a < this.nA; a++) row.push(round(this.qA(s, a)));
      for (let a = 0; a < this.nA; a++) row.push(round(this.qB(s, a)));
      row.push(this.visits(s));
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
      const v = Math.max(0, Number(row[2 * d.nA]) || 0);
      if (q.rowsA) {
        const r = q.row(s, true)!;
        for (let a = 0; a < d.nA; a++) { r[a] = Number(row[a]) || 0; r[d.nA + a] = Number(row[d.nA + a]) || 0; }
        q.visMap!.set(s, v);
        continue;
      }
      for (let a = 0; a < d.nA; a++) {
        q.qa[s * d.nA + a] = Number(row[a]) || 0;
        q.qb[s * d.nA + a] = Number(row[d.nA + a]) || 0;
      }
      q.vis[s] = v;
    }
    return q;
  }

  visitedStates(): number {
    if (this.visMap) return this.visMap.size;
    let n = 0;
    for (let s = 0; s < this.nS; s++) if (this.vis[s] > 0) n++;
    return n;
  }
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
