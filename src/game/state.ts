import type { StageSpec } from '../domain/types';
import { buildTutorialStage } from '../domain/recipes';
import { createFarm } from './farm';
import { SAVE_VERSION, type GameState, type Pet } from './types';

export function newGame(): GameState {
  const tut = buildTutorialStage();
  tut.id = 'stage-tutorial';
  tut.name = 'First lesson: Go to the berry';
  return {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { reducedMotion: 'system', sound: false, farmSpeed: 1, trainSpeed: 'normal', showExpert: false },
    progress: { tutorialStep: 0, tutorialDone: false, unlocks: [], totalCoins: 0, flags: {}, guide: { status: { first: 'active' }, active: 'first', step: 0 } },
    resources: { coins: 0, berries: 0, carrots: 0 },
    pets: [],
    activePetId: null,
    farm: createFarm(),
    stages: [tut],
    activeStageId: tut.id,
    stageHistory: {},
    templates: [],
    journal: [],
    recentCards: [],
    favorites: [],
    purchases: [],
  };
}

/** Training costs energy (it's tiring!). Naps refill it. */
export function trainingCost(stage: StageSpec): number {
  if (stage.id === 'stage-tutorial' || (stage.extensions as Record<string, unknown> | undefined)?.guide) return 0; // Field Guide lessons are free
  return stage.learner.skill === 'Avoid' ? 20 : 15;
}

export function canTrain(p: Pet, stage: StageSpec): { ok: boolean; reason?: string } {
  const cost = trainingCost(stage);
  if (p.energy < cost) return { ok: false, reason: `${p.name} is sleepy (${Math.round(p.energy)} energy, lessons cost ${cost}). Let them nap on the farm or buy a snack.` };
  return { ok: true };
}

/** Record the current stage spec for undo/rollback before a change. */
export function snapshotStage(s: GameState, stage: StageSpec): void {
  const h = (s.stageHistory[stage.id] ??= []);
  h.push(structuredClone(stage));
  if (h.length > 15) h.shift();
}

export function undoStage(s: GameState, stageId: string): boolean {
  const h = s.stageHistory[stageId];
  const prev = h?.pop();
  if (!prev) return false;
  const i = s.stages.findIndex((x) => x.id === stageId);
  if (i < 0) return false;
  s.stages[i] = prev;
  return true;
}
