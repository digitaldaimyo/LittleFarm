# Pen Deck roadmap: player-authored behaviors and a livelier farm

## Goal

Today the player can only teach three fixed skills (Approach, Avoid, Fetch). Each one is hardcoded as a `SkillName`, has a fixed observation, and fills a fixed farm job. The next phase should let players **invent behaviors we didn't anticipate**, such as "guard the carrot patch", "herd the chickens home", "wait by the bin until I call", or "patrol the fence at night". They should then be able to **plan how those behaviors are used** on a farm with a bit more going on.

We get there in small steps. Each milestone ships a playable game, keeps every current test green, and adds its own gate. The guiding idea is to stop hardcoding skills and expose the learner's building blocks as cards:

| Today (hardcoded) | Becomes (player-composed) |
|---|---|
| `SkillName = 'Approach' \| 'Avoid' \| 'Fetch'` | Named skills the player creates from a **learner template** |
| Fixed nav observation (direction to one focus kind + walls + hazards + heading) | **Sense cards** the player chooses (what the pet pays attention to) |
| Fixed action sets (`move`, or `move+pick+drop`) | **Ability cards** (move, stay, pick, drop, shoo, nudge, water…) |
| Fetch controller with 4 fixed options | **Routine builder**: any saved skills and abilities become options |
| Farm jobs Forage / Deliver / Nap + built-in executive rules | **Farm routine mat**: player-written WHEN/IF → DO rules feeding the executive |
| Static farm (plots, pond, bin) | Gentle living farm: chickens, crows, watering, day/night, zones |

### Constraints that stay non-negotiable
- **Local, real and honest learning.** Learning stays tabular RL (Double Q / SMDP / bandit) in the Worker. Every new skill is measured on held-out seeds against random and untrained baselines.
- **State budget.** Every learner state space stays ≤ ~100k states, stored sparsely. The UI shows the budget so players can't silently build an unlearnable lesson (see M1).
- **Same simulator everywhere.** Pens, evaluation and the farm all run on one deterministic simulator. New world features are added to `sim/`, never to the UI.
- **Old saves keep working.** Saves migrate forward through `persistence/save.ts`: existing Approach, Avoid and Fetch skills become presets of the new system.

---

## Milestone 1: Custom skills and senses (the foundation) — ✅ shipped

> **Status:** done. Differences from the plan below:
> - The timer sense shipped as **Patience** (`sense.still`), alongside `ev.stay`, `cond.stayedFor`, `cond.farFrom` and `cond.and`. `eff.endAfter` wasn't needed: the same thing is written as a rule with `cond.stayedFor` + End try.
> - Added **"the target"** (`ref.target`): a Kind card that means whatever the skill is aimed at. It lets a skill be re-aimed without retraining.
> - Added **"Judge when time is up"** lessons (`outcome: 'survive'`) so "keep doing X" skills are expressible.
> - Pulled a small piece of M4 forward: a farm job, **Run a skill**, that runs any of your own skills aimed at any farm object.
> - Skills stay keyed by name (unique per pet) rather than id. Custom names can't reuse a preset's name.

**Player-facing:** "New skill…" in the Pet binder. You name it, pick a learner template, choose up to 3 **Sense** cards and the **Abilities** it may use, then write rules as today. Approach, Avoid and Fetch become one-tap presets built from the same parts.

Example skills that become possible:
- *Shadow*: stay within 1 tile of the bin without standing on it.
- *Keep clear*: stay at least 3 tiles from the pond.
- *Wait for it*: go to the target and **stay** until 10 ticks pass.
- *Corner*: go to whichever rock is nearest the target.

**Domain and registry (`domain/`)**
- `SkillName` becomes `string`. Add a `SkillSpec { id, name, template, senses: SpecNode[], abilities: string[] }` to `LearnerSpec`.
- New card types, which the spec already reserves (`Observation`, `Behavior`):
  - `sense.nearest(kind)`: direction ×9, distance bucket ×3.
  - `sense.blocked`: ×16 (always on today; becomes explicit).
  - `sense.hazards(kind<Hazard>)`: ×16.
  - `sense.carrying(kind)`: ×2.
  - `sense.timer(rule)`: ticks since an event, bucketed ×3.
  - `sense.heading`: ×4.
- New ability cards: `stay` (an explicit wait action), plus the existing move, pick and drop.
- New conditions and effects: `cond.stayedFor(n)`, `cond.farFrom(kind, d)`, `eff.endAfter(n)`. These make "wait" and "keep away" teachable.
- Validation computes the **state-space size** from the chosen senses. It warns above 50k states and errors above 100k, with the message "your pet can't pay attention to that many things at once."

**Learning (`learning/`)**
- Replace `navObserve` and `NAV_STATES` with an `ObservationEncoder` compiled from sense cards (mixed-radix index). Backoff becomes "drop the last sense, then the next", generalizing today's hazard-then-walls backoff.
- `Trainer` takes `{ encoder, actions }` instead of branching on `'nav' | 'fetch'`. Legality masking moves into ability definitions.
- `NavPolicy` becomes `SensePolicy`. Approach, Avoid and Fetch presets must reproduce today's benchmark numbers within noise.

