/**
 * Farm baseline (learned-farm roadmap, phase 0): today's controllers — Auto (rules), Auto (learned), the
 * starter plan, a fixed Harvest job and two pets — on the standard farm and a held-out layout, over three
 * training seeds and two farm days. Later phases must reach ≥ 80% of these numbers with learned jobs.
 * Run: npm run bench:farm   (writes bench/farm-baseline.json)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { newGame } from '../src/game/state';
import { activeRevision, adoptPet, getSkill } from '../src/game/pets';
import { createRuntime, farmTick, setOnDuty, type FarmRuntime } from '../src/game/farm';
import { starterPlan } from '../src/game/plan';
import { startLayout, move, place, applyLayout } from '../src/game/layout';
import { recipeStage } from '../src/domain/recipes';
import type { GameState, Pet } from '../src/game/types';
import { DEFAULT_TRAITS } from '../src/learning/episodes';
import { trainAndSave } from '../tests/helpers';

const SEEDS = [101, 202, 303];
const TICKS = 2400; // two farm days
type Setup = 'auto-rules' | 'auto-learned' | 'starter-plan' | 'harvest-job' | 'two-pets';
const SETUPS: Setup[] = ['auto-rules', 'auto-learned', 'starter-plan', 'harvest-job', 'two-pets'];

function skilledPet(g: GameState, name: string, seed: number): Pet {
  const p = adoptPet(g, name, 'meadow');
  p.traits = { ...DEFAULT_TRAITS };
  const st = recipeStage('go-to-berry'); st.seed = seed;
  trainAndSave(g, p, st);
  const fe = recipeStage('bring-it-home'); fe.seed = seed;
  trainAndSave(g, p, fe, activeRevision(getSkill(p, 'Approach'))!.policy);
  return p;
}

/** A held-out farm: the bushes and carrots moved and two more carrot plots (a layout no measurement used before). */
function heldOut(g: GameState) {
  g.resources.coins += 20;
  const d = startLayout(g);
  move(d, 9, 1, 7, 5); move(d, 10, 5, 2, 5);
  move(d, 2, 7, 6, 8); place(g, d, 'carrot', 8, 8); place(g, d, 'carrot', 10, 7);
  applyLayout(g, d);
  g.resources.coins -= 20; // the layout is free here: keep the starting purse comparable
}

function run(setup: Setup, seed: number, layout: 'standard' | 'held-out') {
  const g = newGame();
  const a = skilledPet(g, 'Pip', seed);
  g.progress.unlocks.push('fetch', 'carrots');
  g.resources.coins = 30;
  g.farm.dutyPetId = a.id;
  a.assignment = { mode: 'auto', job: 'forage', navigator: 'Approach' };
  if (setup === 'auto-learned') a.executive.mode = 'learned';
  if (setup === 'starter-plan') { a.plan = starterPlan(); a.assignment.mode = 'plan'; }
  if (setup === 'harvest-job') a.assignment = { mode: 'job', job: 'forage', navigator: 'Approach' };
  if (setup === 'two-pets') {
    const b = skilledPet(g, 'Mochi', seed);
    b.assignment = { mode: 'job', job: 'deliver', navigator: 'Approach' };
    setOnDuty(g, b.id, true);
  }
  if (layout === 'held-out') heldOut(g);
  const rt: FarmRuntime = createRuntime(g.farm);
  rt.stats = {};
  const c0 = g.progress.totalCoins, sold0 = g.farm.world.sold ?? 0;
  let restTicks = 0, idle = 0;
  const t0 = performance.now();
  for (let t = 0; t < TICKS; t++) {
    farmTick(g, rt);
    const b = g.farm.current?.behaviorId;
    if (b === 'rest') restTicks++;
    if (!b || b === 'wander') idle++;
  }
  const ms = (performance.now() - t0) / TICKS;
  const jobs = Object.values(rt.stats).reduce((x, j) => ({ started: x.started + j.started, ok: x.ok + j.ok, fail: x.fail + j.fail, timeout: x.timeout + j.timeout }), { started: 0, ok: 0, fail: 0, timeout: 0 });
  return {
    setup, seed, layout,
    coins: g.progress.totalCoins - c0,
    sold: (g.farm.world.sold ?? 0) - sold0,
    jobs: jobs.started, ok: jobs.ok, fail: jobs.fail, timeouts: jobs.timeout,
    switchesPerMin: Math.round((jobs.started * 214 / TICKS) * 10) / 10,
    restShare: Math.round((100 * restTicks) / TICKS),
    idleShare: Math.round((100 * idle) / TICKS),
    msPerTick: Math.round(ms * 1000) / 1000,
    byJob: rt.stats,
  };
}

const rows = [];
console.log(`Farm baseline — ${TICKS} ticks, seeds ${SEEDS.join('/')}\n`);
console.log('setup          layout    coins (per seed)     sold  jobs  ok%  timeouts  switch/min  rest%  idle%  ms/tick');
for (const layout of ['standard', 'held-out'] as const) for (const setup of SETUPS) {
  const r = SEEDS.map((seed) => run(setup, seed, layout));
  rows.push(...r);
  const sum = (k: 'sold' | 'jobs' | 'ok' | 'timeouts') => r.reduce((a, x) => a + x[k], 0);
  const avg = (k: 'switchesPerMin' | 'restShare' | 'idleShare') => Math.round((r.reduce((a, x) => a + x[k], 0) / r.length) * 10) / 10;
  console.log(`${setup.padEnd(14)} ${layout.padEnd(9)} ${r.map((x) => String(x.coins).padStart(4)).join(' /').padEnd(20)} ${String(sum('sold')).padStart(5)} ${String(sum('jobs')).padStart(5)} ${String(Math.round((100 * sum('ok')) / Math.max(1, sum('jobs')))).padStart(4)} ${String(sum('timeouts')).padStart(9)} ${String(avg('switchesPerMin')).padStart(11)} ${String(avg('restShare')).padStart(6)} ${String(avg('idleShare')).padStart(6)} ${Math.max(...r.map((x) => x.msPerTick)).toFixed(3).padStart(8)}`);
}
mkdirSync('bench', { recursive: true });
writeFileSync('bench/farm-baseline.json', JSON.stringify({ ticks: TICKS, seeds: SEEDS, rows }, null, 1));
console.log('\nWrote bench/farm-baseline.json');
