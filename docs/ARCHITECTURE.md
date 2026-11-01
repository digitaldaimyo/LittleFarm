# Architecture

```
src/
  domain/       canonical typed spec, card registry (Farm pack), validation, contextual hand, recipes, repairs
  sim/          deterministic gridworld (rng, world, compile: spec → runnable stage)
  learning/     features, Double-Q tables, policies/executors, trainer, evaluation/report, executive, worker
  game/         pets & skills, farm runtime, plans, requests, expansion, progression/shop,
                Field Guide (tutorial), coaching tips, skill cards, journal, game state
  persistence/  versioned save format + IndexedDB storage (localStorage fallback)
  audio/        sound kit (synthesis recipes) and the Web Audio engine (browser only)
  ui/           React presentation only (store, screens, cards/sleeves, charts, replay)
tests/          vitest suites (+ fixtures/ with a real v1 save)
scripts/        bench.ts (npm run bench), tutorial-evidence.ts (npm run evidence),
                e2e-guide.mjs (npm run e2e, Playwright) + e2e-save.ts (its prepared save)
public/sw.js    service worker for offline play
```

Game rules never import React. The UI edits the **canonical spec** (`StageSpec`, `SpecNode`) and the simulator and learners compile from it. The Inspect binder shows that exact JSON.

## Canonical spec and registry

- `TypeExpr` is nominal (`Event`) or generic with trait arguments (`Kind<Carryable>`). `fits(socket, out)` requires the same base name and that every trait the socket asks for is one the output carries. So `PickUp(actor: Actor<CanCarry>, what: Kind<Carryable>)` rejects a Rock card.
- `CardDef` has a stable `id`, `pack`, `version`, `output`, typed `sockets` (required / many), literal `params`, an `evaluator` binding, `bindsIt` (whether the event binds the scoped reference `it`), an optional `unlock`, and presentation (title, sheet, phrase template).
- `SpecNode = { id, cardId, args, extensions? }`. Unknown args and `extensions` round-trip untouched. Unknown card ids are kept and reported, never dropped.
- Rule grammar: `WHEN Event [IF Condition…] THEN Effect… [LIMIT]`, plus stage-level `SUCCESS` / `FAIL` conditions. Limits: every time, once per try, once per object, cooldown.
- `validateStage` reports these as **errors**: unknown cards, type mismatches, missing inputs, bad params, out-of-scope `it`, references to kinds not placed in the pen, missing success, and walled-in fixed goals. It reports these as **warnings**: repeatable rewards, positive per-tick rewards, inverse pick/drop loops, closer-only shaping, and no reward at all. Warnings carry optional repair actions (`domain/repairs.ts`).
- `buildHand` runs compatible → available → relevant. Ranking is deterministic, using type fit, placed kinds, the learner's focus, recency and favorites, with id as the tiebreak. Locked cards stay visible with a reason.
- Content packs: `domain/packs/farm.ts` declares object definitions (traits, solid/hazard/carryable/container) and cards. Kind cards are generated from object definitions, so a new pack adds data, not screens.

## Simulation

`sim/world.ts` is a tick-based grid. Each `step(world, action)` returns an event list (`tick, move, bump, reach, enter, pickup, drop, deliver, fumble`). Rewards, diagnostics, animation and the journal all consume that list. Solid objects block movement, hazards are walkable but emit `enter`, carried objects move with the pet, and dropping onto a container delivers.

`sim/compile.ts` turns a `StageSpec` into a `CompiledStage`:
- `generate(seed)` places fixed objects, then the pet, then scattered objects. It re-rolls up to 40 times until every goal object has a dry path from the pet.
- `evalStep` applies rules with limit bookkeeping and produces reward, per-rule hits for the ledger, and termination.
- `isSuccess` / `isFail` evaluate the stage conditions. **Task success is always measured by the SUCCESS condition, never by reward.**

The same simulator runs pens, evaluation and the farm. Fixed seed + fixed actions gives identical traces (tested).

