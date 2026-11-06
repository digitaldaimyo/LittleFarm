/**
 * The challenge engine (Academy roadmap, phase 1). A challenge fixes its pen and SUCCESS / FAIL (and the seeds it
 * trains and is tested on); the player teaches everything else — rules, senses, abilities, practice. Certification
 * is reproducible (fixed seeds: the same lesson with the same pet gives the same result), refuses a flagged loophole,
 * and earns a rosette, merit badges for mastery stars, and acorns. Each challenge ships with a reference solution
 * that tests prove clears its bar with margin at three temperaments.
 */
import type { SpecNode, StageSpec } from '../domain/types';
import { node } from '../domain/spec';
import { classicApproachStage, recipeStage } from '../domain/recipes';
import { presetSenses } from '../learning/senses';
import type { TrainingReport } from '../learning/report';
import type { GameState } from './types';
import { COURSES, petRank, petRecord, petRecordOf, type Rank } from './academy';
import { petById } from './pets';

/** A mastery star: a merit badge on the rosette, from something the report and the lesson already measure. */
export interface Star {
  id: 'transfer' | 'lean' | 'quick' | 'tidy';
  label: string;
  /** For lean: most senses; quick: most practice tries; tidy: most rules. */
  limit?: number;
}

export interface ChallengeSpec {
  id: string;
  course: string;
  title: string;
  /** Professor Hazel's brief: what to teach, in a sentence or two. */
  brief: string;
  /** The course's exam (passing it earns the course's rank). */
  exam?: boolean;
  /** The lesson as the player first sees it: its pen, SUCCESS / FAIL and seeds are locked. */
  base: () => StageSpec;
  /** Certification: held-out success on the challenge's fixed test layouts. */
  bar: number;
  stars: Star[];
  /** Cards the player may use (things, "the target", "it" and the pet are always allowed). */
  cards: string[];
  /** The reference solution: the base with a working set of rules and learner. */
  reference: (base: StageSpec) => StageSpec;
}

export const ROSETTE_ACORNS = 5;
export const BADGE_ACORNS = 2;
export const EXAM_ACORNS = 10;

export const COURSE1_CARDS = [
  'rule', 'ev.reach', 'ev.enter', 'ev.tick', 'ev.stay', 'ev.bump',
  'eff.reward', 'eff.penalty', 'eff.end', 'lim.once', 'lim.every', 'lim.perObject', 'lim.cooldown',
  'cond.at', 'cond.near', 'cond.farFrom', 'cond.nextTo', 'cond.not', 'cond.and', 'cond.any', 'cond.stayedFor', 'cond.time',
  'sense.nearest', 'sense.distance', 'sense.blocked', 'sense.hazards', 'sense.heading', 'sense.still', 'sense.here',
];

/** A challenge's starting lesson: the recipe's pen and SUCCESS / FAIL, no rules, and a plain learner to build on. */
function blank(st: StageSpec, id: string, title: string, senses: SpecNode[], abilities: StageSpec['abilities'], skill: string, episodes?: number): StageSpec {
  st.id = `challenge-${id}`;
  st.name = title;
  st.recipeId = 'challenge';
  st.extensions = { ...(st.extensions ?? {}), challenge: id };
  st.rules = [];
  st.abilities = abilities;
  st.learner = { ...st.learner, skill, senses, episodes: episodes ?? Math.min(st.learner.episodes, 1500) };
  return st;
}
/** The reference keeps the challenge's id and name but takes a recipe's rules and learner. */
function withRecipe(base: StageSpec, recipe: StageSpec): StageSpec {
  const r = structuredClone(base);
  r.rules = structuredClone(recipe.rules);
  r.abilities = [...recipe.abilities];
  r.learner = { ...structuredClone(recipe.learner), skill: base.learner.skill };
  return r;
}
const nearestTarget = () => node('sense.nearest', { what: node('ref.target') });

