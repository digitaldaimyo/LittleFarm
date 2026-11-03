# Pen & cards roadmap: honest limits, richer Compare, qualifiers, smoother editing

Status: **official** (agreed after playtesting the learned-farm build). It follows `LEARNED_FARM_ROADMAP.md`, which is complete.

## Why

Playtesting the learned-farm build turned up four things:

1. **Reward hacks despite "once per object".** A pet learned *pick → drop → pick again* for repeated treats in a small test pen.
   - **Cause (confirmed in code):** storage keeps only counts. Taking an item out of a basket or shed creates a **new object with a new id** (`step(w, 'pick')` → `addObject`). "Once per object" (`lim.perObject`, keyed by object id) then sees a fresh berry every time it comes out of storage, so put-in / take-out / pick-up pays forever.
   - On open ground an item keeps its id, so the loop is blocked there.
2. **Counting what's in storage is cumbersome.** Players count by hand with notes and *Has done…*, which is unreliable.
3. **Compare is too narrow** to be the general tool it should be. Today it measures one thing (distance from the pet, count lying around, or crow pecks) against a number from 0 to 20.
4. **The card picker stays open** after a choice, or while filling a nested card, so it often needs closing by hand.

## Decisions (settled)

1. **Storage keeps identity.** A berry put into a basket and taken out again is the same berry: same id, and "once per object" counts it once, wherever it has been.
2. **Focus: jump into required slots.** Picking a card that still needs required inputs moves the picker straight to its first empty required slot. When the last required slot is filled, the picker closes.
3. **Compare becomes the measuring hub:** a measure on either side, all six comparisons, and many more measures.
4. **Qualifiers** (nearest / furthest / fullest / emptiest / carried) turn a kind into one specific object. They work in conditions, measures and senses.
5. **Qualifiers as aims** (e.g. Approach → "the furthest berry from the house") are **deferred to a follow-up push**. They touch the farm runtime, not just cards.

## Phases and gates

### Phase 1: Honest limits and a wiring audit

- **Storage identity (sim):**
  - Each storage slot keeps a stack of the ids that went in (`StoreSlot.ids`). Taking an item out reuses the last id (that object is revived, not created).
  - Emptying a basket into the house or a shed moves the ids along with the counts.
  - Pens with *Stocked storage* get ids for their starting stock.
  - The house sells: items delivered there are gone, as today.
  - Old saves: slots without ids get fresh ids on load. Save version bump (v11).
- **Wiring audit (`tests/wiring.test.ts`):** for every card in the registry:
  - it compiles where its type fits;
  - it describes itself in a plain sentence with no unfilled `{slot}`;
  - it validates in a minimal stage.
- **Event cards:** each fires in a small scripted scenario and matches only its own event.
- **Limits:** *once*, *once per object* and *cooldown* hold through pick up, put down, put into storage, take out, lift, empty, and carry across tries.
- **Senses:** each one reads what its hint says in a scripted scenario.
- **Loophole probe:**
  - A small harness trains tiny reward setups with each limit. It flags any setup where treats per try keep climbing while SUCCESS doesn't.
  - The same check feeds the report: "the same berry earned 14 treats in one try" (a sharper coaching tip than today's ratio).
- **Gate:** the pick / drop / re-pick hack is reproduced in a test before the fix and gone after it. The audit and probe pass for every card and limit.

### Phase 2: Compare upgrade and new measures

- **Compare:**
  - **Left:** a measure.
  - **Right:** a number (default) or another measure.
  - **Comparisons:** `< ≤ = ≠ ≥ >`.
  - **Numbers:** 0–100.
  - **Old saves:** existing Compare cards keep their meaning (≤, ≥ and = with a number).
- **Measures** (all usable in Compare, and where sensible in senses):

  | Measure | Reads |
  |---|---|
  | **Count** (exists) | X lying around |
  | **Stored** *(new)* | how many X are in storage: any, baskets only, sheds only, or the basket being carried |
  | **Sold / delivered** *(new)* | X sold at the house, or delivered anywhere: this try in pens, since the job started on the farm |
  | **Distance** *(extended)* | steps between any two things (today: only from the pet) |
  | **Energy**, **Seed money**, **Water carried** *(new)* | the pet's / the pen's values |
  | **Step of the try** *(new)* | replaces *Time in try*, which stays as an old card |
  | **Note value** *(new)* | a note's number, so notes compare with other measures |
  | **Pecks** (exists) | crops pecked by crows |
  | **Time until ripe** *(new)* | for the nearest crop or plot of a kind |

- **Storage sense:** "Storage of X" reads the count in bands (0 / 1–2 / 3–5 / full), so a pet can learn from stock levels without a huge table.
- **Starter content:** rewrite the starter responsibilities and recipes that count by hand to use Stored and Sold. For example, "Storage at most half full" becomes "Stored (any) ≤ half".
- **Gate:**
  - every measure has a scripted test;
  - Compare with measures on both sides works in pens, in rules, and on the farm (responsibilities);
  - old saves load with unchanged meaning;
  - a "keep 3 berries in the basket" pen trains without notes.

### Phase 3: Qualifiers

- **New object cards** (output: Object):
  - **Nearest X**: to the pet, or to another thing;
  - **Furthest X**: from the pet, or from another thing;
  - **Fullest / emptiest storage**;
  - **The thing being carried**.
- Ties go to the lowest id (deterministic).
- **Where they plug in:** sockets that take a kind (conditions, measures, senses) also accept a qualified object. "The nearest basket is full", "steps from the furthest berry to the house ≥ 5", "stored in the nearest basket ≥ 3", sense "direction to the furthest berry from the house".
- **Moving targets:**
  - The loophole probe covers rules built on qualifiers.
  - The report explains when "nearest" kept changing and that is what paid.
  - Validation warns when a reward rule's condition uses *nearest* together with a "closer to" check.
- **Gate:**
  - each qualifier passes scripted tests: ties, nothing to point at, the carried thing;
  - a pen using "furthest berry from the house" trains above random;
  - transfer to a bigger pen holds.

### Phase 4: Card editor focus

- **Picking a card:**
  - with no empty required slots: the picker closes;
  - with required slots: it jumps into the first empty required slot, depth first;
  - after the last one is filled: it closes.
  - Optional slots never hold the picker open; they show as dashed chips to tap later.
- **Escape**, or a tap outside the picker and the rule being edited, closes it.
- **Undo** stays one step per card placed.
- **Keyboard:** focus moves with the picker.
- **Gate:** browser checks that build a nested rule (WHEN … IF Compare(Stored(nearest basket) ≥ 3) THEN …) with no manual closes; existing lessons still pass.

### Phase 5: Recipe tune-ups and clean-up

- **Plant** (75% against a 70% bar) and **Open the gate** (65%, so not certified with default traits) are tuned to certify reliably. Gate: ≥ 80% on 5 training seeds at default traits.
- **Learned picks on the farm:** exploring defaults to off once a pet has practised (it stays on for untrained pets). Gate: measured, with the cost against a good order reported in `bench:farm`.
- **Browser test split:** pens and cards in one run, the Field Guide lessons in another, so card changes don't replay all 13 lessons.
- **Docs:** README, GAME_DESIGN, ARCHITECTURE and TESTING; a card reference table generated from the registry.

## Follow-up (not in this push)

- Qualifiers as **aims** for skills and jobs (Approach → furthest berry from the house; Harvest → crop nearest the basket). This needs the farm runtime to aim at one object rather than a kind.
