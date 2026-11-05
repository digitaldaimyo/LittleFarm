import { describe, expect, it } from 'vitest';
import { node } from '../src/domain/spec';
import { compileCondition, compileStage, writeNotes } from '../src/sim/compile';
import { cloneWorld, emptyWorld } from '../src/sim/world';
import { compileEncoder, radixOf, stateSpaceSize } from '../src/learning/senses';
import { validateStage } from '../src/domain/validate';
import { patrolWithoutNote } from '../src/domain/recipes';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { createRuntime, farmTick } from '../src/game/farm';
import { CHAPTERS, advanceTutorial, currentStep, guide, startChapter } from '../src/game/tutorial';
import { createNode } from '../src/ui/edit';
import type { StageSpec } from '../src/domain/types';
import { recipeStage, trainAndSave } from './helpers';

const codes = (st: StageSpec) => validateStage(st).map((d) => d.code);
/** The Field Guide's Patrol after its step “Let it read the note”: the lesson's pen plus the Note sense. */
function lessonWithNote() {
  const st = patrolWithoutNote();
  st.learner.senses!.push(node('sense.note', { name: 'leg', cap: 2 }));
  return st;
}

function train(st: StageSpec) {
  const t = new Trainer({ stage: st, episodes: st.learner.episodes, traits: { ...DEFAULT_TRAITS } });
  while (!t.done) t.runChunk(1000, false);
  return buildReport(st, DEFAULT_TRAITS, null, t.policy(), null);
}

describe('notes: written by rules, read by conditions and the Note sense', () => {
  it('turn on/off, count up/down and set, clamped to 0–9', () => {
    const w = emptyWorld(3, 3);
    writeNotes(w, [{ name: 'trips', op: 'add', value: 2 }, { name: 'seen', op: 'on', value: 1 }]);
    expect(w.notes).toEqual({ trips: 2, seen: 1 });
    writeNotes(w, [{ name: 'trips', op: 'add', value: 20 }, { name: 'seen', op: 'off', value: 1 }]);
    expect(w.notes).toEqual({ trips: 9, seen: 0 });
    writeNotes(w, [{ name: 'trips', op: 'sub', value: 4 }]);
    expect(w.notes!.trips).toBe(5);
    writeNotes(w, [{ name: 'trips', op: 'set', value: 1 }]);
    expect(w.notes!.trips).toBe(1);
    expect(cloneWorld(w).notes).toEqual(w.notes);
    expect(cloneWorld(w).notes).not.toBe(w.notes);
    const is = (test: string, value = 1) => compileCondition(node('cond.note', { name: 'trips', test, value }))({ w } as never);
    expect([is('on'), is('off'), is('gte', 2), is('eq', 1), is('lt', 1)]).toEqual([true, false, false, true, false]);
  });

  it('the Note sense reads the note, capped; its size is cap + 1', () => {
    const sense = node('sense.note', { name: 'leg', cap: 2 });
    expect(radixOf(sense)).toBe(3);
    expect(radixOf(node('sense.note', { name: 'x' }))).toBe(2); // a flag
    const enc = compileEncoder([sense], 'well');
    const w = emptyWorld(3, 3);
    expect(enc.encode(w)).toEqual([0]);
    w.notes = { leg: 1 };
    expect(enc.encode(w)).toEqual([1]);
    w.notes = { leg: 7 };
    expect(enc.encode(w)).toEqual([2]);
    expect(stateSpaceSize(lessonWithNote().learner.senses!)).toBe(stateSpaceSize(patrolWithoutNote().learner.senses!) * 3);
  });

  it('a rule writes notes when it fires; notes start empty every try', () => {
    const st = recipeStage('patrol');
    const cs = compileStage(st);
    const w = cs.generate(3);
    expect(w.notes).toBeUndefined();
    const well = w.objects.find((o) => o.kind === 'well')!;
    w.pet.x = well.x; w.pet.y = well.y;
    cs.evalStep(w, { x: 0, y: 0 }, [{ type: 'reach', kind: 'well', x: well.x, y: well.y, objId: well.id }], cs.newRuleState());
    expect(w.notes).toEqual({ leg: 1 });
    expect(cs.generate(3).notes).toBeUndefined();
  });

  it('validation: a note nobody writes (with a suggestion), one nobody reads, and at most 4 notes', () => {
    const st = recipeStage('patrol');
    expect(codes(st)).not.toContain('note-never-written');
    st.learner.senses!.push(node('sense.note', { name: 'lge' }));
    const d = validateStage(st).find((x) => x.code === 'note-never-written')!;
    expect(d.message).toMatch(/Did you mean “leg”/);
    const w = patrolWithoutNote();
    expect(codes(w)).toContain('note-not-sensed'); // the rules use it, but the pet can't read it — the lesson's point
    expect(codes(recipeStage('patrol'))).not.toContain('note-not-sensed');
    for (const nm of ['a', 'b', 'c', 'd']) w.rules.push(node('rule', { label: nm, when: node('ev.tick'), then: [node('eff.note', { name: nm, op: 'on' })] }));
    expect(codes(w)).toContain('too-many-notes');
  });

  it('a new Note card starts with the name the lesson already uses', () => {
    expect(createNode('sense.note', patrolWithoutNote()).args.name).toBe('leg');
    expect(createNode('sense.note').args.name).toBe('note');
  });
});

