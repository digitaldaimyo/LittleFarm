/// <reference lib="webworker" />
import { TrainingLoop, type ToWorker } from './session';

let loop: TrainingLoop | null = null;
self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'start') {
    loop = new TrainingLoop(m.cfg, m.speed, (msg) => (self as unknown as Worker).postMessage(msg));
    void loop.run();
  } else loop?.handle(m);
};
