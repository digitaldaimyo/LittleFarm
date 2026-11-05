/// <reference lib="webworker" />
import { runExecPractice, type ToExecWorker } from './execpractice';

let stop = false;
self.onmessage = (e: MessageEvent<ToExecWorker>) => {
  const m = e.data;
  if (m.type === 'cancel') { stop = true; return; }
  stop = false;
  void runExecPractice(m.job, (msg) => (self as unknown as Worker).postMessage(msg), () => stop, () => new Promise((r) => setTimeout(r, 0)));
};
