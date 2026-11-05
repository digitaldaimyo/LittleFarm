import type { SpecNode, StageSpec } from './types';
import { cloneStage, newId } from './spec';
import { presetSenses } from '../learning/senses';
import { maker, pet, k, evalSeeds, coopArea } from './recipekit';
import { harvestRoutine, harvestStoreRoutine, basketRunRoutine, plantRoutine, openGate, shutGate, fetchAsRoutine, morningChores } from './jobrecipes';
export * from './jobrecipes';
export * from './recipekit';

/** Example player-style skill: walk to the target, then stay put for 5 steps. */
function waitForIt(): StageSpec {
  const n = maker('wf');
  const atT = () => n('cond.at', { actor: pet(n), what: n('ref.target') });
  return {
    id: 'stage-wait', name: 'Wait for it', recipeId: 'wait-for-it', version: 1,
    blurb: 'A custom skill: go to the target and sit still for 5 steps.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: k(n, 'target'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'rock'), count: 2, region: 'anywhere' }),
    ],
    abilities: ['move', 'stay'],
    rules: [
      n('rule', { label: 'Good sit', when: n('ev.stay', { actor: pet(n) }), if: [atT()], then: [n('eff.reward', { amount: 0.4 })] }),
      n('rule', { label: 'Not here', when: n('ev.stay', { actor: pet(n) }), if: [n('cond.not', { inner: atT() })], then: [n('eff.penalty', { amount: 0.2 })] }),
      n('rule', { label: 'Patient pet!', when: n('ev.tick'), if: [atT(), n('cond.stayedFor', { actor: pet(n), ticks: 5 })], then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.05 })] }),
    ],
    success: n('cond.and', { all: [atT(), n('cond.stayedFor', { actor: pet(n), ticks: 5 })] }),
    fail: null,
    seed: 505, maxTicks: 50,
    // Polish sweep: 2,500 tries dipped to 70% on one seed; 5,000: 80–95% on 6.
    learner: { skill: 'Wait for it', template: 'sense', focus: 'target', episodes: 5000,
      senses: [n('sense.nearest', { what: n('ref.target') }), n('sense.blocked'), n('sense.heading'), n('sense.still')] },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.7 },
  };
}

/** Example player-style skill: keep away from the pond until time runs out ("survive" lesson). */
function keepClear(): StageSpec {
  const n = maker('kc');
  return {
    id: 'stage-keep-clear', name: 'Keep clear', recipeId: 'keep-clear', version: 1,
    blurb: 'A custom skill: stay more than 2 steps from the pond until time is up.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: k(n, 'pond'), count: 6, region: 'center' }),
      n('place.random', { kind: k(n, 'rock'), count: 2, region: 'anywhere' }),
    ],
    abilities: ['move', 'stay'],
    rules: [
      n('rule', { label: 'Safe distance', when: n('ev.tick'), if: [n('cond.farFrom', { actor: pet(n), what: n('ref.target'), dist: 2 })], then: [n('eff.reward', { amount: 0.1 })] }),
      n('rule', { label: 'Too close', when: n('ev.tick'), if: [n('cond.near', { actor: pet(n), what: n('ref.target'), dist: 2 })], then: [n('eff.penalty', { amount: 0.1 })] }),
      n('rule', { label: 'Splash!', when: n('ev.enter', { actor: pet(n), what: k(n, 'pond') }), then: [n('eff.penalty', { amount: 5 }), n('eff.end', { outcome: 'fail' })] }),
    ],
    outcome: 'survive',
    success: n('cond.farFrom', { actor: pet(n), what: n('ref.target'), dist: 2 }),
    fail: n('cond.at', { actor: pet(n), what: k(n, 'pond') }),
    seed: 606, maxTicks: 30,
    // Polish sweep: 2,000 tries dipped to 75%; 4,000: 80–95% on 6 seeds.
    learner: { skill: 'Keep clear', template: 'sense', focus: 'pond', episodes: 4000,
      senses: [n('sense.nearest', { what: n('ref.target') }), n('sense.blocked'), n('sense.hazards')] },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.7 },
  };
}

