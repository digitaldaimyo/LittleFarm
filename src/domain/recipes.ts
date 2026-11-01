import type { SpecNode, StageSpec } from './types';
import { cloneStage, idFactory, newId } from './spec';
import { presetSenses } from '../learning/senses';

/** Held-out evaluation seeds live in [900000, 999999]; training seeds are always < 800000. */
export const EVAL_SEED_BASE = 900000;
export const TRANSFER_SEED_BASE = 950000;
export function evalSeeds(n: number, base = EVAL_SEED_BASE): number[] {
  return Array.from({ length: n }, (_, i) => base + 1 + i * 7);
}

type Mk = (cardId: string, args?: SpecNode['args']) => SpecNode;
function maker(prefix: string): Mk {
  const id = idFactory(prefix);
  return (cardId, args = {}) => ({ id: id(), cardId, args });
}

const pet = (n: Mk) => n('actor.pet');
const k = (n: Mk, kind: string) => n(`kind:${kind}`);

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
      n('rule', { label: 'Patient pet!', when: n('ev.tick'), if: [atT(), n('cond.stayedFor', { actor: pet(n), ticks: 5 })], then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'success' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.05 })] }),
    ],
    success: n('cond.and', { all: [atT(), n('cond.stayedFor', { actor: pet(n), ticks: 5 })] }),
    fail: null,
    seed: 505, maxTicks: 50,
    learner: { skill: 'Wait for it', template: 'sense', focus: 'target', episodes: 2500,
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
    learner: { skill: 'Keep clear', template: 'sense', focus: 'pond', episodes: 2000,
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
      n('rule', { label: 'All watered', when: n('ev.tick'), if: [n('cond.watered', { what: n('ref.target'), count: 2 })], then: [n('eff.reward', { amount: 6 }), n('eff.end', { outcome: 'success' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.03 })] }),
    ],
    success: n('cond.watered', { what: n('ref.target'), count: 2 }),
    fail: null,
    seed: 707, maxTicks: 60,
    // Deliberately lean: walls are already masked as illegal moves, so a Walls sense would only slow learning here.
    learner: { skill: 'Water the garden', template: 'sense', focus: 'patch', episodes: 10000,
      senses: [n('sense.nearest', { what: k(n, 'well') }), n('sense.nearestDry', { what: n('ref.target') }), n('sense.water')] },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.7 },
  };
}

