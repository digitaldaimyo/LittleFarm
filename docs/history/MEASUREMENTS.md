# Measurements from earlier phases

Moved from `docs/TESTING.md` in polish phase 6. These numbers were measured when each phase shipped; some setups (scripted jobs, direct jobs, the earlier economy) no longer exist. Current numbers are in `docs/TESTING.md`.

## Pen benchmark results (before the polish sweep)
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

## Two pets, 1,500 ticks, 4 berry bushes + carrots (re-measured for farm life)

| Setup | Coins | Berries sold | Carrots sold |
|---|---|---|---|
| One pet harvesting (knows Fetch, so it stores in the basket) | 168 | 21 | 20 |
| Two harvesters | 259 | 45 | 27 |
| One harvests, one hauls | 292 | 19 | 45 |

Before farm life (coins at the bush): one forager 178, two foragers 183, forager + carrot deliverer 387. Now each sale needs a trip to the house, so a second harvester helps a lot, and splitting the work helps a little more.

## Two pets after replanting (phase B), 1,500 ticks, 4 bushes + 2 carrot plots

| Setup | Coins sold | Berries | Carrots |
|---|---|---|---|
| One pet on Harvest | 77 | 31 | 0 |
| Two on Harvest | 145 | 65 | 0 |
| Harvest + Haul | 96 | 36 | 2 |
| One pet on Auto | 173 | 11 | 25 |
| Two on Auto | 214 | 38 | 23 |
| Auto + Haul | 208 | 18 | 30 |

The Harvest job doesn't plant, so once the first carrots are picked their plots sit empty: a farm with nobody on Auto, Plant or a plan with a Plant row lives on berries alone. The coaching tip "field plots are empty" says so. With a planter, the fields (not the walking) limit the farm, so a second pet adds less than before.

## Farm baseline (learned-farm roadmap, phase 0): `npm run bench:farm`

Today's controllers with scripted jobs, one pet with Approach + Fetch (carrots unlocked) unless noted, 2,400 ticks (two farm days), training seeds 101 / 202 / 303. *Held-out* is a farm layout no earlier measurement used (bushes and a carrot plot moved, two more carrot plots). Raw rows (including per-job counts) go to `bench/farm-baseline.json`. **Phase 3 bar (decision 3): learned jobs must reach ≥ 80% of these coins.**

| Setup | Layout | Coins per seed | Sold | Jobs | Jobs ok | Timeouts | Switches / min | Resting | Idle | ms / tick |
|---|---|---|---|---|---|---|---|---|---|---|
| Auto (rules) | standard | 290 / 282 / 223 | 174 | 596 | 98% | 4 | 17.7 | 25% | 9% | 0.08 |
| Auto (learned chooser) | standard | 124 / 138 / 90 | 105 | 407 | 94% | 20 | 12.1 | 7% | 22% | 0.05 |
| Starter plan | standard | 290 / 282 / 223 | 174 | 596 | 98% | 4 | 17.7 | 25% | 9% | 0.07 |
| Harvest job only | standard | 127 / 159 / 70 | 156 | 184 | 93% | 13 | 5.5 | 4% | 4% | 0.03 |
| Two pets (Auto + Haul) | standard | 340 / 340 / 206 | 198 | 614 | 98% | 5 | 18.2 | 26% | 9% | 0.12 |
| Auto (rules) | held-out | 219 / 237 / 202 | 130 | 524 | 98% | 3 | 15.6 | 24% | 7% | 0.05 |
| Auto (learned chooser) | held-out | 81 / 86 / 63 | 57 | 696 | 98% | 12 | 20.7 | 9% | 56% | 0.04 |
| Starter plan | held-out | 219 / 237 / 202 | 130 | 524 | 98% | 3 | 15.6 | 24% | 7% | 0.05 |
| Harvest job only | held-out | 237 / 237 / 196 | 300 | 332 | 99% | 0 | 9.8 | 5% | 5% | 0.05 |
| Two pets (Auto + Haul) | held-out | 311 / 330 / 224 | 189 | 570 | 97% | 9 | 16.9 | 22% | 9% | 0.11 |
| **Learned Harvest routine** (phase 2) | standard | 114 / 148 / 22 | 109 | 131 | 92% | 11 | 3.9 | 5% | 2% | 0.04 |
| **Learned Harvest routine** (phase 2) | held-out | 227 / 218 / 195 | 283 | 296 | 100% | 0 | 8.8 | 5% | 4% | 0.05 |

