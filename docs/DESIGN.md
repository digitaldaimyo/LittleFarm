# Design

What Pen Deck is and how it plays today. How it is built is in `docs/ARCHITECTURE.md`; the measurements behind the numbers here are in `docs/TESTING.md`. Earlier plans and the history of each feature are in `docs/history/`.

## The idea

You are a trainer, not a programmer. You adopt a pet, teach it skills in a training pen by building lessons out of typed cards, and put it to work on your farm. The learning is real: tabular reinforcement learning on your own device, judged on layouts the pet never practised on. Nothing is scripted: a pet does on the farm only what it has learned.

The loop: design a pen → decide what earns treats and what counts as success → train → read the report → refine or roll back → save → use the skill on the farm → earn coins → unlock new lessons, cards and farm items.

The **farm** is the home screen and the pet is always visible. The **pen** is a focused teaching mode.

## Teaching a skill

**A lesson** is a pen (the Environment binder), rules (the Rules binder) and a learner (the Pet binder).

- **Pens.** Place things *scattered* (somewhere new each try: anywhere, in one half, inside an area, next to or away from something, far from the pet) or *pinned* to a tile. Counts can vary, things can appear on about half the tries, and **stocked storage** starts a basket or shed with things in it. Pen size is 6×6, 8×8, 10×10 or *varies*; **Obstacles** scatter rocks or fences; **areas** are painted with two taps; **Weather** and **Time of day** set rain and night. Six example layouts under the pen show the variety, and **Play it yourself** steers the pet through the lesson by hand (it never counts as training).
- **Rules.** *WHEN event [IF conditions] THEN effects [LIMIT]*. Treats teach; **SUCCESS** (and an optional **FAIL**) checks. *Has done…* remembers an event for the rest of the try, *Just…* is true on the step it happens, and *End try* says what the ending means (judged by SUCCESS, counts as a success, counts as a miss). Every rule reads back as a sentence. Rules can be duplicated, reordered and switched off.
- **Measures and qualifiers.** *Compare* checks a measure against a number or another measure: Count, **Stored**, **Sold / delivered**, Distance, Distance between, Energy, Seed money, Water carried, Step, Note value, Time until ripe, Pecks. **Which one** cards pick one particular object wherever a kind of thing goes: the nearest / furthest (from the pet or another thing), the fullest / emptiest storage, what it carries. They work in conditions, senses, events ("picks up the furthest berry from the house") and as a farm job's aim.
- **The learner.** Presets (Approach, Avoid, Fetch) or **your own skill**: choose its **senses** (a meter shows how many situations it must learn), its **abilities** (Move, Stay, Pick up, Put down, Water, Shoo, Nudge gate, Plant, Lift basket), its **brain** (Standard: up to 5 senses and 100,000 situations; Big: up to 8 senses and 2,000,000, kept sparsely), practice (up to 100,000 tries; Fetch and routines 20,000) and time per try (up to 400 steps). *The target* means whatever the skill is aimed at.
- **Notes.** Rules can write up to 4 notes per try (flags or counters 0–9); conditions test them and the *Note* sense reads them. A note is for something only the pet's own history knows (which leg of a patrol it is on). When the thing can be seen on the farm (stored, sold, ripe, how far), use a measure instead.
- **Routines** choose between your skills (*Use skill*, aimed at anything, *only when…*) and actions, watching up to 4 conditions. They learn *which skill to use when*, reusing skills that already work. A job with several legs is usually a routine, not one big skill.
- **A helpful editor.** The hand recommends cards for this lesson; after you pick one, the picker jumps to its first empty required slot. Static checks flag repeatable rewards and pick/drop loops; measured checks (30 quick random tries) warn when SUCCESS ends tries before your goal rule can fire, and offer one-tap repairs. **Your cards** save any card or rule under your own name (with blanks to fill each time); **lesson cards** and **skill cards** share lessons and skills between saves.

**The report** compares before, random and after on 20 held-out layouts, plus bigger unseen pens (transfer). It flags **loopholes** (treats that pay without the goal), with a replay of the worst try and a repair card. When a skill falls short, it explains **why it isn't learning**:
- *big treat never happened*: the rule that ends the try well fired in under 1% of practice;
- *can't tell apart*: the pet can't tell an important situation from another, named in words, with the sense or Watch to add;
- *loops*: it paces between a few tiles, with a replay and a suggestion of Walls, Heading or obstacles in practice;
- *long chain*: several legs asked of one skill.

