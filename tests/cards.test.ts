import { describe, expect, it } from 'vitest';
import { recipeStage, RECIPES } from '../src/domain/recipes';
import { node, walk } from '../src/domain/spec';
import type { SpecNode } from '../src/domain/types';
import { nominal } from '../src/domain/typecheck';
import { validateStage } from '../src/domain/validate';
import { describe as say } from '../src/domain/describe';
import { generateWorld } from '../src/sim/compile';
import { blankCandidates, placeTemplate, saveTemplate, templatesFor } from '../src/ui/edit';
import { exportLessonCard, importLessonCard } from '../src/game/lessoncard';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { applyPlan, createRuntime, farmTick } from '../src/game/farm';
import { compilePlan, starterPlan } from '../src/game/plan';
import { parseGame, serializeGame } from '../src/persistence/save';
import { fingerprint } from '../scripts/layout-fingerprint';
import { recipeStage as rs, trainAndSave, giveHarvest } from './helpers';

const kinds = (n: SpecNode) => { const out: string[] = []; walk(n, (x) => { if (x.cardId.startsWith('kind:')) out.push(x.cardId); }); return out; };

describe('your cards: names and blanks', () => {
  it('a saved rule with a blank asks for the thing each time it is placed, and keeps its name', () => {
    const s = newGame();
    const rule = recipeStage('go-to-berry').rules[0]; // "Treat at the berry": when Pip reaches Berry…
    const t = saveTemplate(s.templates, 'Treat for reaching', rule);
    const cands = blankCandidates(t);
    expect(cands.map((c) => c.title)).toEqual(['Berry']);
    t.exposed = [cands[0].id];
    const { node: placed, blank } = placeTemplate(t);
    expect(placed.extensions?.card).toBe('Treat for reaching');
    expect(placed.id).not.toBe(rule.id);
    expect(kinds(placed)).toEqual([]); // the berry was left blank
    expect(blank?.socket).toBe('what');
    const ev = placed.args.when as SpecNode;
    expect(blank?.parentId).toBe(ev.id);
    // Filling the blank makes it a normal rule again.
    ev.args.what = node('kind:carrot');
    expect(say(placed, { petName: 'Pip' })).not.toContain('…');
    // Without blanks it is a plain copy with fresh ids.
    t.exposed = [];
    const copy = placeTemplate(t).node;
    expect(kinds(copy)).toEqual(['kind:berry']);
    expect(placeTemplate(t).node.id).not.toBe(copy.id);
  });

  it('a named condition is offered wherever a condition fits — SUCCESS, farm plans, routine watches — and works there', () => {
    const s = newGame();
    const home = node('cond.allInArea', { what: node('kind:chicken'), area: node('area.named', { name: 'coop' }) });
    saveTemplate(s.templates, 'Chickens home', home);
    saveTemplate(s.templates, 'Big treat', node('eff.reward', { amount: 10 }));
    const conds = templatesFor(s.templates, nominal('Condition')).map((t) => t.name);
    expect(conds).toEqual(['Chickens home']);
    // Used in a plan row: compiles and reads the farm.
    const plan = starterPlan();
    plan.rows.unshift(node('plan.row', { label: 'All home: nap', if: [placeTemplate(s.templates[0]).node], do: node('job.nap') }));
    const rows = compilePlan(plan);
    const w = generateWorld(recipeStage('herd-chicken'), 3);
    const inCoop = w.objects.filter((o) => o.kind === 'chicken').every((c) => w.areas!.some((a) => c.x >= a.x && c.x < a.x + a.w && c.y >= a.y && c.y < a.y + a.h));
    expect(rows[0].holds(w)).toBe(inCoop);
    // Used as a routine's watched condition: the routine lesson validates.
    const routine = recipeStage('fetch-routine');
    routine.learner.routine!.watch = [...routine.learner.routine!.watch.slice(0, 3), placeTemplate(s.templates[0]).node];
    expect(validateStage(routine).filter((d) => d.severity === 'error' && d.code !== 'missing-reference')).toEqual([]);
  });

  it('saves keep your cards, their blanks and the names on placed copies', () => {
    const s = newGame();
    const t = saveTemplate(s.templates, 'Treat for reaching', recipeStage('go-to-berry').rules[0]);
    t.exposed = [blankCandidates(t)[0].id];
    const placed = placeTemplate(t).node;
    s.stages[0].rules.push(placed);
    const back = parseGame(serializeGame(s)).game!;
    expect(back.templates[0].exposed).toEqual(t.exposed);
    expect(back.stages[0].rules.at(-1)!.extensions?.card).toBe('Treat for reaching');
  });
});

