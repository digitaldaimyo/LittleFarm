import type { GameState } from './types';
import type { SpecNode, StageSpec } from '../domain/types';
import { activePet, getSkill } from './pets';
import { isNode, node, placedKinds } from '../domain/spec';
import { buildTutorialStage, recipeStage } from '../domain/recipes';
import { addJournal } from './journal';

/**
 * The Field Guide: Chapter 1 (the first lesson, always on for new games) plus short lessons that are
 * *offered* when they become useful. Each lesson teaches one idea, often by trying it the wrong way first
 * (an "experiment": free, never auto-saved) and comparing the player's own numbers.
 */
export type GuideScreen = 'farm' | 'teach' | 'pets' | 'guide';

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
}

export interface Chapter {
  id: string;
  title: string;
  blurb: string;
  minutes: number;
  /** When the lesson is offered (Chapter 1 is active from the start). */
  offered: (s: GameState) => boolean;
  /** Prepare the lesson (e.g. create its practice pen). */
  start?: (s: GameState) => void;
  steps: GuideStep[];
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
const TUT = 'stage-tutorial';
export const PRACTICE_STAGE = 'stage-guide-practice';
export const PINNED_STAGE = 'stage-guide-pinned';

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
      { id: 'assign', title: 'Put it to work', text: 'On the Farm, pick the “Forage berries” job.', why: 'Skills are for the farm. Forage uses the Approach you just taught to walk to ripe berries.', screen: 'farm', highlight: 'job-forage', done: (s) => flag(s, 'assignedJob') },
      { id: 'earn', title: 'Earn 5 coins', text: 'Each berry sells for 1 coin. Five coins unlocks Fetch lessons — and the Field Guide has more lessons waiting.', screen: 'farm', done: (s) => s.progress.unlocks.includes('fetch') },
    ],
  },
  {
    id: 'practice', title: 'Read the report: practice', blurb: 'Why a lesson can look broken when it just needs more practice.', minutes: 3,
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
    id: 'scatter', title: 'Scatter, don’t pin', blurb: 'Why pinned objects teach one layout instead of a skill.', minutes: 4,
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
export function recordGuideRun(s: GameState, st: StageSpec, episodes: number, after: number, random: number, transfer: number, scattered?: number): void {
  if (!isGuideStage(st)) return;
  const all = (s.progress.guideRuns ??= {});
  const list = (all[st.id] ??= []);
  list.push({ episodes, after, random, transfer, pinned: isPinned(st), at: Date.now(), ...(scattered !== undefined ? { scattered } : {}) });
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
  return [];
}
