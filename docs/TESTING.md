# Testing and benchmarks

## Automated suites (`npm test`)
322 tests in 44 files. **CI** (`.github/workflows/ci.yml`, on every push and pull request): typecheck, lint, `npm test`, build, then `npm run e2e:cards`. Run the same before pushing. The full browser test, `npm run e2e` (every lesson, under 2 min after a build), stays local. Browser checks run against the built app: `npm run build` first.

**Test pets have a fixed temperament.** `tests/setup.ts` gives every pet adopted in a test the default traits, because adoption seeds a random temperament from the clock and twice made a test fail only in the full run. A test that wants a random one calls `adoptRandomPet` from `tests/helpers.ts`.

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
| `tests/milestone6.test.ts` | Summaries cover all held-out episodes (heat sums to 1, endings match, time concentrates near the target, reward shares); curiosities flag the pickup loophole and stay quiet for plain Approach; probe gives an arrow on every free tile and its greedy path reaches the berry; skill card export → import into another pet acts identically, renames on clash, round-trips through saves; cards with garbage, bad policy rows, oversize tables or unknown cards are rejected; two pets never share a tile or a claim, earn > 1.1× with different jobs (the harvester on Auto, so it replants), are deterministic and survive save/load |
| `tests/guide.test.ts` | Field Guide: lessons offered after the previous is done or skipped and free to train; *practice* (300 vs 1,500 tries, > 30 points apart, comparison card); *scatter* (pinned pen ≥ 90% on its own layout but < 40% on the report's scattered row; scattered pen > 40 points better); replaying the first lesson resets its pen; an old finished tutorial maps to Chapter 1 done; **phase B:** *results* (loophole run has more treats and > 50 points less success than the repaired run, comparison shows both), *where* (Avoid > tested Approach by 15+ points, lesson finishes when "Move with" is Avoid), *invent* (lean senses > extra-sense run by 30+ points); coaching tips point at the right lessons (practice, pinned, situations, loophole) and spot two pets on the same job; **phase C:** *read* follows summary/probe/journal/card actions, *routines* (2 watched conditions scores below random choices, + "at the bin" beats random choices by 40+ points), *plans* (the lesson row never fires until moved above "Otherwise wander", proven by previews; on a busy farm with Fetch and carrots it must go higher still, and the lesson ends only once the experiment row is deleted and the plan applied); every request has a hint; the orchard gate request is judged at nightfall |
| `tests/editor.test.ts` | Card editor regression (the hand stayed closed for slots *inside* a sense card, so “How far is…” couldn't be aimed at Rock): the sense editor keeps its hand open for nested slots and fills them; the hand recommends Patience and How far is… without opening “More cards” |
| `tests/sound.test.ts` | Every farm effect and every tag on one (watered, filled, gate open/shut, shoo!, pecked, egg, and the sound-only shoo/firefly/crow/dawn/dusk markers) maps to its cue or is silent on purpose (naps, rain), also checked against a real farm run through a night (dusk and dawn heard); every sim event maps to a replay cue or is silent on purpose, matching the farm's sounds; stereo position; coins in one tick merge; the limiter's cooldowns and voice cap are deterministic with a fake clock and keep 4× speed sparse; every cue has a recipe within its declared length and gentle levels; ambience layers follow day/night/rain and their loops are seeded and fit their length; new games have sound on; older saves start with it on, a chosen “off” is kept, volumes are clamped. **Phase C:** each pet's voice is stable, in range and usually distinct; training ticks fire exactly 3 times; the music box is reproducible, pentatonic, sparser at night than in the pen than by day, and rarely repeats a bar |
| `tests/teaching.test.ts` | Teaching polish: the event tally (per try, cloned, no moves or ticks); *Has done…* with counts, *Just…*, *Any of*; the *Done … yet?* sense before vs after, and a farm skill run counting from its own start; End try *judged by SUCCESS / counts as a success / counts as a miss*; no recipe ends a try "as a miss" while SUCCESS holds (so recipe scores are unchanged); **gate:** "end on shoo chicken" built from cards learns ≥ 30 points over random (held out); your original setup is caught by the measured check and its repair works; measured checks stay quiet on every recipe; the random baseline uses every ability; memory validation (sense suggestion and its repair, *every step*, plans); the hand ranks *Shoos* / *Has done…* first in a Shoo lesson and groups More cards; every recipe reads as sentences; v4 → v5 save and v1 → v2 skill-card migrations |
| `tests/pens.test.ts` | Better pens: *next to* (one of the 8 tiles around), *away from* and *far from the pet* keep their distances, *inside* an area (things and the pet's start), the pet starting *away from* something; counts that vary stay in range and really vary; *sometimes* appears on 25–75% of tries; varying pen size covers 6×6 to 10×10; obstacles scale with the pen (rocks, fences, mixed); new options are deterministic; conditional sockets are required only when used; fence obstacles need the shop's fences; placements read as sentences; *Next to* counts diagonals but not standing on it; *Thing near thing*; *Time in try*; switched-off rules never run and checks ignore them |
| `tests/cards.test.ts` | Your cards: a saved rule with a blank leaves the thing empty and points the editor at it, and keeps its name on placed copies; a named condition is offered for conditions only and works in a farm plan row and as a routine's watched condition; saves keep cards, blanks and names. Lesson cards: every recipe round-trips with fresh ids, the same rules and exactly the same layouts; renamed on clash; a Field Guide pen becomes an ordinary lesson; bad JSON, wrong format, unknown cards, out-of-range sizes or times and oversized files are rejected without half-adding. Farm plans: "IF has done… picks up a berry DO nap" alternates forage → nap → forage → nap (memory counts from each job's start); plans without memory never create a farm tally |
| `tests/phase0.test.ts` | Learned-farm roadmap: a routine (1a) and a reach skill (1b) that run out of time report a timeout, not success (pinned with `it.fails` in phase 0, fixed in phase 1) |
| `tests/parity.test.ts` | Phase 2: “any ripe crop” in a pen is a real crop, different from try to try, and “storage with room” an empty basket; the Harvest recipe type-checks; Energy drains 0.12 per step of work and restores 1.5 per Stay, *Energy below* and *Tired?* read it (also on the farm); Seed money pays seeds and runs out; **transfer:** a Harvest routine trained in a pen sells crops on the held-out farm with no scripted job, ≥ 80% of the scripted Harvest job (measured 218 vs 237), each run judged from its own start; deployed walks explore, training walks don't; **phase 3a:** a pet without a Harvest skill can't harvest (Auto never does, nothing sells by day), and Harvest binds to the pet's Harvest routine, a skill the player picks, or (uncertified) only when opted in; **phase 3b:** Haul binds to Fetch and Basket run to the Basket run routine; Harvest picks *Harvest to storage* only when storage is nearer than the house; a routine with nothing it may do gives up instead of waiting; **phase 3c:** no Plant routine, no planting (with it, plots are sown); the Plant pen trains above random; *Gates start open* opens pen gates, and Mind the gate needs the skill for that direction; **v8 → v9:** half-run jobs cleared, pets back on Auto, plans dropped, journal note and one-time notice |
| `tests/duties.test.ts` | Phase 4 gate: a responsibility served by two jobs (Haul or Basket run) is worked on until its UNTIL holds; a tired pet rests until refreshed before working; no thrash on three farms (< 25 switches/min, guard never needed); a job that never works is cooled down after 3 tries; an UNTIL commitment holds against a more important responsibility within 60 ticks |
| `tests/executive.test.ts` | Phase 5: untrained, the learned executive picks in the player's order; with “Otherwise wander” first, learned picks beat the order (more than 3×) and random picks after 4 practice days; with a good order they stay within 90% of it and beat random picks; no job is started while tired; practice changes only the pet's executive values; a choice that gets nothing done loses its value |
| `tests/done.test.ts` | Phase 6, the definition of done: a pet with no skills only rests (0 coins in a day); over 2 days every job maps to a learned capability, with no wandering or scripted sniffing; a player-made skill serves a responsibility; v9 → v10: a direct job becomes responsibilities kept at night, wander rows are dropped, skills survive |
| `tests/wiring.test.ts` | Pen & cards phase 1: storage keeps identity (a berry stored and taken out is the same berry; a basket emptied into a shed moves identities; the farm tidying stored items away doesn't lose them; unknown stock gets an id once); every card reads as a sentence, type-checks and compiles where it belongs; all 18 event cards fire in their own scene; once / once per object / cooldown hold through pick up, put down, storage, lifting and emptying; the loophole probe (“every time” gets farmed and the report names the berry, “once per object” doesn't) |
| `tests/measures.test.ts` | Pen & cards phase 2: Stored (any / baskets / sheds / carried, trait aims), Sold / delivered by kind, Distance between, Energy, Seed money, Water, Step, Note value, Time until ripe (the farm's growing plots; 99 in pens); Compare's six comparisons, measure against measure (and how it reads), old saves' meaning, a farm responsibility using Stored; the Storage of… sense bands; gate: “keep 3 berries in the basket” (a routine, SUCCESS = stored berries ≥ 3, no notes) trains to ≥ 60% (measured 75%, random 0%) |
| `tests/qualifiers.test.ts` | Pen & cards phase 3: nearest / furthest (from the pet or another thing), ties, nothing to point at, fullest / emptiest storage, what it carries; in conditions (at, Storage of one), measures (Stored in this one), senses (aimed at the furthest berry from the house); wording, hand, validation (not in events or placements, the moving-target warning); gate: “reach the furthest berry from the house” trains to ≥ 80% (measured 100%, random 35%) and transfers (90%) |
| `tests/focus.test.ts` | Pen & cards phase 4: the card picker's next slot after a pick (depth first inside the new card, then back up the chain), optional slots skipped, nothing left → close, and tapping a slot by hand starts afresh |
| `tests/diagnose.test.ts` | Polish phase 1, "Why isn't it learning?": each report finding is reproduced by a small pen. *Keep 3 berries* as a sense skill reports *big treat never happened* and *long chain*; *Bring it home* without a Carrying sense reports *can't tell apart* (carrying); the Field Guide routine watching two things reports *standing at the basket* (add it to Watches); Approach with only the Nearest sense reports *loops* with a replay and suggests Walls and Heading; a passing skill has no findings |
| `tests/execworker.test.ts` | Polish phase 2: executive practice in steps gives exactly the values and comparison of `practiseExecutive` + `compareExecutives`, needs only the practising pet, reports progress in order, stops on cancel with no result, and reports a missing pet as an error |
| `tests/hygiene.test.ts` | Test pets get the default temperament; `adoptRandomPet` gives varied ones in the game's range |
| `tests/playerpen.test.ts` | A playtester's pen as a fixture (`fixtures/fill-basket-r6.skill.json.gz`: fill a basket with 5 berries, then lift it; 19 rules, notes as counters and a home-made loop check, 94,100 tries): it imports, validates and scores exactly what it did when trained (95%, bigger pens 80%, random 0%), with no findings |
| `tests/savev10.test.ts` | Polish phase 3 gate: a rich v10 save (`fixtures/save-v10.json.gz`, made before the renames by `scripts/save-v10-fixture.ts`) loads with every skill, revision and responsibility (pinned in words); it comes out as v11 with new card and job ids everywhere, retired fields gone and key order kept; old card ids in skill cards load; and the next farm day plays exactly as it did at v10 (the pet's path, coins and sales are pinned) |
| `tests/tuneups.test.ts` | Pen & cards phase 5 and polish phase 1: Plant, Open the gate, Shut the gate, Empty the basket, Harvest and Basket run certify at ≥ 80% on 6 training seeds at default traits; learned picks explore until practised, then stop, unless the player chose |
| `tests/cardref.test.ts` | `docs/CARD_REFERENCE.md` matches the card registry (`npm run cards:ref` regenerates it) |
| `tests/aims.test.ts` | Follow-up: “picks up the furthest berry from the house” pays for that berry, judged before the step (not the near one); a qualifier still can't go in a delivery's Into; aims read as words; Harvest aimed at the furthest berry picks it first; Go to aimed at a qualifier gets there |
| `tests/capability.test.ts` | Phase 1: walking out of time is a timeout; a survive skill succeeds at time-up only if it survived; pinned vs active revision (and a pin to a dropped table falls back); farm use certified by default, opt-in and switch-off; eligibility reasons (missing skill, not allowed, nothing to aim at, paws full, too tired); trait aims `@crop` / `@storage` in nearest, conditions, and a learned Approach on the farm aimed at any ripe crop; routines, Fetch, direct jobs and plan rows through `runCapability`; option updates discounted by 0.99^ticks |
| `tests/notes.test.ts` | Notes: write ops and clamping, the conditions, the sense (value and size), rules writing notes when they fire and notes starting empty each try; validation (never written with a suggestion, rules use it but the pet can't sense it, more than 4); new note cards take the lesson's note name; *Patrol* learns with the note (≥ 60%, measured 70–80%) and not without (≤ 35%, measured 10–20%); on the farm the skill keeps its own notebook (the farm world never holds notes or a verdict); lesson 11's offering and steps (including *Counts up to* 2) |
| `tests/limits.test.ts` | Looser limits: a sparse table computes exactly what the dense one does (20,000 random updates, decisions and serialisation); a 6-sense lesson (279,936 situations) is refused by a Standard brain and learns with a Big one (≥ 55% at 30,000 tries, measured 70%), with a bounded learning curve; more than 8 senses is refused even for Big; a Big skill keeps only its two newest tables, older revisions can't be rolled back to, and it exports as a skill card; limits and lesson-card ranges |
| `tests/baskets.test.ts` | Baskets: lift carries the basket and its contents, pick still takes one item; put down at the house it empties (every item sells) and stays held; at a shed as much as fits; refused on a crop, set down on open ground; old pen baskets lift but have nothing to empty; *Stocked storage* fills (and varies) the amount, *Stock* and *all empty* read it; the *Empty the basket* routine trains over Approach to ≥ 80% (random < 10%); on the farm the starting basket is carried next to the crops and runs happen; with two baskets a harvest goes to the one with room; a pet holding a basket finishes the run first, even when tired; (phase 3b, learned Basket run) a basket is set down beside a crop; with Harvest to storage, crops go into the basket and runs empty it at the house; without a Basket run skill there are no runs |
| `tests/roster.test.ts` | Pet roster: four pets never share a tile (outside the house and storage) or a target over 1,500 ticks, and a fifth is refused; deterministic with four; taking a helper off duty removes its body and runtime, taking the lead off promotes the first helper, the last pet can't leave; make lead swaps places; "who does what" and tile descriptions (basket, ripe bush, locked plot, empty grass); v7 → v8 migration; under 4 ms per tick with four pets (measured 0.19) |
| `tests/layout.test.ts` | Farm layout: a placed basket costs nothing until applied, then is empty storage; refusals with reasons (door tile, coop, occupied, off the farm, locked, max count, plot budget, coins); walling in the well is refused on the last fence; removing refunds half (all of it if placed in this draft), and full storage, the house and rocks can't be removed; moving a bush takes its plot and ripe berry along and it regrows there; the orchard's fence and gate, the house, well and pond stay put, and the budget is 14 after the orchard; a placed pumpkin patch comes planted, ripens and unlocks pumpkins in pens; a shed after Fetch; previews compare as-is with the draft deterministically without changing the game; v6 → v7 save migration; a resting second pet naps at the house; lesson 10 offering and step order |
| `tests/farmlife.test.ts` | Farm life: a basket holds 6 of one kind (a 7th or another kind is refused and left beside it, nothing lost); a shed holds 4 slots × 10 and picking takes from the fullest; pens' containers are unlimited as before; coins come only from the house (the walk home comes between picking and earning); harvests go to the house without Fetch, to the nearest storage with room with it; a Fetch pet on Auto stores and hauls; Haul empties storage into the house (coins = sold × price); never stuck from 0 coins; deterministic; the shop's shed; requests count sales, not picks or storing; the storage-full tip; v5 → v6 save migration; **phase B:** plant turns soil into a growing patch (and fumbles without coins; free in pens); a harvested field plot goes back to soil and waits while bushes regrow; a pet on Auto replants and pays for seeds; *Can afford seeds*; crows head for sunflowers before berries; the dawn seed packet; crop balance (each sale ≥ 3× its seed, profit per trip rises with growing time); the ability order is preserved; a 2-day farm with replanting ends in profit |
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

## Recipe sweep (polish phase 1): `npx tsx scripts/recipe-sweep.ts`

Every built-in recipe at default traits on 6 training seeds (its own, 11, 22, 33, 44, 55), with Approach (and Morning chores' four skills) trained first. Gate: ≥ 80% on unseen layouts on every seed. After the fixes (about 3 minutes):

| Recipe | % per seed | Recipe | % per seed |
|---|---|---|---|
| Go to the berry | 85 85 90 90 85 85 | Harvest | 90 90 85 85 95 95 |
| Bring it home | 95 95 100 95 85 95 | Harvest to storage | 90 90 85 85 95 95 |
| Avoid the pond | 90 90 85 85 80 90 | Basket run | 85 90 95 95 100 100 |
| Wait for it | 90 85 80 95 95 90 | Plant | 90 95 90 85 100 100 |
| Keep clear | 90 95 85 80 85 85 | Herd a chicken | 80 85 95 90 85 90 |
| Water the garden | 80 90 90 100 95 80 | Open the gate | 95 100 95 95 95 100 |
| Empty the basket | 95 100 100 90 95 95 | Shut the gate | 90 90 95 90 90 95 |
| Patrol | 85 90 90 80 85 85 | Fetch routine | 95 95 100 95 85 95 |
| Morning chores | 85 95 95 100 95 80 | | |

What it took:
- **Approach practises among obstacles** (*Obstacles: some rocks*, 3,000 tries). That alone lifted Harvest, Harvest to storage, Plant and Basket run, which walk with it, from dips of 55–75% to ≥ 85%. The Field Guide's first lessons keep the classic pen.
- **More practice** where the per-seed misses were noise of too little practice: Bring it home, Wait for it, Keep clear, Herd and Fetch routine ×2; Avoid, Water the garden and Patrol ×3 (Patrol also gains Heading). Heading or Walls made Water the garden worse.
- **Empty the basket became a routine** (Approach → basket, lift, Approach → house, put down). As one sense skill it stayed at 70–85% even with Walls, Heading and 4× practice, and the new report said *loops*; it is the *long chain* case.
- Lessons that compare setups keep their old practice so the contrast stays clear: *Invent a skill* (2,500 tries) and *Give your pet a notebook* (Patrol without Heading, 10,000 tries).
- Farm effect (`bench:farm --learned`, 3 seeds, vs before): Auto 103% / 100% (standard / held-out), learned picks 109% / 105%, two pets 127% / 114%, Harvest only 90% / 94% (within the single-seed spread).

## Farm benchmark on 5 seeds (polish phase 2): `npm run bench:farm -- --learned`

Seeds 101 / 202 / 303 / 404 / 505 (was 3), 2,400 ticks. Each row reports the mean and spread. Seeds 101–303 give the same coins as the 3-seed run, so the comparison with the phase-0 baseline uses those three.

| Setup | Standard farm: mean (min–max, sd) | Held-out farm: mean (min–max, sd) |
|---|---|---|
| Auto (your order) | 258 (240–268, ±4%) | 227 (193–261, ±11%) |
| Auto (learned picks) | 247 (206–268, ±9%) | 200 (191–210, ±3%) |
| Two pets | 302 (250–320, ±9%) | 273 (225–294, ±9%) |
| Harvest job only | 150 (113–174, ±14%) | 209 (190–225, ±6%) |
| Learned Harvest only | 150 (133–163, ±8%) | 215 (186–242, ±9%) |

A change smaller than the spread on one seed isn't a finding; compare means over all 5 seeds.

**Polish phase 3 (renames, removals, file splits):** all 60 runs (12 setups × 5 seeds) give exactly the same coins, sales and jobs as before (the gate allowed ±2%).

**Executive practice in the browser:** with practice and the comparison in a worker, the L14 browser check records no main-thread task over 50 ms (the long-task threshold) while practising. Before, the 4 practice days and 9 comparison days ran in one synchronous call on the page (about 0.4 s in Node).

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

## Manual checks done
In headless Chromium (Playwright), at desktop 1280×900 and phone 390×844:
- Full tutorial to first farm delivery, Fetch lesson, loophole discovery with replay and repair, carrot deliveries, Steer by keyboard, Pets, Journal, export, and import.
- No console errors. **Zero network requests to any other origin.**
- After one online load, the page reloads and a full lesson trains with the network disabled.
- No horizontal scroll on phone width.
- Docs polish pass: Farm, Teach, Pets and Guide at both sizes with an expanded two-pet save; no page errors, no horizontal scroll.
