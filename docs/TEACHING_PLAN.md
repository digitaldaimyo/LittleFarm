# Teaching polish plan: rules, conditions and pens

**Goal:** make it easier to say what you mean when you build a lesson. More of what a player intends should be expressible, the right card should be quick to find, a lesson that can't work should explain why, and players should be able to keep building on what they've made.

Status: **plan, not started.** Section 6 lists the decisions to take before phase A. Sound phase C is on hold.

---

## 1. The case that started this

> "I wanted to end on *shoo chicken* and *next to chicken*, but I wasn't able to manage it."

I reproduced it in the simulator (a herding pen; rule *WHEN Pip shoos Chicken THEN Treat, End try (done ✓)*; SUCCESS *Pip within 1 of Chicken*):

| Step | What happens |
|---|---|
| Pip stands next to the chicken | SUCCESS holds |
| Pip shoos | The rule fires and ends the try "done ✓" |
| The shoo pushes the chicken one tile away | It is now 2 steps from Pip |
| The try is judged | SUCCESS is checked on the world *after* the step: false. **The try counts as a miss.** |

Four things combine:

1. **No condition remembers what happened.** SUCCESS and IF cards only describe the world *now* (where things are, what's carried). Events like *Shoos*, *Picks up* or *Nudges gate* can only start a rule, so there's no way to say "success = has shooed a chicken". Two specific cases exist (*Has delivered*, *Watered*), but nothing general.
2. **"End try (done ✓)" looks like success but isn't.** It only stops the try. Success is still judged by SUCCESS alone. The ✓ promises something the game doesn't do, and nothing says why the run scored 0%.
3. **State changes after the event.** A shoo moves the chicken away, a pickup removes the item from the ground, and delivering empties the paws. SUCCESS sees the world *after* all of that.
4. **The right cards are hard to find.** In a herding lesson, the hand recommends *Reaches, Delivered, Every step* for WHEN and *Is at, Has delivered, All in area* for SUCCESS. *Shoos* and *All of* are buried in an unsorted "More cards" list of 12–18.

After phase A, the same intent should take a few taps: SUCCESS **"Pip has shooed Chicken (at least 1×)"**, or the rule's **"End try (counts as success ✓)"**. Combining it with "while next to the chicken" should be one *All of* away, from a SUCCESS slot that takes several cards directly.

## 2. Audit: where the editor holds players back

Sizes: S (a day or less), M (a few days), L (a week or more).

### Expressiveness (what can be said)
| # | Gap | Fix | Size |
|---|---|---|---|
| E1 | No memory of events | **"Has … (≥ n times)"**: a condition that wraps *any* event card and counts it this try. For example "has shooed Chicken ≥ 1", "has bumped ≥ 3", "has nudged a gate". Also **"Just …"** (this very step). Tallies live on the world (reset each try), so runs stay deterministic. | M |
| E2 | No "or" | **Any of** (next to *All of* and *Not*) | S |
| E3 | "End try ✓" doesn't mean success | Make the outcome honest. See decision 1. | S–M |
| E4 | "Near" only measures from the pet, in steps (diagonal = 2) | **Next to** (the 8 surrounding tiles) and **"Any X within N of Y"** for two kinds (e.g. a chicken within 1 of the coop). The existing *Object is near* only works on the event's "it". | S |
| E5 | No sense of time within a try | **"Step is before/after N"**, so you can reward finishing early or fail a try that dawdles past N | S |
| E6 | SUCCESS and FAIL take one card | They become **lists**: all must hold by default, with an *any of these* switch (see U2) | S |

What we deliberately *won't* add: per-step shaping effects or treats that scale with distance. The game teaches "pay for results, not effort", and those cards would mostly create loopholes.

### Ease of use (finding and checking)
| # | Gap | Fix | Size |
|---|---|---|---|
| U1 | The hand ignores context | Rank by the lesson's **abilities** (Shoo → *Shoos*, *Has shooed*), its placed kinds and the slot (SUCCESS prefers state and memory conditions; WHEN prefers events your abilities can cause). Sort "More cards" into sub-groups (*Where*, *Has / counts*, *Time*, *Combine*) and alphabetically within them. | M |
| U2 | Combining needs a buried card | SUCCESS and FAIL show **+ condition** chips with an *all / any* toggle. Rules' IF already works this way. | S |
| U3 | Rules are hard to read back | Each rule, SUCCESS and FAIL gets a **plain sentence** ("Success when Pip has shooed a chicken at least once") | S |
| U4 | Silent mismatches like the one above | A **preflight check** (it already runs random tries) counts how often a rule ended "✓" while SUCCESS didn't hold, and how often SUCCESS was already true at step 0. It warns with a one-tap fix: "This rule ends the try as a success, but SUCCESS was false every time. Use *Has shooed* in SUCCESS?" | M |
| U5 | You can't try your own lesson | **Play it yourself**: steer the pet in the pen (same keys as the farm's Steer), watch rules light up as they fire and SUCCESS flip, and see the step count. It uses the same simulator and is never counted as training. | M |
| U6 | Rule housekeeping | **Duplicate**, **reorder** and **switch off** a rule (test without deleting it) | S |
| U7 | Hard to see the variety a pen produces | A strip of **6 example layouts** (seeds from the training range) under the pen, next to *Roll layout* | S |