/** Example player-style skill: fill up at the well, then water every dry patch. */
function waterGarden(): StageSpec {
  const n = maker('wg');
  return {
    id: 'stage-water', name: 'Water the garden', recipeId: 'water-garden', version: 1,
    blurb: 'A custom skill: fill up at the well, then water both patches.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: k(n, 'well'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'patch'), count: 2, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'rock'), count: 2, region: 'anywhere' }),
    ],
    abilities: ['move', 'water'],
    rules: [
      n('rule', { label: 'Splash!', when: n('ev.water', { actor: pet(n), what: n('ref.target') }), then: [n('eff.reward', { amount: 4 })], limit: n('lim.perObject') }),
      n('rule', { label: 'Filled up', when: n('ev.fill', { actor: pet(n) }), if: [n('cond.not', { inner: n('cond.watered', { what: n('ref.target'), count: 2 }) })], then: [n('eff.reward', { amount: 0.5 })], limit: n('lim.once') }),
      n('rule', { label: 'All watered', when: n('ev.tick'), if: [n('cond.watered', { what: n('ref.target'), count: 2 })], then: [n('eff.reward', { amount: 6 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.03 })] }),
    ],
    success: n('cond.watered', { what: n('ref.target'), count: 2 }),
    fail: null,
    seed: 707, maxTicks: 60,
    // Deliberately lean: walls are already masked as illegal moves, so a Walls sense would only slow learning here.
    // Polish sweep: 3× practice (≥80% on every seed); Heading or Walls only slowed it.
    learner: { skill: 'Water the garden', template: 'sense', focus: 'patch', episodes: 30000,
      senses: [n('sense.nearest', { what: k(n, 'well') }), n('sense.nearestDry', { what: n('ref.target') }), n('sense.water')] },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.7 },
  };
}

/**
 * Example player-style skill: a basket starts with stock; lift it, carry it to the house and put it down there (it
 * empties). Polish sweep: as one sense skill it looped (70–85% even at 4× practice), so it is a routine of three
 * legs — the “long chain” finding's own advice.
 */
function emptyBasket(): StageSpec {
  const n = maker('eb');
  const carrying = () => n('cond.carryingAny', { actor: pet(n) });
  const not = (inner: SpecNode) => n('cond.not', { inner });
  const atBin = () => n('cond.at', { actor: pet(n), what: k(n, 'bin') });
  const atHome = () => n('cond.at', { actor: pet(n), what: k(n, 'home') });
  return {
    id: 'stage-empty-basket', name: 'Empty the basket', recipeId: 'empty-basket', version: 2,
    blurb: 'A routine from cards: walk to a stocked basket, lift it, carry it to the house and put it down there to empty it.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.stocked', { kind: k(n, 'bin'), item: k(n, 'berry'), count: 3, vary: 'upTo', region: 'anywhere' }),
      n('place.random', { kind: k(n, 'home'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'rock'), count: 2, region: 'anywhere' }),
    ],
    abilities: ['move', 'drop', 'lift'],
    rules: [
      n('rule', { label: 'Lifted', when: n('ev.lift', { actor: pet(n), what: k(n, 'bin') }), then: [n('eff.reward', { amount: 1 })], limit: n('lim.once') }),
      n('rule', { label: 'Emptied at the house', when: n('ev.empty', { what: k(n, 'bin'), into: k(n, 'home') }), then: [n('eff.reward', { amount: 6 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.03 })] }),
    ],
    success: n('cond.storage', { level: 'empty' }),
    fail: null,
    seed: 909, maxTicks: 80,
    learner: {
      skill: 'Empty the basket', template: 'routine', focus: 'bin', destination: 'home', episodes: 800,
      routine: {
        options: [
          n('opt.skill', { skill: 'Approach', aim: k(n, 'bin'), when: not(carrying()) }),
          n('opt.action', { action: 'lift', when: atBin() }),
          n('opt.skill', { skill: 'Approach', aim: k(n, 'home'), when: carrying() }),
          n('opt.action', { action: 'drop', when: n('cond.and', { all: [carrying(), atHome()] }) }),
        ],
        watch: [carrying(), atBin(), atHome()],
      },
    },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.6 },
  };
}

