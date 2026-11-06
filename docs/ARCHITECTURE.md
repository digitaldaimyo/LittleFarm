# Architecture

How Pen Deck is built today. What it is and how it plays: `docs/DESIGN.md`. How it is tested and measured: `docs/TESTING.md`. The phase-by-phase notes behind each part are in `docs/history/ARCHITECTURE_LOG.md`.

```
src/
  domain/       the typed spec, card registry (packs/farm.ts), validation, the hand, recipes, repairs,
                sentences (describe.ts), the card reference (cardref.ts), old card names (aliases.ts)
  sim/          the deterministic gridworld (world.ts), compiling a lesson (compile.ts) and building a pen (generate.ts)
  learning/     senses and features, Double-Q tables, policies and executors, the trainer and its worker,
                reports and findings (report.ts, diagnose.ts), summaries, the probe, measured checks (lint.ts)
  game/         pets and skills, the farm (farm*.ts), responsibilities and the executive, capabilities,
                layout, requests, progression, the Field Guide, coaching, skill and lesson cards, sound cues, journal
  persistence/  the versioned save format and storage (IndexedDB, localStorage fallback)
  audio/        sound recipes (kit.ts) and the Web Audio engine (engine.ts)
  ui/           React presentation only (store, screens, binders, cards and sleeves, charts, replay)
tests/          vitest suites; fixtures/ holds a v1 and a v10 save, a player's skill card and layout fingerprints
scripts/        benchmarks (bench.ts, bench-farm.ts, recipe-sweep.ts), the card reference, the layouts fixture,
                the browser test (e2e-guide.mjs + e2e-save.ts) and tutorial evidence
public/sw.js    service worker for offline play
```

**The academy edition (Academy roadmap, phase 0).** `game/academy.ts` holds the school (courses, ranks, per-pet records, acorns).
- **Edition switch:** a game with `GameState.academy` is the academy edition. `newAcademyGame()` makes one, and the app uses only that. `newGame()` (the farm edition) remains for tests and benchmarks until Academy phase 6.
- **What the academy edition switches off:** earnings, requests, seed costs, unlocks from coins and lesson energy, each checked at its source in `game/farm.ts`, `game/farmworld.ts` and `game/state.ts`.
- **Saves:** the `pen-deck-academy` format (`ACADEMY_SAVE_VERSION`), loaded only by `parseAcademySave`, in a fresh storage slot.
- **UI:** `ui/AcademyScreen.tsx` is the Academy tab.
- **Challenges** (`game/challenges.ts`, Academy phase 1):
  - `CHALLENGES` (each with a base lesson, a bar, stars, allowed cards and a reference solution); `openChallenge`; `enforceChallengeLocks`, which the store runs after every change; `cardAllowed`, used by the hand; `certify`; `challengeStatus`.
  - UI: `ui/ChallengeBanner.tsx` (the brief in the Lab, and the Certify button on a finished report).
