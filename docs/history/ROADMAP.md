# Pen Deck roadmap: player-authored behaviors and a livelier farm

> **Status (all six milestones shipped).** Everything below was planned before it was built; each milestone has a *Status* note recording what changed from the plan. The tutorial was then rebuilt as the Trainer's Field Guide (`docs/history/TUTORIAL_PLAN.md`). Candidates for what comes next are at the end of this file.

## Goal

When this roadmap was written, the player could only teach three fixed skills (Approach, Avoid, Fetch). Each one is hardcoded as a `SkillName`, has a fixed observation, and fills a fixed farm job. The next phase should let players **invent behaviors we didn't anticipate**, such as "guard the carrot patch", "herd the chickens home", "wait by the bin until I call", or "patrol the fence at night". They should then be able to **plan how those behaviors are used** on a farm with a bit more going on.

We get there in small steps. Each milestone ships a playable game, keeps every current test green, and adds its own gate. The guiding idea is to stop hardcoding skills and expose the learner's building blocks as cards:

| Before (hardcoded) | Became (player-composed) |
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

## Milestone 2: Areas and moving creatures (a world worth teaching about) — ✅ shipped

> **Status:** done. Differences from the plan below:
> - Creatures are ordinary objects with a `mover` (not a separate `Entity` type), so every existing sense, condition, event and save path works on them. Their random moves use a seeded PRNG stored in the world (`world.rng`), so runs stay deterministic.
> - Movers shipped: chickens `wander` (less inside the coop), and crows fly to the nearest crop and peck it, avoiding scarecrows. No generic `flee` mover yet.
> - Areas are placed with an **Area** card (paint two corners; fixed or random spot each try) and referenced by name (`area.named`). Scattered things never start inside an area.
> - Herding needed one extra sense: **Area seen from…** (which way the coop lies *from the chicken*). With it, a single lesson reaches the gate, so no two-stage curriculum was needed. Plain "where is chicken + where is coop" plateaued at 55–70%.
> - Farm runs exposed that "nearest chicken" can be one that's already home, so herding uses **Where is a stray…** (nearest one outside the area) and the goal **All in area**.
> - The loophole gate uses **a treat for every shoo**. "A treat for every coop visit" turned out to be a weak loophole (in/out cycles need lots of walking: 1.4–2.9 visits per try, flagged on only 2 of 3 seeds). The static checker now also warns about repeatable rewards on shoo and area events.
> - Eggs reuse Fetch: the Deliver job carries carrots *or* eggs.

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
- [x] Determinism test extended to worlds with chickens and crows.
- [x] *Herd a chicken* is trainable with cards alone: **85% mean held-out (min 70%) vs 25% random**, 70–100% on bigger unseen pens, across 5 seeds. On the farm it brings in a stray even when another chicken is already home.
- [x] Loophole check (as *a treat for every shoo*): about 30 shoos per try at 15–20% success, flagged on 5 of 5 seeds. "Once per object" repairs it to 80–90%.

**Risk:** herding is genuinely hard for local senses. Mitigation: the `sense.nearestEntity` direction plus `sense.area(direction to area)`. Present it as an advanced lesson with a scripted demo first.

---

## Milestone 3: Routine builder (composing what you taught) — ✅ shipped

> **Status:** done. Differences from the plan below:
> - Options are cards: **Use skill** (any saved movement or own skill, re-aimable, optional **only when…** condition) and **Do action** (pick up, put down, water, shoo, stay). A routine can't use Fetch, another routine, or itself (yet).
> - An option is legal when its *only when* card holds **and** it can do something right now. A skill isn't already finished (its own SUCCESS doesn't hold yet). Approach/Avoid have a target to walk to. An action is physically possible.
> - Fetch and routines now share one option-level training loop. *Bring it home (routine)* rebuilds Fetch from cards and learns a **byte-identical** controller.
> - Reports for routines add a fairer baseline, **Random choices** (the same skills picked at random), next to random steps.
> - The first *Morning chores* passed the gate on paper (85% vs 0% random steps) but random choices and even the untrained routine also scored 85%: finished chores switch off, leaving nothing to choose. The shipped version uses the player's whole deck (two helpful skills plus *Keep clear* and *Wait for it*, which don't help here), so choosing really matters.
> - Revisions record the skill revisions they were certified with (`uses`) and a copy of their lesson, so they can run on the farm ("Run a skill") and show a "certified with Herd r1; now r2" warning.