/**
 * Example player-style skill with a note: visit the well, then the house, then the well again. The pet can't tell
 * its first well visit from its second by looking — a note (“leg”, counted by the rules) lets it.
 */
function patrol(withNote = true): StageSpec {
  const n = maker('pt');
  const leg = (test: string, value: number) => n('cond.note', { name: 'leg', test, value });
  const write = (value: number) => n('eff.note', { name: 'leg', op: 'set', value });
  return {
    id: 'stage-patrol', name: 'Patrol', recipeId: 'patrol', version: 1,
    blurb: 'A custom skill with a note: well, then house, then well again.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: k(n, 'well'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'home'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'rock'), count: 2, region: 'anywhere' }),
    ],
    abilities: ['move'],
    rules: [
      n('rule', { label: 'Well first', when: n('ev.reach', { actor: pet(n), what: k(n, 'well') }), if: [leg('eq', 0)], then: [write(1), n('eff.reward', { amount: 2 })], limit: n('lim.once') }),
      n('rule', { label: 'Then the house', when: n('ev.reach', { actor: pet(n), what: k(n, 'home') }), if: [leg('eq', 1)], then: [write(2), n('eff.reward', { amount: 2 })], limit: n('lim.once') }),
      n('rule', { label: 'Back to the well', when: n('ev.reach', { actor: pet(n), what: k(n, 'well') }), if: [leg('eq', 2)], then: [write(3), n('eff.reward', { amount: 4 }), n('eff.end', { outcome: 'judge' })] }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.03 })] }),
    ],
    success: leg('gte', 3),
    fail: null,
    seed: 4242, maxTicks: 80,
    // Polish sweep: Heading stops it pacing between two tiles; 3× practice lifts it to ≥80% on every seed.
    learner: { skill: 'Patrol', template: 'sense', focus: 'well', episodes: 30000,
      senses: [n('sense.nearest', { what: k(n, 'well') }), n('sense.nearest', { what: k(n, 'home') }), n('sense.heading'), ...(withNote ? [n('sense.note', { name: 'leg', cap: 2 })] : [])] },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.6 },
  };
}
/**
 * The same patrol without the Note sense (the Field Guide's experiment). The lesson keeps the setup from before the
 * polish sweep (no Heading, 10,000 tries): Heading lets a note-less pet half-guess its leg, which blurs the contrast.
 */
export function patrolWithoutNote(): StageSpec {
  const st = patrol(false);
  st.learner.episodes = 10000;
  st.learner.senses = st.learner.senses!.filter((x) => x.cardId !== 'sense.heading');
  return st;
}

/** Example player-style skill: shoo a chicken into a coop that sits somewhere new each try. */
function herdChicken(): StageSpec {
  const n = maker('hc');
  return {
    id: 'stage-herd', name: 'Herd a chicken', recipeId: 'herd-chicken', version: 1,
    blurb: 'A custom skill: get behind the chicken and shoo it into the coop.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('zone.rect', { name: 'coop', where: 'random', x: 0, y: 0, w: 2, h: 2 }),
      n('place.random', { kind: k(n, 'chicken'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'rock'), count: 1, region: 'anywhere' }),
    ],
    abilities: ['move', 'shoo'],
    rules: [
      n('rule', { label: 'Home to roost', when: n('ev.entersArea', { what: n('ref.target'), area: coopArea(n) }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.03 })] }),
    ],
    success: n('cond.allInArea', { what: n('ref.target'), area: coopArea(n) }),
    fail: null,
    seed: 808, maxTicks: 60,
    // Polish sweep: 8,000 tries dipped to 70%; 16,000: 80–95% on 6 seeds.
    learner: { skill: 'Herd', template: 'sense', focus: 'chicken', episodes: 16000,
      senses: [n('sense.outside', { what: n('ref.target'), area: coopArea(n) }), n('sense.areaFrom', { what: n('ref.target'), area: coopArea(n) })] },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.6 },
  };
}