describe('lesson cards', () => {
  it('round-trip every recipe: a new lesson with fresh ids, the same rules and exactly the same layouts', () => {
    for (const r of RECIPES) {
      const s = newGame();
      const st = recipeStage(r.id);
      const res = importLessonCard(s, JSON.stringify(exportLessonCard(st)));
      expect(res.ok, r.id).toBe(true);
      const got = s.stages.find((x) => x.id === (res as { id: string }).id)!;
      expect(got.id).not.toBe(st.id);
      expect(s.activeStageId).toBe(got.id);
      expect(got.rules.map((x) => x.id)).not.toEqual(st.rules.map((x) => x.id));
      expect(say(got.success, { petName: 'P', target: got.learner.focus })).toBe(say(st.success, { petName: 'P', target: st.learner.focus }));
      for (const seed of [1, 2, 3, 900001]) expect(fingerprint(generateWorld(got, seed))).toBe(fingerprint(generateWorld(st, seed)));
    }
  });

  it('renames on a clash, and a Field Guide pen becomes an ordinary lesson (not free)', () => {
    const s = newGame();
    const st = recipeStage('go-to-berry');
    st.extensions = { guide: true };
    importLessonCard(s, JSON.stringify(exportLessonCard(st)));
    const second = importLessonCard(s, JSON.stringify(exportLessonCard(st)));
    expect(second.ok && second.name).toBe(`${st.name} (2)`);
    expect(s.stages.filter((x) => x.name.startsWith(st.name)).every((x) => !(x.extensions as Record<string, unknown> | undefined)?.guide)).toBe(true);
  });

  it('rejects files that aren’t lesson cards, unknown cards and out-of-range lessons', () => {
    const s = newGame();
    const card = exportLessonCard(recipeStage('go-to-berry'));
    const bad = (mut: (c: any) => void) => { const c = structuredClone(card) as any; mut(c); const r = importLessonCard(s, JSON.stringify(c)); return r.ok ? '' : r.reason; };
    expect(importLessonCard(s, '{nope').ok).toBe(false);
    expect(bad((c) => { c.format = 'pen-deck-skill'; })).toMatch(/not a Pen Deck lesson card/);
    expect(bad((c) => { c.lesson.rules[0].cardId = 'ev.teleport'; })).toMatch(/ev\.teleport/);
    expect(bad((c) => { c.lesson.size = { w: 99, h: 8 }; })).toMatch(/pen size/);
    expect(bad((c) => { c.lesson.maxTicks = 1e9; })).toMatch(/out of range/);
    expect(importLessonCard(s, 'x'.repeat(300_000)).ok).toBe(false);
    expect(s.stages.length).toBe(newGame().stages.length); // nothing half-added
  });
});

describe('farm plans remember (since the current job started)', () => {
  it('“IF Has done… picks up a berry DO nap”: naps after a foraging job that picked one, then forages again', () => {
    const s = newGame();
    const p = adoptPet(s, 'Pip', 'meadow');
    p.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 }; // adoptPet's temperament is random
    trainAndSave(s, p, rs('go-to-berry'));
    giveHarvest(s, p);
    p.plan = starterPlan();
    const picked = node('cond.happened', { event: node('ev.pickup', { actor: node('actor.pet'), what: node('kind:berry') }), count: 1 });
    p.plan.rows = [
      node('plan.row', { label: 'Rest after a berry', if: [picked], do: node('job.nap') }),
      node('plan.row', { label: 'Forage', if: [], do: node('job.forage', { navigator: 'Approach' }) }),
    ];
    const rt = createRuntime(s.farm);
    applyPlan(s, rt, p.id);
    // Each job: what it was, and whether a berry was picked during it.
    const jobs: { id: string; picked: boolean }[] = [];
    let cur: unknown = null;
    for (let i = 0; i < 2000 && jobs.length < 12; i++) {
      const carrying0 = s.farm.world.pet.carrying;
      farmTick(s, rt);
      if (s.farm.current && s.farm.current !== cur) { cur = s.farm.current; jobs.push({ id: s.farm.current.behaviorId, picked: false }); }
      if (carrying0 === null && s.farm.world.pet.carrying !== null && jobs.length) jobs[jobs.length - 1].picked = true;
    }
    // A nap (from the memory row) always follows a job that picked a berry, and a harvest follows each nap.
    if (process.env.DBG) console.log('JOBS', JSON.stringify(jobs));
    const naps = jobs.map((j, i) => ({ j, i })).filter(({ j, i }) => j.id === 'rest' && i > 0);
    expect(naps.length).toBeGreaterThanOrEqual(2);
    for (const { i } of naps) {
      const before = jobs.slice(0, i).reverse().find((x) => x.id !== 'wander'); // skip "sniffing around" after a stuck job
      expect(before?.picked).toBe(true);
      if (jobs[i + 1]) expect(['forage', 'wander']).toContain(jobs[i + 1].id);
    }
    expect(s.farm.world.tally).toBeDefined();
  });

  it('plans without memory leave the farm without a tally (so the starter plan stays tick-for-tick identical)', () => {
    const s = newGame();
    const p = adoptPet(s, 'Pip', 'meadow');
    p.traits = { curiosity: 0.5, persistence: 0.5, caution: 0.5 }; // adoptPet's temperament is random
    trainAndSave(s, p, rs('go-to-berry'));
    giveHarvest(s, p);
    const rt = createRuntime(s.farm);
    applyPlan(s, rt, p.id);
    for (let i = 0; i < 300; i++) farmTick(s, rt);
    expect(s.farm.world.tally).toBeUndefined();
  });
});
