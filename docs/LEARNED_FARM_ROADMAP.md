# Learned farm roadmap: every job is a learned skill, and the executive learns too

Status: **official roadmap**, decisions settled (section 8). **Phase 0 done:**
- `npm run bench:farm` writes the baseline (TESTING.md → *Farm baseline*);
- `tests/phase0.test.ts` pins defects 1a/1b, with to-dos for 2 and 3;
- `FarmRuntime.stats` counts job outcomes, for benchmarks only.

**Phase 1 done:**
- **One outcome protocol.** Runs end in `success`, `fail`, `timeout`, `interrupted` or `cancelled`. A timeout is never success, and *survive* skills and routines succeed at time-up only if their FAIL never held (defects 1a/1b fixed).
- **Capabilities** (`src/game/capability.ts`). A skill or routine plus an aim. `deployedRevision` runs the pinned revision while its table is kept, else the active one. `allowedOnFarm` covers certified-by-default, opt-in and switched off. `eligibility` gives a reason (missing skill, not allowed, nothing to aim at, paws full, too tired) plus stale-dependency warnings.
- **One runtime.** `runCapability` starts sense skills, Fetch and routines. The farm's *Run a skill* job and plan rows both go through it, and any learned skill or routine can be assigned, presets included.
- **Trait aims** `@crop` (any ripe crop) and `@storage` (storage with room for what the pet carries), wherever a kind is matched: nearest, at-focus, conditions, events (defect 3).
- **Duration-aware option learning.** Option rewards are discounted per tick and the next value by 0.99^ticks (defect 2). Recipe numbers are unchanged within noise: Fetch 91% → 92%, Fetch routine 91% → 92%, Morning chores 83% → 82%. A per-tick γ of 0.9 collapsed Chores to 10%, hence 0.99.
- **UI:** Pets → each skill: *On the farm* (usable when certified / always / never) and *Runs* (the active revision or pinned to rN). Farm → *Run a skill* lists every skill and routine and the trait aims, and says why one can't run now.
- **Tests:** `tests/capability.test.ts`; the phase-0 defect tests now pass as ordinary tests. The farm baseline is unchanged (`npm run bench:farm`).

**Phase 2 done:**
- **Pens express the farm:**
  - *Any ripe crop* and *Storage with room* are cards. Placed in a pen they become a real crop (different each try) or an empty basket. *The target* can be aimed at them, and routine options too.
  - The **Energy** placement card: work drains 0.12, Stay restores 1.5, like the farm. The **Tired?** sense, and *Energy below* now works in pens.
  - **Seed money:** planting pays the seed and runs out.
- **Gate met:** a full harvest → sell cycle runs on the farm with only learned capabilities. The **Harvest** routine recipe (Approach → any ripe crop, pick up, Approach → house, put down), trained in a pen, earns 96% of the scripted Harvest job on the held-out farm and 80% on the standard one (TESTING.md).
- **Found and fixed on the way:**
  - A run's goal is judged from the run's start; farm delivery totals had made every run "succeed" after one tick.
  - Deployed walks take Curiosity's occasional random step (2–8%), so a greedy loop beside an obstacle can't repeat forever. It's the learned replacement for the scripted stuck recovery. Training is unchanged.
- **Moved to phase 3:** the "clear tile by the crops" aim (it belongs with the Basket-run routine). Also there: the weak-Approach-near-rocks case (seed 303), likely fixed by training Approach with *Obstacles: some*.

