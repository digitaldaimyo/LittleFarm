/**
 * Recipes for the farm's jobs and routines (split from recipes.ts, polish phase 3): Fetch as a routine, Harvest,
 * Harvest to storage, Basket run, Plant, Morning chores, and the gates.
 */
import type { SpecNode, StageSpec } from './types';
import { maker, pet, k, evalSeeds } from './recipekit';
import { fetchRecipe } from './recipes';

/** Fetch rebuilt as a routine from cards: same options, same four watched facts. */
export function fetchAsRoutine(): StageSpec {
  const s = fetchRecipe();
  const n = maker('fr');
  s.id = 'stage-fetch-routine';
  s.name = 'Bring it home (routine)';
  s.recipeId = 'fetch-routine';
  s.blurb = 'Fetch, built from cards: Approach → berry, Approach → basket, pick up, put down.';
  const carrying = () => n('cond.carrying', { actor: pet(n), what: n('ref.target') });
  s.learner = {
    // Polish sweep: 400 tries left one seed at 0%; 800: 85–95% on 6 seeds.
    skill: 'Fetch routine', template: 'routine', focus: 'berry', destination: 'bin', episodes: 800,
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

/**
 * Harvest as a learned routine (learned-farm roadmap): walk to any ripe crop, pick it up, carry it to the house, put
 * it down — built from cards over the pet's own Approach. Trained in a farm-like pen, it runs on the farm unchanged.
 */
export function harvestRoutine(): StageSpec {
  const n = maker('hv');
  const carrying = () => n('cond.carryingAny', { actor: pet(n) });
  return {
    id: 'stage-harvest', name: 'Harvest', recipeId: 'harvest', version: 1,
    blurb: 'A routine from cards: Approach → any ripe crop, pick up, Approach → the house, put down. Coins come from the house.',
    size: { w: 10, h: 10 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: n('kind:@crop'), count: 2, region: 'anywhere', vary: 'more1' }),
      n('place.random', { kind: k(n, 'home'), count: 1, region: 'anywhere' }),
      n('place.obstacles', { amount: 'few', kind: 'rocks' }),
    ],
    abilities: ['move', 'pickup', 'drop'],
    rules: [
      n('rule', { label: 'Sold at the house', when: n('ev.deliver', { what: n('ref.target'), into: k(n, 'home') }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.02 })] }),
    ],
    success: n('cond.delivered', { what: n('ref.target'), into: k(n, 'home'), count: 1 }),
    fail: null,
    seed: 515, maxTicks: 120,
    learner: {
      skill: 'Harvest', template: 'routine', focus: '@crop', destination: 'home', episodes: 600,
      routine: {
        options: [
          n('opt.skill', { skill: 'Approach', aim: n('ref.target'), when: n('cond.not', { inner: carrying() }) }),
          n('opt.skill', { skill: 'Approach', aim: k(n, 'home'), when: carrying() }),
          n('opt.action', { action: 'pick' }),
          // Put it down only at the house: anywhere else it's just picked up again.
          n('opt.action', { action: 'drop', when: n('cond.at', { actor: pet(n), what: k(n, 'home') }) }),
        ],
        watch: [
          carrying(),
          n('cond.at', { actor: pet(n), what: n('ref.target') }),
          n('cond.at', { actor: pet(n), what: k(n, 'home') }),
        ],
      },
    },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.7 },
  };
}

/**
 * Harvest into storage (learned-farm phase 3b): like Harvest, but the crop goes into a basket or shed with room
 * instead of the house — a hauler (Fetch) or a Basket run takes it on from there.
 */