### Watering and night (sim)
- `World.night`, `PetBody.water` (0–3) and `Obj.wet` are optional fields, so older worlds stay valid.
- The `water` action is contextual. On a `WaterSource` (well) it fills up and emits `fill`. With water on a dry `Plot` it soaks the plot and emits `water` with `it` bound to the plot. Otherwise it emits `fumble`. Legality masking permits it only where it would do something.
- `place.time` (Time of day: day/night/random) sets `world.night` per generated layout. On the farm, `updateClock` sets it from `dayInfo(tick)` and spawns or removes fireflies at dusk and dawn. Reaching a firefly catches it (farm rule).
- New cards: `ev.fill`, `ev.water(it)`, `cond.watered(kind, n)`, `cond.hasWater`, `cond.night`, and the senses `sense.nearestDry(kind<Plot>)` (27), `sense.water` (2) and `sense.night` (2).
- `ref.target` now takes on the traits of the kind it is aimed at (`effectiveOutput`), so "the target" fits `Kind<Plot>` sockets when a skill is aimed at a patch.
- Saves are v3. The v2 → v3 migration adds a well to existing farms.

### Creatures and areas (Milestone 2)
- Creatures are objects whose `ObjectDef.mover` is `wander` (chicken, solid) or `crow` (flies, not solid). After the pet acts, `moveCreatures` runs in id order using `world.rng`. Crows step toward the nearest crop (avoiding scarecrow radius 2) and `peck` it on arrival (`world.counts.pecks`).
- `shoo` (ability `shoo`) acts on creatures within 1 tile. A chicken is pushed one tile directly away if the tile is free (`shoo` event). A crow leaves (`scare`). Movement that crosses an area boundary emits `enterArea` / `leaveArea` with the area name.
- `World.areas: {name,x,y,w,h}[]` come from `zone.rect` placements (fixed or random each try). Random placements skip area tiles. On the farm, the coop is `{coop, 0,5, 2×2}`.
- Cards: `area.named(name)` (type `Area`; validation errors on unknown names); `ev.shoo(it)`, `ev.peck(it)`, `ev.entersArea(it)`, `ev.leavesArea(it)`; `cond.inArea(count)`, `cond.allInArea`, `cond.petInArea`; `q.pecks`; senses `sense.area` (27), `sense.outside` (nearest one outside an area, 27) and `sense.areaFrom` (direction from that one to the area, 27).
- Farm: `updateCreatures` handles egg laying (coop only) and crow arrivals and departures. Deliver/Fetch picks the nearest carrot or egg. Saves are v4 (adds the coop area and creature PRNG).

