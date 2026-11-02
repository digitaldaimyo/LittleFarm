import type { GameState } from './types';
import type { SpecNode, StageSpec } from '../domain/types';
import { activePet, getSkill } from './pets';
import { isNode, node, placedKinds } from '../domain/spec';
import { buildTutorialStage, patrolWithoutNote, recipeStage } from '../domain/recipes';
import { addJournal } from './journal';
import { starterPlan } from './plan';
import { evaluate } from '../learning/episodes';
import { heldOutSeeds, policySpecFor } from '../learning/report';

/**
 * The Field Guide: Chapter 1 (the first lesson, always on for new games) plus short lessons that are
 * *offered* when they become useful. Each lesson teaches one idea, often by trying it the wrong way first
 * (an "experiment": free, never auto-saved) and comparing the player's own numbers.
 */
export type GuideScreen = 'farm' | 'teach' | 'pets' | 'guide' | 'journal';

export interface GuideStep {
  id: string;
  title: string;
  text: string;
  /** A short "why" shown under the step. */
  why?: string;
  screen?: GuideScreen;
  /** data-tut key of the control to highlight. */
  highlight?: string;
  done: (s: GameState) => boolean;
  /** Steps finished by pressing "Got it" (sets flag `guide:<chapter>:<step>`). */
  ack?: boolean;
  /** A button in the lesson banner that does something for the player (e.g. run a test). */
  action?: { label: string; run: (s: GameState) => void };
}

export interface Chapter {
  id: string;
  title: string;
  blurb: string;
  minutes: number;
  /** When the lesson is offered (Chapter 1 is active from the start). */
  offered: (s: GameState) => boolean;
  /** Shown while the lesson isn't offered yet: what opens it. */
  opensWhen?: string;
  /** Prepare the lesson (e.g. create its practice pen). */
  start?: (s: GameState) => void;
  steps: GuideStep[];
  /** Side-by-side comparison shown in the Guide: which runs, labelled how. */
  compare?: { stage: string; rows: { variant: string; label: string }[]; note: string };
}

export interface GuideRun {
  episodes: number;
  after: number;
  /** For pinned pens: the score once the target/start are scattered (the honest one). */
  scattered?: number;
  random: number;
  transfer: number;
  /** Was the target pinned (fixed placement) in this run? */
  pinned: boolean;
  /** Mean treats per try (to contrast reward with success). */
  treats?: number;
  /** Which side of the lesson's contrast this run is (see guideVariant). */
  variant?: string;
  at: number;
}

export interface GuideState {
  status: Record<string, 'offered' | 'active' | 'done' | 'skipped'>;
  active: string | null;
  step: number;
}

const flag = (s: GameState, k: string) => !!s.progress.flags[k];
const ackFlag = (chapter: string, step: string) => `guide:${chapter}:${step}`;
const runs = (s: GameState, stageId: string) => s.progress.guideRuns?.[stageId] ?? [];
const stage = (s: GameState, id: string) => s.stages.find((x) => x.id === id);
const hasVariant = (s: GameState, stageId: string, v: string) => runs(s, stageId).some((r) => r.variant === v);
const lastVariantRun = (s: GameState, stageId: string, v: string) => [...runs(s, stageId)].reverse().find((r) => r.variant === v);
const TUT = 'stage-tutorial';
export const PRACTICE_STAGE = 'stage-guide-practice';
export const PINNED_STAGE = 'stage-guide-pinned';
export const LOOPHOLE_STAGE = 'stage-guide-loophole';
export const AVOID_STAGE = 'stage-guide-ponds';
export const INVENT_STAGE = 'stage-guide-invent';
export const ROUTINE_STAGE = 'stage-guide-routine';
export const NOTES_STAGE = 'stage-guide-notes';
/** Id of the deliberately shadowed row the plans lesson adds to the pet's plan. */
export const LESSON_ROW = 'guide-row-well';

function ruleCards(st: StageSpec | undefined): SpecNode[] {
  return st?.rules.filter((r) => r.cardId === 'rule') ?? [];
}
function effects(r: SpecNode): SpecNode[] {
  const t = r.args.then;
  return (Array.isArray(t) ? t : isNode(t) ? [t] : []) as SpecNode[];
}
function treatForBerry(st: StageSpec | undefined): SpecNode | undefined {
  return ruleCards(st).find((r) => {
    const ev = r.args.when;
    return isNode(ev) && ev.cardId === 'ev.reach' && isNode(ev.args.what) && ev.args.what.cardId === 'kind:berry'
      && effects(r).some((e) => e.cardId === 'eff.reward' && Number(e.args.amount ?? 0) > 0);
  });
}
export function isPinned(st: StageSpec): boolean {
  const focus = `kind:${st.learner.focus}`;
  return st.environment.some((p) => p.cardId === 'place.fixed' && isNode(p.args.kind) && p.args.kind.cardId === focus);
}

