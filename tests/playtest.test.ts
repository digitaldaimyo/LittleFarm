/**
 * Academy roadmap, phase 2 (polish phase 7 folded in): playtest measures are local and opt-in — off by default,
 * nothing recorded while off, a summary readable without the docs, and an export with no pet names or free text.
 */
import { describe, expect, it } from 'vitest';
import { newAcademyGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { exportMeasures, measureCertify, measureOpen, measureRun, measuresSummary } from '../src/game/measures';
import { CHALLENGES } from '../src/game/challenges';
import { parseAcademySave, serializeGame } from '../src/persistence/save';

describe('playtest measures (Academy phase 2)', () => {
  it('off by default: nothing is recorded', () => {
    const g = newAcademyGame();
    expect(g.settings.measures).toBeFalsy();
    measureOpen(g, 'fs-berry');
    measureRun(g, 'fs-berry', 0.5, ['loops']);
    measureCertify(g, 'fs-berry', true);
    expect(g.academy!.measures).toBeUndefined();
    expect(parseAcademySave(serializeGame(g)).game!.settings.measures).toBeFalsy();
  });

  it('on: opens, runs, findings and whether the next run improved, certify attempts and time to pass', () => {
    const g = newAcademyGame();
    adoptPet(g, 'Biscuit', 'meadow');
    g.settings.measures = true;
    measureOpen(g, 'fs-stay');
    const t0 = g.academy!.measures!.challenges['fs-stay'].firstOpenedAt;
    measureRun(g, 'fs-stay', 0.2, ['cant-tell']); // a finding was shown…
    measureRun(g, 'fs-stay', 0.6, []); // …and the next run did better
    measureCertify(g, 'fs-stay', false);
    measureRun(g, 'fs-stay', 0.9, []);
    measureCertify(g, 'fs-stay', true, t0 + 5 * 60000);
    measureOpen(g, 'fs-clear');
    measureOpen(g, 'not-a-challenge');
    const e = g.academy!.measures!.challenges['fs-stay'];
    expect(e).toMatchObject({ opened: 1, runs: 3, bestRate: 0.9, lastRate: 0.9, certifyAttempts: 2, passedOnRun: 3, passedAfterMs: 5 * 60000, improvedAfterFinding: 1, notImprovedAfterFinding: 0, findings: { 'cant-tell': 1 } });
    expect(g.academy!.measures!.challenges['not-a-challenge']).toBeUndefined();
    const summary = measuresSummary(g);
    expect(summary[0]).toBe('2 challenges opened, 1 passed, 1 not passed yet.');
    expect(summary.join('\n')).toContain('Sit and stay: opened 1×, 3 training runs (best 90%), certify pressed 2×, passed on run 3 after 5 min. Findings shown: cant tell (1); the next run did better 1 of 1 times.');
    // The export: challenge ids and numbers only — no pet names, no free text.
    const out = JSON.parse(exportMeasures(g));
    expect(out.format).toBe('pen-deck-measures');
    expect(JSON.stringify(out)).not.toContain('Biscuit');
    for (const [id, c] of Object.entries(out.challenges as Record<string, Record<string, unknown>>)) {
      expect(CHALLENGES.map((x) => x.id)).toContain(id);
      for (const [k, v] of Object.entries(c)) {
        if (k === 'findings') { for (const n of Object.values(v as Record<string, unknown>)) expect(typeof n).toBe('number'); }
        else expect(typeof v, k).toBe('number');
      }
    }
    // Turned off again: recording stops (what's recorded stays until cleared).
    g.settings.measures = false;
    measureOpen(g, 'fs-stay');
    expect(g.academy!.measures!.challenges['fs-stay'].opened).toBe(1);
  });
});
