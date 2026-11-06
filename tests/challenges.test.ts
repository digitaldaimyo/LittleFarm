/**
 * Academy roadmap, phase 1 gate: the challenge engine. The same lesson and pet always give the same certification
 * result; every shipped challenge's reference solution clears its bar with margin at three temperaments; a flagged
 * loophole is never certified. Plus locks, allowed cards, badges, acorns and the exam's rank.
 */
import { describe, expect, it } from 'vitest';
import { newAcademyGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { BADGE_ACORNS, CHALLENGES, EXAM_ACORNS, ROSETTE_ACORNS, cardAllowed, certify, challengeBase, challengeById, challengeStatus, enforceChallengeLocks, openChallenge } from '../src/game/challenges';
import { petRank } from '../src/game/academy';
import { Trainer } from '../src/learning/trainer';
import { buildReport, type TrainingReport } from '../src/learning/report';
import { validateStage } from '../src/domain/validate';
import { buildHand } from '../src/domain/hand';
import { REGISTRY } from '../src/domain/registry';
import { nominal } from '../src/domain/typecheck';
import { node } from '../src/domain/spec';
import { recipeStage } from './helpers';
import type { StageSpec } from '../src/domain/types';
import type { Traits } from '../src/learning/episodes';

const TEMPERAMENTS: Traits[] = [0.35, 0.5, 0.65].map((t) => ({ curiosity: t, persistence: t, caution: t }));
function run(st: StageSpec, traits: Traits) {
  const t = new Trainer({ stage: st, episodes: st.learner.episodes, traits });
  while (!t.done) t.runChunk(2000, false);
  return { report: buildReport(st, traits, null, t.policy(), null), policy: t.policy(), episodes: t.episode };
}
function academy(traits: Traits = TEMPERAMENTS[1]) {
  const g = newAcademyGame();
  const p = adoptPet(g, 'Pip', 'meadow');
  p.traits = traits;
  return { g, p };
}
const reference = (id: string) => { const ch = challengeById(id)!; return ch.reference(challengeBase(ch)); };

describe('the challenge engine (Academy phase 1)', () => {
  it('reproducible: the same lesson and pet give the same result, run after run', () => {
    const st = reference('fs-berry');
    const a = run(st, TEMPERAMENTS[1]), b = run(structuredClone(st), TEMPERAMENTS[1]);
    expect(b.report.after.successRate).toBe(a.report.after.successRate);
    expect(b.report.transfer.successRate).toBe(a.report.transfer.successRate);
    expect(JSON.stringify(b.policy)).toBe(JSON.stringify(a.policy));
    const x = academy(), y = academy();
    const cx = certify(x.g, x.p.id, { stage: st, report: a.report, episodes: a.episodes });
    const cy = certify(y.g, y.p.id, { stage: st, report: b.report, episodes: b.episodes });
    expect(cy).toEqual(cx);
  });

  for (const ch of CHALLENGES) {
    it(`“${ch.title}”: the reference solution clears the bar (${ch.bar * 100}%) by 10 points at three temperaments, and certifies`, () => {
      for (const traits of TEMPERAMENTS) {
        const st = ch.reference(challengeBase(ch));
        expect(validateStage(st).filter((d) => d.severity === 'error'), ch.id).toEqual([]);
        const { report, episodes } = run(st, traits);
        expect(report.after.successRate, `${ch.id} at ${traits.curiosity}`).toBeGreaterThanOrEqual(ch.bar + 0.1 - 1e-9);
        const { g, p } = academy(traits);
        for (const c of CHALLENGES.filter((c) => c.course === ch.course && !c.exam && c !== ch)) g.academy!.pets[p.id] = { certificates: { ...(g.academy!.pets[p.id]?.certificates ?? {}), [c.id]: { challengeId: c.id, at: 0, badges: [] } }, exams: [] };
        const res = certify(g, p.id, { stage: st, report, episodes });
        expect(res.ok, res.reason).toBe(true);
      }
    }, 60000);
  }

  it('a flagged loophole is never certified, however well the run scores', () => {
    const st = reference('fs-berry');
    const good = run(st, TEMPERAMENTS[1]).report;
    // A real loophole report: the “Treat for every pickup” experiment.
    const loop = recipeStage('pay-per-pickup');
    const loopReport = run(loop, TEMPERAMENTS[1]).report;
    expect(loopReport.exploits.length).toBeGreaterThan(0);
    const { g, p } = academy();
    const res = certify(g, p.id, { stage: st, report: { ...good, exploits: loopReport.exploits } as TrainingReport, episodes: 1500 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Loophole/);
    expect(g.academy!.acorns).toBe(0);
    expect(g.academy!.pets[p.id]?.certificates['fs-berry']).toBeUndefined();
  }, 60000);

  it('locks: the pen, SUCCESS / FAIL and seeds snap back after any change; a changed lesson is refused', () => {
    const { g } = academy();
    const st = openChallenge(g, 'fs-berry')!;
    expect(openChallenge(g, 'fs-berry')).toBe(st); // reopening keeps the player's work
    expect(g.activeStageId).toBe(st.id);
    const env = JSON.stringify(st.environment);
    st.environment = [];
    st.success = null;
    st.size = { w: 20, h: 20 };
    st.seed = 1;
    st.evaluation.minimumSuccessRate = 0;
    st.rules.push(node('rule', { label: 'mine', when: node('ev.tick'), then: [node('eff.penalty', { amount: 0.01 })] })); // editable
    enforceChallengeLocks(g);
    expect(JSON.stringify(st.environment)).toBe(env);
    expect(st.success).not.toBeNull();
    expect(st.size).toEqual(challengeBase(challengeById('fs-berry')!).size);
    expect(st.evaluation.minimumSuccessRate).toBe(0.8);
    expect(st.rules.map((r) => r.args.label)).toEqual(['mine']);
    const tampered = reference('fs-berry');
    tampered.environment = tampered.environment.slice(0, 1);
    const { g: g2, p } = academy();
    expect(certify(g2, p.id, { stage: tampered, report: run(reference('fs-berry'), TEMPERAMENTS[1]).report, episodes: 1500 }).reason).toMatch(/was changed/);
  });

  it('only allowed cards: the hand leaves the others out, and certification refuses them', () => {
    const ch = challengeById('fs-berry')!;
    const st = challengeBase(ch);
    const effects = buildHand(REGISTRY, { socket: nominal('Effect'), stage: st, unlocks: new Set(['custom']), recent: [], favorites: [], itBound: false, placing: false, allowed: (id) => cardAllowed(ch, id) });
    const ids = [...effects.recommended, ...Object.values(effects.bySheet).flat()].map((h) => h.card.id);
    expect(ids).toContain('eff.reward');
    expect(ids).not.toContain('eff.note');
    expect(cardAllowed(ch, 'kind:berry') && cardAllowed(ch, 'ref.target') && cardAllowed(ch, 'actor.pet')).toBe(true);
    const sneaky = reference('fs-berry');
    sneaky.rules.push(node('rule', { label: 'note', when: node('ev.tick'), then: [node('eff.note', { name: 'x', op: 'on' })] }));
    const { g, p } = academy();
    expect(certify(g, p.id, { stage: sneaky, report: run(reference('fs-berry'), TEMPERAMENTS[1]).report, episodes: 1500 }).reason).toMatch(/doesn’t allow the card eff\.note/);
  });

  it('rewards: a rosette and acorns once, more only for new badges; the exam opens after the course and earns a rank', () => {
    const { g, p } = academy();
    const pass = (id: string, opts: { episodes?: number; resumed?: boolean } = {}) => {
      const st = reference(id);
      const { report, episodes } = run(st, p.traits);
      return certify(g, p.id, { stage: st, report, episodes: opts.episodes ?? episodes, resumed: opts.resumed });
    };
    expect(challengeStatus(g, p.id, challengeById('fs-exam')!)).toBe('locked');
    expect(certify(g, p.id, { stage: reference('fs-exam'), report: run(reference('fs-exam'), p.traits).report, episodes: 3000 }).reason).toMatch(/other challenges/);
    const first = pass('fs-berry', { resumed: true }); // a refined run: no quick-study badge
    expect(first.ok).toBe(true);
    expect(first.badges.map((b) => b.id)).not.toContain('quick');
    expect(first.acorns).toBe(ROSETTE_ACORNS + BADGE_ACORNS * first.badges.length);
    expect(pass('fs-berry', { resumed: true }).acorns).toBe(0); // same badges again: nothing new
    const quick = pass('fs-berry', { episodes: 900 }); // a fresh run within the quick-study limit
    expect(quick.newBadges.map((b) => b.id)).toEqual(['quick']);
    expect(quick.acorns).toBe(BADGE_ACORNS);
    expect(g.academy!.pets[p.id].certificates['fs-berry'].badges).toEqual(expect.arrayContaining(['quick', ...first.badges.map((b) => b.id)]));
    const rest = CHALLENGES.filter((c) => c.course === 'first-steps' && !c.exam && c.id !== 'fs-berry');
    for (const [i, c] of rest.entries()) {
      expect(challengeStatus(g, p.id, challengeById('fs-exam')!)).toBe('locked');
      expect(pass(c.id).ok, c.id).toBe(true);
      void i;
    }
    expect(challengeStatus(g, p.id, challengeById('fs-exam')!)).toBe('open');
    expect(petRank(g, p)).toBe('Novice');
    const before = g.academy!.acorns;
    const exam = pass('fs-exam');
    expect(exam.ok).toBe(true);
    expect(exam.rank).toBe('Apprentice');
    expect(petRank(g, p)).toBe('Apprentice');
    expect(g.academy!.acorns - before).toBe(ROSETTE_ACORNS + EXAM_ACORNS + BADGE_ACORNS * exam.badges.length);
    // Certificates are per pet: a second pet starts from scratch.
    const q = adoptPet(g, 'Mochi', 'plum');
    expect(petRank(g, q)).toBe('Novice');
    expect(challengeStatus(g, q.id, challengeById('fs-berry')!)).toBe('open');
  }, 60000);
});

describe('courses open in order; the Lab offers their cards; recipes are rewards (Academy phase 2)', () => {
  it('every card belongs to a course; a new game’s Lab has First Steps’ cards; passing an exam opens the next course', async () => {
    const { courseOfCard, courseOpen, labCardAllowed, recipeLock, COURSE1_CARDS } = await import('../src/game/challenges');
    const { COURSES } = await import('../src/game/academy');
    const { RECIPES } = await import('../src/domain/recipes');
    for (const id of COURSE1_CARDS) expect(REGISTRY.cards.has(id), id).toBe(true);
    for (const c of REGISTRY.cards.values()) expect(COURSES.map((x) => x.id)).toContain(courseOfCard(c.id));
    const { g, p } = academy();
    expect(courseOpen(g, 'first-steps')).toBe(true);
    expect(courseOpen(g, 'fetch-carry')).toBe(false);
    for (const id of ['ev.reach', 'eff.reward', 'eff.end', 'cond.at', 'sense.nearest', 'kind:berry', 'place.random']) expect(labCardAllowed(g, id), id).toBe(true);
    for (const id of ['ev.pickup', 'eff.note', 'cond.compare', 'opt.skill']) expect(labCardAllowed(g, id), id).toBe(false);
    expect(challengeStatus(g, p.id, challengeById('fs-berry')!)).toBe('open');
    // Recipes: the course must be open, and an answer only after its challenge is passed.
    expect(recipeLock(g, 'wait-for-it')).toMatch(/Sit and stay/);
    expect(recipeLock(g, 'bring-it-home')).toMatch(/Fetch and Carry/);
    expect(RECIPES.every((r) => recipeLock(g, r.id) !== undefined)).toBe(true);
    g.academy!.pets[p.id] = { certificates: { 'fs-stay': { challengeId: 'fs-stay', at: 0, badges: [] } }, exams: [] };
    expect(recipeLock(g, 'wait-for-it')).toBeNull();
    g.academy!.pets[p.id].exams.push('first-steps');
    expect(courseOpen(g, 'fetch-carry')).toBe(true);
    expect(labCardAllowed(g, 'ev.pickup')).toBe(true);
    expect(labCardAllowed(g, 'eff.note')).toBe(false); // Thinking Ahead is the next course after that
    expect(recipeLock(g, 'bring-it-home')).toBeNull();
    // Every exam passed: every card.
    g.academy!.pets[p.id].exams.push('fetch-carry', 'thinking-ahead', 'working-together');
    expect([...REGISTRY.cards.keys()].every((id) => labCardAllowed(g, id))).toBe(true);
  });
});