**Player-facing:** a **Routine** is a skill whose options are the player's other saved skills and abilities. The player picks 2–6 options and up to 4 **condition cards** the routine pays attention to (e.g. *carrying egg*, *crow near patch*, *in coop*). They write rules and train it. Fetch becomes the built-in example: options are Approach(item), Approach(bin), pick and drop.

Examples:
- *Morning chores*: collect eggs, then guard the garden when a crow appears.
- *Fetch with care*: use Avoid, not Approach, when the pond is between the pet and the target.

**Learning:** generalize the SMDP controller in `trainer.ts`. The state is a bitmask over the chosen conditions (≤ 16 states), and the options are the chosen behaviors. Legality comes from each option's **initiation predicate**: options already declare initiation and termination text, and now those become cards. The option executor (`OptionRun`) calls any saved skill by id at its active revision, so improving a sub-skill improves every routine that uses it.

**UI:** a "deck" view showing which skills a routine uses, with revision badges, and a warning when a sub-skill revision changes ("Morning chores was certified with Guard r2; Guard is now r3. Re-test?").

**Gate**
- [x] Fetch re-expressed as a routine: identical Q-table to built-in Fetch (tested on 2 seeds), 91% mean across 5 seeds, same as Fetch.
- [x] Swapping the Herd sub-skill for a weak revision drops *Morning chores* by >20 points without retraining it (tested). Changed sub-skills are flagged in the UI.
- [x] *Morning chores* (4 options, all player-made skills): **83% mean (min 65%)** vs 0% random steps, 0% untrained, and 57% mean (30–75%) for random choice of the same skills.

---

## Milestone 4: Farm routines (planning, not just training) — ✅ shipped

> **Status:** done. Differences from the plan below:
> - Rows are `plan.row` cards: **IF** any number of conditions, **DO** one **job** card (Forage, Deliver, Catch fireflies, Nap, Wander, **Go to…**, **Run skill**). Order is priority. A row is skipped when its job can't do anything right now, the same eligibility rule as the built-in executive. There's no explicit OTHERWISE keyword: a row with no conditions acts as one.
> - New farm conditions: **Energy below N** and **Carrying something**.
> - The **starter plan** is the built-in rules executive written as 9 rows, and it reproduces it tick for tick.
> - The "learned executive as helper" ships as **Learn among matches**: a bandit picks among the rows that currently apply and remembers what paid.
> - The oscillation guard isn't a flat minimum commitment (that would have changed well-behaved plans, including the starter plan). It switches on only when rows flip-flop (≥6 row changes within 40 ticks). Then, for 160 ticks, the pet sticks with the previous row if it still applies, or pauses briefly before switching. On the starter plan it never triggers.
> - Plans live on each pet (`pet.plan`). The editor reuses the lesson card/sleeve editor through a stand-in lesson whose rule list *is* the plan.

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
- [x] The starter plan reproduces the built-in rules executive exactly: identical farm state every tick over 2½ farm days with Approach, Fetch, carrots, chickens, crows and nights (tested).
- [x] A 300-tick dry run equals the real farm over the same ticks (coins, energy, tick, pet position; tested from a mid-game state).
- [x] The guard roughly halves switching on a deliberately fighting plan ("at the bin → go home; otherwise → go to the bin"): 42.8 → 21.8 switches per minute (tested: < half).

---

## Milestone 5: A slightly richer farm — ✅ shipped

Each item is independent and small, so they ship one at a time.