describe('Patrol: the note makes the job learnable', () => {
  it('learns with the Note sense (≥ 60%) and not without it (≤ 35%), same pen, rules and practice', () => {
    const withNote = train(lessonWithNote());
    const without = train(patrolWithoutNote());
    expect(withNote.after.successRate).toBeGreaterThanOrEqual(0.6); // measured 70–80% on 5 seeds
    expect(without.after.successRate).toBeLessThanOrEqual(0.35); // measured 10–20%
    expect(withNote.random.successRate).toBeLessThan(0.1);
  }, 60000);

  it('on the farm the skill keeps writing its notes — in its own notebook, not the farm’s', () => {
    const s = newGame();
    const p = adoptPet(s, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    trainAndSave(s, p, recipeStage('patrol'));
    p.assignment = { mode: 'job', job: 'skill', navigator: 'Approach', skillName: 'Patrol', target: 'well' };
    s.farm.dutyPetId = p.id;
    const rt = createRuntime(s.farm);
    let maxLeg = 0;
    for (let t = 0; t < 400; t++) {
      farmTick(s, rt);
      const notes = (rt.exec as unknown as { notes?: Record<string, number> } | null)?.notes;
      maxLeg = Math.max(maxLeg, notes?.leg ?? 0);
      expect(s.farm.world.notes).toBeUndefined();
      expect(s.farm.world.verdict).toBeUndefined();
    }
    expect(maxLeg).toBeGreaterThanOrEqual(1);
  }, 30000);
});

describe('Field Guide lesson 11: Give your pet a notebook', () => {
  it('opens after “Invent a skill” and walks through train → read → add the sense → retrain → compare → save', () => {
    const s = newGame();
    adoptPet(s, 'Pip', 'meadow');
    const ch = CHAPTERS.find((c) => c.id === 'notes')!;
    expect(ch.offered(s)).toBe(false);
    guide(s).status.invent = 'done';
    expect(ch.offered(s)).toBe(true);
    startChapter(s, 'notes');
    expect(currentStep(s)!.id).toBe('look');
    const st = s.stages.find((x) => x.id === 'stage-guide-notes')!;
    expect(st.learner.senses!.some((n) => n.cardId === 'sense.note')).toBe(false);
    (s.progress.guideRuns ??= {})['stage-guide-notes'] = [{ episodes: 1, after: 0.2, random: 0, transfer: 0, pinned: false, at: 1, variant: 'no-note' }];
    advanceTutorial(s);
    expect(currentStep(s)!.id).toBe('read');
    s.progress.flags['guide:notes:read'] = true;
    advanceTutorial(s);
    st.learner.senses!.push(node('sense.note', { name: 'leg', cap: 1 }));
    advanceTutorial(s);
    expect(currentStep(s)!.id).toBe('sense'); // "Counts up to" must be 2
    st.learner.senses!.at(-1)!.args.cap = 2;
    advanceTutorial(s);
    expect(currentStep(s)!.id).toBe('retrain');
  });
});