**Game (`game/`)**
- Skills are keyed by id, not name. Pets can hold several skills of the same template.
- A skill's **parameters** (e.g. the kind its `sense.nearest` points at) can be re-bound at call time, the way Approach(berry) is reused as Approach(carrot) today.

**Gate**
- [x] Existing benchmark within ±5 points on all presets: identical numbers. Save migration test: a v1 fixture save loads and its skills act move-for-move identically (`tests/milestone1.test.ts`).
- [x] New benchmark rows: *Wait for it* (88% mean vs 0% random) and *Keep clear* (85% vs 10%).
- [x] "Surprise" test: *Shadow the bin* (end next to the bin, not on it, and stay), written only with cards in the test, beats random by ≥ 30 points.

**Cut line if time is short:** drop `sense.timer` and ship `stay` + `cond.stayedFor` only.

---

## Milestone 2: Areas and moving creatures (a world worth teaching about)

**Player-facing:** Paint **areas** in the pen and on the farm (coop, garden, porch). Two gentle creatures arrive: **chickens** that wander and lay eggs, and a **crow** that drifts toward ripe crops. A new ability, **Shoo**, gently pushes an adjacent creature one tile away.

New behaviors players can invent:
- *Herd*: shoo chickens into the coop area.
- *Guard*: stay near the carrot patch and shoo crows.
- *Egg run*: fetch eggs to the basket.

**Sim (`sim/world.ts`, `sim/compile.ts`)**
- `Entity { id, kind, x, y, mover }` with deterministic seeded movers: `wander`, `seek(kind)`, `flee(pet, r)`. Entities move on the same tick, after the pet.
- New events: `ev.entityEnters(kind, area)`, `ev.shooed(kind)`, `ev.peck(crow, crop)`.
- **Areas**: `Area` becomes a real type: `area.rect(x,y,w,h)` and `area.named(id)`. New conditions `cond.inArea(actor|kind, area)` and `cond.countInArea(kind, area, n)`. Areas are painted in the pen editor with a brush card.
- New sense: `sense.nearestEntity(kind)`.

**Content:** chicken, egg (carryable), crow, coop (container for chickens, by area), scarecrow (crows avoid it; decoration with a gameplay effect).

**Gate**
- [ ] Determinism test extended to worlds with entities.
- [ ] *Herd one chicken into the coop* is trainable with the card system alone and reaches ≥ 60% held-out. If it can't, ship it as a two-stage curriculum (approach the chicken → shoo toward the area).
- [ ] Loophole check: rewarding "chicken enters coop" with no limit lets the pet learn to shoo a chicken in and out repeatedly. The existing exploit detector must flag it, and the per-object limit must repair it.

**Risk:** herding is genuinely hard for local senses. Mitigation: the `sense.nearestEntity` direction plus `sense.area(direction to area)`. Present it as an advanced lesson with a scripted demo first.

---

## Milestone 3: Routine builder (composing what you taught)

**Player-facing:** a **Routine** is a skill whose options are the player's other saved skills and abilities. The player picks 2–6 options and up to 4 **condition cards** the routine pays attention to (e.g. *carrying egg*, *crow near patch*, *in coop*). They write rules and train it. Fetch becomes the built-in example: options are Approach(item), Approach(bin), pick and drop.

Examples:
- *Morning chores*: collect eggs, then guard the garden when a crow appears.
- *Fetch with care*: use Avoid, not Approach, when the pond is between the pet and the target.

**Learning:** generalize the SMDP controller in `trainer.ts`. The state is a bitmask over the chosen conditions (≤ 16 states), and the options are the chosen behaviors. Legality comes from each option's **initiation predicate**: options already declare initiation and termination text, and now those become cards. The option executor (`OptionRun`) calls any saved skill by id at its active revision, so improving a sub-skill improves every routine that uses it.

**UI:** a "deck" view showing which skills a routine uses, with revision badges, and a warning when a sub-skill revision changes ("Morning chores was certified with Guard r2; Guard is now r3. Re-test?").

**Gate**
- [ ] Fetch preset re-expressed as a routine gives today's numbers.
- [ ] Changing a sub-skill revision changes routine behavior without retraining (extends the existing test).
- [ ] A 3-option routine built only from player-made M1/M2 skills beats random by ≥ 30 points.

---

## Milestone 4: Farm routines (planning, not just training)

**Player-facing:** a **Farm plan** mat on the Farm screen, using the same card language:

```
WHEN crow near carrot patch        DO Guard(carrot patch)        priority 1
IF energy < 30                     DO Nap                        priority 2
WHEN eggs in coop ≥ 2              DO Egg run                    priority 3
OTHERWISE                          DO Forage(berry) moving with Avoid
```

The player *plans* which taught behavior runs when. The learned executive becomes an optional helper: "let Pip choose among these plan rows" (the existing bandit, now over player-defined jobs).