/** Loophole experiment: herd the chicken, plus a treat for every shoo with no limit. */
function shooLoophole(): StageSpec {
  const s = herdChicken();
  const n = maker('sl');
  s.id = 'stage-shoo-loophole';
  s.name = 'Treat for every shoo';
  s.recipeId = 'shoo-loophole';
  s.blurb = 'An experiment: herd the chicken — and get a treat every time you shoo it.';
  s.rules = [
    n('rule', { label: 'Good shoo', when: n('ev.shoo', { actor: pet(n), what: n('ref.target') }), then: [n('eff.reward', { amount: 1 })], limit: n('lim.every') }),
    ...s.rules,
  ];
  s.learner = { ...s.learner, skill: 'Herd (loophole)' };
  s.seed = 909;
  return s;
}

export interface Recipe {
  id: string;
  name: string;
  blurb: string;
  skill: StageSpec['learner']['skill'];
  /** Unlock flag needed before the recipe appears. */
  unlock?: string;
  optional?: boolean;
  build: () => StageSpec;
}

function approach(): StageSpec {
  const n = maker('ap');
  return {
    id: 'stage-approach', name: 'Go to the berry', recipeId: 'go-to-berry', version: 1,
    blurb: 'Teach your pet to walk to a berry from anywhere in the pen.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: k(n, 'berry'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'rock'), count: 3, region: 'anywhere' }),
    ],
    abilities: ['move'],
    rules: [
      n('rule', { label: 'Treat at the berry', when: n('ev.reach', { actor: pet(n), what: k(n, 'berry') }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.05 })] }),
    ],
    success: n('cond.at', { actor: pet(n), what: k(n, 'berry') }),
    fail: null,
    seed: 101, maxTicks: 40,
    learner: { skill: 'Approach', template: 'sense', senses: presetSenses(), focus: 'berry', episodes: 1500 },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.8 },
  };
}

/**
 * The curriculum's Approach (polish roadmap, phase 1): practised among some obstacles, 3,000 tries. Every routine
 * walks with Approach, so its sturdiness decides theirs: with the classic pen (3 rocks, 1,500 tries) Harvest,
 * Harvest to storage and Plant fell to 65–75% on some seeds and walks looped on the farm; with this one they pass at
 * 85–100% on 6 seeds. The Field Guide's Approach experiments keep the classic pen (`classicApproachStage`).
 */
function sturdyApproach(): StageSpec {
  const s = approach();
  const n = maker('apx');
  s.environment = s.environment.filter((p) => !(p.cardId === 'place.random' && (p.args.kind as SpecNode).cardId === 'kind:rock'));
  s.environment.push(n('place.obstacles', { amount: 'some', kind: 'rocks' }));
  s.learner.episodes = 3000;
  return s;
}

/** The classic Approach pen (3 rocks, 1,500 tries): the base of the Field Guide's practice / scatter / where lessons. */
export function classicApproachStage(): StageSpec {
  return approach();
}

/** Tutorial pen: a pet and rocks, waiting for the player to add a berry and choose rules. */
function tutorialApproach(): StageSpec {
  const s = approach();
  s.environment = s.environment.filter((p) => !(p.cardId === 'place.random' && (p.args.kind as SpecNode).cardId === 'kind:berry'));
  s.rules = [];
  s.success = null; // the player decides what "done" means
  s.recipeId = 'tutorial';
  return s;
}