- **Courses and the Lab** (Academy phase 2): `courseOpen`, `courseOfCard`, `labCardAllowed` (the Lab's hand) and `recipeLock` (the Curriculum's recipes), in `game/challenges.ts`.
- **The Homestead** (`game/homestead.ts`): `DECOR` and `buyDecoration` (stored in `academy.decor`, drawn by `WorldView`'s `decor` layer), and `homeLife`, which `chooseInvocation` asks when an academy pet has nothing to do.
- **Playtest measures** (`game/measures.ts`): `measureOpen` / `measureRun` / `measureCertify`, which record only while `settings.measures` is on, plus `measuresSummary` and `exportMeasures`.

**Ground rules.**
- Game rules never import React.
- The UI edits the **canonical spec** (`StageSpec`, `SpecNode`), and everything else compiles from it. The Inspect binder shows that exact JSON.
- The simulator is deterministic: a seed and a list of actions give identical traces. Pens, evaluation, previews and the farm all run the same simulator, so a preview is the real future.

## The spec and the card registry

- **Types.** `TypeExpr` is nominal (`Event`) or generic with trait arguments (`Kind<Carryable>`). `fits(socket, out)` needs the same base name and every trait the socket asks for, so `PickUp(what: Kind<Carryable>)` rejects a rock. `Object<Qualifier>` fits `Kind` slots.
- **Cards.** A `CardDef` has:
  - a stable `id`, an `output` type, typed `sockets` (required, many, or active only for some parameter values);
  - literal `params`, an `evaluator` binding, an optional `unlock`;
  - presentation: title, sheet, hint, and a phrase template.

  Kind cards are generated from object definitions (`domain/packs/farm.ts`), so a new object adds data, not screens. `retired` cards (Wander) still load but are never offered.
- **Nodes.** `SpecNode = { id, cardId, args, extensions? }`. Unknown args and extensions round-trip untouched. Unknown card ids are kept and reported, never dropped. Old ids (`job.forage`, `job.deliver`, `job.tote`, `plan.row`) are renamed on load by `domain/aliases.ts`.
- **Rules.** *WHEN Event [IF Condition…] THEN Effect… [LIMIT]*, plus stage-level SUCCESS and FAIL (stored as `cond.and` / `cond.any` lists). Limits: every time, once per try, once per object, cooldown. A rule switched off (`args.off`) stays on the mat but isn't compiled.
- **Validation** (`domain/validate.ts`):
  - **Errors:** unknown cards, type mismatches, missing inputs, bad params, out-of-scope *It*, references to things not placed, qualifiers inside events, sense and situation budgets, too many notes.
  - **Warnings and info:** repeatable rewards, per-tick rewards, pick/drop loops, notes never written or never sensed.

  A trait kind (Any ripe crop, Storage with room) counts as placed when any placed object has the trait. Warnings carry repairs (`domain/repairs.ts`).
- **The hand** (`domain/hand.ts`): compatible → available → relevant, ranked deterministically (type fit, the slot's role, abilities, placed kinds, the learner's focus, your cards first). After a pick, the editor focuses the next empty required slot. A card's chip shows every active slot, including ones its phrase doesn't mention.
- **Sentences and the reference.** `domain/describe.ts` reads any card or rule as a sentence from its phrase template. `domain/cardref.ts` builds the Guide's searchable card reference from the registry: where each card fits, by output type, and a one-line example.

## The simulator

- **The world** (`sim/world.ts`) is a tick-based grid. `step(world, action)` returns events (move, bump, reach, enter, pickup, drop, deliver, fumble, stay, fill, water, shoo, scare, peck, enter/leave area, gate, full, plant, lift, empty); rewards, diagnostics, animation, sound and the journal all consume them.
  - **Objects:** solid objects block; hazards are walkable but emit `enter`; carried objects move with the pet.
  - **Storage:** an object with storage holds `{ kind, n, ids }` slots, so an item keeps its identity through storage and "once per object" holds. Dropping onto a container stores, sells (the house) or reports `full`.
  - **Portable storage:** a basket can be lifted with its contents, and is emptied wherever it's put down.
- **Optional world features** (absent unless used): night, water carried and wet plots, areas, gates (`open`), rain, creatures (chickens wander, crows peck; moved by `world.rng` after the pet acts), seed money (`plant` buys a seed), energy, notes (`World.notes`, 4 per try, 0–9), and the event tally used by *Has done…* (`World.tally`, kept only when a lesson uses memory).
- **Trait aims and qualifiers.** Kinds may be trait aims (`@crop`, `@storage`) or selector strings from qualifier cards (`#["furthest","berry","home"]`). `nearest`, `objIs` and `aimIs` resolve them, so every kind-taking condition, measure and sense works with them unchanged. Inside events, a qualifier is matched against what it pointed at when the step began (`World.selBefore`).
- **Compiling a lesson** (`sim/compile.ts`): `compileStage` turns a `StageSpec` into a `CompiledStage`. `evalStep` applies rules with limit bookkeeping; `isSuccess` / `isFail` evaluate SUCCESS and FAIL. Task success is always measured by SUCCESS, never by reward. A rule's *End try* sets `World.verdict` (judged by SUCCESS, success or miss).
- **Building a pen** (`sim/generate.ts`): `generateWorld(spec, seed)` places pinned things, the pet, then scattered things (regions, varying counts, "about half the tries", obstacles, stocked storage, pen size). It re-rolls until every goal has a dry path. `tests/layouts.test.ts` pins every recipe's layouts to a fixture.

## Learning

- **Templates.** A lesson's `LearnerSpec` has a template:
  - `sense`: a tabular learner over player-chosen sense cards. Approach and Avoid are presets.
  - `fetch`: a learned option controller over the pet's Approach.
  - `routine`: an option controller over the pet's own skills and actions, watching up to 4 conditions.
- **Senses** (`learning/senses.ts`) compile into a mixed-radix encoder. Each card declares its radix, and the preset reproduces the original movement index exactly, so old policies load. Abilities map to an ordered action list; impossible actions are masked. Rarely seen states back off to coarser views.
- **Tables** (`learning/qtable.ts`): Double Q-learning. A dense table holds up to 100,000 situations; above that (the Big brain) a sparse map holds only visited situations. Both compute identical updates.
- **Training** (`learning/trainer.ts`, `learning/session.ts`): one loop for all templates. Options (Fetch, routine choices) use a semi-Markov update. `TrainingLoop` runs in a Web Worker (`trainer.worker.ts`), with an inline fallback, in chunks that honour pause, cancel and speed.
- **Seeds:**
  - training: `hash(stage.seed, i) mod 800000`;
  - evaluation: 900000+;
  - transfer pens: 950000+.

  They never overlap.
- **Temperament → parameters:** Curiosity sets the exploration floor; Persistence the time limits of options; Caution an extra penalty for hazards. Feedback (👍/👎 on a replay) adds a small bonus to those state–action pairs.
- **Reports** (`learning/report.ts`) compare before, random (and random choices, for routines), after and transfer, and add:
  - **loopholes** (`findExploits`: rules that pay without the goal, the same object paid repeatedly);
  - **findings** (`learning/diagnose.ts`): big treat never happened, can't tell apart, loops, long chain, each with a lesson link and, for loops, a replay;
  - a behaviour summary (`learning/summary.ts`), from which `curiosities` write journal notes.

  `learning/probe.ts` reads the learned choice on any tile. `learning/lint.ts` runs 30 random tries to catch SUCCESS and rules that disagree.

## Pets and skills

`game/pets.ts`:
- **Revisions.** A pet's skills are versioned revisions, each keeping its own lesson, senses, actions, evaluation and table. Certification is held-out success at or above the lesson's bar.
- **Routines** record the sub-skill revisions they used (`uses`), and the game warns when a sub-skill changes.
- **Big tables:** a Big skill keeps only its active and newest tables.
- **Sharing:** `game/skillcard.ts` and `game/lessoncard.ts` export and import validated JSON. Import renames old card ids.

## The farm

| Module | Holds |
|---|---|
| `game/farm.ts` | the runtime: `FarmRuntime`, `farmTick`, each pet's turn, farm events, who is on duty, the crew |
| `game/farmworld.ts` | world upkeep: size, crops and prices, the day clock, weather, creatures, regrowth, seed gifts, `cropSpot`, `toteTarget`, `describeTile` |
| `game/farmjobs.ts` | job executors: each job runs a learned skill through `runCapability` (`game/capability.ts`), with its time limit; claims |
| `game/farmexec.ts` | the executive glue: `farmContext`, `chooseInvocation`, `finishInvocation`, `workDone` (the world fingerprint progress is judged by) |
| `game/farmlessons.ts` | runs on copies of the farm: `previewPlan`, `practiseExecutive`, `compareExecutives`, `compareAndDiagnose` |
| `game/responsibilities.ts` | the starter set, `jobPlan`, `compilePlan` (WHEN / USE / OR USE / UNTIL rows into jobs), `jobPossible`, warnings |
| `game/plan.ts` | the ordered executive: `chooseDuty` (needs → priority → commitment → evidence → cooldowns, with a reason), `afterDutyJob`, the trace |
| `game/learnedpicks.ts` | learned picks: `ExecValues` (which responsibility, and which job for it, per situation), `rankWeight`, exploring |
| `game/orderdiagnosis.ts` | what learned picks say about the order: `diagnoseOrder`, `applySuggestion` |
| `game/execpractice.ts`, `game/exec.worker.ts` | executive practice and comparison as steps, run in a worker with progress and Stop |
| `game/layout.ts`, `game/expand.ts`, `game/requests.ts` | layout drafts and previews, the orchard expansion, neighbours' requests |

- **Learned jobs.** `game/capability.ts` binds each job to the pet's own skill or routine (`LEARNED_JOBS`, `jobSkill`, `jobCapability`) and runs it with `runCapability` (sense skills, Fetch and routines alike). There is no scripted fallback: a job with no learned skill isn't eligible.
- **Pets on the farm.** The lead's job state lives in `FarmState`, helpers' in `FarmState.helpers` (up to 3). While one pet acts, the others are obstacles and their claimed objects are hidden, so pets never chase the same thing.
- **The executive.** Auto runs `chooseDuty` over the pet's `Responsibilities` (`pet.plan`) at each job boundary.
  - **Modes** (`ExecHow`): `order`, `learned`, or `random` (comparisons only).
  - **Learned values** update from what each job achieved in the world (`afterDutyJob` → `learnFromPending`), weighted by the row's place in the list.
  - **Order diagnosis:** during comparisons only, `PlanRuntime.picks` tallies where learned picks differ from the order; `diagnoseOrder` turns that into the verdict and a one-tap suggestion.

## Field Guide and coaching

- `game/tutorial.ts` holds `CHAPTERS`. Each lesson has `offered(s)`, an `opensWhen` hint, an optional `start(s)` that creates its practice pen, and `steps`. A step has `done(s)`, optional `ack` and `action`, and a `highlight` naming a `data-tut` key. A lesson can also have a `compare` of recorded runs.
- `advanceTutorial` runs after every store mutation. Guide pens and the first lesson cost no energy.
- `game/coach.ts` turns reports and farm state into tips with lesson links.
- The UI outlines and scrolls to the highlighted control; `ui/GuideScreen.tsx` holds the lesson list, comparisons, the notebook, the glossary and the card reference.

## Saves

- **Format.** Saves are **v11** (`SAVE_VERSION`). `persistence/save.ts` reads the envelope `{ format: 'pen-deck-save', version, game }` and runs a migration table one version at a time (v1 → v11). It then fills missing sections from defaults, validates shapes, clamps numbers and reports unknown cards. Saves never execute code.
- **v11 renames** old card ids and job ids wherever they are stored (assignments, evidence, learned values, the job under way), keeping key order. It drops retired fields.
- **Storage.** `persistence/storage.ts` writes to IndexedDB, with a localStorage fallback; Settings exports and imports JSON.

## Sound

- **Cues.** `game/sound.ts` is pure: cue ids with their bus, priority, cooldown and length. It maps farm effects and replay events to cues, mixes the background, and limits cues (`CueLimiter`).
- **Synthesis.** `audio/kit.ts` has one synthesis recipe per cue. `audio/engine.ts` renders them once on the first user gesture, plays them with small pitch variety and stereo position, loops seeded birdsong, crickets and rain, and schedules the opt-in music box. It never fetches anything.
- **Settings** are in `settings.audio`, filled and clamped on load.

## Extension points

- **New objects and cards:** add them to a pack file. Kind cards, the hand, validation and the card reference pick them up.
- **New evaluators:** add a case in `sim/compile.ts` (conditions, events, measures, effects, limits).
- **New skills** usually need no code: a custom skill is a lesson. A new learner template needs a case in `learning/trainer.ts`, an executor in `learning/policies.ts`, and metadata in `game/pets.ts`.
- **New farm jobs:** a job card in the pack, an entry in `LEARNED_JOBS`, and an executor in `game/farmjobs.ts`.
- **New Field Guide lessons:** a chapter in `game/tutorial.ts`, plus `data-tut` hooks on any control it highlights.
