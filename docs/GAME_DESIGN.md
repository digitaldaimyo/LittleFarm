# Game design

## Fantasy and loop
You are a trainer, not a programmer. The loop is: design a pen → choose what earns treats → preflight → train → watch → diagnose → refine or roll back → certify → deploy on the farm → earn coins → unlock new lessons and items → repeat.

The **farm** is the home screen and the pet is always visible. The **pen** is a focused teaching mode.

## Tutorial (skippable, replayable from Settings)
1. Adopt a pet. 2. Open the pen. 3. Put a berry in it. 4. Tap the suggested recipe. 5. Train Approach. 6. Compare before/after on held-out layouts. 7. Save the skill. 8. Assign *Forage berries* on the farm. 9. Earn 5 coins → Fetch unlocked.
A novice reaches a training run in 4 taps from the farm (Teach → Curriculum → a recipe → Train). The tutorial path takes about 6.

## Interface vocabulary
- **Binders:** Environment, Rules, Pet, Curriculum, Behaviors, Inspect.
- **Cards** are colour-coded by role (things, events, conditions, effects/values, limits, measures) and always carry text, not colour alone.
- **Sleeves** open a card to edit its parameters and swap it. The **hand** shows 3–7 recommended compatible cards first. More cards sit under "More cards", and locked cards explain what they need.
- **Training HUD:** try n/N, success (last 50), treats per try, exploration %, simulated ticks, the revision it will save as, two single-measure charts, and a progress bar. The pen replays a sampled try with a clear label: *Training try (exploring)*, *Evaluation (held-out layout)*, *Before training*, *Random baseline*, *Transfer*, or *Scripted demo — not your pet*.

## Economy
| Source | Coins |
|---|---|
| Forage a berry (Approach) | 1 |
| Deliver a carrot (Fetch) | 3 |
| Deliver a berry to the bin | 2 |
| Catch a firefly (night only, walk into it) | 1 |
| Deliver an egg (Fetch) | 2 |

Berry bushes regrow in 28 ticks and carrots in 44. **Watered** plots grow twice as fast, and the soil dries out when the next crop appears. Watering takes a learned skill: fill up at the well, then find dry plots.

**Day/night:** a farm day is 1200 ticks, and the last 30% is night. Night darkens the farm and spawns 4 fireflies on open tiles, which leave at dawn. On Auto, the rules executive catches fireflies when it can and otherwise naps. The learned executive's context includes night and fireflies. At night, work costs 1.5× energy and naps restore 1.5×. A pond sits between the bushes and the bin, so a pet using Approach often splashes through and loses 3 ticks shaking dry. That's a visible reason to learn Avoid.

**Energy:** lessons cost 15 (Avoid costs 20). Farm work costs 0.12 per tick, and napping restores 1.5 per tick (3 with the Comfy bed). Off-duty pets recover 0.5 per tick. Pets are never punished: a pet with no energy simply naps.

## Progression
| Unlock | How |
|---|---|
| Your own skills | A certified Approach |
| Routines | A certified Approach and 2 saved skills |
| Chickens, Scarecrow (shop) | After *Your own skills* |
| Crow visits | Day 2+, after *Your own skills* |
| Fetch lessons | Certified Approach + 5 coins earned |
| Carrot patches | A certified Fetch |
| Avoid lessons | 12 coins earned (after Fetch) |
| Shop | Snack (+40 energy, 3), Tree cards (4), Fence cards (6), Two more bushes (8), Comfy bed (12), Third carrot patch (15), Adopt another pet (20) |

Unlocks add **vocabulary** (new cards and skills) and **problems** (carrots need carrying, ponds need avoiding), not grind.

## Reward hacking as discovery
The *Treat for every pickup* recipe pays +3 per pickup with no limit. Pets reliably learn to pick up and put down the berry over and over: about 30 pickups per try and 0% deliveries, while treats per try climb as success falls. The report says **Loophole found!**, shows a replay of the worst try, explains which rule paid, and offers the repair card *Pay only once per object*. After the repair, retraining delivers most of the time (the test suite requires at least +40 points). Nothing is ever lost: the stage has Undo, and saving an uncertified revision never replaces a certified active one.