### Routines (Milestone 3)
- Template `routine`: `learner.routine = { options: SpecNode[] (opt.skill | opt.action, ≤6), watch: SpecNode[] (Condition, ≤4) }`.
- `learning/routine.ts → compileRoutine(stage, subskills, traits, target?)` builds the state bitmask from the watched conditions (≤16 states) and the options. Each option gets a legality test (its *only when* card plus intrinsic "can it do anything now") and a runner: `NavRun` for Approach/Avoid, `SkillRun` (until the sub-skill's own SUCCESS or its time limit) for custom skills, or one tick of an action. Every option takes at least one tick.
- `SubSkills` are snapshots of the pet's **active** sense-skill revisions (`subskillsFor(pet)`), resolved at training, evaluation and run time. Improving a sub-skill changes every routine that uses it, with no retraining.
- `Trainer` runs Fetch and routines through one SMDP Double-Q option loop (α 0.3, γ 0.9). When no option is legal, the routine idles a tick without a learning update. Reports add `randomOptions` (random legal option at each boundary).
- Saved routine revisions keep `uses: {skill, rev}[]` and a copy of their lesson (`stage`). `routineRunFor` runs them on the farm, and `staleUses` reports sub-skills that changed since certification.

### Farm plans (Milestone 4)
- `pet.plan = { rows: SpecNode[] (plan.row), chooser: 'first' | 'learned', guard, table? }`, and `assignment.mode = 'plan'`.
- `game/plan.ts`: `compilePlan` turns rows into `{ holds(world), job: {behaviorId, args} }`. Job cards map to behaviors (`job.goto` → `goto`, a `NavRun` to the aimed kind; `job.skill` → `skill`). `jobPossible` mirrors `eligibleBehaviors`. `choosePlanRow` returns the first applicable row (or a bandit pick), with the anti-dithering guard (`isThrashing`, `guardUntil`, `lastHold`).
- `chooseInvocation` (farm) handles plan mode after the "too sleepy" safety check. Invocations carry `chosenBy: 'plan'` and `args.row`. `world.petEnergy` is set each tick so `cond.energyBelow` works.
- `applyPlan` resets the runtime (no half-finished job, fresh plan memory, RNG from `farm.rngState`). `previewPlan` deep-clones the game, applies the plan and runs `farmTick`, so it is the real future under determinism.

### Gates, weather, expansion, requests (Milestone 5)
- `Obj.open` (gates). `blocks(o)` = solid object or a closed gate; `isSolidAt` uses it, so senses, legality, BFS and chickens all respect gates. The `nudge` action toggles `nudgeableGate(world)` (on or next to the pet; an open gate isn't shut on a pet or creature) and emits `gate` with `state`. Layout generation treats a closed gate as reachable from a neighbouring tile.
- `World.raining` comes from `place.weather` in pens (rain wets all plots at generation) or from `updateWeather` on the farm (`farm.rainUntil`, `farm.puddles`).
- `game/expand.ts → expandFarm` grows the world in place. Existing objects keep their coordinates, and orchard plots carry `unlock: 'orchard'`.
- `game/requests.ts`: `postRequests` at dawn (and at the first tick), `trackRequests` on every farm event list, `nightfallRequests` at dusk. Eligibility depends on what the farm has (chickens, Fetch, carrots, a watering skill, crows).

### Discovery tools and a second pet (Milestone 6)
- `learning/summary.ts`: `summarize(stage, traces, ledger)` re-simulates every held-out trace to build a `BehaviorSummary` (heatmap of offsets from the nearest target, action mix, endings, reward shares). `evaluate(... 'evaluation')` attaches it, and `saveRevision` stores it. `curiosities(stage, summary, name)` turns it into journal notes.
- `learning/probe.ts`: `probeTile`/`probeField` read Q-values (with the same backoff as acting) and report action, softmax confidence and whether a coarser view was used. `probePath` follows the greedy policy.
- `game/skillcard.ts`: `exportSkillCard` / `importSkillCard` (validated JSON, `format: 'pen-deck-skill'`). Custom sense skills now keep a copy of their lesson on each revision, too.
- Two pets: `farm.duty2PetId`, `world.pet2`, `farm.current2/stun2/queue2/rngState2`, `runtime.second`. `farmTick` runs `petTurn` for the first pet (creatures move and the clock advances), then `secondTurn`, which swaps the second pet into the primary slots and calls the same `petTurn` with `step(..., { advance: false })`. `withOtherPet` adds a transient solid `buddy` object at the other pet's tile and sets `hidden` on its claimed object (`runtime.claim`, the nearest target of its current job). `onGround` ignores hidden objects. Both are removed after the turn.

### Field Guide and coaching (tutorial)
- `game/tutorial.ts`: `CHAPTERS` (lesson 1 *First lesson*, then lessons 2–9). A chapter has `offered(s)`, an `opensWhen` hint for the Guide list, an optional `start(s)` that creates its practice pen (a stage with `extensions.guide`), `steps` (`done(s)`, optional `ack`, `action`, `highlight` = a `data-tut` key) and an optional `compare` (which recorded runs to show side by side).
- State lives in `progress.guide = { status, active, step }` and `progress.guideRuns` (one entry per finished guide training run: episodes, after, random, transfer, scattered, treats, variant). `advanceTutorial` runs after every store mutation: it advances the active step, finishes the chapter and offers newly relevant ones.
- Guide stages and the tutorial pen are free (`trainingCost` 0). Reports add a *Scattered layouts* row whenever a pen pins its target or start.
- `game/coach.ts`: pure functions from (stage, report, game) to tips with lesson links, dismissible for good via `progress.flags`.
- UI: `App.tsx` draws the lesson banner and injects a style rule that outlines `[data-tut="…"]` and scrolls it into view; `GuideScreen.tsx` holds the lesson list, comparisons, notebook and glossary.

### Teaching polish (memory, honest endings, measured checks)
- **Event tally:** `step()` records every notable event (not moves or ticks) in `World.tally`, but only in worlds that have one: `generateWorld` adds it when the lesson uses a memory card (`usesMemory`), and a farm `SkillRun` adds it when it starts. Lessons without memory pay nothing (training speed measured against the previous commit: within noise; an always-on tally cost 5–15%). The tally stores as `type|kind|state|area|into` → [count, last tick]. `cloneWorld` copies it; generated layouts start empty. *Has done…* (`cond.happened`) matches tally keys with the wrapped event's compiled matcher (`countSince`), *Just…* (`cond.just`) checks the last tick, and the *Done … yet?* sense (`sense.did`, ×2) does the same for the learner. Optional `CondCtx.base` / `encode(w, base)` let a farm `SkillRun` count from its own start (it snapshots the tally when it starts). Farm plans reject memory conditions for now.
- **End try** has three outcomes, `EndOutcome = 'judge' | 'success' | 'fail'`. A rule ending ✓ or ✗ sets `World.verdict`, which `isSuccess` / `isFail` honour before SUCCESS / FAIL. Save v5 migrates the old `'success'` (which meant "SUCCESS decides") to `'judge'` everywhere in a save (`migrateLegacyEndOutcomes`), and skill cards v1 → v2 the same way.
- **SUCCESS / FAIL lists** are stored as `cond.and` / `cond.any` roots. The UI (`ConditionList`) shows them as a list with an all/any switch and **+ and…** (which wraps a single card).
- `domain/describe.ts` renders cards and rules as sentences from their phrase templates. `domain/hand.ts` adds a slot role (`slotRole`) and ranks by abilities (`EVENT_ABILITY`), role and whether the pen has what a card needs; More cards are grouped (`COND_GROUP`).
- `learning/lint.ts → rolloutChecks` runs 30 random tries (seeds 700001+), recomputed when the lesson changes. It flags `goal-rule-shadowed` (SUCCESS ends ≥ ⅓ of tries before a goal rule ever fires), `end-never-success` (a rule ends tries judged by SUCCESS and none counted) and `success-at-start` (SUCCESS true at the start of ≥ 20% of layouts), each with a repair from `domain/repairs.ts`.

### Better pens (teaching polish, phase B)
- `generateWorld` gains Scatter regions (`inArea`, `nextTo`, `awayFrom`, `farFromPet`, with the conditional sockets `ref` / `area`), count variation (`vary`) and `chance`, the `place.obstacles` card, pet starts `inArea` / `awayFrom` (an *away from* pet is placed last, so it can avoid scattered things), and `StageSpec.varySize`. New options draw random numbers only when used; `tests/layouts.test.ts` pins every existing lesson's layouts to a fixture.
- `SocketDef.when` marks sockets used only for some parameter values. Validation, chips (`NodeChip`) and sentences (`describe`) skip them otherwise (`socketActive`).
- Conditions `cond.nextTo` (Chebyshev 1), `cond.kindNear` (any A within N of any B) and `cond.time` (step before or after N).
- Rules carry `args.off = 1` when switched off: they stay on the mat and in saves, `compileStage` skips them, and validation and the measured checks ignore them.
- UI: `PenView` has *Play it yourself* (its own compiled stage, world and rule state, stepping `step` + `evalStep` with sounds; never training) and `LayoutStrip` (six layouts from training seeds; tap to preview). The Environment binder adds pen-size buttons, Obstacles, and pickers for *next to / away from* and *inside*.

### Your cards, lesson cards, memory in plans (teaching polish, phase C)
- **Your cards** are `Template`s (`saveTemplate`). `placeTemplate` copies one with fresh ids, stores its name in `extensions.card` (shown as a tag by `NodeChip`), and leaves *blanks* (`exposed`: ids of kind cards inside it, chosen from `blankCandidates`) empty, returning the first blank's slot so the editor focuses it. The hand lists matching templates first under "Your cards", for any slot type, so named conditions work in SUCCESS, rules, routine watches and plans. They are copies, not references.
- **Lesson cards** (`game/lessoncard.ts`): `{ format: 'pen-deck-lesson', version: 1, lesson }`. Import checks format, shape, size (4–16), time and practice ranges, node count and unknown cards before adding anything. It then re-ids the lesson (`cloneStage`), renames on clash, and drops the Field Guide flag.
- **Memory in plans:** `CompiledRow.holds(w, base)`. The farm keeps a tally only when the duty pet's plan uses *Has done…* / *Just…* (`planUsesMemory`), and snapshots it into `PlanRuntime.base` whenever a job starts. Rows are tried between jobs, so they count what happened during the job that just finished.

### Sound
- `game/sound.ts` (pure): cue ids and their bus, priority, cooldown and length; `cueForFx`/`cuesForFarmFx` map one tick's `FarmFx` to cues (by type and tag; coins merge; stereo position from x; naps and rain listed in `SILENT_FX`). The farm adds sound-only effects (`type: 'sound'`: shoo, firefly, crow, dawn, dusk) that the view doesn't draw. `cuesForSimEvents` maps replay frames to the same cues (`SILENT_EVENTS` for moves, ticks and the like). `ambienceMix` says which background layers play; `CueLimiter` (per-cue cooldown, voice cap, thinner low-priority cues at high farm speeds, fake-clock testable); `AudioSettings` defaults, `sanitizeAudio`, `cueGain`.
- `audio/kit.ts`: one synthesis recipe per cue (oscillators and filtered noise with envelopes, glides, vibrato). `audio/engine.ts`: creates the AudioContext on the first user gesture with sound on, renders every recipe once with `OfflineAudioContext`, plays buffers through a compressor with ±3% pitch variety and stereo panning, and suspends while the tab is hidden. It never fetches anything. Ambience: three 12 s loops (`ambienceRecipe`: seeded birdsong, crickets, rain) rendered at 22 kHz with an extra 0.8 s folded back into the start for a seamless loop; each plays on its own gain, which glides to `ambienceMix × master × background` (×0.4 off the Farm screen) whenever the scene changes. Noise voices share one 4.1 s noise buffer.
- Cues come from the farm loop (`store.startFarm` → `audio.playFarm`, Farm screen only unless "Farm sounds on other screens"; it also sets the ambience scene and notices requests completed), replays (`ui/replay.ts` keeps each frame's sim events; `useReplay(..., sound)` plays them, off while training runs), the Field Guide (`store.mutate`: step, new lesson, lesson done), unlocks (`store.mutate` notices a new unlock), training (`ui/training.ts`: start; certified / not / loophole on the report) and UI handlers (cards, pen placement, save, adopt, shop). `ui/sound.ts` toggles sound (header button, M key).
- Settings: `settings.sound` and `settings.audio` (volumes and options). Additive, no save version bump: `parseGame` fills and clamps them, and older saves start with sound on because the old `sound: false` was never a player's choice.

## Learning

### Templates, senses and abilities (Milestone 1)
A lesson's `LearnerSpec` has a **template**:
- `sense`: a tabular learner over player-chosen **Sense cards**. Approach and Avoid are presets of it.
- `fetch`: the option controller.
- `routine`: an option controller over the player's own skills and actions (see *Routines* above).

`learning/senses.ts` compiles sense cards into a mixed-radix `SenseEncoder`. The radix of each card is declared on its `CardDef`. The preset `[Where is the target (27), Walls (16), Hazards (16), Last heading (4)]` reproduces the v1 index exactly, so v1 policies load unchanged (tested move-for-move against a fixture).

**Abilities** (`move`, `stay`, `pickup`, `drop`, and later `water`, `shoo`, `nudge`) map to an ordered action list. Physically impossible actions (walking into walls, dropping with empty paws) are always masked. Backoff for rarely seen states zeroes droppable senses in a fixed order: hazards, walls, patience, carrying, standing-on.

Validation enforces 1–5 senses and a **state budget**: it warns above 50k situations and errors above 100k.

`ref.target` is a Kind card resolved at compile time (`withTarget`) to the skill's focus. Every saved revision stores its own `{ senses, actions }`, focus, SUCCESS condition and outcome mode. Evaluation, comparison and the farm always use the revision's own definition, never the current lesson's. *Refine* refuses when the senses changed. `outcome: 'survive'` lessons judge SUCCESS when time runs out (and only if FAIL never held).

Saves are v2. The v1 → v2 migration adds templates and explicit preset senses.

**Level A, movement skills (Approach, Avoid; presets of the `sense` template):** tabular Double Q-learning over a factored, layout-independent observation: direction to the nearest focus object (9) × distance bucket (3) × blocked neighbours (16) × hazard neighbours (16) × last heading (4). That's 27,648 states, stored sparsely. Moving into walls is illegal and masked. Rarely visited states back off to coarser views (ignore hazards, then walls). Settings: ε-greedy, decaying to a floor set by *Curiosity*; α = 0.25, γ = 0.95. Avoid is the same learner trained in pens with ponds and a fail condition, so it learns to read the hazard bits.

**Level B, reusable options:** every saved skill has a typed signature, initiation and termination text, a timeout (scaled by *Persistence*), an evaluator (the held-out report), a revision number and provenance. `Fetch(item, into)` is a learned SMDP controller (16 states: carrying × on item × at bin × item visible; options goItem / goDest / pick / drop, with illegal options masked). Its movement options call the pet's **currently active** Approach or Avoid revision. Swapping the Approach revision changes Fetch behaviour without retraining Fetch (tested).

**Level C, executive:** on the farm, behaviours are invoked with `{ behaviorId, args, intention, timeout, chosenBy }`. Two selectors share that contract: `rulesSelect` (deterministic baseline) and `learnedSelect`, a tabular contextual bandit over (tired, berries, carrots, carrying, recent failure). It learns from coins earned per behaviour, with ε set by Curiosity. The executive runs only at option boundaries. A failed job (timeout) triggers a few labelled random "sniffing" steps so a pet can't repeat a stuck loop forever.

**Training loop:** `learning/session.ts` (`TrainingLoop`) is shared by the Web Worker (`trainer.worker.ts`) and an inline main-thread fallback. It runs in chunks, honours pause, resume, cancel and speed between chunks, and throttles progress messages. When training finishes it builds a `TrainingReport` with before / random / after on held-out seeds, transfer on bigger unseen pens, and exploit findings.

**Seeds:** training seeds are `hash(stage.seed, i) mod 800000`. Evaluation seeds live in `[900000, 999999]`, so they never overlap.

**Temperament → parameters:** Curiosity sets the exploration floor and the executive's ε. Persistence sets the option timeout (1×–2×). Caution adds up to −3 per hazard entry during training, shown as its own ledger line.

**Feedback:** 👍/👎 on a replayed movement episode adds ±0.5 (clamped to ±1) to those (state, action) pairs. That bonus is added to reward in later lessons for that stage and shown as "Your feedback" in the ledger.

## Persistence

Saves are currently **v5** (`SAVE_VERSION`). `persistence/save.ts` handles the save envelope `{ format: 'pen-deck-save', version, game }`. It has a migration table (version N → N+1), fills missing sections from defaults, validates shapes, clamps numbers, checks policy formats, and reports unknown cards. Saves never execute code. `storage.ts` writes to IndexedDB with a localStorage fallback. Export and Import JSON live in Settings.

## Extension points

- New objects and cards: add to a pack file. Kind cards and hands pick them up automatically.
- New evaluators: add a case in `sim/compile.ts` (conditions, events, quantities, effects, limits).
- New skills: most need no code at all (a custom skill is a lesson with senses, abilities and rules). A new learner *template* needs a case in `learning/trainer.ts`, an executor in `learning/policies.ts`, and metadata in `game/pets.ts`.
- New Field Guide lessons: add a chapter to `game/tutorial.ts` (and `data-tut` hooks on any new control it highlights).
- A future local model (Level D) would implement the same `Invocation` contract as the executive selectors.