export const CHALLENGES: ChallengeSpec[] = [
  {
    id: 'fs-berry', course: 'first-steps', title: 'To the berry',
    brief: 'Teach your pet to walk to the berry, wherever it is. Decide what earns a treat: SUCCESS only checks.',
    base: () => blank(classicApproachStage(), 'fs-berry', 'To the berry', [node('sense.nearest', { what: node('kind:berry') })], ['move'], 'Approach'),
    bar: 0.7,
    stars: [{ id: 'transfer', label: 'Works in bigger pens' }, { id: 'quick', label: 'Quick study', limit: 1000 }, { id: 'tidy', label: 'Tidy: 2 rules or fewer', limit: 2 }],
    cards: COURSE1_CARDS,
    reference: (base) => withRecipe(base, classicApproachStage()),
  },
  {
    id: 'fs-practice', course: 'first-steps', title: 'Enough practice',
    brief: 'A bigger pen with more rocks. Your pet starts with 300 tries of practice: is that enough? If the report looks broken, try more practice before you change anything else.',
    base: () => {
      const st = blank(classicApproachStage(), 'fs-practice', 'Enough practice', presetSenses(), ['move'], 'Approach');
      st.size = { w: 10, h: 10 };
      st.environment.push(node('place.obstacles', { amount: 'some', kind: 'rocks' }));
      st.maxTicks = 60;
      st.learner.episodes = 300;
      return st;
    },
    bar: 0.7,
    stars: [{ id: 'transfer', label: 'Works in bigger pens' }, { id: 'quick', label: 'Quick study', limit: 4000 }, { id: 'tidy', label: 'Tidy: 2 rules or fewer', limit: 2 }],
    cards: COURSE1_CARDS,
    // Measured: 300 tries 10%; 4,000 tries 90% at all three temperaments.
    reference: (base) => { const r = withRecipe(base, classicApproachStage()); r.learner.senses = presetSenses(); r.learner.episodes = 4000; return r; },
  },
  {
    id: 'fs-stay', course: 'first-steps', title: 'Sit and stay',
    brief: 'Teach your pet to go to the target and stay there for 5 steps. It will need to be able to stay, and to sense how long it has waited.',
    base: () => blank(recipeStage('wait-for-it'), 'fs-stay', 'Sit and stay', [nearestTarget()], ['move'], 'Wait for it'),
    bar: 0.7,
    stars: [{ id: 'transfer', label: 'Works in bigger pens' }, { id: 'lean', label: 'Lean: 3 senses or fewer', limit: 3 }, { id: 'tidy', label: 'Tidy: 3 rules or fewer', limit: 3 }],
    cards: COURSE1_CARDS,
    reference: (base) => withRecipe(base, recipeStage('wait-for-it')),
  },
  {
    id: 'fs-pond', course: 'first-steps', title: 'Mind the pond',
    brief: 'The berry again, but there is a pond, and stepping in it is a FAIL. Your pet can only avoid what it can sense.',
    base: () => blank(recipeStage('avoid-pond'), 'fs-pond', 'Mind the pond', [node('sense.nearest', { what: node('kind:berry') })], ['move'], 'Avoid'),
    bar: 0.7,
    stars: [{ id: 'transfer', label: 'Works in bigger pens' }, { id: 'lean', label: 'Lean: 3 senses or fewer', limit: 3 }, { id: 'quick', label: 'Quick study', limit: 25000 }],
    cards: COURSE1_CARDS,
    // Measured: 24,000 tries dipped to 60% at one temperament; 40,000: 80–100%.
    reference: (base) => { const r = withRecipe(base, recipeStage('avoid-pond')); r.learner.episodes = 40000; return r; },
  },
  {
    id: 'fs-clear', course: 'first-steps', title: 'Keep clear',
    brief: 'Teach your pet to stay well away from the pond until time is up. Success is judged when the time runs out.',
    base: () => blank(recipeStage('keep-clear'), 'fs-clear', 'Keep clear', [nearestTarget()], ['move', 'stay'], 'Keep clear'),
    bar: 0.7,
    stars: [{ id: 'transfer', label: 'Works in bigger pens' }, { id: 'lean', label: 'Lean: 3 senses or fewer', limit: 3 }, { id: 'tidy', label: 'Tidy: 2 rules or fewer', limit: 2 }],
    cards: COURSE1_CARDS,
    reference: (base) => { const r = withRecipe(base, recipeStage('keep-clear')); r.learner.episodes = 6000; return r; }, // more practice: a margin at every temperament
  },
  {
    id: 'fs-lean', course: 'first-steps', title: 'Less is more',
    brief: 'Someone gave your pet six senses for a simple walk to the berry, and only 400 tries to practise. Every sense multiplies what it must practise. Choose the few that decide the next step.',
    base: () => blank(classicApproachStage(), 'fs-lean', 'Less is more', [
      node('sense.nearest', { what: node('kind:berry') }), node('sense.distance', { what: node('kind:rock') }), node('sense.blocked'),
      node('sense.hazards'), node('sense.heading'), node('sense.still'),
    ], ['move'], 'Approach', 400),
    bar: 0.8,
    stars: [{ id: 'lean', label: 'Lean: 2 senses or fewer', limit: 2 }, { id: 'quick', label: 'Quick study: 400 tries or fewer', limit: 400 }, { id: 'transfer', label: 'Works in bigger pens' }],
    cards: COURSE1_CARDS,
    // Measured at 400 tries: six senses 30–35%, one (where is the berry) 90–95%.
    reference: (base) => { const r = withRecipe(base, classicApproachStage()); r.learner.senses = [node('sense.nearest', { what: node('kind:berry') })]; r.learner.episodes = 400; return r; },
  },
  {
    id: 'fs-exam', course: 'first-steps', title: 'The Apprentice exam', exam: true,
    brief: 'The berry again, but the pens change size and are cluttered with rocks. Pass this and your pet becomes an Apprentice.',
    base: () => {
      const st = blank(recipeStage('go-to-berry'), 'fs-exam', 'The Apprentice exam', [node('sense.nearest', { what: node('kind:berry') })], ['move'], 'Approach');
      st.varySize = true;
      return st;
    },
    bar: 0.75,
    stars: [{ id: 'transfer', label: 'Works in bigger pens' }, { id: 'quick', label: 'Quick study', limit: 3000 }, { id: 'lean', label: 'Lean: 3 senses or fewer', limit: 3 }],
    cards: COURSE1_CARDS,
    reference: (base) => withRecipe(base, recipeStage('go-to-berry')),
  },
];