**Phase 3a done (Harvest is fully learned):**
- **Job bindings** (`LEARNED_JOBS`, `jobSkill`, `jobCapability`): a farm job is done by one of the pet's skills or routines. That's the player's pick (`Pet.jobSkills`), else the one taught by the job's recipe or named after it. Only certified or opted-in skills count.
- **The scripted Harvest executor is gone.** The Harvest job, Auto and plan rows run the bound skill through `runCapability`, aimed at any ripe crop. With no Harvest skill, the job is locked and Auto never harvests.
- **Field Guide:** the first lesson ends once Approach is saved, then **Teach a job: Harvest** starts by itself (train the routine, save, assign, earn 5 coins → Fetch). *See what your pet learned* now opens on an invented sense skill, not a routine.
- **Tests:** farm tests give pets a trained Harvest (`giveHarvest` in tests/helpers). Expectations that relied on the scripted harvest *filling baskets* changed: the learned Harvest sells at the house, so basket tests stock baskets directly until a learned "harvest into storage" exists (3b). The two-pet test now runs both pets on Auto.
- **Finding:** training Approach with *Obstacles: some* and 3,000 tries makes the learned Harvest beat the scripted one on every seed (158 / 160 / 159 vs 127 / 159 / 70). The Harvest lesson says so.
- **Still scripted** (next slices): Haul, Basket run, Plant, fireflies, the gate, Rest's walk home, Wander. Also to come: the v9 save migration.

