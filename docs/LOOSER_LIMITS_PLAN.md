# Looser limits plan: bigger brains, longer practice, and notes the pet can sense

Status: **plan** (no code yet). Recommendations are marked; decisions are in section 6.

The goal: give players more room to build ambitious skills, without losing what makes the game legible (every number is measured, nothing is a black box, and failure is explained).

## 1. Where we are

| Guard rail | Today | Where |
|---|---|---|
| What a skill learns with | A lookup table (tabular double Q-learning): one row of values per *situation* (a combination of sense values). No neural network anywhere. | `learning/qtable.ts` |
| Senses per skill | 5 | `MAX_SENSES`, `learning/senses.ts` |
| Situations per skill | Warn above 50,000; above 100,000 training is blocked ("too many!") | `STATE_WARN`, `STATE_MAX` |
| Practice tries | 300–12,000 (Fetch 100–4,000); lesson cards accept up to 50,000 | Pet binder slider, `lessoncard.ts` |
| Time per try | 10–120 steps | Pet binder slider |
| Memory within a try | Only what the world itself shows, plus *Done … yet?* (has an event happened this try). Rules can pay treats or end a try, but can't write anything down. | `sense.did`, `cond.happened` |

## 2. What we measured (spikes on this branch, not shipped)

Three lessons, held-out success on 30 unseen layouts:

