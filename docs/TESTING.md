# Testing and benchmarks

## Automated suites (`npm test`)
| File | Covers |
|---|---|
| `tests/sim.test.ts` | Determinism (same seed + actions → identical state/event/reward trace); collision, carrying, delivery; reachable layout generation; limits stopping a pickup/drop loop |
| `tests/registry.test.ts` | Starter recipes valid; generic trait constraints; type mismatch, trait mismatch, missing reference and `it`-scope errors with messages; exploit warning + repair; deterministic compatible → available → relevant hand with locked reasons |
| `tests/learning.test.ts` | Eval seeds held out from training seeds; learned Approach ≥ 80% and beats random by 20+ points, plus transfer; deterministic training; Fetch reuses Approach and degrades when Approach is swapped for a weak revision (no Fetch retraining); loophole detected with replay, and the repair raises success by 40+ points |
| `tests/session.test.ts` | Worker protocol loop: pause holds progress, resume, speed change, completion with report; cancel |
| `tests/save.test.ts` | Export/import round-trip of pets, policies, stages, templates, farm, progress and unknown fields; restored policies act identically; unknown cards reported not dropped; garbage and newer versions rejected |
| `tests/milestone1.test.ts` | v1 → v2 migration of a real v1 fixture save; the preset encoder equals the legacy index; v1 skills act move-for-move identically (Approach, Avoid layouts, Fetch); *Wait for it* and *Keep clear* beat random by ≥ 30 points; a "surprise" skill (*Shadow the bin*) written only from cards learns; state-budget, no-senses and wrong-card validation; a custom skill saved with its senses runs re-aimed on the farm |
| `tests/water-night.test.ts` | Fill/water mechanics and charges; *Water the garden* valid and ≥ 30 points over random; "the target" trait typing; watered farm plots regrow ≤ half the ticks and dry afterwards; clock boundaries; fireflies appear at night, get caught for coins and leave at dawn; night-preferring rules executive; Time of day card, *Is night* condition; v2 save gains a well |
| `tests/milestone2.test.ts` | Determinism with chickens/crows; shoo pushes into an area (events) and scares crows; crows peck but avoid scarecrows; scattered things avoid areas; unknown area names rejected; **gate:** *Herd a chicken* ≥ 60% held-out and ≥ 30 points over random; *Treat for every shoo* statically warned, flagged after training (> 10 shoos per try) and repaired by "once per object"; shop chickens lay eggs only in the coop and Fetch delivers them; crows arrive by day 2; a learned Herd brings in a stray on the farm while another chicken is already home; v3 saves gain the coop |
| `tests/milestone3.test.ts` | **Gate 1:** Fetch rebuilt as a routine learns a byte-identical Q-table and equal held-out success; **gates 2–3:** *Morning chores* from 4 player-made skills beats random steps by ≥ 30 and random choices by ≥ 20 points, and degrades by > 20 points when Herd is swapped for a weak revision (no retraining); `uses` recorded and `staleUses` detects a newer Herd; a saved routine runs on the farm (Fetch routine delivers carrots); validation (no options, > 4 watched, self-reference) and missing-skill refusal |
| `tests/milestone4.test.ts` | **Gate 1:** starter plan ≡ built-in rules (identical farm snapshot every tick for 3000 ticks, guard never triggers); **gate 2:** 300-tick preview equals the real farm from a mid-game state; **gate 3:** on a fighting plan the guard steps in and cuts switches/min by more than half; plans that run a missing skill warn and still earn from the other rows (vs a nap-only plan earning 0); the learned chooser fills its value table and earns |
| `tests/farm.test.ts` | Trained pet produces coins where an untrained pet produces none; independent repertoires and rollback; full first-hour flow (adopt → pen → train → save → deploy → earn → Fetch unlocked, tutorial complete); Fetch delivers carrots on the farm; 3000-tick runs keep producing (no permanent stuck loops) with both executives |