export const challengeById = (id: string | null | undefined) => CHALLENGES.find((c) => c.id === id);
export const challengeOf = (st: StageSpec | null | undefined) => challengeById((st?.extensions as { challenge?: string } | undefined)?.challenge);

/** What the challenge fixes: the pen, SUCCESS / FAIL, what "the target" is, time per try, and the seeds. */
const LOCKED = ['size', 'varySize', 'environment', 'success', 'fail', 'outcome', 'maxTicks', 'seed', 'evaluation'] as const;
const baseCache = new Map<string, StageSpec>();
/** The challenge's base lesson, built once per session (so its card ids are stable). */
export function challengeBase(ch: ChallengeSpec): StageSpec {
  if (!baseCache.has(ch.id)) baseCache.set(ch.id, ch.base());
  return structuredClone(baseCache.get(ch.id)!);
}
const lockedPart = (st: StageSpec) => JSON.stringify([...LOCKED.map((k) => st[k] ?? null), st.learner.focus, st.learner.destination ?? null]);

/** Put a challenge's locked parts back if anything changed them (the store calls this after every change). */
export function enforceChallengeLocks(s: GameState): void {
  for (const st of s.stages) {
    const ch = challengeOf(st);
    if (!ch) continue;
    const base = challengeBase(ch);
    if (lockedPart(st) === lockedPart(base)) continue;
    for (const k of LOCKED) (st as unknown as Record<string, unknown>)[k] = structuredClone(base[k]);
    st.learner.focus = base.learner.focus;
    st.learner.destination = base.learner.destination;
  }
}

/** Open a challenge: its lesson joins the Lab's lessons (kept if already there) and becomes the active one. */
export function openChallenge(s: GameState, id: string): StageSpec | null {
  const ch = challengeById(id);
  if (!ch) return null;
  let st = s.stages.find((x) => challengeOf(x)?.id === id);
  if (!st) { st = challengeBase(ch); s.stages.push(st); }
  s.activeStageId = st.id;
  return st;
}

/** Can the player use this card in a challenge's lesson? */
export function cardAllowed(ch: ChallengeSpec | undefined, cardId: string): boolean {
  if (!ch) return true;
  return cardId.startsWith('kind:') || cardId === 'actor.pet' || cardId === 'ref.target' || cardId === 'ref.it' || ch.cards.includes(cardId);
}

export type ChallengeStatus = 'open' | 'passed' | 'locked';
/** Per pet: an exam opens once the pet holds every other rosette of its course. */
export function challengeStatus(s: GameState, petId: string, ch: ChallengeSpec): ChallengeStatus {
  const rec = petRecordOf(s, petId);
  if (rec.certificates[ch.id]) return 'passed';
  if (!courseOpen(s, ch.course)) return 'locked';
  if (!ch.exam) return 'open';
  return CHALLENGES.filter((c) => c.course === ch.course && !c.exam).every((c) => rec.certificates[c.id]) ? 'open' : 'locked';
}