| Feature | Why it creates teachable problems | Size |
|---|---|---|
| ✅ **Watering:** crops grow 2× faster when watered; a well; new `water` ability. *Shipped without a carryable can: the pet carries 3 splashes itself, which keeps it a single sense skill.* | Multi-step fetch-and-use, without new learner types | S |
| ✅ **Day / night** (one cycle ≈ 5½ farm minutes at 1×): fireflies by night (crows wait for M2); pets prefer sleeping at night. *Shipped with `sense.night`, `cond.night` and a Time of day pen card.* | Time becomes a sense and a plan condition | S |
| ✅ **Farm zones and expansion:** the *Orchard expansion* (shop, 25 coins) grows the farm from 12×9 to 16×12, with a fenced `orchard` area of 3 berry bushes behind a gate and a southern meadow. *The coop already existed (Milestone 2).* | Transfer pressure on learned skills; areas become meaningful | M |
| ✅ **Gates:** open/closed; **Nudge** ability (from on or next to the gate; never shuts on someone); `ev.gate`, `cond.gates`, `sense.gate`; plan job **Mind the gate**; example lesson *Open the gate* | Opens up "close the gate after the chickens" plans | S |
| ✅ **Gentle weather:** from day 2, the odd daytime shower (≈1/700 per tick, 180–400 ticks) waters every plot, swells the pond by one tile and keeps crows away. Pens get a *Weather* card, *Is raining* and a rain sense | Robustness: Avoid has to handle changing layouts | S |
| ✅ **Requests board:** up to 3 requests from fictional neighbours each dawn, only for things the farm can do (eggs, carrots, berries, fireflies, watering, no pecks, chickens in the coop at nightfall). They pay coins, sometimes with a gift of Tree/Fence cards. Missed ones cost nothing | Gives players reasons to invent behaviors, with open-ended solutions | M |

Keep it cozy: no death and no losses beyond time. Crows peck crops (slower regrowth), they never take coins.

**Gate**
- [x] 60 fps with the expanded 16×12 farm, 2 pets (one on duty) and 6 creatures, raining, at 4× speed: phone viewport with **4× CPU throttling** (Chromium DevTools emulation, not a real device). Main thread 53% busy, script 9%, no long tasks; still 60 fps at 6× throttling (69% busy). SVG was enough, no canvas needed. *At the time only the on-duty pet was drawn; Milestone 6 added drawing the second pet on duty.*
- [x] Each feature has sim tests (`tests/milestone5.test.ts`) and event-grounded journal entries: expansion, first gate open/shut, first rain and its end, first requests, request done/missed.

> **Found while testing:** the learned Approach is shaky right next to the new fence, e.g. wall to the east with the target close by to the north-east, a situation that barely appears in 8×8 practice pens. The stuck-recovery gets the pet through (the gate job succeeds within ~100 ticks), but it's a real transfer gap, and a good reason for players to retrain in pens with fences.

---

## Milestone 6: Discovery tools (seeing what your pet actually learned) — ✅ shipped

> **Status:** done. Each item has tests (`tests/milestone6.test.ts`):
> - **Behaviour summary**, computed from *all* held-out episodes (not just the replays) and stored on each revision: a 13×13 heatmap of where the pet is relative to its target, action mix, endings (done / ran out of time / failed), steps per try, and which rules the treats came from. Shown in the lesson report and on the Pets screen. Older revisions can work it out on demand.
> - **Probe** ("What does Pip do?" in the pen): the learned choice on every free tile as an arrow (moves) or dot (other actions), sized by softmax confidence, greyed where the exact situation was never practised. Tapping a tile traces the pet's greedy path from there. Works for movement and your own skills; routines and Fetch show their summary instead.
> - **Curiosities:** after each lesson, the journal notes gentle surprises: most treats from a non-finishing rule (the loophole recipe triggers it), > 50% standing still, hovering beside rather than on the target, succeeding only near the time limit, or a strong one-direction habit. Hints, never errors.
> - **Skill cards:** export one skill's active revision (policy, senses/options, lesson copy and summary) as JSON, and import it into any pet. Validation is like a save: format, policy shape (≤ 100,000 states, numeric rows), known cards only. Name clashes get "(2)", and routines warn about sub-skills the pet lacks. No code.
> - **Two pets on duty:** a second pet acts after the first within the same tick. Each sees the other as a solid obstacle, and whatever the other is heading for (its claim) is hidden, so they never share a tile or a target (tested over 1,500 ticks). The single-pet path is unchanged: the starter-plan ≡ built-in rules test still passes tick for tick. **Finding:** a second pet only pays off when it does *different* work. Two foragers earn 183 vs 178 coins for one (berry regrowth is the bottleneck), while forager + carrot deliverer earn 387.

The more freedom players have, the more they need to understand surprising results.