| Lesson | Learner | Practice | Success | Time (headless) |
|---|---|---|---|---|
| Approach (preset senses, 27,648 situations) | table | 1,500 | 93% | 0.2 s |
| | small network, 64 units, online | 3,000 | 93% | 0.8 s |
| | small network, 32 units, replay | 1,500 | 57% | 1.1 s |
| Empty the basket item by item (4 senses, 4,374 situations) | table | 12,000 | 63% | 2.1 s |
| | table | 30,000 | **87%** | 4.8 s |
| | small network, 64 units (two variants) | 12,000 | **0%** | 26–106 s |
| Same + *Walls nearby* + *Last heading* (6 senses, **279,936** situations, beyond today's cap) | table | 12,000 | 53% | 3.0 s |
| | table | 30,000 | 70% | 6.0 s |
| | table | 60,000 | **83%** | 12.6 s |

**What this says:**
- **Longer practice is the cheapest big win.** Today's 12,000-try ceiling is what holds the basket lesson at 63%.
- **The table handles far more situations than the cap allows.** At 280,000 situations it still learned (83%) because a pet only visits a fraction of them: 15,180 visited, about 800 KB saved.
- **A naive network isn't a stronger learner here.** It matched the table on Approach but learned nothing on the multi-step task, at 10–50× the time. A network that helps would need real work (multi-step returns, tuning, a benchmark), so it belongs in its own gated phase.

## 3. Design

### 3.1 A bigger brain (recommended: a "Brain" choice in the Pet binder)

| Brain | Senses | Situations | Storage | Notes |
|---|---|---|---|---|
| **Standard** (today) | up to 5 | up to 100,000 | dense arrays | Unchanged default, and the one presets use |
| **Big** | up to 8 | up to 2,000,000 | sparse (only visited situations kept in memory and in saves) | Needs more practice; the hint says so with the measured numbers |
| **Network** (experimental, phase C) | up to 10 | no product limit (inputs add up instead of multiplying) | a few thousand weights | Only if it passes the benchmark gate in section 5 |

- The situations meter gets a second scale for Big brains, and the "too many!" block moves to the Big limit.
- **Probe, summaries, curiosities, skill cards and routines keep working** for Standard and Big, because both are tables (Big just stores rows sparsely). The network would need its own "visited" bookkeeping for the probe's grey arrows.
- Skill cards accept Big tables (new upper bounds), and check them like today.

### 3.2 Longer runs and more steps

- **Practice tries:** up to 100,000 for sense skills (Standard or Big), 20,000 for Fetch and routines. The slider becomes stepped (300 … 12,000 … 30,000 … 100,000).
- **Time per try:** up to 400 steps (today 120). Bigger pens and multi-trip jobs need it: the basket lesson needed 120–160 to learn reliably.
- **Before training, the binder shows an estimate** ("about 15 s on this device", from a quick calibration run), and the progress panel already has *Stop*.
- **Energy (decision 2):** recommended to keep the flat cost (15, Avoid 20; Field Guide free). Charging for longer runs would put the guard rail back.
- **Saves:** Big skills can be large, so a save-size line appears in Settings. Old revisions of Big skills keep only their report, not their table, unless pinned (decision 4). IndexedDB holds this comfortably; the localStorage fallback warns when it can't.

### 3.3 Notes: counters and flags that rules write and the pet can sense

Players get a small notebook per skill, with named **notes**. Each note is a **flag** (on/off) or a **counter** (0 up to a cap).

- **Effects (rule THEN):**
  - *Set note* (flag on, or a counter to a number);
  - *Clear note*;
  - *Count up* / *Count down* (clamped between 0 and the cap).
- **Conditions:** *Note is set*, and *Note compares* (= ≠ < ≤ > ≥ a number). They work in rule IFs, SUCCESS and FAIL.
- **Sense:** *Note*. A flag has 2 values; a counter has cap + 1 values (default cap 3, so 0, 1, 2, 3+). This is how a pet "remembers": for example "visited the well" for patrols, or "carried 2 so far" for "bring exactly three berries".
- **Lifetime:** notes reset at the start of every try, and at the start of every skill run on the farm.
- **Notes rules run wherever the skill runs:** in training, in the report's evaluation, in the probe, and on the farm (`SkillRun`). That keeps what the pet senses the same in the pen and on the farm. Only the treats are training-only.
- **Limits:** 4 notes per skill, counter cap ≤ 9, names from the player.
  - The hand offers names already used in the lesson, so a typo can't silently create a second note.
- **Honesty checks (validation):**
  - a note that is sensed or tested but never written: warning;
  - a note that is written but never read: info;
  - a note whose writing rule depends on something the pet can't sense: explained, like today's *Done … yet?* hint.
- **Relation to what exists:** *Done … yet?* and *Has done…* stay as they are, as automatic notes about events. Player notes are for anything else.
- **Farm plans (decision 5):** plans could later read the lead pet's notes ("IF Pip's note *trips* ≥ 3 DO nap"). Recommended later, not in this pass.
- **A recipe and a Field Guide lesson (decision 6):** *Patrol* is the recipe. The pet visits the well, then the gate, then the well again; a "visited the well" flag plus the Note sense should make it learnable, while without the note the pet can't tell the two well visits apart (to be measured in phase B before the lesson is built on it). The Guide lesson would try it without the note first, then with it, and compare (like *Invent a skill*).

## 4. What this touches

- **Saves:** v9 adds `learner.brain` (default Standard), note effects/conditions/senses (new cards; old saves unaffected), sparse Big policies (`format: 'sparse-q/v1'`). Lesson cards and skill cards accept the new ranges.
- **Trainer and worker:** a sparse table class with the same interface as `DoubleQ`; the training loop is unchanged. A notes engine in `compileStage` (`evalStep` applies note effects before conditions are checked the next step), and `SkillRun` on the farm runs the notes rules.
- **UI:**
  - Pet binder: Brain choice, wider practice and time sliders, estimate.
  - The hand: Notes group (effects, conditions, sense).
  - Rules: notes read back as sentences ("note *trips* +1").
  - Reports: a "notes at the end of the try" line in replays.
- **Determinism:** unchanged (same RNG paths). The tests in section 5 pin it.

## 5. Testing and gates

- **Big brain:** a Big table trained on the 6-sense basket lesson reaches ≥ 75% at 60,000 tries (measured 83%). A Standard-sized lesson trained as Big gives identical decisions to Standard (same seeds, same table values). Sparse save/load round-trips; skill cards with Big tables import and act identically.
- **Longer runs:** 100,000 tries finish in the worker without memory growth (sparse rows only); *Stop* keeps the partial skill. Time-per-try 400 works in every recipe.
- **Notes:** effects, clamping, reset each try, the conditions and the sense; notes rules run on the farm (a skill that counts trips behaves the same in the pen and on the farm); validation warnings; *Patrol* learns with the note and stays near random without it (the lesson's contrast, measured on 3 seeds).
- **Network gate (phase C):** ship only if, at equal wall-clock time, it matches the table within 5 points on Approach and the basket lesson, and beats it on a lesson with ≥ 8 senses. Otherwise record the result in TESTING.md and leave it out.
- **Browser test:** choose Big, raise practice, train, save; build a note rule and see it in the replay.

## 6. Decisions needed

1. **Brain choices:** Standard + Big now and the network as a gated experiment later (**recommended**), or attempt the network now?
2. **Energy for long runs:** keep the flat cost (**recommended**), or scale it with practice?
3. **Limits:** 8 senses / 2,000,000 situations (Big), 100,000 tries, 400 steps (**recommended**); or more?
4. **Old Big revisions in saves:** keep only the active and pinned revisions' tables (**recommended**), or keep everything?
5. **Notes in farm plans:** later (**recommended**), or in this pass?
6. **A Field Guide lesson for notes** (*Patrol*, with/without a note): yes (**recommended**), or just the recipe?

## 7. Phasing

| Phase | Scope | Size |
|---|---|---|
| **A: room to grow** | Big brain (sparse table, 8 senses, 2M situations), practice to 100,000 and time to 400 steps, the estimate, save-size line, card/save ranges, tests | M |
| **B: notes** | Note effects, conditions, sense; notes rules everywhere a skill runs (incl. the farm); validation; *Patrol* recipe and Guide lesson; tests, browser test | M–L |
| **C: network (experimental)** | A small Q-network brain with multi-step returns, its probe bookkeeping, and the benchmark gate; ships only if the gate passes | M (+ research risk) |

Each phase ships on its own, keeps every existing test green, and ends with the browser test passing.
