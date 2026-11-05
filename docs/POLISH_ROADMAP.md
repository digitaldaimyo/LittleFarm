# Polish roadmap: make what we have better

Status: **official**. We stop adding features and improve what exists. It follows `PEN_CARDS_ROADMAP.md` and `LEARNED_FARM_ROADMAP.md`, which are both complete.

## Why (the critique, with evidence)

1. **Pens can fail silently.**
   - "Keep 3 berries in the basket" as a sense skill never learned, even at 30,000 tries: its big treat never fired in practice. The report showed 0% and said nothing.
   - The two gate recipes lacked a sense they needed.
   - Approach needs obstacle practice to hold up on the farm.
   - Harvest looped pick-up / put-down after a stuck walk.

   Each was found by reading traces, which a player can't do.
2. **The new power isn't taught.** Compare and its measures, qualifiers, *Storage of one*, UNTIL / OR USE, aimed jobs and learned picks are tested and documented, but no lesson uses most of them. There are 126 cards.
3. **Learned picks have an unclear pitch.** On a good order they earn 84–95% of the fixed order; they only win when the order has a mistake.
4. **Executive practice freezes the page.** Practice plus comparison runs on the main thread (about 0.4 s in Node, more in a browser). Pen training already uses a worker.
5. **Code health:**
   - Code names differ from what players see: `forage` / `deliver` / `tote` / `bin` / `plan.row` / `chooser` versus Harvest / Haul / Basket run / Basket / Responsibility.
   - Dead code remains: `harvestTarget` / `harvestDestination`, the old bandit's `ExecutiveTable`, `describeContext`, `FarmPlan.chooser`.
   - Old modes (direct jobs, plan) are converted at runtime as well as in saves.
   - Some files are large: `farm.ts` 1,077 lines, `TeachScreen.tsx` 1,060, and `plan.ts` mixes responsibilities with both executives.
   - Recent save fields went in without a version bump.
6. **Tests and CI:**
   - Twice a test failed only in the full run because it adopted a pet with a random temperament.
   - The only CI is the Pages deploy; nothing runs typecheck, lint or tests on push.
   - Single-seed benchmark numbers move by ±10% between runs.
7. **Docs sprawl:** 13 docs, about 2,800 lines, several of them finished plans. `GAME_DESIGN` has been patched phase by phase.
8. **We don't know how it plays now.** Every number comes from the simulation, and the first coin now needs the Harvest lesson.

## Decisions

- **No new features in this push.** Changes are explanations, teaching, reliability, structure and docs.
- **Behaviour stays measurably the same** through the clean-up phases. The test suite and `bench:farm --learned` are the referees.
- **Lessons are improved, not added:** new cards are taught inside existing lessons.
- **Playtest measures are local and opt-in.** Nothing leaves the device unless the player exports it.

## Phases and gates

### Phase 1: "Why isn't it learning?"
**Status: done.** Findings live in `src/learning/diagnose.ts` and show in the training report with a lesson link and, for loops, a replay. Every recipe passes the sweep (≥ 80% on 6 seeds; numbers in `TESTING.md`). Fixes: Approach practises among rocks, more practice for eight recipes, Patrol gains Heading, and *Empty the basket* is now a routine.

- **New report findings** (they show beside the existing loophole and below-random warnings, each with a lesson link):
  - **Big treat never happened:** a rule with *End try* / SUCCESS never fired, or fired in under 1% of practice tries. Suggests stepping-stone treats, or a routine for multi-step jobs.
  - **Can't tell apart:** practice keeps meeting the same sense state where different actions paid off in different layouts, so a sense is missing. The report names the situation in words ("standing at the basket, carrying nothing").
  - **Loops:** after training, it keeps stepping between the same two or three tiles. Suggests the Walls or Heading sense, or obstacles in practice.
  - **Long chain:** SUCCESS needs several deliveries or legs, and the skill is a single sense skill. Suggests a routine.