const coopArea = (n: Mk) => n('area.named', { name: 'coop' });

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
      n('rule', { label: 'Home to roost', when: n('ev.entersArea', { what: n('ref.target'), area: coopArea(n) }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'success' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.03 })] }),
    ],
    success: n('cond.allInArea', { what: n('ref.target'), area: coopArea(n) }),
    fail: null,
    seed: 808, maxTicks: 60,
    learner: { skill: 'Herd', template: 'sense', focus: 'chicken', episodes: 8000,
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

/** Fetch rebuilt as a routine from cards: same options, same four watched facts. */
function fetchAsRoutine(): StageSpec {
  const s = fetchRecipe();
  const n = maker('fr');
  s.id = 'stage-fetch-routine';
  s.name = 'Bring it home (routine)';
  s.recipeId = 'fetch-routine';
  s.blurb = 'Fetch, built from cards: Approach → berry, Approach → bin, pick up, put down.';
  const carrying = () => n('cond.carrying', { actor: pet(n), what: n('ref.target') });
  s.learner = {
    skill: 'Fetch routine', template: 'routine', focus: 'berry', destination: 'bin', episodes: 400,
    routine: {
      options: [
        n('opt.skill', { skill: 'Approach', aim: n('ref.target'), when: n('cond.not', { inner: carrying() }) }),
        n('opt.skill', { skill: 'Approach', aim: k(n, 'bin') }),
        n('opt.action', { action: 'pick' }),
        n('opt.action', { action: 'drop' }),
      ],
      watch: [
        carrying(),
        n('cond.at', { actor: pet(n), what: n('ref.target') }),
        n('cond.at', { actor: pet(n), what: k(n, 'bin') }),
        n('cond.and', { all: [n('cond.not', { inner: carrying() }), n('cond.compare', { quantity: n('q.count', { what: n('ref.target') }), op: '>=', value: 1 })] }),
      ],
    },
  };
  return s;
}

/** A routine built from two player-made skills: herd the chicken home, water the garden, and nap when done. */
function morningChores(): StageSpec {
  const n = maker('mc');
  const coop = () => n('area.named', { name: 'coop' });
  const herded = () => n('cond.allInArea', { what: k(n, 'chicken'), area: coop() });
  const watered = () => n('cond.watered', { what: k(n, 'patch'), count: 2 });
  return {
    id: 'stage-chores', name: 'Morning chores', recipeId: 'morning-chores', version: 1,
    blurb: 'A routine: get the chicken in and both patches watered — choosing the right skills from your deck.',
    size: { w: 9, h: 9 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('zone.rect', { name: 'coop', where: 'random', x: 0, y: 0, w: 2, h: 2 }),
      n('place.random', { kind: k(n, 'chicken'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'well'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'patch'), count: 2, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'pond'), count: 3, region: 'anywhere' }),
    ],
    abilities: ['move', 'shoo', 'water', 'stay'],
    rules: [
      n('rule', { label: 'Chicken home', when: n('ev.entersArea', { what: k(n, 'chicken'), area: coop() }), then: [n('eff.reward', { amount: 3 })], limit: n('lim.once') }),
      n('rule', { label: 'Garden watered', when: n('ev.water', { actor: pet(n), what: k(n, 'patch') }), if: [watered()], then: [n('eff.reward', { amount: 3 })], limit: n('lim.once') }),
      n('rule', { label: 'All done!', when: n('ev.tick'), if: [herded(), watered()], then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'success' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.02 })] }),
    ],
    success: n('cond.and', { all: [herded(), watered()] }),
    fail: null,
    seed: 1111, maxTicks: 110,
    learner: {
      skill: 'Morning chores', template: 'routine', focus: 'chicken', episodes: 600,
      routine: {
        // Your whole deck: two useful skills and two that don't help with these chores.
        options: [
          n('opt.skill', { skill: 'Keep clear', aim: k(n, 'pond') }),
          n('opt.skill', { skill: 'Wait for it', aim: k(n, 'well') }),
          n('opt.skill', { skill: 'Herd', aim: k(n, 'chicken') }),
          n('opt.skill', { skill: 'Water the garden', aim: k(n, 'patch') }),
        ],
        watch: [herded(), watered()],
      },
    },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.6 },
  };
}

/** Example player-style skill: walk to a (closed) gate and nudge it open. */
function openGate(): StageSpec {
  const n = maker('og');
  return {
    id: 'stage-gate', name: 'Open the gate', recipeId: 'open-gate', version: 1,
    blurb: 'A custom skill: find the gate and nudge it open from next to it.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: k(n, 'gate'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'rock'), count: 2, region: 'anywhere' }),
    ],
    abilities: ['move', 'nudge'],
    rules: [
      n('rule', { label: 'Gate open!', when: n('ev.gate', { actor: pet(n), state: 'open' }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'success' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.05 })] }),
    ],
    success: n('cond.gates', { state: 'open' }),
    fail: null,
    seed: 1212, maxTicks: 40,
    learner: { skill: 'Open the gate', template: 'sense', focus: 'gate', episodes: 3000,
      senses: [n('sense.nearest', { what: n('ref.target') }), n('sense.blocked')] },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.7 },
  };
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
      n('rule', { label: 'Treat at the berry', when: n('ev.reach', { actor: pet(n), what: k(n, 'berry') }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'success' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.05 })] }),
    ],
    success: n('cond.at', { actor: pet(n), what: k(n, 'berry') }),
    fail: null,
    seed: 101, maxTicks: 40,
    learner: { skill: 'Approach', template: 'sense', senses: presetSenses(), focus: 'berry', episodes: 1500 },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.8 },
  };
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
      n('rule', { label: 'Treat at the berry', when: n('ev.reach', { actor: pet(n), what: k(n, 'berry') }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'success' })], limit: n('lim.once') }),
      n('rule', { label: 'Splash!', when: n('ev.enter', { actor: pet(n), what: k(n, 'pond') }), then: [n('eff.penalty', { amount: 4 }), n('eff.end', { outcome: 'fail' })] }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.05 })] }),
    ],
    success: n('cond.at', { actor: pet(n), what: k(n, 'berry') }),
    fail: n('cond.at', { actor: pet(n), what: k(n, 'pond') }),
    seed: 202, maxTicks: 40,
    learner: { skill: 'Avoid', template: 'sense', senses: presetSenses(), focus: 'berry', episodes: 8000 },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.8 },
  };
}

