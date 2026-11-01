import type { GameState } from './types';
import { activePet, getSkill } from './pets';
import { placedKinds } from '../domain/spec';

export interface TutorialStep {
  id: string;
  title: string;
  text: string;
  /** Screen the player should be on. */
  screen?: 'farm' | 'teach' | 'pets';
  done: (s: GameState) => boolean;
}

const tutStage = (s: GameState) => s.stages.find((x) => x.id === 'stage-tutorial');

export const TUTORIAL: TutorialStep[] = [
  { id: 'adopt', title: 'Adopt a pet', text: 'Every trainer needs a trainee. Pick a name and colours.', done: (s) => s.pets.length > 0 },
  { id: 'open-pen', title: 'Open the training pen', text: 'Tap “Teach” to open the pen. It’s where your pet practises.', screen: 'teach', done: (s) => !!s.progress.flags.visitedTeach },
  { id: 'place-berry', title: 'Put a berry in the pen', text: 'In the Environment binder, pick the Berry card and tap a tile. “Scatter” moves it every try, so the lesson works anywhere.', screen: 'teach', done: (s) => { const t = tutStage(s); return !!t && placedKinds(t).has('berry'); } },
  { id: 'rules', title: 'Choose what earns a treat', text: 'Open the Rules binder and tap the suggested recipe “Treat for reaching the berry”.', screen: 'teach', done: (s) => { const t = tutStage(s); return !!t && t.rules.length > 0 && !!t.success; } },
  { id: 'train', title: 'Train Approach', text: 'Press Train. Your pet really practises — hundreds of tries, learning from treats. Watch the success line climb.', screen: 'teach', done: (s) => (activePet(s)?.stats.trainingRuns ?? 0) > 0 },
  { id: 'observe', title: 'Compare before and after', text: 'The report tests your pet on 20 layouts it never trained on. Compare “before” with “after”.', screen: 'teach', done: (s) => !!s.progress.flags.sawReport },
  { id: 'save', title: 'Save the skill', text: 'Press “Save skill” to keep this version of Approach in your pet’s repertoire.', screen: 'teach', done: (s) => { const p = activePet(s); return !!p && !!getSkill(p, 'Approach'); } },
  { id: 'assign', title: 'Put it to work', text: 'Back on the Farm, pick the “Forage berries” job card. Your pet will use the Approach it just learned.', screen: 'farm', done: (s) => !!s.progress.flags.assignedJob },
  { id: 'earn', title: 'Earn 5 coins', text: 'Each berry gathered sells for 1 coin. Five coins (with a certified Approach) unlocks Fetch lessons.', screen: 'farm', done: (s) => s.progress.unlocks.includes('fetch') },
];

export function advanceTutorial(s: GameState): boolean {
  if (s.progress.tutorialDone) return false;
  let moved = false;
  while (s.progress.tutorialStep < TUTORIAL.length && TUTORIAL[s.progress.tutorialStep].done(s)) {
    s.progress.tutorialStep++;
    moved = true;
  }
  if (s.progress.tutorialStep >= TUTORIAL.length) s.progress.tutorialDone = true;
  return moved;
}

export function currentStep(s: GameState): TutorialStep | null {
  if (s.progress.tutorialDone) return null;
  return TUTORIAL[s.progress.tutorialStep] ?? null;
}