export function harvestStoreRoutine(): StageSpec {
  const n = maker('hs');
  const carrying = () => n('cond.carryingAny', { actor: pet(n) });
  return {
    id: 'stage-harvest-store', name: 'Harvest to storage', recipeId: 'harvest-store', version: 1,
    blurb: 'A routine from cards: Approach → any ripe crop, pick up, Approach → storage with room, put down.',
    size: { w: 10, h: 10 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: n('kind:@crop'), count: 2, region: 'anywhere', vary: 'more1' }),
      n('place.random', { kind: n('kind:@storage'), count: 1, region: 'anywhere' }),
      n('place.obstacles', { amount: 'few', kind: 'rocks' }),
    ],
    abilities: ['move', 'pickup', 'drop'],
    rules: [
      n('rule', { label: 'Stored', when: n('ev.deliver', { what: n('ref.target'), into: n('kind:@storage') }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.02 })] }),
    ],
    success: n('cond.delivered', { what: n('ref.target'), into: n('kind:@storage'), count: 1 }),
    fail: null,
    seed: 525, maxTicks: 120,
    learner: {
      skill: 'Harvest to storage', template: 'routine', focus: '@crop', destination: '@storage', episodes: 600,
      routine: {
        options: [
          n('opt.skill', { skill: 'Approach', aim: n('ref.target'), when: n('cond.not', { inner: carrying() }) }),
          n('opt.skill', { skill: 'Approach', aim: n('kind:@storage'), when: carrying() }),
          n('opt.action', { action: 'pick', when: n('cond.at', { actor: pet(n), what: n('ref.target') }) }),
          n('opt.action', { action: 'drop', when: n('cond.at', { actor: pet(n), what: n('kind:@storage') }) }),
        ],
        watch: [
          carrying(),
          n('cond.at', { actor: pet(n), what: n('ref.target') }),
          n('cond.at', { actor: pet(n), what: n('kind:@storage') }),
        ],
      },
    },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.7 },
  };
}

/**
 * Basket run as a learned routine (learned-farm phase 3b): lift a basket, empty it at the house if anything is in
 * it, carry it back to the crops and set it down beside one (step aside off the crop, put down).
 */
export function basketRunRoutine(): StageSpec {
  const n = maker('br');
  const carrying = () => n('cond.carryingAny', { actor: pet(n) });
  const stocked = () => n('cond.storage', { level: 'basket' });
  const not = (inner: SpecNode) => n('cond.not', { inner });
  const byCrops = () => n('cond.kindNear', { what: k(n, 'bin'), near: n('kind:@crop'), dist: 1 });
  const done = () => n('cond.and', { all: [not(carrying()), not(stocked()), byCrops()] });
  const atHome = () => n('cond.at', { actor: pet(n), what: k(n, 'home') });
  const atCrop = () => n('cond.at', { actor: pet(n), what: n('kind:@crop') });
  const nextToCrop = () => n('cond.nextTo', { actor: pet(n), what: n('kind:@crop') });
  return {
    id: 'stage-basket-run', name: 'Basket run', recipeId: 'basket-run', version: 1,
    blurb: 'A routine from cards: lift the basket, empty it at the house, set it down again beside the crops.',
    size: { w: 10, h: 10 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.stocked', { kind: k(n, 'bin'), item: k(n, 'berry'), count: 3, vary: 'upTo', region: 'anywhere' }),
      n('place.random', { kind: k(n, 'home'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: n('kind:@crop'), count: 2, region: 'anywhere' }),
      n('place.obstacles', { amount: 'few', kind: 'rocks' }),
    ],
    abilities: ['move', 'drop', 'lift'],
    rules: [
      n('rule', { label: 'Emptied at the house', when: n('ev.empty', { what: k(n, 'bin'), into: k(n, 'home') }), then: [n('eff.reward', { amount: 4 })], limit: n('lim.once') }),
      n('rule', { label: 'Set down by the crops', when: n('ev.tick'), if: [done()], then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.02 })] }),
    ],
    success: done(),
    fail: null,
    seed: 535, maxTicks: 160,
    learner: {
      skill: 'Basket run', template: 'routine', focus: 'bin', destination: 'home', episodes: 1200,
      routine: {
        options: [
          n('opt.skill', { skill: 'Approach', aim: k(n, 'bin'), when: not(carrying()) }),
          n('opt.action', { action: 'lift' }),
          n('opt.skill', { skill: 'Approach', aim: k(n, 'home'), when: carrying() }),
          n('opt.skill', { skill: 'Approach', aim: n('kind:@crop'), when: carrying() }),
          n('opt.action', { action: 'aside', when: n('cond.and', { all: [carrying(), atCrop()] }) }),
          // Put down only where it helps: at the house to empty it, or beside a crop once it's empty.
          n('opt.action', { action: 'drop', when: n('cond.any', { any: [n('cond.and', { all: [stocked(), atHome()] }), n('cond.and', { all: [not(stocked()), nextToCrop(), not(atCrop())] })] }) }),
        ],
        watch: [carrying(), stocked(), atHome(), nextToCrop()],
      },
    },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.6 },
  };
}