/** A copy of the standard Approach lesson used by Field Guide experiments. */
function guideStage(id: string, name: string, tweak: (s: StageSpec) => void): StageSpec {
  const s = recipeStage('go-to-berry');
  s.id = id;
  s.name = name;
  s.recipeId = 'guide';
  s.extensions = { guide: true };
  tweak(s);
  return s;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'first', title: 'First lesson', blurb: 'Teach your first skill and put it to work.', minutes: 4,
    offered: () => true,
    start: (s) => {
      // Replaying: a fresh, empty practice pen and the pen-building steps again.
      const fresh = buildTutorialStage();
      fresh.id = TUT;
      fresh.name = 'First lesson: Go to the berry';
      upsertStage(s, fresh);
      s.activeStageId = TUT;
      for (const k of ['visitedTeach', 'assignedJob']) delete s.progress.flags[k];
      delete s.progress.guideRuns?.[TUT];
    },
    steps: [
      { id: 'adopt', title: 'Adopt a pet', text: 'Every trainer needs a trainee. Pick a name and colours.', done: (s) => s.pets.length > 0 },
      { id: 'open-pen', title: 'Open the training pen', text: 'Tap “Teach”.', why: 'A pen is a practice world. What you put in it is all your pet will ever see while learning — so build it like the place the skill will be used.', screen: 'teach', highlight: 'nav-teach', done: (s) => flag(s, 'visitedTeach') },
      { id: 'place-berry', title: 'Put a berry in the pen', text: 'In Environment, keep “Scatter” on, pick the Berry card and tap any tile.', why: 'Scatter puts the berry somewhere new on every try, so your pet learns “walk to the berry”, not “walk to that corner”. The rocks are already there because the farm has obstacles too.', screen: 'teach', highlight: 'env-berry', done: (s) => placedKinds(stage(s, TUT) ?? ({ environment: [] } as unknown as StageSpec)).has('berry') },
      { id: 'treat-rule', title: 'Decide what earns a treat', text: 'In Rules, press “+ Add rule”. For WHEN choose “Reaches” and then “Berry”. For THEN choose “Treat”.', why: 'Treats are how your pet learns. Pay for the result you want — reaching the berry — not for effort along the way.', screen: 'teach', highlight: 'add-rule', done: (s) => !!treatForBerry(stage(s, TUT)) },
      { id: 'success', title: 'Say what “done” means', text: 'Add “End try” to that rule’s THEN (so each try stops at the berry), then set SUCCESS to “Is at → Berry”.', why: 'Treats teach; SUCCESS checks. The report judges your pet only by SUCCESS — so you’ll notice if treats ever reward the wrong thing.', screen: 'teach', highlight: 'success-slot', done: (s) => { const t = stage(s, TUT); const r = treatForBerry(t); return !!t?.success && !!r && effects(r).some((e) => e.cardId === 'eff.end'); } },
      { id: 'train', title: 'Train Approach', text: 'Press Train. Your pet really practises — around 1,500 tries.', why: 'Lessons in the Field Guide are free: they cost no energy.', screen: 'teach', highlight: 'train-btn', done: (s) => runs(s, TUT).length > 0 },
      { id: 'read-report', title: 'Read the report', text: 'Look at the highlighted rows: “Before” and “Random wandering” vs “After”, and “Transfer” (bigger pens it never saw).', why: 'Every number comes from layouts your pet never practised on. A skill is only as good as its score there — that’s why scattering mattered.', screen: 'teach', highlight: 'report-compare', ack: true, done: (s) => flag(s, ackFlag('first', 'read-report')) },
      { id: 'save', title: 'Save the skill', text: 'Press “Save skill”.', screen: 'teach', highlight: 'save-skill', done: (s) => { const p = activePet(s); return !!p && !!getSkill(p, 'Approach')?.revisions.some((r) => r.stageId === TUT && r.createdAt >= (runs(s, TUT)[0]?.at ?? 0)); } },
      { id: 'assign', title: 'Put it to work', text: 'On the Farm, pick the “Harvest” job.', why: 'Skills are for the farm. Harvest uses the Approach you just taught to walk to ripe berries.', screen: 'farm', highlight: 'job-forage', done: (s) => flag(s, 'assignedJob') },
      { id: 'earn', title: 'Earn 5 coins', text: 'Each berry sells for 2 coins once your pet carries it to the house — coins only come from the house. Five coins unlocks Fetch lessons (with Fetch, pets can also store crops in the basket and haul them home later) — and the Field Guide has more lessons waiting.', screen: 'farm', done: (s) => s.progress.unlocks.includes('fetch') },
    ],
  },
  {
    id: 'practice', title: 'Read the report: practice', blurb: 'Why a lesson can look broken when it just needs more practice.', minutes: 3, opensWhen: 'Opens after the first lesson.',
    offered: (s) => guideStatus(s, 'first') === 'done' || guideStatus(s, 'first') === 'skipped',
    start: (s) => {
      upsertStage(s, guideStage(PRACTICE_STAGE, 'Field guide: practice', (x) => { x.learner.episodes = 300; }));
      s.activeStageId = PRACTICE_STAGE;
      delete s.progress.guideRuns?.[PRACTICE_STAGE];
    },
    steps: [
      { id: 'short', title: 'Experiment: only 300 tries', text: 'This copy of “Go to the berry” is set to 300 practice tries. Train it.', why: 'Experiments are free and never saved automatically.', screen: 'teach', highlight: 'train-btn', done: (s) => runs(s, PRACTICE_STAGE).some((r) => r.episodes <= 400) },
      { id: 'long', title: 'Now give it 1,500 tries', text: 'In the Pet binder, slide “Practice tries” to 1,500 and train again.', screen: 'teach', highlight: 'practice-slider', done: (s) => runs(s, PRACTICE_STAGE).some((r) => r.episodes >= 1200) },
      { id: 'compare', title: 'Compare your two runs', text: 'Same pen, same rules — only the practice changed. Check the comparison in the Guide.', why: 'Below ~700 tries most lessons look broken. If a new skill disappoints, try more practice (or “Refine”, which keeps learning from where it left off) before redesigning the pen.', screen: 'guide', highlight: 'guide-compare', ack: true, done: (s) => flag(s, ackFlag('practice', 'compare')) },
    ],
  },
  {
    id: 'scatter', title: 'Scatter, don’t pin', blurb: 'Why pinned objects teach one layout instead of a skill.', minutes: 4, opensWhen: 'Opens after “Read the report: practice”.',
    offered: (s) => guideStatus(s, 'practice') === 'done' || guideStatus(s, 'practice') === 'skipped',
    start: (s) => {
      upsertStage(s, guideStage(PINNED_STAGE, 'Field guide: pinned berry', (x) => {
        // One "perfect" layout: everything pinned. Measured: ~15% on new layouts (5/5 seeds) vs 85–95% once berry and start are scattered.
        x.environment = [
          node('place.pet', { mode: 'fixed', x: 0, y: 0 }),
          node('place.fixed', { kind: node('kind:berry'), x: 7, y: 7 }),
          node('place.fixed', { kind: node('kind:rock'), x: 3, y: 3 }),
          node('place.fixed', { kind: node('kind:rock'), x: 5, y: 2 }),
          node('place.fixed', { kind: node('kind:rock'), x: 2, y: 6 }),
        ];
      }));
      s.activeStageId = PINNED_STAGE;
      delete s.progress.guideRuns?.[PINNED_STAGE];
    },
    steps: [
      { id: 'pinned', title: 'Experiment: a pinned berry', text: 'This pen is one carefully made layout: the berry is pinned in one corner, your pet always starts in the other, the rocks never move. Train it.', screen: 'teach', highlight: 'train-btn', done: (s) => runs(s, PINNED_STAGE).some((r) => r.pinned) },
      { id: 'miss', title: 'Watch it miss', text: 'Look at the report: on its own pinned layout it’s nearly perfect — but the “Scattered layouts” row moves the berry and start. Press “▶ a miss” there to watch one.', why: 'In practice, “walk to that corner” and “walk to the berry” looked the same. Only layouts where the berry moves tell them apart.', screen: 'teach', highlight: 'replay-miss', done: (s) => flag(s, 'replayedMiss') },
      { id: 'unpin', title: 'Scatter it', text: 'In Environment, press “Scatter this” on the berry and “Random start” on the pet. (The rocks can stay — what matters is that the berry and the start change.)', screen: 'teach', highlight: 'placements', done: (s) => { const st = stage(s, PINNED_STAGE); return !!st && !isPinned(st) && placedKinds(st).has('berry') && !st.environment.some((p) => p.cardId === 'place.pet' && p.args.mode === 'fixed'); } },
      { id: 'retrain', title: 'Train the scattered version', text: 'Train again and compare.', screen: 'teach', highlight: 'train-btn', done: (s) => runs(s, PINNED_STAGE).some((r) => !r.pinned) },
      { id: 'compare', title: 'Compare pinned vs scattered', text: 'Check the comparison in the Guide.', why: 'Scatter anything whose position will change in real life. Pin only what really stays put (like the farm’s bin or well) — and even then, varying it a little makes skills sturdier.', screen: 'guide', highlight: 'guide-compare', ack: true, done: (s) => flag(s, ackFlag('scatter', 'compare')) },
    ],
  },
  {
    id: 'results', title: 'Pay for results, not effort', blurb: 'How a reward with a loophole teaches the wrong thing — and how to repair it.', minutes: 5, opensWhen: 'Opens when Fetch lessons unlock (earn 5 coins) and a pet knows Approach.',
    offered: (s) => s.progress.unlocks.includes('fetch') && s.pets.some((p) => !!getSkill(p, 'Approach')),
    start: (s) => {
      const st = recipeStage('pay-per-pickup');
      st.id = LOOPHOLE_STAGE;
      st.name = 'Field guide: a treat for every pickup';
      st.recipeId = 'guide';
      st.extensions = { guide: true };
      upsertStage(s, st);
      s.activeStageId = LOOPHOLE_STAGE;
      delete s.progress.guideRuns?.[LOOPHOLE_STAGE];
    },
    steps: [
      { id: 'loophole', title: 'Experiment: a treat for every pickup', text: 'This is the Fetch lesson (carry the berry to the basket) with one extra rule: a treat every time your pet picks the berry up. Sounds encouraging… train it.', screen: 'teach', highlight: 'train-btn', done: (s) => hasVariant(s, LOOPHOLE_STAGE, 'loophole') },
      { id: 'read', title: 'Treats up, success down', text: 'Your pet earns lots of treats but rarely delivers. Read “Loophole found!” and open “What it actually did” — where did the treats come from?', why: 'Your pet does exactly what the treats pay for. Picking up and putting down again and again paid better than the delivery — so that’s what it learned.', screen: 'teach', highlight: 'report-exploit', ack: true, done: (s) => flag(s, ackFlag('results', 'read')) },
      { id: 'repair', title: 'Use the repair card', text: 'Press “Repair card: Pay only once per object”.', why: 'Limits close loopholes without removing the encouragement: the first pickup still pays, the hundredth doesn’t.', screen: 'teach', highlight: 'repair-card', done: (s) => { const st = stage(s, LOOPHOLE_STAGE); return !!st && st.rules.some((r) => isNode(r.args.when) && r.args.when.cardId === 'ev.pickup' && isNode(r.args.limit) && r.args.limit.cardId === 'lim.perObject'); } },
      { id: 'retrain', title: 'Train the repaired lesson', text: 'Train again with the repaired rule.', screen: 'teach', highlight: 'train-btn', done: (s) => hasVariant(s, LOOPHOLE_STAGE, 'repaired') },
      { id: 'compare', title: 'Compare', text: 'Check the comparison in the Guide: success and treats, before and after the repair.', screen: 'guide', highlight: 'guide-compare', ack: true, done: (s) => flag(s, ackFlag('results', 'compare')) },
      { id: 'save', title: 'Keep the working Fetch', text: 'Back in Teach, save the repaired run — it’s a perfectly good Fetch skill.', screen: 'teach', highlight: 'save-skill', done: (s) => s.pets.some((p) => !!getSkill(p, 'Fetch')?.revisions.some((r) => r.stageId === LOOPHOLE_STAGE)) },
    ],
    compare: { stage: LOOPHOLE_STAGE, rows: [{ variant: 'loophole', label: 'Treat every pickup' }, { variant: 'repaired', label: 'Once per object' }], note: 'More treats is not more success. When treats rise but success doesn’t, look for a rule that pays for repeating something — and pay for the result instead.' },
  },
  {
    id: 'where', title: 'Practise where it works', blurb: 'Why a skill learned in an easy pen stumbles in the real world.', minutes: 5, opensWhen: 'Opens when Avoid lessons unlock and a pet has splashed through the pond.',
    offered: (s) => s.progress.unlocks.includes('avoid') && s.pets.some((p) => p.stats.dips > 0 && !!getSkill(p, 'Approach')),
    start: (s) => {
      const st = recipeStage('avoid-pond');
      st.id = AVOID_STAGE;
      st.name = 'Field guide: the pond pen';
      st.recipeId = 'guide';
      st.extensions = { guide: true };
      upsertStage(s, st);
      s.activeStageId = AVOID_STAGE;
      delete s.progress.guideRuns?.[AVOID_STAGE];
    },
    steps: [
      { id: 'baseline', title: 'Test your Approach with ponds', text: 'Your Approach practised in pens without ponds. This pen has some. Press “Test my Approach here” — no training, just a test on 20 layouts.', why: 'This is what happened on the farm: the shortest way to the berry sometimes goes through the pond.', screen: 'teach', action: { label: 'Test my Approach here', run: (s) => testApproachHere(s) }, done: (s) => hasVariant(s, AVOID_STAGE, 'approach') },
      { id: 'train', title: 'Train Avoid in the pond pen', text: 'This lesson already has ponds, a FAIL condition (stepping in ends the try) and a “Splash!” nudge. Train it.', why: 'Practise with the obstacles the job will meet. Some variety, not maximum difficulty: pets practised with no rocks scored 70% in cluttered pens, a few rocks 86%, lots of rocks 80%.', screen: 'teach', highlight: 'train-btn', done: (s) => hasVariant(s, AVOID_STAGE, 'avoid') },
      { id: 'compare', title: 'Compare', text: 'Check the comparison in the Guide.', screen: 'guide', highlight: 'guide-compare', ack: true, done: (s) => flag(s, ackFlag('where', 'compare')) },
      { id: 'save', title: 'Save Avoid', text: 'In Teach, save the Avoid skill.', screen: 'teach', highlight: 'save-skill', done: (s) => s.pets.some((p) => !!getSkill(p, 'Avoid')?.revisions.some((r) => r.stageId === AVOID_STAGE)) },
      { id: 'use', title: 'Use it on the farm', text: 'On the Farm, set “Move with” to Avoid. Your jobs keep working — they just walk around the pond now.', why: 'Skills are reused, not retrained: Harvest and Haul move with whichever movement skill you pick. The same goes for anything new on the farm — when the farm changes (fences, gates, rain puddles), practise with it.', screen: 'farm', highlight: 'nav-avoid', done: (s) => s.pets.some((p) => p.assignment.navigator === 'Avoid') },
    ],
    compare: { stage: AVOID_STAGE, rows: [{ variant: 'approach', label: 'Approach (practised without ponds)' }, { variant: 'avoid', label: 'Avoid (practised with ponds)' }], note: 'A skill is only as good as the pens it practised in. Build the pen like the place the skill will be used.' },
  },
  {
    id: 'invent', title: 'Invent a skill', blurb: 'Choose what your pet senses and can do — and why fewer senses often learn better.', minutes: 6, opensWhen: 'Opens when “Your own skills” unlocks (a certified Approach).',
    offered: (s) => s.progress.unlocks.includes('custom'),
    start: (s) => {
      const st = recipeStage('wait-for-it');
      st.id = INVENT_STAGE;
      st.name = 'Field guide: Wait for it';
      st.recipeId = 'guide';
      st.seed = 202; // a training seed where the extra-sense contrast is clear (measured: 90% lean vs 20% with “How far is rock”)
      st.extensions = { guide: true };
      st.abilities = ['move'];
      st.learner.senses = [node('sense.nearest', { what: node('ref.target') }), node('sense.blocked'), node('sense.heading')];
      st.rules = [];
      st.success = null;
      upsertStage(s, st);
      s.activeStageId = INVENT_STAGE;
      delete s.progress.guideRuns?.[INVENT_STAGE];
    },
    steps: [
      { id: 'stay', title: 'Give it the Stay ability', text: 'This skill should walk to the target and sit still for 5 steps. In the Pet binder, turn on the “Stay” ability.', why: 'Abilities are what a skill may do. Without Stay, “wait” isn’t even possible.', screen: 'teach', highlight: 'abilities', done: (s) => !!stage(s, INVENT_STAGE)?.abilities.includes('stay') },
      { id: 'patience', title: 'Add the Patience sense', text: 'Under Senses, press “+ sense” and pick “Patience”. Watch the situations meter.', why: 'Senses are what a skill pays attention to. To know when it has waited long enough, your pet must be able to sense how long it has waited.', screen: 'teach', highlight: 'senses', done: (s) => !!stage(s, INVENT_STAGE)?.learner.senses?.some((n) => n.cardId === 'sense.still') },
      { id: 'rules', title: 'Add the rules', text: 'In Rules, tap the suggested “Wait for it” rules: a small treat for staying on the target, a big one after 5 steps, and SUCCESS = “at the target and stayed 5+”.', screen: 'teach', highlight: 'suggested', done: (s) => { const st = stage(s, INVENT_STAGE); return !!st?.success && st.rules.some((r) => isNode(r.args.when) && r.args.when.cardId === 'ev.stay'); } },
      { id: 'train', title: 'Train it', text: 'Train your new skill.', screen: 'teach', highlight: 'train-btn', done: (s) => runs(s, INVENT_STAGE).length > 0 },
      { id: 'extra', title: 'Experiment: one sense too many', text: 'Add a sense this job doesn’t need: “How far is…” → Rock. Then train again with the same practice — it usually does noticeably worse.', why: 'Each sense multiplies the situations your pet must practise. (A sense that never changes in the pen — like “Hazards nearby” with no pond — costs nothing.)', screen: 'teach', highlight: 'senses', done: (s) => { const r = runs(s, INVENT_STAGE); return r.length > 1 && (r.at(-1)!.variant ?? '') !== (r[0].variant ?? ''); } },
      { id: 'compare', title: 'Compare', text: 'Check the comparison in the Guide.', screen: 'guide', highlight: 'guide-compare', ack: true, done: (s) => flag(s, ackFlag('invent', 'compare')) },
      { id: 'save', title: 'Keep the lean version', text: 'In Teach, remove the extra sense (✕ on its card), train once more, and save “Wait for it”. Then try it on the farm with “Run a skill”.', screen: 'teach', highlight: 'save-skill', done: (s) => s.pets.some((p) => !!getSkill(p, 'Wait for it')?.revisions.some((r) => r.stageId === INVENT_STAGE && !r.learner?.senses.some((n) => n.cardId === 'sense.distance'))) },
    ],
    compare: { stage: INVENT_STAGE, rows: [{ variant: 'first', label: 'Lean senses' }, { variant: 'latest', label: 'With the extra sense' }], note: 'Choose the fewest senses that decide the next move. Every extra one multiplies the practice your pet needs — and with the same practice, it learns worse.' },
  },
  {
    id: 'read', title: 'See what your pet learned', blurb: 'Summaries, the “What does Pip do?” probe, curiosities and skill cards.', minutes: 5, opensWhen: 'Opens once you’ve saved a skill you invented.',
    offered: (s) => s.pets.some((p) => p.skills.some((k) => k.custom && k.revisions.length > 0)),
    start: (s) => {
      for (const k of ['viewedSummaryPreset', 'viewedSummaryCustom', 'probed', 'probePath', 'exportedCard']) delete s.progress.flags[k];
      if (stage(s, TUT)) s.activeStageId = TUT;
    },
    steps: [
      { id: 'summary-approach', title: 'How Approach behaves', text: 'In Pets, open “What it actually does” on Approach (press “work it out now” if it hasn’t been worked out yet).', why: 'The report says how often a skill succeeds. The summary says how: where it spends its time, what it does, and which rules paid.', screen: 'pets', highlight: 'summary', done: (s) => flag(s, 'viewedSummaryPreset') },
      { id: 'summary-custom', title: 'Now one of your own skills', text: 'Open “What it actually does” on a skill you invented. Compare the heatmaps: Approach ends on the target; a waiting or herding skill spends its time somewhere else.', screen: 'pets', highlight: 'summary', done: (s) => flag(s, 'viewedSummaryCustom') },
      { id: 'probe', title: 'Ask “What does Pip do?”', text: 'In Teach, on the first lesson’s pen, press “What does Pip do?”. Every arrow is a learned choice; grey ones are guesses about situations it never practised exactly.', why: 'Grey arrows show where more practice — or more variety in the pen — would help.', screen: 'teach', highlight: 'probe', done: (s) => flag(s, 'probed') },
      { id: 'probe-tap', title: 'Start it anywhere', text: 'Tap a tile to drop your pet there and see the path it would take.', screen: 'teach', highlight: 'probe', done: (s) => flag(s, 'probePath') },
      { id: 'curious', title: 'Read the curiosities', text: 'Journal notes marked “Curious:” point out behaviour that doesn’t match what the rules seem to ask for. They’re hints, never errors.', screen: 'journal', ack: true, done: (s) => flag(s, ackFlag('read', 'curious')) },
      { id: 'card', title: 'Share a skill', text: 'In Pets, press “Export skill card” on any skill. Cards can be imported into another pet or another save — the skill keeps its history and its scores.', screen: 'pets', highlight: 'export-card', done: (s) => flag(s, 'exportedCard') },
    ],
  },
  {
    id: 'routines', title: 'Combine skills (routines)', blurb: 'A routine chooses between your skills — but only as well as what it watches.', minutes: 5, opensWhen: 'Opens when routines unlock (a certified Approach and 2 saved skills).',
    offered: (s) => s.progress.unlocks.includes('routines'),
    start: (s) => {
      const st = recipeStage('fetch-routine');
      st.id = ROUTINE_STAGE;
      st.name = 'Field guide: berry run';
      st.recipeId = 'guide';
      st.extensions = { guide: true };
      st.learner.skill = 'Berry run';
      // A useless option (the player's deck is rarely perfect) and only two watched conditions.
      st.learner.routine!.options.push(node('opt.skill', { skill: 'Approach', aim: node('kind:rock') }));
      st.learner.routine!.watch = st.learner.routine!.watch.slice(0, 2);
      upsertStage(s, st);
      s.activeStageId = ROUTINE_STAGE;
      delete s.progress.guideRuns?.[ROUTINE_STAGE];
    },
    steps: [
      { id: 'train-blind', title: 'Experiment: a routine that watches two things', text: 'This routine can use Approach (to the berry, the basket — or a rock, which is useless here), pick up and put down. It watches “carrying the berry” and “at the berry”. Train it.', why: 'A routine doesn’t learn to walk — it reuses your Approach. It only learns which option to pick in each situation it can tell apart.', screen: 'teach', highlight: 'train-btn', done: (s) => hasVariant(s, ROUTINE_STAGE, 'watch:2') },
      { id: 'read', title: 'Worse than random choices', text: 'Compare “After” with “Random choices” (the same options picked at random). It’s stuck in a loop.', why: 'It can’t tell “standing at the basket” from anywhere else — so it can’t know when to put the berry down.', screen: 'teach', highlight: 'report-compare', ack: true, done: (s) => flag(s, ackFlag('routines', 'read')) },
      { id: 'watch-bin', title: 'Let it watch the basket', text: 'In the Pet binder, under Watches, press “+ condition” and pick “Is at” → Basket.', screen: 'teach', highlight: 'watches', done: (s) => (stage(s, ROUTINE_STAGE)?.learner.routine?.watch.length ?? 0) >= 3 },
      { id: 'retrain', title: 'Train it again', text: 'Same options, same practice — one more thing to watch.', screen: 'teach', highlight: 'train-btn', done: (s) => runs(s, ROUTINE_STAGE).some((r) => (r.variant ?? '').startsWith('watch:') && Number((r.variant ?? 'watch:0').slice(6)) >= 3) },
      { id: 'compare', title: 'Compare', text: 'Check the comparison in the Guide.', screen: 'guide', highlight: 'guide-compare', ack: true, done: (s) => flag(s, ackFlag('routines', 'compare')) },
      { id: 'save', title: 'Keep your routine', text: 'Save “Berry run”. It always uses your current Approach — retrain Approach and the routine improves too (the Pets screen warns when a skill changed since the routine was certified).', screen: 'teach', highlight: 'save-skill', done: (s) => s.pets.some((p) => !!getSkill(p, 'Berry run')?.revisions.some((r) => r.stageId === ROUTINE_STAGE)) },
    ],
    compare: { stage: ROUTINE_STAGE, rows: [{ variant: 'watch:2', label: 'Watching 2 things' }, { variant: 'watch:3', label: 'Watching 3 (+ at the basket)' }], note: 'A routine chooses only as well as what it watches. If “After” isn’t clearly above “Random choices”, it’s missing something it needs to notice.' },
  },
  {
    id: 'plans', title: 'Plan the farm', blurb: 'Decide when each skill runs — and preview before you commit.', minutes: 5, opensWhen: 'Opens after “Combine skills”, or once you have two pets.',
    offered: (s) => ['done', 'skipped'].includes(guideStatus(s, 'routines') ?? '') || s.pets.length >= 2,
    start: (s) => {
      for (const k of ['planOpened', 'planPreviewed', 'planRowFired']) delete s.progress.flags[k];
      const p = activePet(s);
      if (!p) return;
      p.plan ??= starterPlanRows();
      p.plan.rows = p.plan.rows.filter((r) => r.id !== LESSON_ROW);
      // A new row added at the bottom — below “Otherwise wander”, which always applies.
      p.plan.rows.push({ id: LESSON_ROW, cardId: 'plan.row', args: { label: 'Check on the well', if: [], do: node('job.goto', { aim: node('kind:well'), navigator: 'Approach' }) } });
    },
    steps: [
      { id: 'open', title: 'Open the farm plan', text: 'On the Farm, press “Edit farm plan…”. These rows are the Auto rules you’ve been using all along — now yours to edit. A new row, “Check on the well”, was added at the bottom.', why: 'Rows are tried top to bottom; the first one that applies (and can do something right now) runs.', screen: 'farm', highlight: 'plan-edit', done: (s) => flag(s, 'planOpened') },
      { id: 'preview', title: 'Preview it', text: 'Press “Preview 300 ticks”. Which row never ran?', why: 'The farm is deterministic, so the preview is exactly what would happen.', screen: 'farm', highlight: 'plan-preview', done: (s) => flag(s, 'planPreviewed') },
      { id: 'move', title: 'Fix the shadowed row', text: '“Check on the well” sits below “Otherwise wander”, which always applies — so it can never run. Move it up (↑) above “Otherwise wander”.', screen: 'farm', highlight: 'plan-rows', done: (s) => rowAboveWander(s) },
      { id: 'preview-again', title: 'Preview again', text: 'Preview once more. Did “Check on the well” run? If not, the rows above it kept finding work — move it higher (↑) and preview again until it runs.', why: 'Order is priority. On a busy farm, a row low in the list may never get a turn, even with nothing wrong in it.', screen: 'farm', highlight: 'plan-preview', done: (s) => flag(s, 'planRowFired') },
      { id: 'apply', title: 'Tidy up and use the plan', text: '“Check on the well” was only an experiment (high up, it would pull your pet away from its chores). Delete it (✕), then press “Use this plan”. Your pet now follows your rows.', screen: 'farm', highlight: 'plan-apply', done: (s) => s.pets.some((p) => p.assignment.mode === 'plan' && !!p.plan && !p.plan.rows.some((r) => r.id === LESSON_ROW)) },
      { id: 'two-pets', title: 'Two pets? Split the work', text: 'Tap the house on the farm for your pets: up to 4 can be on duty. With a second pet, both can work on Auto, or one works while the other hauls the basket to the house. Measured over 1,500 ticks: one pet on Auto 161 coins, Auto + a hauler 223, both on Auto 240. Plain Harvest doesn’t replant, so keep someone on Auto, Plant or a plan with a Plant row.', why: 'Produce only earns at the house. When the basket fills up and nobody hauls it, harvests pile up beside it; a hauler keeps the farm flowing.', screen: 'farm', ack: true, done: (s) => flag(s, ackFlag('plans', 'two-pets')) },
    ],
  },
  {
    id: 'layout', title: 'Lay out the farm', blurb: 'Where things are decides how far your pets walk — try changes in preview before you pay for them.', minutes: 5, opensWhen: 'Opens once a pet has a saved Fetch skill.',
    offered: (s) => s.pets.some((p) => !!getSkill(p, 'Fetch')),
    start: (s) => { for (const k of ['layoutOpened', 'layoutBasketByBushes', 'layoutPreviewed', 'layoutCropCloser', 'layoutPreviewedCloser', 'layoutApplied']) delete s.progress.flags[k]; },
    steps: [
      { id: 'open', title: 'Open the layout', text: 'On the Farm, press “Layout…”. The farm pauses while you edit a draft.', why: 'Every harvest walks from the crop to storage or the house, and every haul walks from storage to the house. Shorter walks, more coins.', screen: 'farm', highlight: 'layout-btn', done: (s) => flag(s, 'layoutOpened') },
      { id: 'basket', title: 'Experiment: a basket by the bushes', text: 'Pick “Basket” and tap a free tile next to (or near) a berry bush.', why: 'With Fetch, harvests go to the nearest storage with room — so each harvest trip gets short.', screen: 'farm', highlight: 'layout-bin', done: (s) => flag(s, 'layoutBasketByBushes') },
      { id: 'preview', title: 'Preview it', text: 'Press “Preview half a day”. It runs the farm twice from this moment — as it is, and with your draft — with the same pets and jobs.', why: 'A second basket usually loses with one pet: it doesn’t bring the crops any closer to the house, and every basket needs its own runs. (Pets on Auto already carry a basket next to the crops and empty it at the house six at a time.)', screen: 'farm', highlight: 'layout-preview', done: (s) => flag(s, 'layoutPreviewed') },
      { id: 'closer', title: 'Bring a crop closer', text: 'Remove the basket (undoing it is free), then use “Move”: tap a berry bush or a carrot patch and tap a free tile nearer the house. Preview again.', why: 'Measured over two farm days with one pet on Auto: both bushes beside the house earned 226–309 coins vs 191–247 as they were.', screen: 'farm', highlight: 'layout-move', done: (s) => flag(s, 'layoutPreviewedCloser') },
      { id: 'apply', title: 'Keep the better farm', text: 'If your layout earned more, press “Apply layout” (you pay for what you added; moving is free). If not, keep trying — or Cancel and keep the farm as it is.', screen: 'farm', highlight: 'layout-apply', done: (s) => flag(s, 'layoutApplied') || flag(s, ackFlag('layout', 'apply')), ack: true },
      { id: 'room', title: 'Room to grow', text: 'The farm holds 8 crop plots (14 after the orchard expansion). Bushes are free to keep; field crops cost a seed each time. Fences, scarecrows and sheds go anywhere that leaves everything reachable from the house.', screen: 'farm', ack: true, done: (s) => flag(s, ackFlag('layout', 'room')) },
    ],
  },
  {
    id: 'notes', title: 'Give your pet a notebook', blurb: 'Rules can write notes (flags and counters) that the pet senses — memory for jobs with several legs.', minutes: 5, opensWhen: 'Opens after “Invent a skill”.',
    offered: (s) => ['done', 'skipped'].includes(guideStatus(s, 'invent') ?? ''),
    start: (s) => {
      const st = patrolWithoutNote();
      st.id = NOTES_STAGE;
      st.name = 'Field guide: Patrol';
      st.recipeId = 'guide';
      st.extensions = { guide: true };
      upsertStage(s, st);
      s.activeStageId = NOTES_STAGE;
      delete s.progress.guideRuns?.[NOTES_STAGE];
    },
    compare: { stage: NOTES_STAGE, rows: [{ variant: 'no-note', label: 'Can’t read the note' }, { variant: 'note', label: 'Reads the note' }], note: 'Same pen, same rules, same practice: only the Note sense changed.' },
    steps: [
      { id: 'look', title: 'A job with three legs', text: 'This pen teaches Patrol: the well, then the house, then the well again. Open Rules: each leg writes the note “leg” (1, 2, 3), and SUCCESS is “leg is at least 3”. Train it.', why: 'Rules can write notes: flags and counters that start at 0 every try. Here they count the legs.', screen: 'teach', highlight: 'train-btn', done: (s) => hasVariant(s, NOTES_STAGE, 'no-note') },
      { id: 'read', title: 'Lost at the well', text: 'It rarely finishes. Standing at the well, it can’t tell whether it’s just starting or coming back — both look the same.', why: 'A pet only knows what it senses. The rules know which leg it’s on; the pet doesn’t.', screen: 'teach', highlight: 'report-compare', ack: true, done: (s) => flag(s, ackFlag('notes', 'read')) },
      { id: 'sense', title: 'Let it read the note', text: 'In the Pet binder, press “+ sense”, pick “Note” — it’s already named “leg” — and set “Counts up to” to 2.', why: 'The Note sense reads a note your rules write: 0, 1 or 2 here (higher counts read as 2). That’s 3× the situations, and worth it.', screen: 'teach', highlight: 'senses', done: (s) => !!stage(s, NOTES_STAGE)?.learner.senses?.some((n) => n.cardId === 'sense.note' && String(n.args.name ?? '').trim() === 'leg' && Number(n.args.cap ?? 1) >= 2) },
      { id: 'retrain', title: 'Train it again', text: 'Same pen, same rules, same practice.', screen: 'teach', highlight: 'train-btn', done: (s) => hasVariant(s, NOTES_STAGE, 'note') },
      { id: 'compare', title: 'Compare', text: 'Check the comparison in the Guide.', why: 'Measured on 5 training seeds: 10–20% without the note, 70–80% with it. Notes written by rules also run on the farm, so the skill keeps track of its legs there too.', screen: 'guide', highlight: 'guide-compare', ack: true, done: (s) => flag(s, ackFlag('notes', 'compare')) },
      { id: 'save', title: 'Keep Patrol', text: 'In Teach, save the version that reads the note.', screen: 'teach', highlight: 'save-skill', done: (s) => s.pets.some((p) => !!getSkill(p, 'Patrol')?.revisions.some((r) => r.stageId === NOTES_STAGE && r.learner?.senses.some((n) => n.cardId === 'sense.note'))) },
    ],
  },
];

