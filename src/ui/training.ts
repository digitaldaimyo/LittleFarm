import type { StageSpec } from '../domain/types';
import type { FromWorker, ToWorker, TrainSpeed } from '../learning/session';
import { TrainingLoop } from '../learning/session';
import type { TrainProgress } from '../learning/trainer';
import type { TrainingReport } from '../learning/report';
import type { SerializedQ } from '../learning/qtable';
import type { EpisodeTrace } from '../learning/episodes';
import type { NavigatorName, Pet } from '../game/types';
import { activeRevision, getSkill, navPolicyFor } from '../game/pets';
import { store } from './store';
import { trainingCost } from '../game/state';
import { addJournal } from '../game/journal';

export interface TrainingSessionState {
  petId: string;
  stage: StageSpec;
  status: 'running' | 'paused' | 'evaluating' | 'done' | 'cancelled' | 'error';
  speed: TrainSpeed;
  progress: TrainProgress | null;
  report: TrainingReport | null;
  policy: SerializedQ | null;
  resumedFrom: number | null;
  navigator: { skill: NavigatorName; rev: number } | null;
  ms: number;
  error?: string;
  /** Trace currently shown in the pen (training sample, eval or replay). */
  replay: EpisodeTrace | null;
  saved: boolean;
  startedAt: number;
}

let worker: Worker | null = null;

function createTrainingWorker(): Worker {
  return new Worker(new URL('../learning/trainer.worker.ts', import.meta.url), { type: 'module' });
}

/** Load the worker script once at startup so it's cached for offline play. */
export function warmTrainingWorker(): void {
  try {
    const w = createTrainingWorker();
    setTimeout(() => w.terminate(), 3000);
  } catch {
    /* workers unavailable — inline fallback will be used */
  }
}
let inline: TrainingLoop | null = null;

function send(m: ToWorker) {
  if (worker) worker.postMessage(m);
  else inline?.handle(m);
}

function onMessage(m: FromWorker) {
  const t = store.ui.training;
  if (!t) return;
  if (m.type === 'progress') {
    t.progress = m.progress;
    if (m.progress.sample) t.replay = m.progress.sample;
  } else if (m.type === 'evaluating') {
    t.status = 'evaluating';
  } else if (m.type === 'done') {
    t.status = 'done';
    t.progress = m.progress;
    t.report = m.report;
    t.policy = m.policy;
    t.ms = m.ms;
    t.replay = m.report.after.traces[0] ?? null;
    finishWorker();
    store.mutate((s) => {
      const pet = s.pets.find((p) => p.id === t.petId);
      if (pet) {
        pet.stats.trainingRuns++;
        pet.stats.episodes += m.progress.episode;
        const r = m.report.after;
        addJournal(s, pet.id, 'training', `${pet.name} practised “${t.stage.name}” ${m.progress.episode} times. On ${r.episodes} new layouts: ${r.successes} successes (before: ${m.report.before.successes}).`);
        for (const e of m.report.exploits) addJournal(s, pet.id, 'exploit', `${pet.name} discovered a loophole in “${t.stage.name}”: ${e.diagnostic.message}`, true);
      }
    });
    return;
  } else if (m.type === 'cancelled') {
    t.status = 'cancelled';
    t.progress = m.progress;
    finishWorker();
  } else if (m.type === 'error') {
    t.status = 'error';
    t.error = m.message;
    finishWorker();
  }
  store.emit();
}

function finishWorker() {
  worker?.terminate();
  worker = null;
  inline = null;
}

export function startTraining(pet: Pet, stage: StageSpec, opts: { resume: boolean }): string | null {
  if (store.ui.training && (store.ui.training.status === 'running' || store.ui.training.status === 'paused' || store.ui.training.status === 'evaluating')) return 'Training already running.';
  const skill = getSkill(pet, stage.learner.skill);
  const current = activeRevision(skill);
  let navigator: TrainingSessionState['navigator'] = null;
  let navPolicy: SerializedQ | null = null;
  if (stage.learner.skill === 'Fetch') {
    const nav = navPolicyFor(pet, stage.learner.navigator ?? 'Approach');
    if (!nav) return `Fetch reuses a movement skill. Teach ${pet.name} Approach first.`;
    navigator = { skill: nav.skill.name as NavigatorName, rev: nav.rev.rev };
    navPolicy = nav.rev.policy;
  }
  const cost = trainingCost(stage);
  const prevSession = store.ui.training;
  const unsaved = opts.resume && prevSession?.policy && !prevSession.saved && prevSession.stage.id === stage.id && prevSession.petId === pet.id ? prevSession.policy : null;
  const resumeFrom = opts.resume && current && !unsaved ? current : null;
  const cfg = {
    stage: structuredClone(stage),
    episodes: stage.learner.episodes,
    traits: { ...pet.traits },
    feedback: pet.feedback[stage.id] ?? {},
    initial: unsaved ?? resumeFrom?.policy ?? null,
    navigator: navPolicy,
    seedOffset: resumeFrom || unsaved ? pet.stats.episodes + 17 : 0,
  };
  store.mutate((s) => {
    const p = s.pets.find((x) => x.id === pet.id);
    if (p) p.energy = Math.max(0, p.energy - cost);
  });
  const speed = store.state.settings.trainSpeed;
  store.ui.training = {
    petId: pet.id, stage: cfg.stage, status: 'running', speed, progress: null, report: null, policy: null,
    resumedFrom: resumeFrom?.rev ?? null, navigator, ms: 0, replay: null, saved: false, startedAt: Date.now(),
  };
  const runInline = () => {
    // Fallback: same loop on the main thread, chunked with timeouts so the UI stays responsive.
    worker?.terminate();
    worker = null;
    inline = new TrainingLoop(cfg, store.ui.training?.speed ?? speed, onMessage);
    void inline.run();
  };
  try {
    worker = createTrainingWorker();
    let heard = false;
    worker.onmessage = (e: MessageEvent<FromWorker>) => { heard = true; onMessage(e.data); };
    worker.onerror = (e) => {
      e.preventDefault?.();
      if (!heard) runInline();
      else onMessage({ type: 'error', message: e.message || 'Training worker failed.' });
    };
    worker.postMessage({ type: 'start', cfg, speed } satisfies ToWorker);
  } catch {
    runInline();
  }
  store.emit();
  return null;
}

export function pauseTraining() {
  const t = store.ui.training;
  if (!t || t.status !== 'running') return;
  send({ type: 'pause' });
  t.status = 'paused';
  store.emit();
}
export function resumeTraining() {
  const t = store.ui.training;
  if (!t || t.status !== 'paused') return;
  send({ type: 'resume' });
  t.status = 'running';
  store.emit();
}
export function cancelTraining() {
  send({ type: 'cancel' });
}
export function setTrainingSpeed(speed: TrainSpeed) {
  send({ type: 'speed', speed });
  if (store.ui.training) store.ui.training.speed = speed;
  store.state.settings.trainSpeed = speed;
  store.emit();
}
export function closeTraining() {
  finishWorker();
  store.ui.training = null;
  store.emit();
}