- **Behavior summary** for any skill revision: a heatmap of where the pet goes, an action mix, typical episode length, and "ends by" (success / timeout / fail). All of it is computed from evaluation traces that already exist.
- **"What does Pip do when…?"** probe: place the pet and objects by hand in the pen and step the greedy policy. Show the Q-values as arrows (big arrow = confident).
- **Surprise detector:** the journal notes when a skill's summary differs strongly from what its rules seem to ask for (e.g. reward comes mostly from one rule, or the pet spends > 50% of the time *staying*). These are hints framed as curiosities, not errors.
- **Skill cards export/import:** share one skill (spec + policy) as a small JSON "card" between saves. It's sanitised like saves and never contains code.
- **Two pets, one plan:** allow the second pet on duty with a simple "no two pets target the same object" claim rule. It's optional and last because it touches executive and sim ordering.

---

## How it was sequenced

The milestones shipped in the recommended order: M1 → M5 (watering + day/night) → M2 → M3 → M4 → M5 (expansion, gates, weather, requests) → M6. Bringing two small farm features forward right after M1 gave custom skills something new to point at early. Each milestone kept every earlier test green and added its own gate tests (`tests/milestone1–6.test.ts`, `tests/water-night.test.ts`).

## Risks: how they played out
- **Players build lessons that can't be learned:** the state-budget meter, preflight and Refine shipped. The Field Guide's *Invent a skill* lesson now teaches the budget directly (one sense too many costs ~35 points), and coaching tips flag "too many situations".
- **Tabular RL hits its limits:** herding needed one extra relative sense (*Area seen from…*), not a bigger learner. No neural network was needed for anything in M1–M6.
- **UI complexity:** presets and recipes stay one tap away; the hand recommends 3–7 cards; the Field Guide introduces senses, routines and plans when they unlock.
- **Save churn:** saves went v1 → v4, one migration each, tested against a real v1 fixture (`tests/fixtures/`).

## Open questions: what was decided
1. **Sharing skills between pets:** yes, as explicit **skill cards** (export/import, M6). Each pet still trains on its own; a card is a copy with its own history.
2. **Requests board:** shipped (M5) as light, optional requests; missing one costs nothing.
3. **Creatures:** chickens and crows shipped (M2). Nothing else has been requested.

## After the milestones (shipped)
- **The Trainer's Field Guide:** nine lessons on setting up training that works, the notebook, glossary, coaching tips, and request hints (`docs/history/TUTORIAL_PLAN.md`).
- **Sound, phases A–C:**
  - core cues, settings and mute;
  - the whole farm, replays and background sounds;
  - pet voices, nap sighs, probe plucks, optional training ticks, and an optional generative music box (`docs/history/SOUND_PLAN.md`).
- **Teaching polish, phases A–C** (`docs/history/TEACHING_PLAN.md`):
  - *Has done…* / *Just…* / *Any of*, an honest End try, SUCCESS lists, a context-aware hand, sentences, measured checks;
  - better pens, play it yourself, example layouts, rule housekeeping;
  - your cards with blanks and names, lesson cards, memory in farm plans.
- **Fixes found along the way:** the random baseline never used Shoo or Stay (learned results unchanged); lesson 9 could get stuck on busy farms; a starting lesson's report covered the next one.

## Next: farm life (in progress)
Phase A shipped: produce travels to storage (baskets, sheds) and sells only at the house, with Harvest and Haul jobs. Phase B shipped: field crops (carrot, sunflower, pumpkin) need replanting, each seed costs coins, and a Plant job, ability and cards do the work. Phase C shipped: a Layout mode (place, move, remove, validated as you go, previewed against the farm as it is) and Field Guide lesson 10. Since then: pets carry baskets (Lift; a Basket run job that Auto uses), and pens can start with stocked storage (the *Empty the basket* recipe). Phase D shipped: tap a pet for its card, the house for the roster, anything else for what it is; up to 4 pets on duty. See `docs/history/FARM_LIFE_PLAN.md`.

## What could come next
Not committed; listed roughly smallest first.
- **Approach near fences:** the known transfer gap (M5 note above). Measured since: practising with *Obstacles: some* gains 7–9 points in cluttered pens (TESTING.md). A Field Guide follow-up on "practise with what the farm has now" would teach it.
- **Routines over Fetch and other routines:** allow nesting (with a depth limit and a cycle check) so *Morning chores* can include deliveries.
- **A built-in Guard job** for plans, or a recipe for one, since guarding crops currently needs a player-made skill.
- **Cards, a step further:** number blanks ("Treat of ___"), and optionally live-linked named conditions (edit once, update everywhere), with a clear story for skills already certified with the old version.
- **Pens:** non-square *varies* sizes; "away from" for areas.
