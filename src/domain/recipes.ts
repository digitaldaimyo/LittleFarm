import type { SpecNode, StageSpec } from './types';
import { cloneStage, idFactory, newId } from './spec';

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
    learner: { skill: 'Approach', focus: 'berry', episodes: 1500 },
    evaluation: { episodes: 20, seedSet: evalSeeds(20), minimumSuccessRate: 0.8 },
  };
}

/** Tutorial pen: a pet and rocks, waiting for the player to add a berry and choose rules. */
function tutorialApproach(): StageSpec {
  const s = approach();
  s.environment = s.environment.filter((p) => !(p.cardId === 'place.random' && (p.args.kind as SpecNode).cardId === 'kind:berry'));
  s.rules = [];
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
    learner: { skill: 'Avoid', focus: 'berry', episodes: 6000 },
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
    learner: { skill: 'Fetch', focus: 'berry', destination: 'bin', navigator: 'Approach', episodes: 400 },
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