function upsertStage(s: GameState, st: StageSpec) {
  const i = s.stages.findIndex((x) => x.id === st.id);
  if (i >= 0) s.stages[i] = st; else s.stages.push(st);
}

export function guide(s: GameState): GuideState {
  if (!s.progress.guide) {
    // Saves from before the Field Guide: a finished old tutorial counts as Chapter 1 done.
    const done = s.progress.tutorialDone;
    s.progress.guide = { status: { first: done ? 'done' : 'active' }, active: done ? null : 'first', step: 0 };
  }
  return s.progress.guide;
}

export function guideStatus(s: GameState, id: string) {
  return guide(s).status[id];
}

export function chapterById(id: string | null): Chapter | null {
  return CHAPTERS.find((c) => c.id === id) ?? null;
}

/** Advance the active lesson, finish it when all steps are done, and offer newly relevant lessons. Returns true if anything changed. */
export function advanceTutorial(s: GameState): boolean {
  const g = guide(s);
  let moved = false;
  const ch = chapterById(g.active);
  if (ch) {
    while (g.step < ch.steps.length && ch.steps[g.step].done(s)) { g.step++; moved = true; }
    if (g.step >= ch.steps.length) {
      g.status[ch.id] = 'done';
      g.active = null;
      g.step = 0;
      addJournal(s, activePet(s)?.id ?? null, `guide-${ch.id}`, `Field Guide lesson finished: “${ch.title}”.`, ch.id === 'first');
      moved = true;
    }
  }
  for (const c of CHAPTERS) {
    if (!g.status[c.id] && c.offered(s)) { g.status[c.id] = 'offered'; moved = true; }
  }
  s.progress.tutorialDone = g.status.first === 'done' || g.status.first === 'skipped';
  s.progress.tutorialStep = g.active === 'first' ? g.step : s.progress.tutorialDone ? CHAPTERS[0].steps.length : 0;
  return moved;
}