### Pens (environment)
| # | Gap | Fix | Size |
|---|---|---|---|
| V1 | Scatter regions are coarse (anywhere / left / right / top / bottom / centre) | **"in area …"**, **"next to …"** and **"away from …"** regions (e.g. chickens start next to the coop; berries away from the pet) | M |
| V2 | Counts are fixed | Counts become a **range** ("1–3 each try"), plus a **sometimes** option (present on about half the tries). Variety without hand-making layouts. | S |
| V3 | Pens are always 8×8 | A **Pen size** card: 6×6, 8×8, 10×10, or *varies* each try. Senses are relative, so the state budget doesn't change. Transfer is already tested on bigger pens, and *varies* should help it. | M |
| V4 | Obstacles mean placing rocks one by one | An **Obstacles** card: none, a few, some or many, plus "rocks / fences / mixed". Our evidence: no rocks gave 70% in cluttered pens, a few 86%, lots 80%. | S |
| V5 | The pet's start is random or one tile | Start **in area** or **away from …** | S |

### Long-term flexibility
| # | Gap | Fix | Size |
|---|---|---|---|
| L1 | Memory conditions in rewards can be unlearnable | A pet can't sense "have I shooed yet?", so rewards that depend on it are guesses from the pet's point of view. Add a matching sense, **"Done … yet?"** (×2 situations). The validator suggests it when IF or SUCCESS uses *Has …* and no sense covers it. | S |
| L2 | Templates exist but are hard to use | Saving any card as a template already works in the sleeve. Add a **"Your cards"** shelf in the hand and the **exposed parameters** editing UI (stored since M1 but never shown), so a template like "Treat for reaching ___" asks for its blank. | M |
| L3 | Named conditions | Save a condition as a named card ("Chicken home" = *All in area Chicken coop*) and reuse it in rules, SUCCESS, routines' watches and farm plans. Mostly a matter of surfacing L2. | S |
| L4 | Lessons can't be shared | **Lesson cards**: export and import a lesson (pen, rules, SUCCESS), validated like skill cards | S |
| L5 | Farm plans and new conditions | Every new condition works in plans automatically (same type). Memory conditions need a farm meaning: see decision 2. | S |
| L6 | Changing a card's meaning breaks old lessons | Any semantic change (E3) gets a save migration (v4 → v5) with a fixture test, so saved lessons behave exactly as before | S |

