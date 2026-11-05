/**
 * A player-built pen as a regression fixture (polish phase 2): “fill basket”, made and trained in the game by a
 * playtester (94,100 tries). It fills a basket with 5 berries, then lifts it, with notes as hand-made counters
 * and a home-made “am I getting closer?” check that penalises wandering. Its exported skill card must keep importing,
 * validating and scoring what it scored when it was trained: the clean-up phases may not change behaviour.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { importSkillCard } from '../src/game/skillcard';
import { buildReport } from '../src/learning/report';
import { validateStage } from '../src/domain/validate';
import type { StageSpec } from '../src/domain/types';

const card = gunzipSync(readFileSync(new URL('./fixtures/fill-basket-r6.skill.json.gz', import.meta.url))).toString('utf8');

describe('a player-built pen keeps working', () => {
  it('“fill basket” imports, validates, and its trained table scores as it did (95%, bigger pens 80%, random 0%)', () => {
    const g = newGame();
    const p = adoptPet(g, 'Biscuit', 'meadow');
    expect(importSkillCard(g, p, card).ok).toBe(true);
    const rev = activeRevision(getSkill(p, 'fill basket')!)!;
    const st = (rev as unknown as { stage: StageSpec }).stage;
    expect(st.rules.length).toBe(19);
    expect(validateStage(st).filter((d) => d.severity === 'error')).toEqual([]);
    // Notes that only decide treats are fine: one calm notice for all of them (polish phase 4), not one each.
    const notes = validateStage(st).filter((d) => d.code === 'note-not-sensed');
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toMatch(/“Result”, “TroubleCount”, “CloserCount”.*fine for notes that only decide treats/);
    const r = buildReport(st, p.traits, null, rev.policy, null);
    expect(r.after.successRate).toBe(rev.eval.successRate);
    expect(r.after.successRate).toBe(0.95);
    expect(r.transfer?.successRate).toBe(0.8);
    expect(r.random.successRate).toBe(0);
    expect(r.findings ?? []).toEqual([]); // it passes, so “why isn't it learning?” has nothing to say
  });
});