export interface CertifyInput {
  stage: StageSpec;
  report: TrainingReport;
  /** Practice tries in this training run. */
  episodes: number;
  /** The run continued an earlier one (Refine): the quick-study badge needs a fresh run. */
  resumed?: boolean;
}

export interface CertifyResult {
  ok: boolean;
  reason?: string;
  badges: Star[];
  newBadges: Star[];
  acorns: number;
  /** The pet's new rank, when an exam raised it. */
  rank?: Rank;
}

/** The merit badges a run earns. */
export function earnedBadges(ch: ChallengeSpec, inp: CertifyInput): Star[] {
  const senses = inp.stage.learner.senses?.length ?? 0;
  const rules = inp.stage.rules.filter((r) => r.cardId === 'rule' && !r.args.off).length;
  return ch.stars.filter((st) =>
    st.id === 'transfer' ? inp.report.transfer.successRate >= ch.bar
    : st.id === 'lean' ? senses <= (st.limit ?? 0)
    : st.id === 'quick' ? !inp.resumed && inp.episodes <= (st.limit ?? 0)
    : rules <= (st.limit ?? 0));
}

/** Only cards the challenge allows (a lesson card import or an old lesson can't smuggle others in). */
function disallowedCards(ch: ChallengeSpec, st: StageSpec): string[] {
  const out = new Set<string>();
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (!n || typeof n !== 'object') return;
    const o = n as SpecNode;
    if (typeof o.cardId === 'string' && !cardAllowed(ch, o.cardId)) out.add(o.cardId);
    if (o.args) for (const v of Object.values(o.args)) visit(v);
  };
  visit(st.rules);
  visit(st.learner.senses ?? []);
  return [...out];
}

/**
 * Certify a pet's training run on a challenge. Refused if the lesson's locked parts changed, the run is below the
 * bar on the fixed test layouts, a loophole was flagged, or the lesson uses cards the challenge doesn't allow. A
 * pass records a rosette (keeping the best badges), pays acorns for the first pass and for each new badge, and an
 * exam raises the pet's rank.
 */
export function certify(s: GameState, petId: string, inp: CertifyInput): CertifyResult {
  const no = (reason: string): CertifyResult => ({ ok: false, reason, badges: [], newBadges: [], acorns: 0 });
  const ch = challengeOf(inp.stage);
  const pet = petById(s, petId);
  if (!ch || !s.academy) return no('This lesson isn’t an Academy challenge.');
  if (!pet) return no('That pet isn’t here.');
  if (lockedPart(inp.stage) !== lockedPart(challengeBase(ch))) return no('The challenge’s pen or SUCCESS / FAIL was changed. Open the challenge again to reset them.');
  if (challengeStatus(s, petId, ch) === 'locked') return no(`${pet.name} must pass the course’s other challenges before its exam.`);
  const bad = disallowedCards(ch, inp.stage);
  if (bad.length) return no(`This challenge doesn’t allow ${bad.length === 1 ? 'the card' : 'the cards'} ${bad.join(', ')}.`);
  if (inp.report.exploits.length) return no('Loophole found: a rule pays without the goal being met. Repair it and train again: the Academy doesn’t certify loopholes.');
  const rate = inp.report.after.successRate;
  if (rate < ch.bar) return no(`${Math.round(rate * 100)}% on the test layouts; the bar is ${Math.round(ch.bar * 100)}%.`);
  const badges = earnedBadges(ch, inp);
  const rec = petRecord(s, petId);
  const prev = rec.certificates[ch.id];
  const had = new Set(prev?.badges ?? []);
  const newBadges = badges.filter((b) => !had.has(b.id));
  const acorns = (prev ? 0 : ROSETTE_ACORNS + (ch.exam ? EXAM_ACORNS : 0)) + BADGE_ACORNS * newBadges.length;
  rec.certificates[ch.id] = { challengeId: ch.id, at: prev?.at ?? Date.now(), badges: [...new Set([...had, ...badges.map((b) => b.id)])] };
  s.academy.acorns += acorns;
  const rankBefore = petRank(s, pet);
  if (ch.exam && !rec.exams.includes(ch.course)) rec.exams.push(ch.course);
  const rank = petRank(s, pet);
  return { ok: true, badges, newBadges, acorns, ...(rank !== rankBefore ? { rank } : {}) };
}