export function startChapter(s: GameState, id: string): void {
  const g = guide(s);
  const ch = chapterById(id);
  if (!ch) return;
  if (g.active && g.active !== id && g.status[g.active] === 'active') g.status[g.active] = 'offered';
  for (const st of ch.steps) if (st.ack) delete s.progress.flags[ackFlag(id, st.id)];
  if (id === 'scatter') delete s.progress.flags.replayedMiss;
  ch.start?.(s);
  g.status[id] = 'active';
  g.active = id;
  g.step = 0;
  advanceTutorial(s);
}

export function pauseChapter(s: GameState): void {
  const g = guide(s);
  if (g.active) g.status[g.active] = 'offered';
  g.active = null;
  g.step = 0;
  advanceTutorial(s);
}

export function skipChapter(s: GameState, id: string): void {
  const g = guide(s);
  g.status[id] = 'skipped';
  if (g.active === id) { g.active = null; g.step = 0; }
  advanceTutorial(s);
}

export function ackStep(s: GameState): void {
  const g = guide(s);
  const ch = chapterById(g.active);
  const st = ch?.steps[g.step];
  if (ch && st?.ack) s.progress.flags[ackFlag(ch.id, st.id)] = true;
  advanceTutorial(s);
}

export function currentStep(s: GameState): (GuideStep & { chapter: Chapter; index: number }) | null {
  const g = guide(s);
  const ch = chapterById(g.active);
  if (!ch) return null;
  const st = ch.steps[g.step];
  return st ? { ...st, chapter: ch, index: g.step } : null;
}

