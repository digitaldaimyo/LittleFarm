/**
 * Playtest measures (Academy roadmap, phase 2; polish phase 7 folded in). Local and opt-in: nothing is recorded
 * unless the player turns it on in Settings, nothing leaves the device unless they export it, and an export holds
 * only challenge ids and numbers (no pet names, no free text).
 */
import type { GameState } from './types';
import { CHALLENGES } from './challenges';

export interface ChallengeMeasure {
  /** Times opened, and when first. */
  opened: number;
  firstOpenedAt: number;
  /** Training runs finished on it, and their held-out success. */
  runs: number;
  lastRate: number;
  bestRate: number;
  /** Report findings shown (“why isn't it learning?”), by id, and whether the run after one did better. */
  findings: Record<string, number>;
  improvedAfterFinding: number;
  notImprovedAfterFinding: number;
  pendingFinding?: boolean;
  /** Certify presses, and the first pass: after how long since first opened, and on which run. */
  certifyAttempts: number;
  passedAfterMs?: number;
  passedOnRun?: number;
}

export interface Measures { since: number; challenges: Record<string, ChallengeMeasure> }

const on = (s: GameState) => !!s.academy && s.settings.measures === true;
function entry(s: GameState, id: string): ChallengeMeasure | null {
  if (!on(s) || !CHALLENGES.some((c) => c.id === id)) return null;
  const m = (s.academy!.measures ??= { since: Date.now(), challenges: {} });
  return (m.challenges[id] ??= { opened: 0, firstOpenedAt: Date.now(), runs: 0, lastRate: 0, bestRate: 0, findings: {}, improvedAfterFinding: 0, notImprovedAfterFinding: 0, certifyAttempts: 0 });
}

export function measureOpen(s: GameState, challengeId: string): void {
  const e = entry(s, challengeId);
  if (e) e.opened++;
}

/** A finished training run on a challenge: its success, and the findings its report showed. */
export function measureRun(s: GameState, challengeId: string, rate: number, findingIds: string[], now = Date.now()): void {
  const e = entry(s, challengeId);
  if (!e) return;
  if (e.pendingFinding) { if (rate > e.lastRate) e.improvedAfterFinding++; else e.notImprovedAfterFinding++; }
  e.runs++;
  e.lastRate = rate;
  e.bestRate = Math.max(e.bestRate, rate);
  for (const f of findingIds) e.findings[f] = (e.findings[f] ?? 0) + 1;
  e.pendingFinding = findingIds.length > 0;
  void now;
}

export function measureCertify(s: GameState, challengeId: string, ok: boolean, now = Date.now()): void {
  const e = entry(s, challengeId);
  if (!e) return;
  e.certifyAttempts++;
  if (ok && e.passedAfterMs === undefined) { e.passedAfterMs = Math.max(0, now - e.firstOpenedAt); e.passedOnRun = e.runs; }
}

/** A plain summary, readable without the docs. */
export function measuresSummary(s: GameState): string[] {
  const m = s.academy?.measures;
  if (!m || !Object.keys(m.challenges).length) return ['Nothing recorded yet.'];
  const lines: string[] = [];
  const all = Object.entries(m.challenges);
  const passed = all.filter(([, e]) => e.passedAfterMs !== undefined);
  lines.push(`${all.length} challenge${all.length === 1 ? '' : 's'} opened, ${passed.length} passed, ${all.length - passed.length} not passed yet.`);
  for (const [id, e] of all) {
    const title = CHALLENGES.find((c) => c.id === id)?.title ?? id;
    const fs = Object.entries(e.findings);
    const after = e.improvedAfterFinding + e.notImprovedAfterFinding;
    lines.push(`${title}: opened ${e.opened}×, ${e.runs} training run${e.runs === 1 ? '' : 's'} (best ${Math.round(e.bestRate * 100)}%), certify pressed ${e.certifyAttempts}×` +
      (e.passedAfterMs !== undefined ? `, passed on run ${e.passedOnRun} after ${Math.max(1, Math.round(e.passedAfterMs / 60000))} min` : ', not passed yet') +
      (fs.length ? `. Findings shown: ${fs.map(([f, n]) => `${f.replace(/-/g, ' ')} (${n})`).join(', ')}${after ? `; the next run did better ${e.improvedAfterFinding} of ${after} times` : ''}` : '') + '.');
  }
  return lines;
}

/** The export: challenge ids and numbers only. */
export function exportMeasures(s: GameState): string {
  const m = s.academy?.measures ?? { since: 0, challenges: {} };
  const challenges = Object.fromEntries(Object.entries(m.challenges).map(([id, e]) => [id, {
    opened: e.opened, runs: e.runs, lastRate: e.lastRate, bestRate: e.bestRate, findings: { ...e.findings },
    improvedAfterFinding: e.improvedAfterFinding, notImprovedAfterFinding: e.notImprovedAfterFinding,
    certifyAttempts: e.certifyAttempts, ...(e.passedAfterMs !== undefined ? { passedAfterMs: e.passedAfterMs, passedOnRun: e.passedOnRun } : {}),
  }]));
  return JSON.stringify({ format: 'pen-deck-measures', version: 1, exportedAt: Date.now(), challenges }, null, 1);
}