## Expansion, gates, weather, requests (Milestone 5)
- **Orchard expansion** (shop, 25 coins): 16×12 farm, fence along column 12 with a gate at (12,4) (starts open), orchard area (3 bushes) to the east, meadow to the south. Chickens wander through an open gate, and shutting it shuts the pet out of the orchard too: a real trade-off for plans.
- **Rain:** from day 2, about one daytime shower a day lasting 180–400 ticks. Every bush and patch counts as watered, one pond tile appears next to the pond (removed when it dries), and crows stay away.
- **Requests:** at most 3 open at a time. Rewards: eggs 3, carrots 4, berries 1, fireflies 2 and watering 1 coin each; no-pecks and coop 6 coins flat. A 35% chance of a Tree or Fence card gift (until both are owned).

## Discovery (Milestone 6)
The more freedom players have, the more surprising their pets become, so the game shows what a pet does, not just whether it succeeded. Summaries answer "where does it go, and what pays it?". The probe answers "what would it do *here*?". Curiosities point at the gap between the rules and the behaviour without calling it a mistake. Skill cards let players trade skills, and those skills keep their own history and evaluation. A second pet on duty turns farm planning into division of labour: two foragers fight over the same bushes, but a forager and a deliverer double the income.

## Farm plans
Training answers "can my pet do X?". Plans answer "when should it do X?". The plan mat uses the same cards as lessons, so a player who learned to write *WHEN… THEN* rules can write *IF… DO* rows. The starter plan exposes the hidden Auto rules as an editable example. The preview makes planning iterative and safe: try a plan, see the coins, energy, naps and dips it would produce, fix fighting rows, then apply it. Diagnostics explain rather than block: rows that never ran, rows that fight, skills that aren't learned or certified yet.

## Routines
A routine is the player's planning tool inside the pen: a deck of options (their own skills and basic actions) plus a few things to watch. Training learns *which skill to use when*. The report always shows **Random choices** (same deck, random picks) so players can see whether the routine actually learned to choose, or whether the skills alone do all the work. *Morning chores* shows this: an untrained routine with distractors at the top of the deck gets 0%, random choices about 57%, and the learned routine about 83%.

## Creatures and areas
- **Coop** (farm area, 2×2, bottom left). **Chickens** (shop, 10 coins, after *Your own skills*) wander 25% of ticks, but only 6% inside the coop. Each one inside the coop lays an egg on a free coop tile with probability 1/90 per tick (max 4 eggs). They block movement, so pets must **Shoo** them, which pushes them one tile directly away.
- **Crows** arrive by day from day 2 (at most one; spawn chance 1/250 per tick at the map edge). They fly to the nearest crop every other tick, ignoring walls, and peck it: the crop is gone and regrows normally. Shoo scares a crow off. Night sends crows away. The **Scarecrow** (shop, 8 coins) keeps them out of a radius of 2.
- The herding lesson shows why the choice of senses matters. "Where is chicken" + "where is coop" plateaus around 55–70%, but "where is a stray" + "the coop seen from the chicken" reaches ~85%.

## Your own skills
Players invent behaviors by combining **senses**, **abilities** and **rules**. A small catalog of senses with visible costs (the "situations to learn" meter) is the core trade-off: more attention means a smarter pet that needs more practice. Two example lessons (*Wait for it*, *Keep clear*) show "do a thing and hold it" and "keep doing something until time's up". A custom skill keeps its own revision history, signature and provenance. On the farm, **Run a skill** points it at any object. A skill trained to wait on a target will happily wait on the bin.

## Mastery and curriculum
Lessons are promoted when held-out success meets the stage minimum (Approach/Avoid 80%, Fetch 65%, n=20 unseen layouts). The Curriculum binder shows **mastery** (at save time), **retention** (re-test with current skills), and **transfer** (10 bigger, unseen pens) separately. You can clone a stage without sharing node identity.

## Journal
Entries are grounded templates filled from real events: adoption, skill learned (with actual success counts), certification, first berry, first delivery, first pond dip and repeat dips, loopholes found, revisits, purchases and unlocks. A *Scrapbook* filter shows milestones. No made-up psychology.

## Content
- Two-plus pet palettes (Meadow, Plum, Sky, Moss) and seven name suggestions.
- Objects: berry, carrot, target, bin, pond, rock, tree, fence, plus farm-only home, berry bush and carrot patch.
- Objects added with watering and day/night: well, firefly. With Milestone 2: chicken, crow, egg, scarecrow, and the Area card. Berry bushes, carrot patches and home can now go in pens.
- Recipes: *Go to the berry*, *Bring it home*, *Avoid the pond*, *Treat for every pickup* (experiment), and custom-skill examples *Wait for it*, *Keep clear*, *Water the garden* and *Herd a chicken*, the experiment *Treat for every shoo*, and the routines *Bring it home (routine)* and *Morning chores*.