Each finding links to its lesson. **What it actually did**, **What does Pip do?** (the learned choice on every tile) and **curiosities** in the journal show what a pet learned, not just whether it passed.

Saving makes a **revision**. Revisions keep their own lesson and evaluation; a skill is certified when held-out success meets its lesson's bar, and saving an uncertified revision never replaces a certified one. Every built-in recipe reaches at least 80% on six training seeds at default temperament.

## The farm

- **Produce travels; the house sells.** Coins come only from produce brought to the house, plus fireflies:

  | Sold at the house | Coins | | Field crop | Seed | Grows (ticks) |
  |---|---|---|---|---|---|
  | Berry | 2 | | Carrot | 1 | 44 |
  | Carrot | 5 | | Sunflower | 2 | 70 |
  | Sunflower | 7 | | Pumpkin | 3 | 120 |
  | Pumpkin | 12 | | | | |
  | Egg | 3 | | | | |
  | Firefly (caught at night) | 1 | | | | |

- **Crops.** Berry bushes regrow by themselves. Field plots go back to empty soil after each harvest and must be planted again, buying a seed. A farm can't get stuck: bushes are free, and at dawn a neighbour's seed packet plants the cheapest plot when nothing is growing and no seed is affordable. Watered plots grow twice as fast.
- **Storage.** A basket holds 6 of one kind; a shed 4 kinds × 10. A pet can **lift** a basket with what's in it: put down at the house it sells everything, at a shed it stores what fits, on open ground it's set down.
- **Jobs are learned.** Every farm job runs one of the pet's own skills or routines:
  - **Harvest**: the *Harvest* or *Harvest to storage* routine.
  - **Haul**: Fetch.
  - **Plant**: the *Plant* routine.
  - **Basket run**: the *Basket run* routine.
  - **Mind the gate**: *Open the gate* or *Shut the gate*.
  - **Catch fireflies**, **Go to…** and **Run a skill**: any skill or routine of yours.

  A job the pet hasn't learned isn't done; the Pet binder's **Ready for the farm** shows which skill does each job, or which recipe teaches it. Nap is innate.