## Benchmark protocol (`npm run bench`)
For each of 5 training seeds (101, 202, 303, 404, 505), the benchmark trains each starter skill from scratch with default temperament and the recipe's episode budget. It then evaluates on **20 held-out layouts** (seeds 900001 + 7k) and **10 transfer layouts** (pens 3 tiles larger with extra rocks/ponds, seeds 950001 + 7k). Baselines are random legal actions and the untrained policy. Fetch and the loophole recipe use the Approach trained under the same seed.

### Observed results
Hardware: Intel Xeon @ 2.10 GHz, 4 threads, Node 22 (a cloud container, no GPU). Preset rows were unchanged by the Milestone 1 refactor.

| Skill | Tries | Random | Learned (mean) | Learned (min) | Transfer (range) | Train time |
|---|---|---|---|---|---|---|
| Approach | 1500 | 40% | **93%** | 90% | 80–100% | 65–125 ms |
| Avoid | 8000 | 30% | **82%** | 75% | 80–100% | 510–590 ms |
| Fetch (reuses Approach) | 400 | 0% | **91%** | 85% | 70–100% | 30–65 ms |
| Treat for every pickup | 400 | 0% | 0% (loophole flagged 5/5) | — | — | 40–60 ms |
| *Wait for it* (custom: move+stay; where is target, walls, heading, patience) | 2500 | 0% | **88%** | 70% | 80–100% | ~250 ms |
| *Keep clear* (custom, survive; where is target=pond, walls, hazards) | 2000 | 10% | **85%** | 80% | 80–100% | ~200 ms |
| *Water the garden* (custom: move+water; where is well, where is a dry patch, has water) | 10000 | 0% | **78%** | 70% | 50–80% | ~1.2 s |
| *Herd a chicken* (custom: move+shoo; where is a stray chicken, coop seen from it) | 8000 | 25% | **85%** | 70% | 70–100% | ~0.6 s |
| *Treat for every shoo* (loophole) | 8000 | 25% | 18% (flagged 5/5, ~30 shoos per try) | — | — | ~0.9 s |
| *Bring it home (routine)* (Fetch from cards) | 400 | 0% (random choices 70–90%) | **91%** | 85% | 70–100% | ~45 ms |
| *Morning chores* (routine over Herd, Water, Keep clear, Wait for it) | 600 | 0% (random choices 30–75%, mean 57%) | **83%** | 65% | 60–90% | ~180 ms |

Per-run rows are printed by the script. In the browser, *Normal* speed adds small delays so training is watchable (Approach takes a few seconds). *Fast* is close to the raw numbers above.

### Known failures and caveats
- *Morning chores* beats random choice of the same skills by +15 to +35 points depending on the seed (worst seed: 65% vs 30%). It depends on sub-skills trained in simpler pens (Herd, Water), and their failures dominate its misses.
- *Water the garden* transfers less well to bigger pens (50–80%) because a bigger pen has more patches spread farther apart. Adding a *Walls nearby* sense made learning much slower (10% after 4,000 tries vs 60% without), which is a good in-game example of the sense-budget trade-off.
- Avoid sometimes lands at 75% (below the 80% bar) on a single run. *Refine* (train more) usually certifies it.
- Evaluation uses n = 20, so ±10 percentage points between runs is normal noise. The UI always shows the sample size.
- Before the action-legality fix, a Fetch controller could tie between "pick up" and a no-op "drop" and loop. Options that can't apply in the current state are now masked. The fix is covered by the multi-seed benchmark and the long-run farm test.

## Manual checks done
In headless Chromium (Playwright), at desktop 1280×900 and phone 390×844:
- Full tutorial to first farm delivery, Fetch lesson, loophole discovery with replay and repair, carrot deliveries, Steer by keyboard, Pets, Journal, export, and import.
- No console errors. **Zero network requests to any other origin.**
- After one online load, the page reloads and a full lesson trains with the network disabled.
- No horizontal scroll on phone width.
