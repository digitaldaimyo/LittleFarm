# Testing and benchmarks

## Automated suites (`npm test`)
134 tests in 19 files. CI-style check before every push: `npm run typecheck && npm run lint && npm test && npm run build`.

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
| `tests/milestone5.test.ts` | Gates block pets and chickens, Nudge opens/closes and never shuts on the pet; *Open the gate* learnable (≥ 30 points over random); orchard expansion grows the farm to 16×12 with a gated orchard a trained pet harvests; a "Mind the gate" plan row shuts the gate (preview agrees); rain from day 2 waters plots, adds exactly one pond tile, keeps crows away and dries up; Weather card; requests posted, tracked, paid (with journal); a full day judges at nightfall and posts at dawn |
| `tests/milestone6.test.ts` | Summaries cover all held-out episodes (heat sums to 1, endings match, time concentrates near the target, reward shares); curiosities flag the pickup loophole and stay quiet for plain Approach; probe gives an arrow on every free tile and its greedy path reaches the berry; skill card export → import into another pet acts identically, renames on clash, round-trips through saves; cards with garbage, bad policy rows, oversize tables or unknown cards are rejected; two pets never share a tile or a claim, earn > 1.3× with different jobs, are deterministic and survive save/load |
| `tests/guide.test.ts` | Field Guide: lessons offered after the previous is done or skipped and free to train; *practice* (300 vs 1,500 tries, > 30 points apart, comparison card); *scatter* (pinned pen ≥ 90% on its own layout but < 40% on the report's scattered row; scattered pen > 40 points better); replaying the first lesson resets its pen; an old finished tutorial maps to Chapter 1 done; **phase B:** *results* (loophole run has more treats and > 50 points less success than the repaired run, comparison shows both), *where* (Avoid > tested Approach by 15+ points, lesson finishes when "Move with" is Avoid), *invent* (lean senses > extra-sense run by 30+ points); coaching tips point at the right lessons (practice, pinned, situations, loophole) and spot two pets on the same job; **phase C:** *read* follows summary/probe/journal/card actions, *routines* (2 watched conditions scores below random choices, + "at the bin" beats random choices by 40+ points), *plans* (the lesson row never fires until moved above "Otherwise wander", proven by previews; on a busy farm with Fetch and carrots it must go higher still, and the lesson ends only once the experiment row is deleted and the plan applied); every request has a hint; the orchard gate request is judged at nightfall |
| `tests/editor.test.ts` | Card editor regression (the hand stayed closed for slots *inside* a sense card, so “How far is…” couldn't be aimed at Rock): the sense editor keeps its hand open for nested slots and fills them; the hand recommends Patience and How far is… without opening “More cards” |
| `tests/sound.test.ts` | Every farm effect and every tag on one (watered, filled, gate open/shut, shoo!, pecked, egg, and the sound-only shoo/firefly/crow/dawn/dusk markers) maps to its cue or is silent on purpose (naps, rain), also checked against a real farm run through a night (dusk and dawn heard); every sim event maps to a replay cue or is silent on purpose, matching the farm's sounds; stereo position; coins in one tick merge; the limiter's cooldowns and voice cap are deterministic with a fake clock and keep 4× speed sparse; every cue has a recipe within its declared length and gentle levels; ambience layers follow day/night/rain and their loops are seeded and fit their length; new games have sound on; older saves start with it on, a chosen “off” is kept, volumes are clamped |
| `tests/teaching.test.ts` | Teaching polish: the event tally (per try, cloned, no moves or ticks); *Has done…* with counts, *Just…*, *Any of*; the *Done … yet?* sense before vs after, and a farm skill run counting from its own start; End try *judged by SUCCESS / counts as a success / counts as a miss*; no recipe ends a try "as a miss" while SUCCESS holds (so recipe scores are unchanged); **gate:** "end on shoo chicken" built from cards learns ≥ 30 points over random (held out); your original setup is caught by the measured check and its repair works; measured checks stay quiet on every recipe; the random baseline uses every ability; memory validation (sense suggestion and its repair, *every step*, plans); the hand ranks *Shoos* / *Has done…* first in a Shoo lesson and groups More cards; every recipe reads as sentences; v4 → v5 save and v1 → v2 skill-card migrations |
| `tests/pens.test.ts` | Better pens: *next to* (one of the 8 tiles around), *away from* and *far from the pet* keep their distances, *inside* an area (things and the pet's start), the pet starting *away from* something; counts that vary stay in range and really vary; *sometimes* appears on 25–75% of tries; varying pen size covers 6×6 to 10×10; obstacles scale with the pen (rocks, fences, mixed); new options are deterministic; conditional sockets are required only when used; fence obstacles need the shop's fences; placements read as sentences; *Next to* counts diagonals but not standing on it; *Thing near thing*; *Time in try*; switched-off rules never run and checks ignore them |
| `tests/layouts.test.ts` | Every recipe and the tutorial pen (and their bigger transfer pens) produce exactly the layouts recorded in `tests/fixtures/layouts.json`, so changes to layout generation can't silently move existing lessons. Regenerate only on purpose: `PRINT_LAYOUTS=1 npx vite-node scripts/layout-fingerprint.ts > tests/fixtures/layouts.json` |
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
| *Herd a chicken* (custom: move+shoo; where is a stray chicken, coop seen from it) | 8000 | 20% (was 25%, see below) | **85%** | 70% | 70–100% | ~0.6 s |
| *Treat for every shoo* (loophole) | 8000 | 20% (was 25%) | 18% (flagged 5/5, ~30 shoos per try) | — | — | ~0.9 s |
| *Open the gate* (custom: move+nudge; where is the gate, walls) | 3000 | 10–20% | **75–95%** (3 seeds) | — | 50–100% | ~0.15 s |
| *Bring it home (routine)* (Fetch from cards) | 400 | 0% (random choices 70–90%) | **91%** | 85% | 70–100% | ~45 ms |
| *Morning chores* (routine over Herd, Water, Keep clear, Wait for it) | 600 | 0% (random choices 30–75%, mean 57%) | **83%** | 65% | 60–90% | ~180 ms |

Re-run for the docs polish pass (same hardware): every mean and minimum above reproduced exactly. Per-run rows are printed by the script. In the browser, *Normal* speed adds small delays so training is watchable (Approach takes a few seconds). *Fast* is close to the raw numbers above.

**Random-baseline fix (teaching polish, phase A):** the random baseline used to leave out the Shoo and Stay abilities, so it never shooed or stayed. Re-run with the fix (same hardware), every learned mean and minimum is unchanged. Random moved for Herd (25% → 20%) and the shoo loophole (25% → 20%); *Wait for it* stays at 0%. Herd's old 25% came from chickens wandering into the coop by themselves.

### Does pen variety help? (teaching polish, phase B)
Approach (1,500 tries, 5 seeds), measured on its own held-out layouts, bigger transfer pens, and a cluttered 12×12 pen with many rocks:

| Practised in | Own layouts | Bigger pens | Cluttered 12×12 |
|---|---|---|---|
| 8×8, the recipe's rocks | 93% | 96% | 47% (40–60) |
| Pen size varies 6–10 | 94% | 94% | 42% (27–47) |
| 8×8 + Obstacles: some | 83% | 86% | 54% (43–63) |
| Varies + Obstacles: some | 82% | 86% | 56% (47–67) |

Varying the size didn't help Approach: it already copes with bigger pens. Obstacles help in clutter (+7–9 points) at a small cost in open pens. The in-game hints say this rather than promising more.

### Known failures and caveats
- *Morning chores* beats random choice of the same skills by +15 to +35 points depending on the seed (worst seed: 65% vs 30%). It depends on sub-skills trained in simpler pens (Herd, Water), and their failures dominate its misses.
- *Water the garden* transfers less well to bigger pens (50–80%) because a bigger pen has more patches spread farther apart. Adding a *Walls nearby* sense made learning much slower (10% after 4,000 tries vs 60% without), which is a good in-game example of the sense-budget trade-off.
- Avoid sometimes lands at 75% (below the 80% bar) on a single run. *Refine* (train more) usually certifies it.
- Evaluation uses n = 20, so ±10 percentage points between runs is normal noise. The UI always shows the sample size.
- Before the action-legality fix, a Fetch controller could tie between "pick up" and a no-op "drop" and loop. Options that can't apply in the current state are now masked. The fix is covered by the multi-seed benchmark and the long-run farm test.

## Tutorial evidence (`npm run evidence`)
Numbers behind the Field Guide and the Trainer's notebook (3 training seeds, 30 held-out scattered layouts): see `docs/TUTORIAL_PLAN.md` §2. Scatter lesson check (5 seeds): fully pinned pen 15% on every seed; berry and start scattered (rocks still fixed) 85–95%.

## Two pets (Milestone 6), 1,500 ticks, 4 berry bushes + carrots

| Setup | Coins | Berries | Carrots |
|---|---|---|---|
| Pip alone, foraging | 178 | 168 | 0 |
| Pip + Mochi, both foraging | 183 | 170 | 0 |
| Pip foraging + Mochi delivering carrots | 387 | 166 | 65 |

## Performance (Milestone 5 gate)
Headless Chromium, 390×844 phone viewport, DPR 2, expanded 16×12 farm, 2 pets (1 on duty), 6 chickens/crows, raining, farm at 4× speed, 5 s per measurement:

| CPU throttling | FPS | Main thread busy | Script | Long tasks (>50 ms) |
|---|---|---|---|---|
| 1× | 60 | 12% | 2% | 0 |
| 4× (mid-range phone stand-in) | 60 | 53% | 9% | 0 |
| 6× | 60 | 69% | 12% | 0 |

**With sound (phase A),** same setup, same session, sound on vs muted: 1× 15% vs 15% busy; 4× 63% vs 59%; 6× 81% vs 84%; 60 fps at 1× and 4× either way (57 fps at 6× either way). The difference is within run-to-run noise.

**With sound (phase B: 38 cues plus ambience; this save is raining, so rain and birds play):** three pairs of runs, sound on vs muted. 4×: 59.2–60.0 vs 59.3–59.7 fps, 62–68% vs 60–67% busy. 6×: 52.5–56.4 vs 53.8–58.3 fps. The ranges overlap; if there is a cost, it's a couple of fps at 6× throttling only. Rendering all cues takes 0.3–0.5 s and the loops another ~0.3 s, asynchronously after the first click. In about 1 of 4 runs that first click shows one 66–85 ms long task (never with audio disabled). Creating the AudioContext costs up to ~30 ms in this browser; rendering now starts in a separate task.

This container measured higher absolute numbers than the original Milestone 5 run (59% vs 53% at 4× with sound muted), so compare rows from the same session.

This is emulation, not a real device. Most of the cost is style and paint from CSS animations (rain, pet bobbing); *Reduce motion* turns those off.

## Browser test (`npm run e2e`)
Plays the whole Field Guide in headless Chromium with real clicks (run `npm run build` first; about 45 s). It starts its own preview server on port 4179.
- **Part 1, lessons 1–3, from a new game:** builds the first rule and SUCCESS card by card, trains, saves, forages to 5 coins, then the practice and scatter lessons (comparison cards, the Scattered layouts row, "▶ a miss").
- **Part 2, lessons 4–9, from a prepared save:** `scripts/e2e-save.ts` builds the save a player would have after lessons 1–3 (a certified Approach, 20 coins earned, so Fetch, Avoid and own skills are unlocked, and two pond splashes). The test imports it through Settings and plays: the pickup loophole and its repair card (4); "Test my Approach here" vs Avoid, then "Move with: Avoid" (5); Stay + Patience, the suggested rules, "How far is… → Rock" (the playtest bug) and removing it again (6); summaries, the probe, the journal and a skill-card download (7); a routine watching 2 conditions, then "Is at → Bin" (8); a shadowed plan row moved up until the preview shows it runs, deleted again, and the plan applied (9). Every lesson must end marked done.
- **Teaching polish:** on the *Herd a chicken* lesson the test builds your original setup by clicking. That's a rule *WHEN Pip shoos chicken THEN End try* and SUCCESS *Is near → chicken*. The measured check warns that SUCCESS ends tries before the shoo rule can fire. Its one-tap repair makes SUCCESS *Has done… Pip shoos chicken* and the warning clears. Then it rebuilds that SUCCESS from empty in 4 taps (the hand recommends *Has done…*, then *Shoos*, first) and trains it: 10/20 vs 5/20 random. The herd recipe's senses aren't made for this goal; with fitting senses the unit-test gate gets 90–100%.
- **Better pens:** on the same lesson the test sets pen size to *varies* and sees six example layouts in different sizes. It plays the lesson by keyboard (step 3, SUCCESS shown), then duplicates a rule and switches the copy off, which keeps it on the mat.
- **Sound:** no AudioContext before the first click, one after it (the adopt chirp); all 38 cues render, none renders as silence (peak check), and the three ambience loops render at a gentle level (RMS day 0.009, night 0.005, rain 0.026); audio is running; the one-time "Sound is on" note appears with the first sound; key moments trigger their cues (card flick/snap/remove, pen place, train start, certified or not, save, pickup, coin; loophole, repair card, unlock, Field Guide step/offer/done). The test watches the loophole replay for 3 s and hears its pick-up/put-down sounds. On the farm the ambience is playing; pressing M mutes: no cues for 3 s and the ambience fades to zero. Cues are counted through a test hook (`window.__penDeckAudio`), not by listening.
- Step checks wait up to 3 s for the banner, since some steps advance a moment after the click (`<details>` toggle events are asynchronous; this made one lesson-7 check flaky).
- Throughout: no page errors and no request leaves the page's origin. On a failure it saves a screenshot and prints its path.
- `npm run e2e -- --from=4` runs part 2 only.

Last run: all 49 checks passed. Practice 50% → 90%, scatter 25% → 80%, loophole 0% (100 treats per try) → repaired 90% (11), Approach in the pond pen 50% vs Avoid 85%, lean senses 90% vs extra sense 20%, routine watching 2 things 0% vs 3 things 90%.

**Found by extending it:** (1) *Plan the farm* could get stuck. On a farm with Fetch and carrots (which any player reaching lesson 9 has), the rows above "Otherwise wander" always find work, so the lesson row never ran even after being moved as instructed. The lesson now says to keep moving it up until the preview shows it runs, then delete the experiment row before using the plan. (2) Starting a lesson left the previous lesson's saved report open, covering the new lesson's binder; a saved report now closes when a lesson starts on another pen.

## Manual checks done
In headless Chromium (Playwright), at desktop 1280×900 and phone 390×844:
- Full tutorial to first farm delivery, Fetch lesson, loophole discovery with replay and repair, carrot deliveries, Steer by keyboard, Pets, Journal, export, and import.
- No console errors. **Zero network requests to any other origin.**
- After one online load, the page reloads and a full lesson trains with the network disabled.
- No horizontal scroll on phone width.
- Docs polish pass: Farm, Teach, Pets and Guide at both sizes with an expanded two-pet save; no page errors, no horizontal scroll.
