import { describe, expect, it } from 'vitest';
import { recipeStage } from '../src/domain/recipes';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { HEAT_N, HEAT_R, curiosities } from '../src/learning/summary';
import { probeField, probePath } from '../src/learning/probe';
import { SensePolicy } from '../src/learning/policies';
import { senseDefFor } from '../src/learning/skilldef';
import { generateWorld } from '../src/sim/compile';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { exportSkillCard, importSkillCard } from '../src/game/skillcard';
import { createRuntime, farmTick } from '../src/game/farm';
import { parseGame, serializeGame } from '../src/persistence/save';
import { trainAndSave } from './helpers';
import type { StageSpec } from '../src/domain/types';

function trained(stage: StageSpec) {
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: DEFAULT_TRAITS });
  while (!t.done) t.runChunk(1000, false);
  return { q: t.policy(), report: buildReport(stage, DEFAULT_TRAITS, null, t.policy(), null) };
}

describe('M6: behaviour summaries', () => {
  it('summarise all held-out episodes: heatmap centred on the target, action mix, endings, reward shares', () => {
    const st = recipeStage('go-to-berry');
    const { report } = trained(st);
    const s = report.after.summary!;
    expect(s.episodes).toBe(report.after.episodes);
    expect(s.heat.length).toBe(HEAT_N * HEAT_N);
    expect(s.heat.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(s.endings.success).toBe(report.after.successes);
    expect(Object.values(s.actions).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // Time concentrates near the target: cells within 3 steps hold far more than their share of the grid.
    let near = 0;
    for (let y = 0; y < HEAT_N; y++) for (let x = 0; x < HEAT_N; x++) if (Math.abs(x - HEAT_R) + Math.abs(y - HEAT_R) <= 3) near += s.heat[y * HEAT_N + x];
    expect(near).toBeGreaterThan(0.4);
    expect(s.onTargetShare).toBeGreaterThan(0);
    expect(s.rewardShare[0].label).toBe('Treat at the berry');
  });

  it('curiosities: a loophole shows up as “most treats from one rule”, a waiting skill as standing still', () => {
    const ap = trained(recipeStage('go-to-berry')).q;
    const loop = recipeStage('pay-per-pickup');
    const t = new Trainer({ stage: loop, episodes: loop.learner.episodes, traits: DEFAULT_TRAITS, navigator: ap });
    while (!t.done) t.runChunk(1000, false);
    const r = buildReport(loop, DEFAULT_TRAITS, null, t.policy(), ap);
    expect(curiosities(loop, r.after.summary!, 'Pip').some((c) => /came from “Pickup treat”/.test(c))).toBe(true);
    const wait = recipeStage('wait-for-it');
    const s2 = trained(wait).report.after.summary!;
    expect(s2.stayShare).toBeGreaterThan(0.1);
    expect(curiosities(recipeStage('go-to-berry'), trained(recipeStage('go-to-berry')).report.after.summary!, 'Pip')).toEqual([]);
  });
});

describe('M6: “What does Pip do when…?” probe', () => {
  it('reads an arrow on every free tile and following the arrows reaches the target', () => {
    const st = recipeStage('go-to-berry');
    const { q } = trained(st);
    const pol = SensePolicy.from(q, senseDefFor(st))!;
    const w = generateWorld(st, 900008);
    const cells = probeField(pol, w, 'berry');
    const free = w.w * w.h - w.objects.filter((o) => o.kind === 'rock').length;
    expect(cells.length).toBe(free);
    expect(cells.every((c) => c.confidence > 0 && c.confidence <= 1)).toBe(true);
    const berry = w.objects.find((o) => o.kind === 'berry')!;
    const path = probePath(pol, w, 'berry', 30);
    expect(path.some((p) => p.x === berry.x && p.y === berry.y)).toBe(true);
    expect(cells.some((c) => c.guessed)).toBe(true); // some situations were never practised exactly
  });
});

describe('M6: skill cards', () => {
  it('export → import into another pet gives a skill that acts identically; names never clash', () => {
    const g = newGame();
    const a = adoptPet(g, 'Pip', 'meadow');
    const b = adoptPet(g, 'Mochi', 'plum');
    trainAndSave(g, a, recipeStage('wait-for-it'));
    const card = exportSkillCard(a, 'Wait for it')!;
    const text = JSON.stringify(card);
    const r = importSkillCard(g, b, text);
    expect(r.ok).toBe(true);
    const ra = activeRevision(getSkill(a, 'Wait for it'))!, rb = activeRevision(getSkill(b, 'Wait for it'))!;
    const pa = SensePolicy.from(ra.policy, ra.learner)!, pb = SensePolicy.from(rb.policy, rb.learner)!;
    const st = recipeStage('wait-for-it');
    for (let i = 0; i < 10; i++) { const w = generateWorld(st, 500 + i); expect(pb.act(w, 'target')).toBe(pa.act(w, 'target')); }
    const again = importSkillCard(g, b, text);
    expect(again.ok && again.name).toBe('Wait for it (2)');
    expect(parseGame(serializeGame(g)).ok).toBe(true);
  });

  it('rejects garbage, broken policies and unknown cards', () => {
    const g = newGame();
    const a = adoptPet(g, 'Pip', 'meadow');
    trainAndSave(g, a, recipeStage('wait-for-it'));
    const card = exportSkillCard(a, 'Wait for it')!;
    expect(importSkillCard(g, a, 'nope').ok).toBe(false);
    expect(importSkillCard(g, a, JSON.stringify({ ...card, format: 'x' })).ok).toBe(false);
    const bad = structuredClone(card);
    bad.revision.policy.rows['0'] = [1, 2, 'x'] as unknown as number[];
    expect(importSkillCard(g, a, JSON.stringify(bad)).ok).toBe(false);
    const huge = structuredClone(card);
    huge.revision.policy.nS = 10_000_000;
    expect(importSkillCard(g, a, JSON.stringify(huge)).ok).toBe(false);
    const unknown = structuredClone(card);
    unknown.revision.learner!.senses.push({ id: 'z', cardId: 'sense.telepathy', args: {} });
    const r = importSkillCard(g, a, JSON.stringify(unknown));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/telepathy/);
  });
});

describe('M6: two pets on duty', () => {
  function twoPetFarm(second: boolean) {
    const g = newGame();
    const a = adoptPet(g, 'Pip', 'meadow');
    const b = adoptPet(g, 'Mochi', 'plum');
    for (const p of [a, b]) { p.traits = { ...DEFAULT_TRAITS }; trainAndSave(g, p, recipeStage('go-to-berry')); p.assignment = { mode: 'job', job: 'forage', navigator: 'Approach' }; }
    // Farm life: Pip (on Auto) plants and harvests into the basket (knowing Fetch, it stores rather than walking
    // home), Mochi hauls the basket to the house. Two different jobs.
    for (const p of [a, b]) trainAndSave(g, p, recipeStage('bring-it-home'), activeRevision(getSkill(p, 'Approach'))!.policy);
    a.assignment = { mode: 'auto', job: 'forage', navigator: 'Approach' }; // harvests and replants
    b.assignment = { mode: 'job', job: 'deliver', navigator: 'Approach' };
    g.farm.dutyPetId = a.id;
    g.farm.duty2PetId = second ? b.id : null;
    g.resources.coins = 30;
    g.progress.unlocks.push('custom', 'bushes', 'fetch', 'carrots');
    return g;
  }

  it('never share a tile or a target, and earn more together (one harvests, one hauls)', () => {
    const one = twoPetFarm(false), two = twoPetFarm(true);
    const r1 = createRuntime(one.farm), r2 = createRuntime(two.farm);
    let sameTile = 0, sameClaim = 0;
    for (let t = 0; t < 1500; t++) {
      farmTick(one, r1);
      farmTick(two, r2);
      const w = two.farm.world;
      // Pets may share the house and storage tiles (one naps while the other sells); anywhere else, never.
      if (w.pet2 && w.pet.x === w.pet2.x && w.pet.y === w.pet2.y && !w.objects.some((o) => o.x === w.pet.x && o.y === w.pet.y && ['home', 'bin', 'shed'].includes(o.kind))) sameTile++;
      if (r2.claim !== null && r2.claim === r2.second?.claim) sameClaim++;
      expect(w.objects.some((o) => o.hidden || o.kind === 'buddy')).toBe(false);
    }
    expect(sameTile).toBe(0);
    expect(sameClaim).toBe(0);
    expect(two.resources.coins).toBeGreaterThan(one.resources.coins * 1.1); // crops (and replanting) cap the farm, so the gain is modest
    expect(two.resources.berries).toBeGreaterThan(one.resources.berries * 0.85); // Pip barely slowed down
    expect(two.resources.carrots).toBeGreaterThan(5);
  });

  it('is deterministic and survives save/load', () => {
    const run = () => { const g = twoPetFarm(true); const rt = createRuntime(g.farm); for (let t = 0; t < 400; t++) farmTick(g, rt); return g; };
    const a = run(), b = run();
    expect(JSON.stringify(a.farm.world)).toBe(JSON.stringify(b.farm.world));
    const r = parseGame(serializeGame(a));
    expect(r.ok).toBe(true);
    expect(r.game!.farm.world.pet2).toBeDefined();
  });
});
