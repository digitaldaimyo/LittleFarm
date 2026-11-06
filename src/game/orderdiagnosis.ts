/**
 * Learned picks as a diagnosis of the player's order (polish phase 5). During the comparison, every free choice the
 * learned picks make is tallied against what the order would have picked at that moment (`PickTally`). If learned
 * picks earn clearly more, the diagnosis names the responsibility they skip most and suggests moving it below the
 * ones they chose instead (or, for a job, trying it first). Otherwise it says the order is fine.
 */
import type { SpecNode } from '../domain/types';
import { isNode } from '../domain/spec';
import type { Responsibilities } from './types';
import type { PickTally } from './plan';
import { compilePlan } from './responsibilities';
import type { ExecComparisonRow } from './farmlessons';

/** Learned picks must earn at least this much more than the order before the order is called into question. */
export const BETTER_BY = 1.05;
/** A disagreement worth naming: at least this share of the learned picks' free choices. */
export const NOTABLE = 0.1;

export type OrderSuggestion =
  | { kind: 'move'; rowId: string; afterRowId: string; text: string; button: string }
  | { kind: 'job-first'; rowId: string; jobIndex: number; text: string; button: string };

export interface OrderDiagnosis {
  verdict: 'fine' | 'change';
  text: string;
  suggestion?: OrderSuggestion;
  /** Share of free choices where learned picks did what the order would have done. */
  agree: number;
}

export function emptyTally(): PickTally { return { n: 0, rows: {}, jobs: {} }; }
export function addTally(a: PickTally, b?: PickTally): PickTally {
  if (!b) return a;
  a.n += b.n;
  for (const [k, v] of Object.entries(b.rows)) a.rows[k] = (a.rows[k] ?? 0) + v;
  for (const [k, v] of Object.entries(b.jobs)) a.jobs[k] = (a.jobs[k] ?? 0) + v;
  return a;
}

const pct = (x: number) => `${Math.round(100 * x)}%`;

export function diagnoseOrder(plan: Responsibilities, cmp: ExecComparisonRow[], t: PickTally): OrderDiagnosis {
  const coins = (m: string) => cmp.find((r) => r.mode === m)?.coins ?? 0;
  const order = coins('order'), learned = coins('learned');
  const rowDiff = Object.values(t.rows).reduce((a, b) => a + b, 0);
  const agree = t.n ? 1 - rowDiff / t.n : 1;
  const label = (id: string) => String(plan.rows.find((r) => r.id === id)?.args.label ?? 'that one');
  const index = (id: string) => plan.rows.findIndex((r) => r.id === id);
  if (learned < order * BETTER_BY) {
    return { verdict: 'fine', agree, text: `Your order is fine. Learned picks didn’t earn clearly more (${learned} coins vs ${order} in your order), and they matched your order in ${pct(agree)} of their choices.` };
  }
  // Responsibilities: which one do learned picks skip most, and for which ones?
  const skipped: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(t.rows)) {
    const [x, y] = k.split('>');
    (skipped[x] ??= {})[y] = v;
  }
  const total = (x: string) => Object.values(skipped[x]).reduce((a, b) => a + b, 0);
  const worst = Object.keys(skipped).filter((x) => index(x) >= 0).sort((a, b) => total(b) - total(a))[0];
  if (worst && total(worst) >= NOTABLE * t.n) {
    // Move it below the lowest responsibility the learned picks chose instead (any it chose notably often).
    const instead = Object.entries(skipped[worst]).filter(([y, v]) => index(y) >= 0 && v >= NOTABLE * total(worst)).map(([y]) => y);
    // A responsibility with no WHEN always applies, so it hides everything below it: the bottom is its place.
    const row = plan.rows[index(worst)];
    const always = !(Array.isArray(row.args.if) && row.args.if.length);
    const lastId = plan.rows[plan.rows.length - 1].id;
    if (always && lastId !== worst) {
      return {
        verdict: 'change', agree,
        text: `Learned picks earned ${learned} coins vs ${order} in your order. They skip “${label(worst)}” in ${pct(total(worst) / t.n)} of their choices. It has no WHEN, so it always applies and hides everything listed below it. Move it to the bottom?`,
        suggestion: { kind: 'move', rowId: worst, afterRowId: lastId, text: `Move “${label(worst)}” to the bottom`, button: `Move “${label(worst)}” to the bottom` },
      };
    }
    const after = instead.sort((a, b) => index(b) - index(a))[0];
    if (after) {
      const others = instead.filter((y) => y !== after).map(label);
      return {
        verdict: 'change', agree,
        text: `Learned picks earned ${learned} coins vs ${order} in your order. They skip “${label(worst)}” in ${pct(total(worst) / t.n)} of their choices and work on “${label(after)}”${others.length ? ` (or ${others.map((o) => `“${o}”`).join(', ')})` : ''} instead. Move “${label(worst)}” below “${label(after)}”?`,
        suggestion: { kind: 'move', rowId: worst, afterRowId: after, text: `Move “${label(worst)}” below “${label(after)}”`, button: `Move “${label(worst)}” down` },
      };
    }
  }
  // Jobs: within one responsibility, a job learned picks prefer over the one the order uses.
  const job = Object.entries(t.jobs).sort((a, b) => b[1] - a[1])[0];
  if (job && job[1] >= NOTABLE * t.n) {
    const [rowId, pair] = [job[0].slice(0, job[0].indexOf('|')), job[0].slice(job[0].indexOf('|') + 1)];
    const [from, to] = pair.split('>');
    const row = compilePlan(plan).find((r) => r.id === rowId);
    const ji = row?.jobs.findIndex((j) => j.key === to) ?? -1;
    if (row && ji > 0) {
      const name = (k: string) => row.jobs.find((j) => j.key === k)?.label ?? k;
      return {
        verdict: 'change', agree,
        text: `Learned picks earned ${learned} coins vs ${order} in your order. For “${row.label}” they prefer ${name(to)} over ${name(from)}. Use ${name(to)} first?`,
        suggestion: { kind: 'job-first', rowId, jobIndex: ji, text: `Use ${name(to)} first for “${row.label}”`, button: `Use ${name(to)} first` },
      };
    }
  }
  return { verdict: 'fine', agree, text: `Learned picks earned a little more (${learned} coins vs ${order}), but no single change to your order explains it. They matched your order in ${pct(agree)} of their choices.` };
}

/** Apply a suggestion to the responsibilities (one tap). Returns false if the list changed since. */
export function applySuggestion(plan: Responsibilities, s: OrderSuggestion): boolean {
  const i = plan.rows.findIndex((r) => r.id === s.rowId);
  if (i < 0) return false;
  if (s.kind === 'move') {
    const row = plan.rows.splice(i, 1)[0];
    const j = plan.rows.findIndex((r) => r.id === s.afterRowId);
    if (j < 0) { plan.rows.splice(i, 0, row); return false; }
    plan.rows.splice(j + 1, 0, row);
    return true;
  }
  const r = plan.rows[i];
  const also = (Array.isArray(r.args.also) ? r.args.also : []).filter(isNode) as SpecNode[];
  const k = s.jobIndex - 1;
  if (!isNode(r.args.do) || k < 0 || k >= also.length) return false;
  const first = also[k];
  also[k] = r.args.do;
  r.args.do = first;
  r.args.also = also;
  return true;
}