/** Challenges of a course, in order (its exam last). */
export const courseChallenges = (courseId: string) => CHALLENGES.filter((c) => c.course === courseId).sort((a, b) => Number(!!a.exam) - Number(!!b.exam));
export const courseOf = (ch: ChallengeSpec) => COURSES.find((c) => c.id === ch.course)!;
/*
 * Courses open in order, and the Lab offers the cards of every open course (Academy roadmap, decision 9). A course
 * opens when any pet passes the previous course's exam. Each course owns a set of cards; everything not claimed by
 * an earlier course belongs to the last one, so passing every exam opens every card.
 */
const COURSE_CARDS: Record<string, (id: string) => boolean> = {
  'first-steps': (id) => COURSE1_CARDS.includes(id),
  'fetch-carry': (id) => /^(ev\.(pickup|drop|deliver|lift|empty|full|fill|water|fumble)|cond\.(carrying|carryingAny|storage|delivered|watered|hasWater)|sense\.(carrying|stock|water|nearestDry|stored))$/.test(id),
  'thinking-ahead': (id) => /^(eff\.note|cond\.(note|happened|just|compare|energyBelow|night|raining|canAfford)|sense\.(note|did|tired|night|rain)|q\.|obj\.)/.test(id),
  'working-together': (id) => /^(opt\.|ev\.(shoo|scare|peck|entersArea|leavesArea|gate|plant)|cond\.(inArea|allInArea|petInArea|gates|kindNear)|sense\.(area|outside|areaFrom|gate)|area\.)/.test(id),
};
const ALWAYS = (id: string) => id.startsWith('kind:') || id === 'actor.pet' || id === 'ref.target' || id === 'ref.it' || id.startsWith('place.') || id === 'zone.rect';

/** The course a card is taught in. */
export function courseOfCard(id: string): string {
  return COURSES.find((c) => COURSE_CARDS[c.id]?.(id))?.id ?? COURSES[COURSES.length - 1].id;
}

/** Is a course open? The first always; each later one once any pet passed the previous course's exam. */
export function courseOpen(s: GameState, courseId: string): boolean {
  const i = COURSES.findIndex((c) => c.id === courseId);
  if (i <= 0) return true;
  const prev = COURSES[i - 1].id;
  return Object.values(s.academy?.pets ?? {}).some((r) => r.exams.includes(prev));
}

/** Can the Lab offer this card? Farm-edition games offer everything. */
export function labCardAllowed(s: GameState, cardId: string): boolean {
  if (!s.academy || ALWAYS(cardId)) return true;
  return courseOpen(s, courseOfCard(cardId));
}

/** Which course each recipe belongs to, and the challenge it answers (if any). */
const RECIPE_COURSE: Record<string, { course: string; answers?: string }> = {
  'go-to-berry': { course: 'first-steps', answers: 'fs-exam' },
  'wait-for-it': { course: 'first-steps', answers: 'fs-stay' },
  'keep-clear': { course: 'first-steps', answers: 'fs-clear' },
  'avoid-pond': { course: 'first-steps', answers: 'fs-pond' },
  'bring-it-home': { course: 'fetch-carry' }, 'pay-per-pickup': { course: 'fetch-carry' }, 'empty-basket': { course: 'fetch-carry' },
  'water-garden': { course: 'fetch-carry' }, harvest: { course: 'fetch-carry' }, 'harvest-store': { course: 'fetch-carry' }, plant: { course: 'fetch-carry' },
  patrol: { course: 'thinking-ahead' },
  'herd-chicken': { course: 'working-together' }, 'shoo-loophole': { course: 'working-together' }, 'open-gate': { course: 'working-together' },
  'shut-gate': { course: 'working-together' }, 'fetch-routine': { course: 'working-together' }, 'morning-chores': { course: 'working-together' },
  'basket-run': { course: 'days-work' },
};

/**
 * Recipes in the Lab are rewards, not spoilers: a recipe opens when its course is open and, if it answers a
 * challenge, once a pet has passed that challenge. Returns null when open, else why not.
 */
export function recipeLock(s: GameState, recipeId: string): string | null {
  if (!s.academy) return null;
  const r = RECIPE_COURSE[recipeId] ?? { course: COURSES[COURSES.length - 1].id };
  const course = COURSES.find((c) => c.id === r.course)!;
  if (!courseOpen(s, r.course)) return `Opens with the course “${course.title}”`;
  if (r.answers && !Object.values(s.academy.pets).some((p) => p.certificates[r.answers!])) return `Opens when a pet passes “${challengeById(r.answers)?.title}”`;
  return null;
}
