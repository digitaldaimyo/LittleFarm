/**
 * Benchmark: trains each starter skill from scratch under several training seeds and reports
 * held-out success for random / untrained / learned policies, transfer, and wall-clock time.
 * Run: npm run bench
 */
import os from 'node:os';
import { recipeStage } from '../src/domain/recipes';
import type { StageSpec } from '../src/domain/types';
import { Trainer } from '../src/learning/trainer';
import { buildReport } from '../src/learning/report';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import type { SerializedQ } from '../src/learning/qtable';

const SEEDS = [101, 202, 303, 404, 505];

function train(stage: StageSpec, navigator?: SerializedQ) {
  const t0 = performance.now();
  const t = new Trainer({ stage, episodes: stage.learner.episodes, traits: DEFAULT_TRAITS, navigator });
  while (!t.done) t.runChunk(500, false);
  return { q: t.policy(), ms: performance.now() - t0 };
}

const fmt = (x: number) => `${Math.round(x * 100)}%`.padStart(5);
console.log(`Pen Deck benchmark — ${os.cpus()[0]?.model ?? 'unknown CPU'} (${os.cpus().length} threads), Node ${process.version}`);
console.log('Held-out success on 20 unseen layouts per run; transfer = 10 bigger unseen pens.\n');
console.log('skill     seed  tries  random  untrained  learned  transfer  train-ms  exploit?');
const rows: Record<string, number[]> = {};
for (const seed of SEEDS) {
  const ap = { ...recipeStage('go-to-berry'), seed };
  const a = train(ap);
  const jobs: [string, StageSpec, SerializedQ | undefined][] = [
    ['Approach', ap, undefined],
    ['Avoid', { ...recipeStage('avoid-pond'), seed }, undefined],
    ['Fetch', { ...recipeStage('bring-it-home'), seed }, a.q],
    ['Loophole', { ...recipeStage('pay-per-pickup'), seed }, a.q],
    ['Wait*', { ...recipeStage('wait-for-it'), seed }, undefined],
    ['Clear*', { ...recipeStage('keep-clear'), seed }, undefined],
    ['Water*', { ...recipeStage('water-garden'), seed }, undefined],
  ];
  for (const [name, stage, nav] of jobs) {
    const res = name === 'Approach' ? a : train(stage, nav);
    const r = buildReport(stage, DEFAULT_TRAITS, null, res.q, nav ?? null);
    (rows[name] ??= []).push(r.after.successRate);
    console.log(`${name.padEnd(9)} ${String(seed).padStart(4)}  ${String(stage.learner.episodes).padStart(5)}  ${fmt(r.random.successRate)}   ${fmt(r.before.successRate)}     ${fmt(r.after.successRate)}    ${fmt(r.transfer.successRate)}   ${String(Math.round(res.ms)).padStart(7)}  ${r.exploits.length ? 'yes' : 'no'}`);
  }
}
console.log('\nMean held-out success across seeds:');
console.log('(* = player-style skill built only from cards: custom senses, abilities and rules)');
for (const [k, v] of Object.entries(rows)) console.log(`  ${k.padEnd(9)} ${fmt(v.reduce((a, b) => a + b, 0) / v.length)}  (min ${fmt(Math.min(...v))})`);