/** Is this a free Field Guide lesson (no energy cost, labelled as an experiment)? */
export function isGuideStage(st: StageSpec): boolean {
  return st.id === TUT || !!(st.extensions && (st.extensions as Record<string, unknown>).guide);
}

/** Remember a finished training run in a Field Guide pen, so lessons can compare runs. */
/** Which side of a lesson's contrast a run is on. */
export function guideVariant(st: StageSpec): string | undefined {
  if (st.id === LOOPHOLE_STAGE) {
    const pay = st.rules.find((r) => isNode(r.args.when) && r.args.when.cardId === 'ev.pickup');
    return pay && isNode(pay.args.limit) && (pay.args.limit.cardId === 'lim.perObject' || pay.args.limit.cardId === 'lim.once') ? 'repaired' : 'loophole';
  }
  if (st.id === AVOID_STAGE) return 'avoid';
  if (st.id === INVENT_STAGE) return `senses:${(st.learner.senses ?? []).map((n) => n.cardId).join(',')}`;
  if (st.id === ROUTINE_STAGE) return `watch:${st.learner.routine?.watch.length ?? 0}`;
  if (st.id === NOTES_STAGE) return readsLegNote(st) ? 'note' : 'no-note';
  return undefined;
}

export function recordGuideRun(s: GameState, st: StageSpec, episodes: number, after: number, random: number, transfer: number, scattered?: number, treats?: number, variant?: string): void {
  if (!isGuideStage(st)) return;
  const all = (s.progress.guideRuns ??= {});
  const list = (all[st.id] ??= []);
  const v = variant ?? guideVariant(st);
  list.push({ episodes, after, random, transfer, pinned: isPinned(st), at: Date.now(), ...(scattered !== undefined ? { scattered } : {}), ...(treats !== undefined ? { treats } : {}), ...(v ? { variant: v } : {}) });
  if (list.length > 8) list.shift();
}

