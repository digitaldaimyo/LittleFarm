import { describe, expect, it } from 'vitest';
import { TrainingLoop, type FromWorker } from '../src/learning/session';
import { recipeStage } from '../src/domain/recipes';
import { DEFAULT_TRAITS } from '../src/learning/episodes';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('training loop (worker protocol)', () => {
  it('can be paused, resumed and completes with a report from separate evaluation seeds', async () => {
    const msgs: FromWorker[] = [];
    const stage = recipeStage('go-to-berry');
    const loop = new TrainingLoop({ stage, episodes: 1500, traits: DEFAULT_TRAITS }, 'normal', (m) => msgs.push(m));
    const run = loop.run();
    await sleep(60);
    loop.handle({ type: 'pause' });
    await sleep(100);
    const n = msgs.filter((m) => m.type === 'progress').length;
    await sleep(200);
    expect(msgs.filter((m) => m.type === 'progress').length).toBe(n);
    loop.handle({ type: 'speed', speed: 'fast' });
    loop.handle({ type: 'resume' });
    await run;
    const done = msgs.find((m) => m.type === 'done');
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.report.after.successRate).toBeGreaterThan(done.report.random.successRate);
      expect(done.report.evalSeeds.every((s) => s >= 900000)).toBe(true);
    }
  });

  it('can be cancelled', async () => {
    const msgs: FromWorker[] = [];
    const loop = new TrainingLoop({ stage: recipeStage('avoid-pond'), episodes: 8000, traits: DEFAULT_TRAITS }, 'watch', (m) => msgs.push(m));
    const run = loop.run();
    await sleep(150);
    loop.handle({ type: 'cancel' });
    await run;
    expect(msgs.at(-1)?.type).toBe('cancelled');
    expect(msgs.some((m) => m.type === 'done')).toBe(false);
  });
});