function avoid(): StageSpec {
  const n = maker('av');
  return {
    id: 'stage-avoid', name: 'Avoid the pond', recipeId: 'avoid-pond', version: 1,
    blurb: 'Reach the berry without splashing through the pond.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: k(n, 'berry'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'pond'), count: 5, region: 'center' }),
      n('place.random', { kind: k(n, 'rock'), count: 2, region: 'anywhere' }),
    ],
    abilities: ['move'],
    rules: [
      n('rule', { label: 'Treat at the berry', when: n('ev.reach', { actor: pet(n), what: k(n, 'berry') }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Splash!', when: n('ev.enter', { actor: pet(n), what: k(n, 'pond') }), then: [n('eff.penalty', { amount: 4 }), n('eff.end', { outcome: 'fail' })] }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.05 })] }),
    ],
    success: n('cond.at', { actor: pet(n), what: k(n, 'berry') }),
    fail: n('cond.at', { actor: pet(n), what: k(n, 'pond') }),
    seed: 202, maxTicks: 40,
    // Polish sweep: 3× practice (≥80% on every seed).
    learner: { skill: 'Avoid', template: 'sense', senses: presetSenses(), focus: 'berry', episodes: 24000 },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.8 },
  };
}

export function fetchRecipe(): StageSpec {
  const n = maker('fe');
  return {
    id: 'stage-fetch', name: 'Bring it home', recipeId: 'bring-it-home', version: 1,
    blurb: 'Pick up the berry and drop it in the basket. Reuses your Approach skill.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: k(n, 'berry'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'bin'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'rock'), count: 2, region: 'anywhere' }),
    ],
    abilities: ['move', 'pickup', 'drop'],
    rules: [
      n('rule', { label: 'Delivered!', when: n('ev.deliver', { what: k(n, 'berry'), into: k(n, 'bin') }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.02 })] }),
    ],
    success: n('cond.delivered', { what: k(n, 'berry'), into: k(n, 'bin'), count: 1 }),
    fail: null,
    seed: 303, maxTicks: 80,
    // Polish sweep: 400 tries left one seed at 0% (its greedy choice looped); 800: 85–95% on 6 seeds.
    learner: { skill: 'Fetch', template: 'fetch', focus: 'berry', destination: 'bin', navigator: 'Approach', episodes: 800 },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.65 },
  };
}

/** Deliberate exploit-discovery recipe: every pickup pays. */
function payPerPickup(): StageSpec {
  const s = fetchRecipe();
  const n = maker('pp');
  s.id = 'stage-pickup-pay';
  s.name = 'Treat for every pickup';
  s.recipeId = 'pay-per-pickup';
  s.blurb = 'An experiment: what if picking up the berry earns a treat every time?';
  s.rules = [
    n('rule', { label: 'Pickup treat', when: n('ev.pickup', { actor: pet(n), what: k(n, 'berry') }), then: [n('eff.reward', { amount: 3 })], limit: n('lim.every') }),
    ...s.rules,
  ];
  s.seed = 404;
  return s;
}

