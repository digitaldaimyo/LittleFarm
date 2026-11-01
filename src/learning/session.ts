import type { TrainConfig, TrainProgress } from './trainer';
import { Trainer } from './trainer';
import { buildReport, type TrainingReport } from './report';
import type { SerializedQ } from './qtable';

export type TrainSpeed = 'watch' | 'normal' | 'fast';

export const SPEEDS: Record<TrainSpeed, { chunk: number; delay: number; label: string }> = {
  watch: { chunk: 4, delay: 110, label: 'Watch' },
  normal: { chunk: 20, delay: 35, label: 'Normal' },
  fast: { chunk: 250, delay: 0, label: 'Fast' },
};

export type ToWorker =
  | { type: 'start'; cfg: TrainConfig; speed: TrainSpeed }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' }
  | { type: 'speed'; speed: TrainSpeed };

export type FromWorker =
  | { type: 'progress'; progress: TrainProgress }
  | { type: 'evaluating' }
  | { type: 'done'; progress: TrainProgress; policy: SerializedQ; report: TrainingReport; ms: number }
  | { type: 'cancelled'; progress: TrainProgress }
  | { type: 'error'; message: string };

/**
 * The training loop shared by the Web Worker and the inline fallback.
 * Chunked so pause / cancel / speed changes are honoured between chunks,
 * and progress messages are throttled.
 */
export class TrainingLoop {
  private paused = false;
  private cancelled = false;
  private speed: TrainSpeed;
  constructor(private cfg: TrainConfig, speed: TrainSpeed, private post: (m: FromWorker) => void) {
    this.speed = speed;
  }
  handle(m: ToWorker): void {
    if (m.type === 'pause') this.paused = true;
    else if (m.type === 'resume') this.paused = false;
    else if (m.type === 'cancel') this.cancelled = true;
    else if (m.type === 'speed') this.speed = m.speed;
  }
  async run(): Promise<void> {
    const t0 = performance.now();
    let active = 0;
    try {
      const trainer = new Trainer(this.cfg);
      let lastPost = 0;
      while (!trainer.done) {
        if (this.cancelled) return this.post({ type: 'cancelled', progress: trainer.progress() });
        if (this.paused) {
          await sleep(80);
          continue;
        }
        const sp = SPEEDS[this.speed];
        const a = performance.now();
        const p = trainer.runChunk(sp.chunk, true);
        active += performance.now() - a;
        const now = performance.now();
        if (now - lastPost > 60 || trainer.done || sp.delay >= 60) {
          this.post({ type: 'progress', progress: p });
          lastPost = now;
        }
        await sleep(sp.delay);
      }
      this.post({ type: 'evaluating' });
      await sleep(0);
      const policy = trainer.policy();
      const report = buildReport(this.cfg.stage, this.cfg.traits, this.cfg.initial ?? null, policy, this.cfg.navigator ?? null);
      void t0;
      this.post({ type: 'done', progress: trainer.progress(), policy, report, ms: Math.round(active) });
    } catch (e) {
      this.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
