# Architecture

```
src/
  domain/       canonical typed spec, card registry (Farm pack), validation, contextual hand, recipes, repairs
  sim/          deterministic gridworld (rng, world, compile: spec → runnable stage)
  learning/     features, Double-Q tables, policies/executors, trainer, evaluation/report, executive, worker
  game/         pets & skills, farm runtime, progression/shop, tutorial, journal, game state
  persistence/  versioned save format + IndexedDB storage (localStorage fallback)
  ui/           React presentation only (store, screens, cards/sleeves, charts, replay)
tests/          vitest suites;  scripts/bench.ts  benchmark
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

## Learning

### Templates, senses and abilities (Milestone 1)
A lesson's `LearnerSpec` has a **template**:
- `sense`: a tabular learner over player-chosen **Sense cards**. Approach and Avoid are presets of it.
- `fetch`: the option controller.

`learning/senses.ts` compiles sense cards into a mixed-radix `SenseEncoder`. The radix of each card is declared on its `CardDef`. The preset `[Where is the target (27), Walls (16), Hazards (16), Last heading (4)]` reproduces the v1 index exactly, so v1 policies load unchanged (tested move-for-move against a fixture).

**Abilities** (`move`, `stay`, `pickup`, `drop`) map to an ordered action list. Physically impossible actions (walking into walls, dropping with empty paws) are always masked. Backoff for rarely seen states zeroes droppable senses in a fixed order: hazards, walls, patience, carrying, standing-on.

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

`persistence/save.ts` handles the save envelope `{ format: 'pen-deck-save', version, game }`. It has a migration table (version N → N+1), fills missing sections from defaults, validates shapes, clamps numbers, checks policy formats, and reports unknown cards. Saves never execute code. `storage.ts` writes to IndexedDB with a localStorage fallback. Export and Import JSON live in Settings.

## Extension points

- New objects and cards: add to a pack file. Kind cards and hands pick them up automatically.
- New evaluators: add a case in `sim/compile.ts` (conditions, events, quantities, effects, limits).
- New skills: add a learner kind in `learning/trainer.ts`, an executor in `learning/policies.ts`, and metadata in `game/pets.ts`.
- A future local model (Level D) would implement the same `Invocation` contract as the executive selectors.
