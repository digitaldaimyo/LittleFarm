/**
 * Qualifiers as aims and inside events (the follow-up to the pen & cards roadmap).
 */
import { describe, expect, it } from 'vitest';
import { node } from '../src/domain/spec';
import { validateStage } from '../src/domain/validate';
import { addObject, selectorText, step } from '../src/sim/world';
import { compileStage, resolveKind } from '../src/sim/compile';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { createRuntime, farmTick } from '../src/game/farm';
import { compilePlan } from '../src/game/plan';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { recipeStage, trainAndSave, giveFarmJobs } from './helpers';
import type { FarmPlan } from '../src/game/types';

const furthestFromHome = () => node('obj.furthest', { what: node('kind:berry'), from: node('kind:home') });

describe('qualifiers inside events', () => {
  it('“picks up the furthest berry from the house” pays for that berry — judged as it was before the step', () => {
    const st = recipeStage('go-to-berry');
    st.rules = [node('rule', { label: 'Far pick', when: node('ev.pickup', { actor: node('actor.pet'), what: furthestFromHome() }), then: [node('eff.reward', { amount: 5 })], limit: node('lim.once') })];
    expect(validateStage(st).filter((d) => d.code === 'qualifier-in-event')).toEqual([]);
    const cs = compileStage(st);
    const run = (petAt: number) => {
      const w = cs.generate(1);
      w.objects = []; w.w = 6; w.h = 1;
      addObject(w, 'home', 0, 0); addObject(w, 'berry', 1, 0); addObject(w, 'berry', 5, 0);
      w.pet.x = petAt; w.pet.y = 0;
      const rs = cs.newRuleState();
      const prev = { ...w.pet };
      return cs.evalStep(w, prev, step(w, 'pick'), rs).reward;
    };
    expect(run(5)).toBe(5); // the far berry: pays (afterwards, "the furthest" is the other berry — it still counts)
    expect(run(1)).toBe(0); // the near one: no treat
  });

  it('a delivery still can’t take a qualifier in “Into” (it only knows the kind of container)', () => {
    const st = recipeStage('go-to-berry');
    st.rules = [node('rule', { label: 'x', when: node('ev.deliver', { what: node('kind:berry'), into: node('obj.nearest', { what: node('kind:bin') }) }), then: [node('eff.reward', { amount: 1 })] })];
    expect(validateStage(st).some((d) => d.code === 'qualifier-in-event')).toBe(true);
  });
});

describe('qualifiers as aims on the farm', () => {
  function farm() {
    const g = newGame();
    const p = adoptPet(g, 'Pip', 'meadow');
    p.traits = { ...DEFAULT_TRAITS };
    trainAndSave(g, p, recipeStage('go-to-berry'));
    giveFarmJobs(g, p);
    g.farm.dutyPetId = p.id;
    return { g, p };
  }

  it('they read as words in the trace and on jobs', () => {
    expect(selectorText(resolveKind(furthestFromHome()))).toBe('the furthest berry from home');
    const plan: FarmPlan = { chooser: 'first', guard: true, rows: [node('plan.row', { label: 'Far berries', if: [], do: node('job.forage', { aim: furthestFromHome() }) })] };
    expect(compilePlan(plan)[0].job.label).toBe('Harvest → the furthest berry from home');
  });

  it('Harvest aimed at “the furthest berry from the house” picks that one first', () => {
    const { g, p } = farm();
    const w = g.farm.world;
    for (const o of w.objects.filter((x) => x.kind === 'berry')) o.delivered = true;
    w.objects = w.objects.filter((o) => !o.delivered);
    const home = w.objects.find((o) => o.kind === 'home')!;
    const bushes = w.objects.filter((o) => o.kind === 'bush').sort((a, b) => (Math.abs(b.x - home.x) + Math.abs(b.y - home.y)) - (Math.abs(a.x - home.x) + Math.abs(a.y - home.y)));
    const far = addObject(w, 'berry', bushes[0].x, bushes[0].y);
    addObject(w, 'berry', bushes.at(-1)!.x, bushes.at(-1)!.y); // a nearer one
    p.plan = { chooser: 'first', guard: true, rows: [node('plan.row', { label: 'Far berries', if: [], do: node('job.forage', { aim: furthestFromHome() }) }), node('plan.row', { label: 'Otherwise nap', if: [], do: node('job.nap') })] };
    const rt = createRuntime(g.farm);
    let first: number | null = null;
    for (let t = 0; t < 300 && first === null; t++) { farmTick(g, rt); if (w.pet.carrying !== null) first = w.pet.carrying; }
    expect(first).toBe(far.id);
  }, 60000);

  it('Run a skill (Approach) aimed at a qualifier walks to that one', () => {
    const { g, p } = farm();
    const w = g.farm.world;
    p.plan = { chooser: 'first', guard: true, rows: [node('plan.row', { label: 'To the far berry', if: [], do: node('job.goto', { aim: furthestFromHome() }) }), node('plan.row', { label: 'Otherwise nap', if: [], do: node('job.nap') })] };
    const rt = createRuntime(g.farm);
    rt.stats = {};
    for (let t = 0; t < 200 && !(rt.stats.goto?.ok); t++) farmTick(g, rt);
    expect(rt.stats.goto?.ok ?? 0).toBeGreaterThan(0);
    void w;
  }, 60000);
});