/**
 * Planting as a learned routine (learned-farm phase 3c): walk to empty soil whose seed the farm can afford, plant it.
 */
export function plantRoutine(): StageSpec {
  const n = maker('pl');
  const afford = () => n('cond.canAfford');
  const onSoil = () => n('cond.at', { actor: pet(n), what: k(n, 'soil') });
  return {
    id: 'stage-plant', name: 'Plant', recipeId: 'plant', version: 1,
    blurb: 'A routine from cards: Approach → empty soil (when there’s money for its seed), plant it.',
    size: { w: 10, h: 10 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: k(n, 'soil'), count: 2, region: 'anywhere', vary: 'more1' }),
      n('place.purse', { coins: 6 }),
      n('place.obstacles', { amount: 'few', kind: 'rocks' }),
    ],
    abilities: ['move', 'plant'],
    rules: [
      n('rule', { label: 'Planted', when: n('ev.plant', { actor: pet(n), what: k(n, 'carrot') }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.02 })] }),
    ],
    success: n('cond.happened', { event: n('ev.plant', { actor: pet(n), what: k(n, 'carrot') }) }),
    fail: null,
    seed: 545, maxTicks: 60,
    learner: {
      skill: 'Plant', template: 'routine', focus: 'soil', episodes: 800,
      routine: {
        options: [
          n('opt.skill', { skill: 'Approach', aim: k(n, 'soil'), when: afford() }),
          n('opt.action', { action: 'plant', when: onSoil() }),
        ],
        watch: [onSoil(), afford()],
      },
    },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.7 },
  };
}

/** A routine built from two player-made skills: herd the chicken home, water the garden, and nap when done. */
export function morningChores(): StageSpec {
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
      n('rule', { label: 'All done!', when: n('ev.tick'), if: [herded(), watered()], then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
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
export function openGate(): StageSpec {
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
      n('rule', { label: 'Gate open!', when: n('ev.gate', { actor: pet(n), state: 'open' }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.05 })] }),
    ],
    success: n('cond.gates', { state: 'open' }),
    fail: null,
    seed: 1212, maxTicks: 40,
    // Heading (as Approach has) keeps it from looping around rocks: 2 senses at 3,000 tries scored 55–95% across seeds;
    // with heading at 6,000, 95–100% on 8 seeds.
    learner: { skill: 'Open the gate', template: 'sense', focus: 'gate', episodes: 6000,
      senses: [n('sense.nearest', { what: n('ref.target') }), n('sense.blocked'), n('sense.heading')] },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.7 },
  };
}

/** Example player-style skill: walk to an open gate and nudge it shut from beside it (the farm's gate at nightfall). */
export function shutGate(): StageSpec {
  const n = maker('sg');
  return {
    id: 'stage-shut-gate', name: 'Shut the gate', recipeId: 'shut-gate', version: 1,
    blurb: 'A custom skill: find the open gate and nudge it shut — from beside it, not standing in it.',
    size: { w: 8, h: 8 },
    environment: [
      n('place.pet', { mode: 'random', x: 0, y: 0 }),
      n('place.random', { kind: k(n, 'gate'), count: 1, region: 'anywhere' }),
      n('place.random', { kind: k(n, 'rock'), count: 2, region: 'anywhere' }),
      n('place.gates', { state: 'open' }),
    ],
    abilities: ['move', 'nudge'],
    rules: [
      n('rule', { label: 'Gate shut!', when: n('ev.gate', { actor: pet(n), state: 'closed' }), then: [n('eff.reward', { amount: 10 }), n('eff.end', { outcome: 'judge' })], limit: n('lim.once') }),
      n('rule', { label: 'Hurry up', when: n('ev.tick'), then: [n('eff.penalty', { amount: 0.05 })] }),
    ],
    success: n('cond.gates', { state: 'closed' }),
    fail: null,
    seed: 1313, maxTicks: 40,
    // With heading (as Approach has): 90–100% on 8 seeds; without it, 65–95%.
    learner: { skill: 'Shut the gate', template: 'sense', focus: 'gate', episodes: 6000,
      senses: [n('sense.nearest', { what: n('ref.target') }), n('sense.blocked'), n('sense.heading')] },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.7 },
  };
}
