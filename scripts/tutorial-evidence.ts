/**
 * Evidence for docs/history/TUTORIAL_PLAN.md: what makes training pens work in Pen Deck.
 * Trains under 3 seeds and tests on 30 held-out scattered layouts. Run: npm run evidence
 */
import { recipeStage, evalSeeds } from '../src/domain/recipes';
import { Trainer } from '../src/learning/trainer';
import { evaluate, DEFAULT_TRAITS } from '../src/learning/episodes';
import { policySpecFor } from '../src/learning/report';
import { node } from '../src/domain/spec';
import { validateStage } from '../src/domain/validate';
import type { StageSpec } from '../src/domain/types';
const SEEDS = [101, 202, 303];
function run(name: string, train: (seed: number) => StageSpec, test: StageSpec, eps?: number) {
  const out: string[] = [];
  let sum = 0, ticks = 0;
  for (const seed of SEEDS) {
    const st = train(seed); if (eps) st.learner.episodes = eps;
    const t = new Trainer({ stage: st, episodes: st.learner.episodes, traits: DEFAULT_TRAITS });
    while (!t.done) t.runChunk(1000, false);
    const r = evaluate(test, policySpecFor(test, t.policy(), null), evalSeeds(30), 'evaluation', DEFAULT_TRAITS, 0);
    sum += r.successRate; ticks += r.meanTicks; out.push(`${Math.round(r.successRate * 100)}%`);
  }
  console.log(`${name.padEnd(46)} ${(Math.round((sum / SEEDS.length) * 100) + '%').padStart(5)}  (${out.join(' ')})  ~${Math.round(ticks / SEEDS.length)} steps`);
}
const base = (seed: number) => ({ ...recipeStage('go-to-berry'), seed });
const scatterTest = recipeStage('go-to-berry');
console.log('Evaluated on 30 held-out scattered layouts, 3 training seeds\n');
console.log('A. Where things are placed');
run('Scatter berry + random start (default)', base, scatterTest);
run('Berry fixed at (5,5), pet fixed at (1,1)', (seed) => { const s = base(seed); s.environment = [node('place.pet', { mode: 'fixed', x: 1, y: 1 }), node('place.fixed', { kind: node('kind:berry'), x: 5, y: 5 }), node('place.random', { kind: node('kind:rock'), count: 3 })]; return s; }, scatterTest);
run('Berry fixed, pet random', (seed) => { const s = base(seed); s.environment = [node('place.pet', { mode: 'random' }), node('place.fixed', { kind: node('kind:berry'), x: 5, y: 5 }), node('place.random', { kind: node('kind:rock'), count: 3 })]; return s; }, scatterTest);
run('Everything pinned (pet 0,0 / berry 7,7 / 3 fixed rocks)', (seed) => { const s = base(seed); s.environment = [node('place.pet', { mode: 'fixed', x: 0, y: 0 }), node('place.fixed', { kind: node('kind:berry'), x: 7, y: 7 }), node('place.fixed', { kind: node('kind:rock'), x: 3, y: 3 }), node('place.fixed', { kind: node('kind:rock'), x: 5, y: 2 }), node('place.fixed', { kind: node('kind:rock'), x: 2, y: 6 })]; return s; }, scatterTest);
console.log('\nB. Rewards');
run('Treat at berry + small nudge each step (default)', base, scatterTest);
run('Treat at berry only, no nudge', (seed) => { const s = base(seed); s.rules = s.rules.slice(0, 1); return s; }, scatterTest);
run('Nudge only, no treat at berry', (seed) => { const s = base(seed); s.rules = s.rules.slice(1); return s; }, scatterTest);
const closer = (seed: number) => { const s = base(seed); s.rules = [s.rules[0], node('rule', { label: 'Closer', when: node('ev.tick'), if: [node('cond.closer', { actor: node('actor.pet'), what: node('kind:berry') })], then: [node('eff.reward', { amount: 0.5 })] })]; return s; };
console.log('   warnings for closer-only shaping:', validateStage(closer(1)).filter(d => d.severity !== 'info').map(d => d.code).join(', '));
run('E. Treat at berry + paid for getting closer only', closer, scatterTest);
console.log('\nC. Practice');
for (const n of [100, 300, 700, 1500, 3000]) run(`${n} tries`, base, scatterTest, n);
console.log('\nD. Practice pen vs real conditions (tested in cluttered pens: 8 rocks)');
const cluttered = recipeStage('go-to-berry'); cluttered.environment = cluttered.environment.map(p => (p.args.kind as any)?.cardId === 'kind:rock' ? { ...p, args: { ...p.args, count: 8 } } : p);
run('Practised with 0 rocks', (seed) => { const s = base(seed); s.environment = s.environment.filter(p => (p.args.kind as any)?.cardId !== 'kind:rock'); return s; }, cluttered);
run('Practised with 3 rocks (default)', base, cluttered);
run('Practised with 8 rocks', (seed) => { const s = base(seed); s.environment = s.environment.map(p => (p.args.kind as any)?.cardId === 'kind:rock' ? { ...p, args: { ...p.args, count: 8 } } : p); return s; }, cluttered);