/** For the Guide's comparison card. */
export function guideComparison(s: GameState, chapter: string): { label: string; run: GuideRun }[] {
  if (chapter === 'practice') {
    const r = runs(s, PRACTICE_STAGE);
    const short = [...r].reverse().find((x) => x.episodes <= 400), long = [...r].reverse().find((x) => x.episodes >= 1200);
    return [short && { label: `${short.episodes} tries`, run: short }, long && { label: `${long.episodes} tries`, run: long }].filter(Boolean) as { label: string; run: GuideRun }[];
  }
  if (chapter === 'scatter') {
    const r = runs(s, PINNED_STAGE);
    const pinned = [...r].reverse().find((x) => x.pinned), scattered = [...r].reverse().find((x) => !x.pinned);
    // Judge both on layouts where the berry moves: the pinned run's honest score is its "scattered" one.
    return [pinned && { label: 'Pinned pen', run: { ...pinned, after: pinned.scattered ?? pinned.after } }, scattered && { label: 'Scattered pen', run: scattered }].filter(Boolean) as { label: string; run: GuideRun }[];
  }
  const ch = chapterById(chapter);
  if (!ch?.compare) return [];
  const r = runs(s, ch.compare.stage);
  if (chapter === 'routines') {
    const two = lastVariantRun(s, ROUTINE_STAGE, 'watch:2');
    const more = [...r].reverse().find((x) => Number((x.variant ?? 'watch:0').slice(6)) >= 3);
    return [two && { label: 'Watching 2 things', run: two }, more && { label: `Watching ${(more.variant ?? '').slice(6)} (+ at the basket)`, run: more }].filter(Boolean) as { label: string; run: GuideRun }[];
  }
  if (chapter === 'invent') {
    // First run = lean; latest run with different senses = the experiment.
    const first = r[0], latest = [...r].reverse().find((x) => x.variant !== first?.variant);
    return [first && { label: 'Lean senses', run: first }, latest && { label: 'With the extra sense', run: latest }].filter(Boolean) as { label: string; run: GuideRun }[];
  }
  return ch.compare.rows.map((row) => { const run = lastVariantRun(s, ch.compare!.stage, row.variant); return run && { label: row.label, run }; }).filter(Boolean) as { label: string; run: GuideRun }[];
}