**Phase 3b done (Haul, Basket run and Harvest to storage are learned):**
- **Two new routine recipes** (Train, once Fetch is unlocked):
  - **Harvest to storage:** Approach → any ripe crop, pick up, Approach → storage with room, put down.
  - **Basket run:** Approach → basket, lift, Approach → the house, put down (it empties), Approach → a crop, step aside, put down. The routine scores 90–95% in its pen.
  - New "Do action" choices: *lift a basket*, *plant*, *nudge* and *step aside* (onto a clear tile next to the pet).
  - New Storage level: *basket has anything* (the one carried, if any).
  - *Thing near thing* and the *deliver*/*empty* events accept "any crop" / "storage with room".
- **Bindings:**
  - Haul runs the pet's Fetch (it must be certified, or opted in). It is still aimed at eggs or the fullest storage, and counts sales at the house.
  - Basket run runs the Basket run routine. The job is done once a basket it lifted is set down.
  - Harvest picks *Harvest to storage* only when storage with room is nearer than the house and someone on duty can empty it (Fetch or Basket run). Otherwise it uses *Harvest*.
- **The built-in basket-run code is gone.** Haul's built-in Fetch setup is gone too: it now starts through `runCapability`.
- **A routine with nothing it may do gives up** ("no option applies") instead of waiting out its time. This happens, for example, when the pet holds a berry and the only basket holds carrots. The farm then chooses again. Survive routines and pen tries still wait.
- **Recipe fix:** Harvest's *put down* is now "only at the house". Before, after a stuck walk home, it could pick up and put down on the spot until time ran out.
- **The ≥ 80% gate passes for every setup.** `npm run bench:farm -- --learned` gives every pet Approach, Fetch, Harvest, Harvest to storage and Basket run, all trained in pens; Approach is practised with *Obstacles: some* and 3,000 tries, as the lesson advises. Coins over three seeds vs the phase-0 baseline (all scripted jobs):

| Setup | Standard farm | Held-out farm |
|---|---|---|
| Auto (rules) | 724 vs 795 (91%) | 651 vs 658 (99%) |
| Auto (learned) | 471 vs 352 (134%) | 276 vs 230 (120%) |
| Starter plan | 724 vs 795 (91%) | 651 vs 658 (99%) |
| Harvest job | 431 vs 356 (121%) | 650 vs 670 (97%) |
| Two pets | 776 vs 886 (88%) | 761 vs 865 (88%) |

**Phase 3c done (Plant, the gate, errands, fireflies and the walk home):**
- **Plant** runs the pet's own **Plant** routine: Approach → empty soil, only when there's money for its seed; then plant. It's a new recipe (Train, after carrots unlock) that scores 75% in its pen (random 30%). The job is done once a plot is sown. Without the routine nobody plants, and the carrots unlock now says so.
- **Mind the gate** runs the pet's own **Shut the gate** skill (a new recipe; 85% in its pen) or **Open the gate**, depending on the direction asked. A new pen card, **Gates start** (open / shut / either), lets pens practise shutting an open gate. The old *Open the gate* skill never saw an open gate, so it couldn't shut one on the farm. The neighbours' gate request now says to teach Shut the gate.
- **Errands and fireflies** were already the pet's own walking skill (Approach / Avoid) and stay that way.
- **Rest is innate** (Stay, as decided). The walk home before a nap with another pet on duty is now the pet's own Approach; without Approach it naps where it is. **Wander** stays innate too.
- **Fixed:** a single skill (not a routine) now honours the job's own goal. Before, *Open the gate*'s goal "a gate is open" counted as instant success when the job was to shut it.
- **Gate:** `bench:farm --learned` (now with Plant learned too) stays ≥ 80% everywhere: 83–175%.
- **No built-in job scripts are left.** Every farm job runs a skill or routine the pet learned, or an innate Stay or wander.

**Phase 3d done:** the v9 save migration (see §6). Phase 3 is complete.

**Phase 4 done (responsibilities + the deterministic executive):**
- **Responsibilities** are the farm plan's rows, grown in place, so old rows still mean what they meant. Each card now reads: WHEN conditions, USE a job, **OR USE** more jobs, and optionally **UNTIL** a condition. The plan mat is now the responsibilities editor (decision 6).
- **Auto is the responsibility executive** (`chooseDuty`, `afterDutyJob` in `game/plan.ts`):
  - **Needs first:** a tired pet rests until energy 90, unless it holds a basket. At night it sleeps, unless a responsibility's WHEN mentions night.
  - **Priority:** the highest responsibility whose WHEN holds and whose UNTIL doesn't yet, with at least one eligible job that isn't cooling down.
  - **Commitment:** an UNTIL responsibility holds for 60 ticks unless its job failed. An each-time responsibility is released after each finished job, so old rows behave exactly as before.
  - **Evidence:** the job with the best evidence wins (success rate per tick, kept on the pet). Untried jobs get a turn first.
  - **Cooldowns:** a job that makes **no progress in the world** 3 times in a row rests for 200 ticks. An UNTIL responsibility with no progress for 400 ticks is set aside. Progress is a world fingerprint (sales, deliveries, what's in the paws, sown plots, fireflies, gates), not what the job reported. This mattered: Harvest to storage handing a crop over to Haul isn't a failure.
  - **Decision trace:** "Why…" in the editor; the reason is also on the pet card.
- **Retired:** `rulesSelect` (the old fixed Auto rule list), the separate Farm plan job card and plan mode (old saves' plan mode runs as Auto), and the "Tired? Nap" / "Night: sleep" rows, which are now needs. The *Learns from results* bandit stays until phase 5 replaces it.
- **Field Guide:** lesson 10 is now *Responsibilities*: same shadowing and preview steps, plus UNTIL, OR USE and the trace.
- **Gate (tests/duties.test.ts):**
  - a responsibility served by two jobs (Haul or Basket run) is worked on until its UNTIL holds;
  - a tired pet rests until refreshed before working;
  - no thrash: under 25 switches a minute on three farms, and the guard is never needed;
  - no endless retry: a job that can never work is tried at most 3 times per cooldown;
  - a commitment holds against a more important responsibility within 60 ticks.
- **Farm output stays ≥ 80% of the phase-0 baseline everywhere** (`bench:farm --learned`): Auto 690 vs 795 (87%) on the standard farm and 674 vs 658 (102%) held-out; two pets 84% / 87%; the Harvest job 121% / 97%.

**Phase 5 done (the learned executive):**
- **Auto → "Learns what pays off"** keeps everything that makes the fixed order safe: needs, cooldowns, the 60-tick commitment and the anti-flip-flop guard. What it learns is the choice:
  - **upper level:** which responsibility, per compact farm situation;
  - **lower level:** which of its jobs.
  - The values (`ExecValues`, on `Pet.executive.values`) are separate from skills and can be forgotten.
- **Reward:** progress on the responsibility plus completion, measured in the world (the phase-4 fingerprint), weighted by the responsibility's place in the list, discounted by the job's duration (γ = 0.995 per tick), minus a failure penalty. Coins are not the reward. Jobs that get nothing done (wandering, napping) earn nothing, wherever they are listed.
- **Untrained values follow the player's order,** so a new learner picks exactly like the fixed order. It learns away from that only when a choice doesn't get things done. Ties between jobs go to the farm-wide evidence.
- **Exploration is Curiosity:** 2–10% on the farm, 10–40% in practice, 0 when measuring. It only ever picks among eligible choices.
- **What didn't work (measured):**
  - *Bootstrapped values* (r + γ^ticks · max next, plain or with an average-reward time charge). A quick job that gets nothing done (wander, 6 ticks) scored almost as well as harvesting (about 25 ticks). Practice then made the farm worse: on a good order, 141–173 coins against 235 for the fixed order.
  - *Completion credit for any finished job:* naps and wanders "completed", so naps won.
  - *Unweighted progress:* quick planting outranked harvesting.
  - Values are therefore one-step (option-level, duration-discounted), with progress weighted by the order.
- **Executive lesson** (Farm → Auto → Learns what pays off → **Practise deciding**): 4 farm days on copies of the farm (only executive values change), then a comparison on 3 held-out farm seeds of *In your order*, *Learned picks* and *Random picks*: coins, switches per minute, and jobs started while tired.
- **Field Guide lesson 14, *Let them choose*:** switch, practise, read the comparison.
- **Retired:** the old contextual bandit (`learnedSelect`, `updateExecutive`) and the plan's *Learn among matches* chooser.
- **Gate (tests/executive.test.ts and measurements; 3 held-out seeds, 1 farm day each):**

| Order | In your order | Learned (after 4 practice days) | Random picks | Jobs started tired |
|---|---|---|---|---|
| Good (starter set), farm 101 | 378 | 364 | 221 | 0 |
| Good (starter set), farm 202 | 235 | 234 | 207 | 0 |
| Good, held-out layout, 101 / 202 | 316 / 245 | 313 / 246 | 221 / 229 | 0 |
| "Otherwise wander" first, 101 / 202 | 20 / 20 | 331–345 / 220–285 | 232 / 175 | 0 |

  The learned executive beats random picks everywhere and stays within 4% of a good order. It rescues a bad one, and never starts a job while tired. It doesn't beat a good order: the starter set is already close to the best this reward can see.
- **On the real farm** (`bench:farm --learned`, 2 days, Curiosity exploring 2–10%, after 4 practice days), learned Auto earns 606 on the standard farm and 544 held-out, against 690 and 674 for the fixed order (88% / 81%; both above the phase-0 baselines of 352 / 230 for the old learned chooser). Exploring on the job costs about 10–20% against a good order. Lowering farm exploration, or letting the player set it, is a phase-6 tuning question.

Next: phase 6 (retire and polish: direct job cards, the stuck-recovery sniffing, capability readiness in the Pet binder, an executive inspector).

**The commitment.** Everything a pet does on its own on the farm comes from a skill or routine the player taught it in the pen. No hidden job scripts. The farm executive is promoted from a fixed rule list to a learned, two-level decision-maker:
- the **upper level** reads the farm and picks what to work on next (a responsibility);
- the **lower level** picks which learned skill or routine to use for it.

This roadmap draws on the feedback group's *Learned Capabilities & Executive AI Redesign* spec. We adopt its core principles, adapt much of its machinery to fit what Pen Deck already has, and defer or decline the rest (section 2).

## 1. Audit: what is learned today and what is scripted (HEAD `34c8b26`)

Farm decisions flow `chooseInvocation` → `buildExecutor` → `step` in `src/game/farm.ts`. Each farm **job** (`BehaviorId`) is executed as follows:

| Job | What runs it today | Learned part | Scripted part |
|---|---|---|---|
| **Harvest** (`forage`) | `FarmWalk` legs + `pick` + `drop` | Walking (the pet's Approach/Avoid) | Which crop, the pick, choosing storage vs house (`harvestTarget`), the drop, stuck recovery |
| **Haul** (`deliver`) | `FetchRun` | The Fetch controller *and* Approach | Which item (eggs, fullest storage) and the destination (house) |
| **Plant** | `FarmWalk` to soil + `plant` | Walking | Which soil, the plant |
| **Basket run** (`tote`) | A phase machine: fetch → lift → unload → place | Walking legs | Nearly everything: target basket, destination, the crop-side spot (`cropSpot`), BFS last steps, retries |
| **Catch fireflies** | `NavRun` to firefly | Walking | Target choice |
| **Mind the gate** | Walk + `nudge` | Walking | Which gate, the nudge |
| **Go to** | `NavRun` | Walking | — |
| **Nap** (`rest`) | `wait` until rested; with other pets on duty, a **BFS walk home** | — | All of it |
| **Wander** | random moves | — | All of it (by design) |
| **Run a skill** | `SkillRun` / `RoutineRun` | **All of it** | Target from the player |
| **Steer** | the player | — | — |

**Who decides:**
- **Auto, rules mode:** `rulesSelect` is a hand-ordered priority list.
- **Auto, learned mode:** `learnedSelect` is a contextual bandit over the fixed job list, rewarded by coins per tick.
- **Farm plans:** player IF/DO rows over the same fixed jobs, plus *Run a skill*.
- **Always on:** the starter plan mirrors the rules tick for tick, and stuck recovery (`jitter`, `FarmWalk` sniffing) is scripted.

**Defects confirmed while auditing:**
1. `RoutineRun` reports `success: 'time up'` on timeout (`routine.ts:158`). `SkillRun` does too (`policies.ts:203`), which is only right for *survive* skills ("stay dry until time's up"). Timeout must be its own outcome.
2. Routine and Fetch learning add up an option's rewards undiscounted and then discount by a flat γ (`trainer.ts:219`). It isn't duration-aware SMDP learning yet. This matters once options last very different lengths of time.
3. A bought or unlocked crop plot can exist before it's usable. Harvest only "knows" kinds through `CROPS`, and a pen skill aims at **one kind**. There's no "any ripe crop" target.

**What already works in our favour:**
- Pens can hold every farm object (crops, soil, house, baskets, sheds, gates, creatures, fireflies, stocked storage), night, rain, and the Plant / Lift / Shoo / Nudge / Water abilities.
- Routines learn Fetch from cards in 400 tries (91%) and already run on the farm.
- Notes give skills memory.
- Big brains and long runs give room.
- A **certified** label exists for every skill.

## 2. What we take from the feedback spec

| Spec idea | Our call | Why |
|---|---|---|
| No hidden competence; every autonomous farm action from a saved learned skill/routine | **Adopt** | It's the game's promise |
| Physics stays deterministic; only *choices* are learned | **Adopt** (already true) | |
| One runtime and outcome protocol (success / failure / timeout / interrupted / cancelled) | **Adopt** | Fixes defect 1; simplifies `farm.ts` |
| Capability registry with stable IDs, revisions, eligibility reasons | **Adopt, slimmed**: a *capability* is a saved skill or routine **plus an aim** (what it's pointed at), with eligibility reasons | We already have stable skill IDs and revisions |
| Pin revisions by default | **Adapt** (decided): follow the active revision, with stale-dependency warnings and an optional pin | Pinning by default would undercut "retrain to improve" |
| Goals vs needs vs intentions as three constructs | **Adopt, small**: **responsibilities** (player goals: a condition to reach or keep, a priority), **needs** (energy only, plus night) and one **current commitment** with no-progress and cooldown rules | The full lifecycle machine is more than the farm needs |
| Goal predicates from the existing card grammar | **Adopt** | Conditions, *Has done…*, counts, storage, notes already exist |
| Deterministic executive first, then learned | **Adopt** | Gives an honest baseline to beat |
| Goal-conditioned SMDP option-value learner, duration-discounted | **Adopt** for the lower level (the capability choice); the upper level starts as priorities and learns later | Matches our tabular style |
| `expectedEffects` predictions on capabilities | **Adapt**: *learned* per-capability statistics (success rate, ticks, goal progress per use), shown as evidence | Players shouldn't have to write predictions |
| Rest requires a learned capability; no invisible nap | **Adapt**: resting is the innate *Stay* action (like *Do action* in routines). Choosing **when** to rest and **where** to go is learned. Collapsing asleep at 0 energy stays involuntary (a need, not a job). | A pet that can't learn to sit down would be cruel and confusing |
| Bounded nested routines (routine as an option) | **Defer** (decided). Routines themselves are full executive capabilities from phase 1; only routine-inside-routine waits | The spec itself says measure first |
| Raise `MAX_OPTIONS` / `MAX_WATCH` | **Defer** until a task needs it | |
| Responsibility board and custom goal editor | **Adopt**, built on the farm-plan mat (rows become responsibilities) | Reuses a UI players know |
| Restructured 9-lesson curriculum | **Adapt** (section 5): keep our 11 lessons, insert *Harvest* early, convert *Plan the farm* to responsibilities | Existing lessons are still accurate about training |
| Statistical evidence: repeated seeds, held-out scenarios, anti-reward-hacking checks | **Adopt** (we already measure this way) | |
| Feature flags for legacy scripted jobs | **Adopt, tests only**, removed when each job's learned replacement passes its gate | |
| Pet-to-pet negotiation, LLMs, natural-language planning | **Decline** | Non-goals in the spec too |
| Economy redesign | **Decline**, except unlock order (section 5) | |

## 3. Target design

```text
Responsibilities (player)  +  Needs (energy, night)
              │  upper level: what to work on — priorities first, learned later (phase 5)
              ▼
     Current commitment  (sticks until done, stuck, or out-prioritised; cools down failures)
              │  lower level: which capability — learned option values per responsibility
              ▼
   Capabilities = saved skills / routines × aim   (eligibility + reasons, evidence)
              │  one runtime adapter, one outcome protocol
              ▼
   Deterministic world (unchanged)
```

### 3.1 Capabilities
- **What counts:** every saved skill or routine the pet has, combined with an **aim**: a kind ("berry"), a **trait** ("any ripe crop", "any storage with room") or "the target of the responsibility". Trait aims are new (defect 3) and are needed for one Harvest skill to work for every crop.
- **Opt-in:** a capability is usable on the farm when the player allows it (default: certified ones). Uncertified ones can be allowed explicitly; the card shows readiness.
- **Eligibility, with a reason:** missing skill, nothing to aim at, a stale dependency, hands full, too tired, cooling down.
- **Evidence, learned on the farm:** uses, success rate, median ticks, progress per use. It's shown on the card and used by the executive.
- **One runtime:**
  - every capability runs through one adapter, whether started by direct assignment, a plan row, a responsibility or the executive;
  - it reports `success`, `failure`, `timeout`, `interrupted` or `cancelled`, with a reason and elapsed ticks;
  - *survive* skills (e.g. "Keep clear") report success at time-up only if they survived.

### 3.2 Responsibilities, needs and the commitment
- **A responsibility** is a condition card (what should be true), how it's kept (*until true once*, *keep true*, or *repeat N times*), a priority, and optionally which capabilities may serve it. Examples:
  - "Storage at most half full (keep)";
  - "Sell 10 berries today (repeat daily)";
  - "Every field plot planted (keep)";
  - "Patrol: note *leg* ≥ 3 (repeat)".
- **Needs:** energy below a threshold raises a *Rest* need, and night raises a *Sleep* preference. A need becomes a high-priority responsibility. Satisfying it still uses a capability: *Stay* (innate), or a learned "Go home" first.
- **The commitment:**
  - the executive commits to one responsibility and keeps using capabilities for it until it's satisfied, until it's out-prioritised by a need or a clearly higher priority, or until no progress is made for N ticks;
  - repeated failures put that capability or responsibility pair on cooldown (shown with the reason);
  - progress is always measured from the world (conditions and tallies), never from what a skill claims.
- **Farm plans** become the responsibility editor. A plan row "IF *condition* DO *job*" converts to a responsibility "WHEN *condition* WORK ON *(the job's goal)* USING *(capability)*" (section 6).

### 3.3 The executive, in two stages
1. **Deterministic (phase 4):** take the highest-priority unsatisfied responsibility, then choose the eligible capability with the best evidence for it (optimistic for untried ones), committing as in 3.2.
2. **Learned (phase 5):** an option-value table per (responsibility, compact farm state, capability). It's trained at capability boundaries with **duration-discounted** targets (γ^ticks), and rewarded by **progress on the responsibility** plus completion, minus time and failure. Coins are no longer the reward. Exploration follows the pet's Curiosity, over eligible capabilities only.
   - The upper level (which responsibility next) learns the same way once the lower level works.
   - Executive values are separate from skills: they can be reset, and retrained in **executive lessons**.

### 3.4 What stays scripted (the allowlist)
World physics and legality; collapsing asleep at 0 energy; the player's Steer; *Stay*; stopping when a capability is cancelled. Nothing else. Today's stuck recovery (random sniffing) becomes a property of the walking skills: their own Walls and Last-heading senses, plus the *timeout* outcome. Recovery is the executive choosing something else.

## 4. Pen ↔ farm parity (what pens must express so farm jobs can be taught)

| Farm capability | Taught as | Pen affordances needed |
|---|---|---|
| Go to / Approach, Avoid | Existing presets | — |
| **Harvest & sell** | A routine: Approach → ripe crop, Pick up, Approach → house, Put down (watching carrying / at crop / at house) | **Trait aims** ("any ripe crop", "the house"); crops that ripen during a try (optional) |
| Harvest into storage | Same routine, aimed at "storage with room" | Trait aim "storage with room"; stocked storage (exists) |
| **Haul** | Fetch (exists) aimed at "fullest storage" → house | Trait aims |
| **Plant** | A sense skill: walk to soil, Plant | "Can afford seeds" in pens (a pen coin budget); soil (exists) |
| **Basket run** | A routine: Approach → basket, Lift, Approach → house, Put down, Approach → crops, Put down | Basket senses (Stock, exists); "a clear tile by the crops" aim |
| **Rest** | *Stay*, plus a learned "Go home" (Approach → house) | **Energy in pens** (drains with work, a Tired sense), so "rest when tired" can be practised |
| Catch fireflies | Approach aimed at firefly at night | Exists (Time of day, fireflies placeable) |
| Mind the gate | Existing *Open the gate* recipe, plus a "Close" variant | Exists |
| Wander | A learned "explore" skill, or simply unused | Optional |

**Gate per job:**
- the same saved revision succeeds on held-out pens and on held-out farm layouts;
- the farm reaches at least the agreed share of the scripted baseline (decision 3);
- no legacy executor runs for that job.

## 5. Progression and the Field Guide

The first farm coins currently come from the built-in Harvest. Without it, **harvesting must be taught before the farm earns**. Proposed early game:

| # | Lesson | New / changed | The player builds |
|---|---|---|---|
| 1 | First lesson | Changed ending: "put it to work" becomes "it can walk to anything; now teach it a job" | Approach |
| 2 | **Harvest** *(new)* | A routine from cards in a farm-like pen: Approach → crop, Pick up, Approach → house, Put down | Harvest routine, then **allowed on the farm** → first coins |
| 3–4 | Practice, Scatter | Unchanged | |
| 5 | Pay for results | Unchanged (Fetch loophole) | Fetch |
| 6–9 | Where, Invent, Read, Combine | Unchanged | |
| 10 | **Plan the farm → First responsibility** *(changed)* | "Keep storage at most half full" with Harvest and Haul allowed; watch the executive commit, switch, recover | Responsibilities |
| 11–12 | Lay out the farm, Notebook | Unchanged | |
| 13 | **Teach a job** *(new, optional)* | Plant and Basket run from cards when those unlock | Plant skill, Basket-run routine |
| 14 | **Let them choose** *(new)* | Train the executive in an executive lesson; compare deterministic vs learned on held-out farms | Executive values |

- **Unlock order:** Fetch lessons open right after Harvest instead of at 5 coins, since Haul needs it. Carrots still follow a certified Fetch.
- **Starter content:** none is pre-trained invisibly. Recipes and lessons give the cards; the pet trains them like any skill.

## 6. Existing saves (v8 → v9)

The playtest team knows existing saves may be negatively affected by this update and will reset (decision 4). So:
- **No grace period and no transition lesson.** Legacy jobs are never mapped to skills a pet lacks.
- **Loading an older save:**
  - the migration keeps what still makes sense: pets, skills and their revisions, cards, stages, the layout;
  - it drops the old assignments and plans;
  - the journal says the farm now runs on learned jobs and points to the Harvest lesson.
- **If a save can't be migrated cleanly,** the game offers a reset rather than guessing.
- New games are the supported path, and the browser test plays a new game end to end.

**Done (phase 3d):** saves are v9. Migrating a v8 save:
- clears jobs the old scripts left half-run;
- puts every pet back on Auto (old assignments and plans dropped; the navigator is kept);
- adds a journal milestone pointing to *Teach a job: Harvest*;
- sets a one-time farm notice with **Open the Guide**, **Start fresh…** (the reset dialog) and dismiss buttons.

Pets, skills, revisions, stages and the layout are kept.

## 7. Phases and gates

| Phase | Scope | Gate |
|---|---|---|
| **0: baselines** | `npm run bench:farm`: current Auto (rules and learned), plans and two-pet farms over fixed and held-out seeds (coins, tasks, ticks, timeouts, idle, switches, ms per tick); failing tests for defects 1–2 | Reproducible baseline report in TESTING.md |
| **1: one runtime** | Capability = skill/routine × aim; one adapter and outcome protocol (fixes defect 1); duration-aware option learning (defect 2, gated so existing skills keep their measured results); trait aims; eligibility reasons; *Run a skill* and plan rows go through it | All direct and plan skill invocations use one path; outcome tests pass; existing recipe numbers unchanged within noise |
| **2: parity** | Pen energy and a Tired sense, a pen coin budget for seeds, the "storage with room" / "ripe crop" / "clear tile by crops" aims; transfer tests (train in pen → run on held-out farms) | A full harvest → sell cycle runs on the farm using only learned capabilities |
| **3: learned repertoire** | Harvest, Haul, Plant, Basket run, Rest/Go home, fireflies, gate as recipes and lessons; Field Guide lessons 1–2 and 13; unlock reorder; v9 save migration (section 6); retire each scripted executor once its gate passes | A pet without a skill can't do that job; farm output ≥ the agreed share of baseline (decision 3); new-player e2e passes |
| **4: responsibilities + deterministic executive** | Responsibilities (from plan rows), needs, commitment rules, cooldowns, decision trace ("working on X with Y because…"); replaces `rulesSelect`, the starter plan and the job list | Multi-capability responsibility completed; low energy handled; no thrash (switches per minute) and no infinite retry (property tests) |
| **5: learned executive** | Duration-discounted option values per responsibility (lower level), then the upper level; executive lessons; Curiosity as exploration | Beats the phase-4 executive or random-eligible choice on held-out farms over repeated seeds, without losing safety; lesson 14 |
| **6: retire and polish** | Remove legacy Auto, rules and job executors; capability readiness in the Pet binder; executive inspector; docs | Definition of done (below) |

**Definition of done:**
- A pet with no skills does nothing productive on the farm.
- Every autonomous action on the farm comes from a saved skill or routine through one runtime.
- Player-made skills serve responsibilities without being named in code.
- Responsibilities, needs and the commitment are inspectable.
- The learned executive measurably beats its baseline.
- Old saves keep every trained skill.
- No timeout counts as success.

## 8. Decisions (settled)

1. **Revision binding:** follow the active revision, with stale-dependency warnings and an **optional pin** per capability.
2. **Rest:** innate *Stay*. *When* and *where* to rest are learned; collapsing asleep at 0 energy stays involuntary.
3. **Bar for retiring a scripted job:** the learned replacement reaches ≥ 80% of the phase-0 scripted baseline on held-out farms. *(Recommendation taken; no objection raised.)*
4. **Existing saves:** they may be negatively affected; the playtest team will reset. No grace period (section 6).
5. **Capability opt-in:** certified skills and routines are usable on the farm by default; anything else needs an explicit opt-in.
6. **Responsibilities editor:** the farm-plan mat is converted into it.
7. **Upper-level learning:** priorities first; the learned upper level comes in phase 5. *(Recommendation taken; no objection raised.)*
8. **Nested routines:** deferred. **The executive must be able to employ routines as capabilities** from phase 1 on (it does: a routine is a capability like any skill). Only routine-inside-routine waits for evidence.