- **Day and night.** A day is 1,200 ticks (about 5½ minutes at 1×); the last 30% is night. Night darkens the farm, pets sleep (a need), and fireflies appear until dawn. From day 2, gentle **rain** waters every plot and keeps crows away, and **crows** peck ripe crops by day (*Shoo* sends them off; a **scarecrow** keeps them 2 tiles away). **Chickens** lay eggs only inside the coop.
- **Layout.** *Layout…* pauses the farm and edits a draft: place crop plots, baskets, sheds, scarecrows and fences, move things for free, remove them for half their price back. Every change is checked (the house's door stays clear, the coop whole, everything reachable). *Preview half a day* races the farm as it is against the draft; *Apply* pays. Up to 8 crop plots, 14 with the orchard.
- **Pets.** Up to 4 pets on duty, each with its own responsibilities. They never chase the same thing, and a resting pet naps at the house. Tap a pet for its card, the house for the roster, anything else for what it is. **Steer** moves the lead pet by hand (tiles or keys).
- **Requests.** Each dawn, neighbours pin up to three optional requests, each with a hint and a lesson link.

## Responsibilities: what a pet looks after

A pet on **Auto** works on its **responsibilities**, written with the same cards as lessons: **WHEN** conditions hold, **USE** a job (**OR USE** others), optionally **UNTIL** a condition holds. Higher in the list matters more.

- **Needs first:** a tired pet rests until refreshed (a basket in its paws is put down first); at night it sleeps, unless a responsibility mentions night or is set to keep at it.
- **Commitment:** with UNTIL, the pet sticks with a responsibility until it holds; only a need, or a failed job after 60 ticks, pulls it away. Without UNTIL, each finished job counts.
- **Evidence:** among the jobs a responsibility may use, the pet uses the one that has worked best, judged by what changed in the world. A job that makes no progress 3 times in a row rests for 200 ticks; an UNTIL responsibility with no progress for 400 ticks is set aside.
- **Why…** explains each decision; **Preview 300 ticks** shows exactly what would happen (the farm is deterministic).
- **The starter set**, which Auto works on until you edit it:
  1. Holding a basket
  2. Fireflies out
  3. Finish what's in your paws
  4. Basket needs a run
  5. Storage at most half full (UNTIL it's under half; Haul, or a Basket run)
  6. Every plot planted
  7. Harvest what's ripe
  8. Goods waiting
  9. Otherwise nap

**Picks: in your order, or learned.** **Check my order** practises deciding for 4 farm days on copies of the farm, then compares your order, the pet's learned picks and random picks on farms it hasn't practised on.
- If learned picks earn clearly more (5% or more), the verdict names the responsibility they skip and offers a one-tap fix. For example, "Otherwise nap" at the top always applies and hides everything below it, so the fix moves it to the bottom.
- Otherwise it says your order is fine.

**Learns what pays off** lets the pet pick on its own, weighted by your order, with needs and cooldowns unchanged.

## Progression

| Unlock | How |
|---|---|
| Your own skills | A certified Approach |
| Fetch lessons | A certified Approach and 5 coins earned |
| Carrot patches | A certified Fetch |
| Avoid lessons | 12 coins earned (after Fetch) |
| Routines | A certified Approach and 2 saved skills |
| Crows | Day 2, after *Your own skills* |
| Shop | Snack (+40 energy) 3, Tree cards 4, Fence cards 6, Comfy bed 12, Adopt another pet 20; after *Your own skills*: Two chickens 10, Orchard expansion 25 (16×12, with a gate) |
| Layout | Berry bush 4, Carrot 3, Sunflower 5 and Pumpkin 6 patches, Basket 6, Shed 25, Scarecrow 8, Fence 1 |

Unlocks add vocabulary (cards, skills) and problems (carrots need carrying, ponds need avoiding), not grind. **Energy:** lessons cost 15 (Avoid 20; Field Guide lessons are free); farm work costs 0.12 a tick and naps restore 1.5 (3 with the Comfy bed). A pet with no energy simply naps; pets are never punished.

## The Field Guide

Short, free lessons on training that works, mostly by trying something the wrong way first and comparing the player's own two runs. Each opens when it becomes useful:

1. *First lesson* (Approach)
2. *Teach a job: Harvest*
3. *Read the report: practice*
4. *Scatter, don't pin*
5. *Pay for results, not effort* (a loophole and its repair)
6. *Practise where it works* (Approach vs Avoid by the pond)
7. *Invent a skill* (one sense too many)
8. *See what your pet learned*
9. *Combine skills* (a routine is only as good as what it watches; why routines exist)
10. *Responsibilities* (order, preview, UNTIL with a measure, OR USE, a "which one" aim)
11. *Lay out the farm*
12. *Give your pet a notebook* (a note vs a measure)
13. *Let them choose* (check your order, fix a deliberate mistake in one tap, learned picks as a mode)

The Guide also holds the **Trainer's notebook** (a checklist of measured results) and a **glossary** with every card, searchable by title or hint, each with where it fits and a one-line example. **Coaching tips** appear in reports and on the farm when the evidence suggests a common mistake, each linking to its lesson.

## Principles

- **Real learning, honestly shown.** Every number comes from episodes the pet ran, on held-out layouts, with the sample size shown. Scripted demos are labelled as scripted.
- **Explain, don't block.** Validation and checks say what is wrong and offer a repair; experiments are free and never saved automatically. Nothing is lost: lessons have Undo, revisions can be rolled back.
- **Treats teach; SUCCESS checks.** Reward hacking is a discovery, not a failure: the report shows the loophole and the repair.
- **Sound is redundant and cozy.** Every sound repeats something visible, it is sparse and soft (a miss sounds curious, not punished), and everything is synthesized on the device. Background birds, crickets and rain follow the clock and weather; each pet chirps in its own voice; an opt-in music box never repeats.
- **The journal is grounded.** Entries come from real events (skills learned with their actual success, first sales, loopholes found, curiosities), never made-up psychology.
- **Offline and private.** No accounts, servers or telemetry. After one load the game runs with no network.

## Limitations

- Crows visit only by day and one at a time; guarding crops means running a skill you taught.
- Thumbs up/down feedback applies to movement skills (Approach, Avoid), not to Fetch or routines.
- Your cards are copies: editing a saved card later doesn't change lessons that already used it. Blanks can be things, not numbers.
- Learned Approach is less sure-footed right beside fences; practising with obstacles helps (the built-in recipe does).
- Routines can't use Fetch or other routines as options. Previews start from a fresh decision.
- Static and measured reward checks are heuristics, not proofs that a reward can't be exploited.