## 3. Principles
- **Say it the way you think it.** If a player can describe a goal in one sentence, it should be one or two cards.
- **Treats teach; SUCCESS checks** stays true. Ending a try is neither, so the effect says plainly what the ending means.
- **Explain, don't block.** Mismatches become warnings with a one-tap fix, measured in preflight wherever possible, never guessed.
- **Honest to the learner.** If a reward depends on something the pet can't sense, the game says so and offers the sense.
- **Old lessons don't change behaviour.** New cards are additive; changed meanings migrate.

## 4. Phasing

| Phase | Scope | Size |
|---|---|---|
| **A: say what you mean** | E1 *Has … / Just …*, E2 *Any of*, E3 honest End try (with the L6 migration), E6/U2 SUCCESS and FAIL lists, U1 context-aware hand and sorted More, U3 plain sentences, U4 preflight mismatch check, L1 "Done … yet?" sense | M–L |
| **B: better pens, and try it yourself** | V1–V5 (regions, ranges, pen size, obstacles, start), U5 play it yourself, U6 rule housekeeping, U7 layout strip, E4 *Next to* / *X within N of Y*, E5 time in try | M–L |
| **C: build on what you made** | L2 template shelf and exposed parameters, L3 named conditions, L4 lesson cards, L5 plan semantics for memory conditions | M |

Each phase ships on its own and keeps every existing test green.

**Gates for phase A**
- The motivating case, built from cards in a test: herding pen, SUCCESS "has shooed Chicken ≥ 1". It must be expressible (validated), learnable (beats random by ≥ 30 points held out), and reported as success when the rule's End try is marked as counting.
- With the old setup (End try ✓ + SUCCESS *within 1*), preflight warns, and the one-tap fix produces the working version.
- All 9 recipes and the Field Guide lessons keep their numbers within noise. Saved v4 lessons load as v5 and score identically (fixture).
- The hand recommends *Shoos* and *Has shooed* in a lesson with the Shoo ability (unit test on ranking).
- Browser test: build the motivating case by clicking (≤ 8 taps from an empty SUCCESS slot) and train it.

## 5. Testing
- Unit:
  - memory tallies reset each try and stay deterministic;
  - *Has …* covers every event card;
  - *Any of* / *All of* / *Not* combinations;
  - the End try migration;
  - list-valued SUCCESS and FAIL;
  - plain-sentence rendering for every card;
  - hand ranking by abilities and slot.
- Learning: the motivating case and one memory-based lesson per ability (e.g. "nudge the gate once, then get away") against random and untrained baselines, plus the effect of the "Done … yet?" sense, measured and written up the way the Field Guide evidence was.
- Browser: the motivating case built and trained by clicks; the preflight warning and its fix; in phase B, play-it-yourself and the layout strip.
- Docs: GAME_DESIGN (vocabulary), ARCHITECTURE (memory tallies, list conditions), TESTING, README, and the Field Guide where lessons mention SUCCESS. *Invent a skill* may want a short note on *Has …*.

## 6. Decisions needed
1. **What "End try" means.** (a) Three honest choices: *End try* (judged by SUCCESS, today's behaviour, now labelled plainly), *End try: counts as success ✓*, and *End try: counts as a miss ✗*. Old saves migrate to the first, so nothing changes for them **(recommended)**. (b) Make today's ✓ count as success for everyone, which changes old lessons' scores. (c) Keep the meaning and only relabel ✓ to "end try".
2. **What "Has …" means on the farm** (plans and skills run with *Run a skill*): (a) since the current job or skill started **(recommended**, matching a try), or (b) since dawn ("today").
3. **SUCCESS and FAIL as lists** with an all/any toggle **(recommended)**, or keep one slot and rely on *All of* / *Any of* cards.
4. **Pen size:** offer 6×6 / 8×8 / 10×10 / *varies* per lesson **(recommended)**, or keep 8×8 and only vary the contents.
5. **Play it yourself** in phase B **(recommended)**, or earlier in phase A because it helps people debug lessons.