- **A recipe sweep:** every built-in recipe at default traits on 6 training seeds (including its own), through the probe and audit. Fix any recipe that is marginal (under 80% on any seed, or showing a loop or can't-tell-apart finding).
- **Gate:**
  - Each finding is reproduced by a small pen in tests, and shows up in its report.
  - The "keep 3 berries" sense pen reports *big treat never happened* and *long chain*.
  - Every recipe is ≥ 80% on all 6 seeds.

### Phase 2: Background practice, test hygiene, CI
- **Executive practice and comparison run in a worker**, like pen training, with progress and a cancel button. The page stays responsive.
- **Test helpers adopt pets with fixed traits by default.** A test that wants a random temperament asks for it.
- **CI on push:** typecheck, lint, unit tests and `e2e:cards`.
- **Benchmarks** use 5 seeds per setup (was 3) and report the spread.
- **Gate:**
  - No main-thread task over 100 ms during practice (measured in the browser test).
  - CI green on the branch.
  - The full suite passes 3 times in a row.

### Phase 3: Clean-up and renames (no behaviour change)
- **Rename internals to the player's words:**
  - jobs: `forage`→`harvest`, `deliver`→`haul`, `tote`→`basketRun`;
  - the responsibility card id gets an alias, with the old id still loading;
  - `FarmPlan`→`Responsibilities`;
  - executive modes `rules`/`learned`→`order`/`learned`.
- **Remove:** `harvestTarget` / `harvestDestination`, `ExecutiveTable` / `describeContext`, `FarmPlan.chooser` / `table`, and the runtime conversion of old modes (the save migration handles them).
- **Split large files:**
  - `farm.ts` into world upkeep, jobs (executors), the executive glue, and executive lessons;
  - `plan.ts` into responsibilities, the ordered executive, and learned picks;
  - `TeachScreen.tsx` into its binders.
- **Saves v11:** normalise the additive fields (storage ids, evidence, executive values) and drop the retired fields.
- **Gate:**
  - All tests pass unchanged (only imports and names change).
  - `bench:farm --learned` is within ±2% of before on every setup and seed.
  - A v10 save loads with every skill and responsibility intact.
  - No file over 700 lines.

### Phase 4: Teach what's there
- **Fold the new cards into existing lessons:**
  - *Responsibilities:* add an UNTIL with **Stored ≥ 3**, and an OR USE.
  - *Give your pet a notebook:* show where a measure (Stored, Sold) replaces a hand-made counter, and when a note is still the right tool.
  - *Combine skills:* point to *long chain* (phase 1) as the reason routines exist.
  - Qualifiers: one step in an existing pen lesson aims a sense at "the furthest berry from the house".
- **In-game card reference:** the Guide's glossary gains a searchable list of every card (from the registry, as in `docs/CARD_REFERENCE.md`), with "where it fits" and a one-line example.
- **Gate:**
  - The browser test plays the changed lessons.
  - Each new card family is used by at least one lesson.
  - A card-reference search finds cards by title or hint.

### Phase 5: Learned picks as a diagnosis of your order
- After practice, the comparison also **names what the learned picks changed**, e.g. "it skips *Otherwise nap* at the top — move it down?" or "it prefers Haul over Basket run when storage is half full". It offers a one-tap edit to the order.
- Learned picks stay available as a mode, but the lesson leads with the diagnosis.
- **Gate:**
  - On a bad order ("Otherwise nap" first), the diagnosis names that row.
  - Applying its suggestion brings the fixed order to within 5% of the learned picks.
  - On a good order, it says the order is fine.

### Phase 6: Docs consolidation
- **One current `docs/DESIGN.md`** (what the game is and how it plays now) and **one `docs/ARCHITECTURE.md`**.
- Finished plans and roadmaps move to `docs/history/`.
- The README becomes a short front page linking to them.
- **Gate:** no current doc describes retired behaviour (direct jobs, wander, the starter plan as Auto rules, the old bandit). Links in the README and in the docs resolve.

### Phase 7: Playtest measures
- **Local, opt-in measures:** time to the first coin, time and tries per lesson, reports at 0%, which report findings appeared and whether the next try improved, and lessons skipped or abandoned.
- Shown in Settings as a plain summary; exported with the save, or on its own, only when the player chooses.
- **Gate:**
  - Off by default, and nothing is recorded while off.
  - The summary is readable without the docs.
  - Exported measures contain no pet names or free text.

## Out of scope (later)

New cards, recipes, farm features and lessons.