function fetchRecipe(): StageSpec {
  const n = maker('fe');
  return {
    id: 'stage-fetch', name: 'Bring it home', recipeId: 'bring-it-home', version: 1,
    blurb: 'Pick up the berry and drop it in the bin. Reuses your Approach skill.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: k(n, 'berry'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'bin'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'rock'), count: 2, region: 'anywhere' }),
    ],
    abilities: ['move', 'pickup', 'drop'],
    rules: [
      n('rule', { label: 'Delivered!', when: n('ev.deliver', { what: k(n, 'berry'), into: k(n, 'bin') }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'success' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.02 })] }),
    ],
    success: n('cond.delivered', { what: k(n, 'berry'), into: k(n, 'bin'), count: 1 }),
    fail: null,
    seed: 303, maxTicks: 80,
    learner: { skill: 'Fetch', template: 'fetch', focus: 'berry', destination: 'bin', navigator: 'Approach', episodes: 400 },
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
  { id: 'go-to-berry', name: 'Go to the berry', blurb: 'Approach: walk to a target from anywhere.', skill: 'Approach', build: approach },
  { id: 'bring-it-home', name: 'Bring it home', blurb: 'Fetch: carry a crop to the bin, reusing Approach.', skill: 'Fetch', unlock: 'fetch', build: fetchRecipe },
  { id: 'avoid-pond', name: 'Avoid the pond', blurb: 'Avoid: reach the goal while staying dry.', skill: 'Avoid', unlock: 'avoid', build: avoid },
  { id: 'wait-for-it', name: 'Wait for it', blurb: 'Your own skill: go to the target and stay put.', skill: 'Wait for it', unlock: 'custom', optional: true, build: waitForIt },
  { id: 'keep-clear', name: 'Keep clear', blurb: 'Your own skill: stay away from the pond until time is up.', skill: 'Keep clear', unlock: 'custom', optional: true, build: keepClear },
  { id: 'water-garden', name: 'Water the garden', blurb: 'Your own skill: fill up at the well, water the dry patches.', skill: 'Water the garden', unlock: 'custom', optional: true, build: waterGarden },
  { id: 'herd-chicken', name: 'Herd a chicken', blurb: 'Your own skill: shoo a chicken into the coop.', skill: 'Herd', unlock: 'custom', optional: true, build: herdChicken },
  { id: 'shoo-loophole', name: 'Treat for every shoo', blurb: 'Experiment: a herding reward with a loophole.', skill: 'Herd (loophole)', unlock: 'custom', optional: true, build: shooLoophole },
  { id: 'open-gate', name: 'Open the gate', blurb: 'Your own skill: find a gate and nudge it open.', skill: 'Open the gate', unlock: 'custom', optional: true, build: openGate },
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
        n('rule', { label: `Treat at the ${f}`, when: n('ev.reach', { actor: pet(n), what: k(n, f) }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'success' })], limit: n('lim.once') }),
        n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.05 })] }),
      ],
      success: n('cond.at', { actor: pet(n), what: k(n, f) }),
    });
  } else {
    const d = stage.learner.destination ?? 'bin';
    out.push({
      label: `Treat for delivering the ${f}`,
      rules: [
        n('rule', { label: 'Delivered!', when: n('ev.deliver', { what: k(n, f), into: k(n, d) }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'success' })], limit: n('lim.once') }),
        n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.02 })] }),
      ],
      success: n('cond.delivered', { what: k(n, f), into: k(n, d), count: 1 }),
    });
  }
  return out;
}