**Learned farm (phase 3b):** `npm run bench:farm -- --learned` trains every job in pens (Approach among obstacles with 3,000 tries, Fetch, Harvest, Harvest to storage, Basket run), writes `bench/farm-learned.json` and compares coins with the baseline. Every setup is at ≥ 80% (88–175%); see `docs/LEARNED_FARM_ROADMAP.md`.

**What it shows:**
- **Phase 2 transfer:** the Harvest routine is trained in a pen (any ripe crop, the house, a few rocks; 600 tries) and assigned on the farm aimed at any ripe crop. It reaches **96%** of the scripted Harvest job on the held-out farm and **80%** on the standard farm. Seed 303's weak Approach still loops beside the rock at (8,6): 22 coins vs 70 scripted.
  - Two things made the transfer work. Each run's goal is judged from its own start; without that, a cumulative delivery count made every run "succeed" after one tick. And deployed walks take Curiosity's occasional random step (2–8%); without it, the standard farm reached 37 / 172 / 14.
- The starter plan equals the rules tick for tick, as designed.
- The **learned chooser** (today's coin-rewarded bandit over fixed jobs) earns about half of the rules. On the held-out farm it idles 56% of the time and switches 21 times a minute. That's the baseline the phase-5 executive has to beat.
- On the held-out layout, Harvest alone (berries straight to the house, no replanting needed for bushes next to it) outearns Auto.
- "Jobs ok" counts a job's own success. Several scripted jobs succeed by definition, so it isn't a goal measure: phase 1's outcome protocol replaces it.

## Baskets (after phase D), 2,400 ticks

- **One pet on Auto with Fetch (5 seeds):** carrots 294 / 286 / 224 / 263 / 286 (mean 271; before basket runs 247); + pumpkin and sunflower patches 353 / 354 / 347 / 379 / 375 (mean 362; was 310).
- **Starter plan + a Basket run row vs Auto before (seeds 101 / 202 / 303):** 247 / 244 / 191 vs 217 / 200 / 160; with four more carrot plots 245 / 266 / 188 vs 194 / 194 / 140.
- **A second pet only on Basket run** earns less than a second pet hauling (247 / 239 / 174 vs 273 / 239 / 211): it waits for a basket to be half full.
- **Found while measuring:** (1) a basket run "emptied" one basket into the basket next to it, back and forth; destinations are now the house or a shed only. (2) With two baskets, a harvest walked to the *nearest* basket by kind, found it full, left the crop beside it and picked it up again (248→36 coins). Harvests now head for the specific basket with room.
- **Empty the basket recipe (5 training seeds):** 85 / 60 / 80 / 75 / 65% on unseen layouts, random 0%. Without the once-only "Lifted" treat, practice never found the end treat (0%). The one-item-at-a-time version (Pick up / Put down, 4 senses) reached 15–95% depending on seed and time per try.

## Pets on duty (phase D, before basket runs), 2,400 ticks, seeds 101 / 202 / 303

| Pets (jobs) | Starting farm | + four carrot plots | Slowest tick |
|---|---|---|---|
| 1 (Auto) | 217 / 200 / 160 | 194 / 194 / 140 | 0.08 ms |
| 2 (Auto, Haul) | 273 / 239 / 211 | 250 / 250 / 163 | 0.12 ms |
| 3 (+ Auto) | 331 / 340 / 213 | 417 / 417 / 185 | 0.15 ms |
| 4 (+ Auto) | 376 / 383 / 262 | 561 / 565 / 359 | 0.19 ms |

(Coins earned after the plots were placed.) Extra pets pay when there’s work for them: on the starting farm the fields run out; with more plots, four pets earn 2.6–2.9× one. **Two-pet identity:** a two-pet farm hashed every tick over 3,000 ticks for four job mixes (Auto + Haul, Auto + Auto, Harvest + Harvest, plan + Nap) is identical before and after the crew refactor.

## Farm layout (phase C): coins over 2,400 ticks, as is → with the change (seeds 101 / 202 / 303)

| Change | One pet on Auto | Auto + a hauler |
|---|---|---|
| A second basket by the bushes (9,2) | 217→110, 200→184, 160→46 | 273→251, 239→189, 211→37 |
| The basket moved by the bushes | 217→219, 200→206, 160→80 | 273→251, 239→192, 211→109 |
| Both carrot patches by the house | 217→245, 200→252, 160→139 | 273→269, 239→312, 211→208 |
| Both bushes by the house | 217→249, 200→211, 160→208 | 273→325, 239→272, 211→281 |
| Two more carrot patches | 217→209, 200→167, 160→147 | 273→288, 239→261, 211→209 |

With one pet, storage costs a second trip per crop, so more baskets lose; bringing crops nearer the house wins. Lesson 10 is built on this. Seed 303's Approach is the weak one (it loops near obstacles), so placements next to the rock at (9,3) hurt it most.

**Found while measuring:** with two pets, a pet napping in the doorway corridor blocked the other, whose learned Approach circled it for most of a day (248→23 coins). A resting pet now naps at the house when another is on duty.

**Re-measured after phase C** (unbought shop plots are gone): Approach only mean 105; Fetch + carrots, replanted, mean 247; plus a pumpkin and a sunflower patch, mean 310. Two pets, 1,500 ticks: one on Auto 161, Auto + hauler 223, both on Auto 240; plain Harvest (which doesn't replant) 82 / two 112 / with a hauler 94.

## Farm-life economy (phase A), 5 training seeds, 2,400 ticks (≈ 2 farm days)

| | First 5 coins (ticks) | Coins per 2,400 ticks |
|---|---|---|
| Approach only, before | 64–97 | 70–117 (mean 97) |
| Approach only, after (berry 2) | 87–186 (median 102) | 60–130 (mean 104) |
| With Fetch + carrots, before | — | mean 250 |
| With Fetch + carrots, after (carrot 5) | — | 165–315 (mean 252) |
| Phase B: Fetch + carrots, replanted (seed 1) | — | 205–282 (mean 251) |
| Phase B: + pumpkin and sunflower patches | — | 179–317 (mean 279) |

**Found while tuning:**
- Every trip now starts at the house, so pets cross the farm and meet the rock at (8,6) more often. Learned Approach can loop beside it (wall to one side, target diagonally beyond), the known "Approach near obstacles" gap. On the farm only, a Harvest walk now sniffs around for two random steps when it revisits a tile 3 times in 8 steps; pens and reports are unchanged. Without it, Approach-only farms earned 32–134 coins with first-5 times up to 842 ticks.
- A pet napping on the house tile counted as an obstacle and blocked the other pet from selling. Pets may now share the house and storage tiles.
- Seed 303's Approach reaches the house from only 79% of tiles (98–100% for the others); it's the slow first-5 outlier.
- Training temperament is random at adoption, so economy measurements pin it (curiosity, persistence and caution all 0.5).

## Browser test (`npm run e2e`)
Plays the whole Field Guide in headless Chromium with real clicks, then the newer editor features (teaching polish, pens, your cards, lesson cards) and the sound checks (run `npm run build` first; about a minute). It starts its own preview server on port 4179.
- **Part 1, lessons 1–3, from a new game:** builds the first rule and SUCCESS card by card, trains, saves, forages to 5 coins, then the practice and scatter lessons (comparison cards, the Scattered layouts row, "▶ a miss").
- **Part 2, lessons 4–10, from a prepared save:** `scripts/e2e-save.ts` builds the save a player would have after lessons 1–3 (a certified Approach, 20 coins earned, so Fetch, Avoid and own skills are unlocked, and two pond splashes). The test imports it through Settings and plays: the pickup loophole and its repair card (4); "Test my Approach here" vs Avoid, then "Move with: Avoid" (5); Stay + Patience, the suggested rules, "How far is… → Rock" (the playtest bug) and removing it again (6); summaries, the probe, the journal and a skill-card download (7); a routine watching 2 conditions, then "Is at → Bin" (8); a shadowed plan row moved up until the preview shows it runs, deleted again, and the plan applied (9); Layout… pauses the farm, a basket by the bushes is previewed, removed again for free, a bush is moved next to the house, previewed, and the layout applied (10); Patrol trained without the note, the Note sense added (already named “leg”) counting up to 2, retrained and compared (11). Every lesson must end marked done. Then the roster: tapping the house opens it, a second pet is adopted and put on duty and appears on the farm, the strip opens its card, tapping the basket shows its contents, and off duty it goes home.
- **Teaching polish:** on the *Herd a chicken* lesson the test builds your original setup by clicking. That's a rule *WHEN Pip shoos chicken THEN End try* and SUCCESS *Is near → chicken*. The measured check warns that SUCCESS ends tries before the shoo rule can fire. Its one-tap repair makes SUCCESS *Has done… Pip shoos chicken* and the warning clears. Then it rebuilds that SUCCESS from empty in 4 taps (the hand recommends *Has done…*, then *Shoos*, first) and trains it: 10/20 vs 5/20 random. The herd recipe's senses aren't made for this goal; with fitting senses the unit-test gate gets 90–100%.
- **Better pens:** on the same lesson the test sets pen size to *varies* and sees six example layouts in different sizes. It plays the lesson by keyboard (step 3, SUCCESS shown), then duplicates a rule and switches the copy off, which keeps it on the mat.
- **Your cards and lesson cards:** the test saves the lesson's SUCCESS as one of your cards ("Shooed a chicken") and sees it on the shelf as a sentence. It ticks Chicken as a blank, exports the lesson as a card and imports it, giving "Herd a chicken (2)". In the copy it places the card in FAIL from "Your cards" in the hand; the editor jumps to the blank, it picks Chicken, and the FAIL row shows the card's name and reads back filled in.
- **Sound:** no AudioContext before the first click, one after it (the adopt chirp); all 42 cues render, none renders as silence (peak check), and the three ambience loops render at a gentle level (RMS day 0.009, night 0.005, rain 0.026); audio is running; the one-time "Sound is on" note appears with the first sound; key moments trigger their cues (card flick/snap/remove, pen place, train start, certified or not, save, pickup, coin, the pet's chirp while it forages; loophole, repair card, unlock, Field Guide step/offer/done). The test watches the loophole replay for 3 s and hears its pick-up/put-down sounds. Switching the music box on in Settings schedules notes, and switching it off stops them. On the farm the ambience is playing; pressing M mutes: no cues for 3 s and the ambience fades to zero. Cues are counted through a test hook (`window.__penDeckAudio`), not by listening.
- Step checks wait up to 3 s for the banner, since some steps advance a moment after the click (`<details>` toggle events are asynchronous; this made one lesson-7 check flaky).
- Throughout: no page errors and no request leaves the page's origin. On a failure it saves a screenshot and prints its path.
- `npm run e2e -- --from=4` runs part 2 only.

Last run: all 49 checks passed. Practice 50% → 90%, scatter 25% → 80%, loophole 0% (100 treats per try) → repaired 90% (11), Approach in the pond pen 50% vs Avoid 85%, lean senses 90% vs extra sense 20%, routine watching 2 things 0% vs 3 things 90%.

**Found by extending it:** (1) *Plan the farm* could get stuck. On a farm with Fetch and carrots (which any player reaching lesson 9 has), the rows above "Otherwise wander" always find work, so the lesson row never ran even after being moved as instructed. The lesson now says to keep moving it up until the preview shows it runs, then delete the experiment row before using the plan. (2) Starting a lesson left the previous lesson's saved report open, covering the new lesson's binder; a saved report now closes when a lesson starts on another pen.