/** Lesson 5 action: test the pet's current Approach in the pond pen (no training). */
export function testApproachHere(s: GameState): void {
  const p = activePet(s);
  const st = stage(s, AVOID_STAGE);
  const rev = p && getSkill(p, 'Approach')?.revisions.find((r) => r.rev === getSkill(p, 'Approach')!.activeRev);
  if (!p || !st || !rev) return;
  const seeds = heldOutSeeds(st);
  const r = evaluate(st, policySpecFor(st, rev.policy, null, undefined, rev.learner), seeds, 'evaluation', p.traits, 1);
  const random = evaluate(st, { kind: 'random' }, seeds, 'baseline', p.traits, 0);
  recordGuideRun(s, st, 0, r.successRate, random.successRate, r.successRate, undefined, r.meanReward, 'approach');
  addJournal(s, p.id, 'guide-approach-ponds', `${p.name}'s Approach was tested in a pen with ponds: ${r.successes}/${r.episodes} reached the berry dry.`);
}

/** Notes lesson: does the skill sense the note “leg”? */
function readsLegNote(st: StageSpec | undefined): boolean {
  return !!st?.learner.senses?.some((n) => n.cardId === 'sense.note' && String(n.args.name ?? '').trim() === 'leg');
}

function starterPlanRows() {
  return starterPlan();
}

/** Plans lesson: is the lesson row above the first always-on (no conditions) wander row? */
function rowAboveWander(s: GameState): boolean {
  const p = activePet(s);
  const rows = p?.plan?.rows ?? [];
  const i = rows.findIndex((r) => r.id === LESSON_ROW);
  const w = rows.findIndex((r) => isNode(r.args.do) && r.args.do.cardId === 'job.wander' && !(Array.isArray(r.args.if) && r.args.if.length));
  return i >= 0 && (w < 0 || i < w);
}