**Engineering**
- Generalize `Invocation.behaviorId` from the fixed union to a skill id, with args bound from the plan row (kind, area).
- `chooseInvocation` in `game/farm.ts` evaluates plan rows using compiled conditions from `sim/compile.ts`, which already exist, against the farm world.
- **Plan preview:** dry-run the plan for 300 ticks on a copy of the farm (deterministic sim) and show expected coins, energy and naps. Players iterate on plans the way they do on lessons.
- **Plan diagnostics:** "row 3 never fires", "two rows fight each other (switched 40 times in a minute)", "this skill isn't certified".

**Gate**
- [ ] A player-written plan reproduces today's built-in rules executive exactly (regression test).
- [ ] The dry-run preview matches the real farm over the same ticks (determinism).
- [ ] An oscillation guard (minimum commitment per invocation) prevents plan thrashing; tested.

---

## Milestone 5: A slightly richer farm

Each item is independent and small, so they ship one at a time.

| Feature | Why it creates teachable problems | Size |
|---|---|---|
| ✅ **Watering:** crops grow 2× faster when watered; a well; new `water` ability. *Shipped without a carryable can: the pet carries 3 splashes itself, which keeps it a single sense skill.* | Multi-step fetch-and-use, without new learner types | S |
| ✅ **Day / night** (one cycle ≈ 5½ farm minutes at 1×): fireflies by night (crows wait for M2); pets prefer sleeping at night. *Shipped with `sense.night`, `cond.night` and a Time of day pen card.* | Time becomes a sense and a plan condition | S |
| **Farm zones and expansion:** buy an orchard and a coop; the map grows from 12×9 to 16×12 | Transfer pressure on learned skills; areas become meaningful | M |
| **Gates:** open/closed; the pet can learn to `nudge` them | Opens up "close the gate after the chickens" plans | S |
| **Gentle weather:** rain waters crops and the pond grows by a tile | Robustness: Avoid has to handle changing layouts | S |
| **Requests board:** neighbours post small requests ("3 eggs by nightfall", "no crow pecks today") for coins and new cards | Gives players reasons to invent behaviors, with open-ended solutions | M |

Keep it cozy: no death and no losses beyond time. Crows peck crops (slower regrowth), they never take coins.

**Gate**
- [ ] The farm stays at or above 60 fps on a mid-range phone with 2 pets and 6 creatures (profile `WorldView`; switch to canvas only if needed).
- [ ] Each feature has a sim test and a journal template grounded in events.

---

## Milestone 6: Discovery tools (seeing what your pet actually learned)

The more freedom players have, the more they need to understand surprising results.

- **Behavior summary** for any skill revision: a heatmap of where the pet goes, an action mix, typical episode length, and "ends by" (success / timeout / fail). All of it is computed from evaluation traces that already exist.
- **"What does Pip do when…?"** probe: place the pet and objects by hand in the pen and step the greedy policy. Show the Q-values as arrows (big arrow = confident).
- **Surprise detector:** the journal notes when a skill's summary differs strongly from what its rules seem to ask for (e.g. reward comes mostly from one rule, or the pet spends > 50% of the time *staying*). These are hints framed as curiosities, not errors.
- **Skill cards export/import:** share one skill (spec + policy) as a small JSON "card" between saves. It's sanitised like saves and never contains code.
- **Two pets, one plan:** allow the second pet on duty with a simple "no two pets target the same object" claim rule. It's optional and last because it touches executive and sim ordering.

---

## Sequencing and effort

| Milestone | Depends on | Rough effort | Ships on its own? |
|---|---|---|---|
| M1 Custom skills and senses | — | 1.5–2 weeks | Yes: biggest unlock for creativity |
| M2 Areas and creatures | M1 (senses) | 1.5 weeks | Yes |
| M3 Routine builder | M1 | 1 week | Yes |
| M4 Farm routines | M3 (any skill as a job) | 1 week | Yes |
| M5 Richer farm | M2 for crows/chickens; watering and day/night need nothing | 0.5–1 week per row | Yes, feature by feature |
| M6 Discovery tools | M1 | 1 week | Yes |

**Recommended order:** M1 → M5 (watering + day/night) → M2 → M3 → M4 → M6. Bringing two small farm features forward right after M1 gives players something new to point their custom skills at early, before the larger creature work.

## Risks and mitigations
- **Players build lessons that can't be learned:** state-budget meter, preflight with a scripted demo where possible, and Refine. Treat "the pet couldn't learn this" as a readable outcome, with a hint such as which sense was never informative.
- **Tabular RL hits its limits** (herding, multi-entity situations): keep senses local and relative, lean on curriculum (sub-skills then routine), and only then consider a tiny MLP behind the same `ObservationEncoder` interface. It's opt-in and benchmarked.
- **UI complexity:** presets stay one tap away. Senses, abilities and routines live in "advanced" sleeves until the player first opens them, and the hand keeps recommending 3–7 cards.
- **Save churn:** one migration per milestone, each with a round-trip test using a real v1 save fixture checked into `tests/fixtures/`.

## Open questions for you
1. Should custom skills be shareable between pets (copy a policy to a second pet) or stay strictly individual? Copying is easy but softens "each pet learns for itself".
2. Is a requests board (light quests) welcome, or should the farm stay purely self-directed?
3. Creatures: are chickens and crows the right tone, or would you prefer something else (bees, ducks, a lost lamb)?