export const RECIPES: Recipe[] = [
  { id: 'go-to-berry', name: 'Go to the berry', blurb: 'Approach: walk to a target from anywhere — around obstacles.', skill: 'Approach', build: sturdyApproach },
  { id: 'bring-it-home', name: 'Bring it home', blurb: 'Fetch: carry a crop to the basket, reusing Approach.', skill: 'Fetch', unlock: 'fetch', build: fetchRecipe },
  { id: 'avoid-pond', name: 'Avoid the pond', blurb: 'Avoid: reach the goal while staying dry.', skill: 'Avoid', unlock: 'avoid', build: avoid },
  { id: 'wait-for-it', name: 'Wait for it', blurb: 'Your own skill: go to the target and stay put.', skill: 'Wait for it', unlock: 'custom', optional: true, build: waitForIt },
  { id: 'keep-clear', name: 'Keep clear', blurb: 'Your own skill: stay away from the pond until time is up.', skill: 'Keep clear', unlock: 'custom', optional: true, build: keepClear },
  { id: 'water-garden', name: 'Water the garden', blurb: 'Your own skill: fill up at the well, water the dry patches.', skill: 'Water the garden', unlock: 'custom', optional: true, build: waterGarden },
  { id: 'empty-basket', name: 'Empty the basket', blurb: 'Your own skill: carry a stocked basket to the house and empty it there (uses Lift).', skill: 'Empty the basket', unlock: 'custom', optional: true, build: emptyBasket },
  { id: 'patrol', name: 'Patrol', blurb: 'Your own skill with a note: well, house, well again (the note remembers which leg).', skill: 'Patrol', unlock: 'custom', optional: true, build: () => patrol() },
  { id: 'harvest', name: 'Harvest', blurb: 'A routine: walk to any ripe crop, pick it up, carry it to the house (uses your Approach).', skill: 'Harvest', unlock: 'custom', optional: true, build: harvestRoutine },
  { id: 'harvest-store', name: 'Harvest to storage', blurb: 'A routine: walk to any ripe crop, pick it up, put it in a basket or shed with room (uses your Approach).', skill: 'Harvest to storage', unlock: 'fetch', optional: true, build: harvestStoreRoutine },
  { id: 'basket-run', name: 'Basket run', blurb: 'A routine: lift a basket, empty it at the house, set it down beside the crops (uses your Approach).', skill: 'Basket run', unlock: 'fetch', optional: true, build: basketRunRoutine },
  { id: 'plant', name: 'Plant', blurb: 'A routine: walk to empty soil you can afford a seed for, plant it (uses your Approach).', skill: 'Plant', unlock: 'carrots', optional: true, build: plantRoutine },
  { id: 'herd-chicken', name: 'Herd a chicken', blurb: 'Your own skill: shoo a chicken into the coop.', skill: 'Herd', unlock: 'custom', optional: true, build: herdChicken },
  { id: 'shoo-loophole', name: 'Treat for every shoo', blurb: 'Experiment: a herding reward with a loophole.', skill: 'Herd (loophole)', unlock: 'custom', optional: true, build: shooLoophole },
  { id: 'open-gate', name: 'Open the gate', blurb: 'Your own skill: find a gate and nudge it open.', skill: 'Open the gate', unlock: 'custom', optional: true, build: openGate },
  { id: 'shut-gate', name: 'Shut the gate', blurb: 'Your own skill: find the open gate and nudge it shut from beside it.', skill: 'Shut the gate', unlock: 'custom', optional: true, build: shutGate },
  { id: 'fetch-routine', name: 'Bring it home (routine)', blurb: 'Fetch, rebuilt from cards as a routine.', skill: 'Fetch routine', unlock: 'routines', optional: true, build: fetchAsRoutine },
  { id: 'morning-chores', name: 'Morning chores', blurb: 'A routine: pick the right skills from your deck (needs Herd, Water the garden, Keep clear, Wait for it).', skill: 'Morning chores', unlock: 'routines', optional: true, build: morningChores },
  { id: 'pay-per-pickup', name: 'Treat for every pickup', blurb: 'Experiment: a reward with a loophole.', skill: 'Fetch', unlock: 'fetch', optional: true, build: payPerPickup },
];

export function buildTutorialStage(): StageSpec {
  return tutorialApproach();
}

/** A fresh, independent copy of a recipe (no shared node identity). */
export function instantiateRecipe(id: string): StageSpec {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown recipe ${id}`);
  return cloneStage(r.build(), true, `stage-${id}-${newId('s')}`);
}

export function recipeStage(id: string): StageSpec {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown recipe ${id}`);
  return r.build();
}

/** Suggested one-tap rule sets offered in the Rules binder. */
export function suggestedRules(stage: StageSpec): { label: string; rules: SpecNode[]; success: SpecNode }[] {
  if (stage.learner.skill === 'Wait for it' && stage.recipeId === 'guide') {
    const w = cloneStage(waitForIt(), true);
    return [{ label: 'Wait for it rules', rules: w.rules, success: w.success! }];
  }
  const n = maker(`sg${newId('')}`);
  const f = stage.learner.focus;
  const out: { label: string; rules: SpecNode[]; success: SpecNode }[] = [];
  if (stage.learner.skill !== 'Fetch') {
    out.push({
      label: `Treat for reaching the ${f}`,
      rules: [
        n('rule', { label: `Treat at the ${f}`, when: n('ev.reach', { actor: pet(n), what: k(n, f) }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
        n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.05 })] }),
      ],
      success: n('cond.at', { actor: pet(n), what: k(n, f) }),
    });
  } else {
    const d = stage.learner.destination ?? 'bin';
    out.push({
      label: `Treat for delivering the ${f}`,
      rules: [
        n('rule', { label: 'Delivered!', when: n('ev.deliver', { what: k(n, f), into: k(n, d) }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
        n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.02 })] }),
      ],
      success: n('cond.delivered', { what: k(n, f), into: k(n, d), count: 1 }),
    });
  }
  return out;
}
