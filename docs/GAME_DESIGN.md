# Game design

## Fantasy and loop
You are a trainer, not a programmer. The loop is: design a pen → choose what earns treats → preflight → train → watch → diagnose → refine or roll back → certify → deploy on the farm → earn coins → unlock new lessons and items → repeat.

The **farm** is the home screen and the pet is always visible. The **pen** is a focused teaching mode.

## Tutorial: the Trainer's Field Guide
The tutorial teaches *how a good trainer thinks*, not just which buttons exist. Full design and evidence: `docs/TUTORIAL_PLAN.md`.

- **Lesson 1, First lesson** (10 steps, active from the start): adopt → open the pen → place a scattered berry → build the treat rule card by card → set SUCCESS → train Approach → read the report → save → Forage on the farm → earn 5 coins (Fetch unlocks). The tutorial pen starts with rocks but no berry, rules or SUCCESS. A suggested recipe sits behind "Stuck?".
- **Lessons 2–9** appear in the **Guide** tab when they become useful (a locked lesson says what opens it): 2 *Read the report: practice*, 3 *Scatter, don't pin*, 4 *Pay for results, not effort*, 5 *Practise where it works*, 6 *Invent a skill*, 7 *See what your pet learned*, 8 *Combine skills*, 9 *Plan the farm*, 10 *Lay out the farm*. Most try something the wrong way first and show the player's own two runs side by side.
- Every lesson can be started, paused, skipped and replayed. Field Guide training costs no energy and is never saved automatically.
- A banner shows the current step, *why* it matters and, where useful, a button that does it ("Test my Approach here"). The control it refers to is outlined and scrolled into view.
- The Guide also holds the **Trainer's notebook** (a checklist built from measured results) and a **glossary**.
- **Coaching tips** appear in reports and on the farm when the evidence suggests a common mistake (pinned pen, loophole, too little practice, too many situations, poor transfer, two pets on the same job), each linking to its lesson. Requests on the neighbours' board carry a "How:" hint and a lesson link.

Outside the tutorial, a training run is 4 taps from the farm (Teach → Curriculum → a recipe → Train).

## Interface vocabulary
- **Binders:** Environment, Rules, Pet, Curriculum, Behaviors, Inspect.
- **Cards** are colour-coded by role (things, events, conditions, effects/values, limits, measures) and always carry text, not colour alone.
- **Sleeves** open a card to edit its parameters and swap it. The **hand** shows 3–7 recommended compatible cards first. More cards sit under "More cards", and locked cards explain what they need.
- **Training HUD:** try n/N, success (last 50), treats per try, exploration %, simulated ticks, the revision it will save as, two single-measure charts, and a progress bar. The pen replays a sampled try with a clear label: *Training try (exploring)*, *Evaluation (held-out layout)*, *Before training*, *Random baseline*, *Transfer*, or *Scripted demo — not your pet*.

## Economy
**Produce travels; the house sells** (farm life, phase A). Coins come only from produce that reaches the house, plus fireflies:

| Sold at the house | Coins |
|---|---|
| Berry | 2 |
| Carrot | 5 |
| Sunflower | 7 |
| Pumpkin | 12 |
| Egg | 3 |
| Firefly (caught at night, walk into it; not carried) | 1 |

- **Harvest** (with Approach or Avoid) picks a ripe berry or carrot and carries it home. Until the pet knows Fetch, it goes straight to the house. With Fetch, it goes to the nearest storage with room (or the house, if that's nearer).
- **Storage:** the **basket** (today's bin) holds 6 of one kind; the **shed** (shop, 25) holds 4 kinds, 10 each. A full basket, or one holding another kind, is skipped, and a crop dropped on it anyway is left beside it.
- **Haul** (Fetch) carries eggs and stored goods to the house.
- Two pets can split the work: one harvests into the basket while the other hauls it.
- Prices were tuned against the old economy (5 training seeds, a farm day of 2,400 ticks): a first-hour pet with only Approach earns about the same per day as before (mean 104 vs 97 coins). The first 5 coins take a little longer (median about 100 ticks vs 66, the walk home). A farm with Fetch and carrots earns 252 vs 250.

**Crops and replanting** (farm life, phase B). Berry bushes are perennial: they regrow 28 ticks after each harvest, for free. Field plots cycle **empty soil → planted → ripe → harvested → empty soil**, and each planting buys a seed from the farm's coins:

| Field crop | Seed | Grows (ticks) | Sells for |
|---|---|---|---|
| Carrot | 1 | 44 | 5 |
| Sunflower (crows go for it first) | 2 | 70 | 7 |
| Pumpkin | 3 | 120 | 12 |

- **Plant** (a job, an ability and a card) walks to empty soil and plants it. Auto and the starter plan plant before harvesting, so the seed grows while the pet works. The Harvest job doesn't plant.
- **Never stuck:** bushes keep a 0-coin farm earning, and at dawn, if nothing is growing and no seed is affordable, a neighbour's packet plants the cheapest plot for free.
- With replanting, a pet on Auto with Fetch and carrots sells about 247 coins over two farm days; adding a pumpkin and a sunflower patch gives about 310.

**Your layout** (farm life, phase C). *Layout…* pauses the farm and edits a draft: place crop plots, baskets, sheds, scarecrows and fences; move things for free; remove them for half their price back (all of it if placed in this draft). A placement is refused, with the reason, if it's off the farm, on the house's door tile or the coop, on something, over the plot budget (8, or 14 with the orchard), unaffordable, or if it would cut the house, well, storage, a plot, a gate or the coop off from the house's door. The house, well, pond, gates and the orchard's fence stay put. *Preview half a day* runs the farm as it is and as drafted from the same moment and compares coins; *Apply* pays. Placing a scarecrow, sunflower or pumpkin also makes it available in pens.

- **Measured** (one pet on Auto with Fetch and carrots, 3 seeds, 2,400 ticks): both bushes beside the house 208–249 vs 160–217 as they were; carrots beside the house helps 2 of 3 seeds; a *second* basket by the bushes loses (46–184): with one pet each basketed crop travels twice. With a hauler too, bushes beside the house help 2 of 3 seeds.

**Watered** plots grow twice as fast, and the soil dries out when the next crop appears. Watering takes a learned skill: fill up at the well, then find dry plots.

**Day/night:** a farm day is 1200 ticks, and the last 30% is night. Night darkens the farm and spawns 4 fireflies on open tiles, which leave at dawn. On Auto, the rules executive catches fireflies when it can and otherwise naps. The learned executive's context includes night and fireflies. At night, work costs 1.5× energy and naps restore 1.5×. A pond sits between the bushes and the basket and house, so a pet using Approach often splashes through and loses 3 ticks shaking dry. That's a visible reason to learn Avoid.

**Energy:** lessons cost 15 (Avoid costs 20); Field Guide lessons are free. Farm work costs 0.12 per tick, and napping restores 1.5 per tick (3 with the Comfy bed). Off-duty pets recover 0.5 per tick. Pets are never punished: a pet with no energy simply naps.

## Progression
| Unlock | How |
|---|---|
| Your own skills | A certified Approach |
| Routines | A certified Approach and 2 saved skills |
| Crow visits | Day 2+, after *Your own skills* |
| Fetch lessons | Certified Approach + 5 coins earned |
| Carrot patches | A certified Fetch |
| Avoid lessons | 12 coins earned (after Fetch) |
| Shop | Snack (+40 energy, 3), Tree cards (4), Fence cards (6, also unlock fences in Layout), Comfy bed (12), Adopt another pet (20). After *Your own skills*: Two chickens (10), Orchard expansion (25) |
| Layout (Farm → Layout…) | Berry bush 4, Carrot patch 3, Sunflower patch 5, Pumpkin patch 6 (patches after carrots, placed planted), Basket 6 (up to 4), Shed 25 (after Fetch, up to 2), Scarecrow 8 (after *Your own skills*, up to 2), Fence 1 (after Fence cards). Removing refunds half. Up to 8 crop plots, 14 with the orchard |
| Field Guide lessons | Offered in context (see Tutorial) |

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

## Saying what you mean (teaching polish)
Lessons should read the way a player thinks. *Has done…* remembers events, so "success = shooed a chicken" is a single card. End try states what the ending means instead of implying success. SUCCESS takes a list. Each rule reads back as a sentence. The game measures (30 quick random tries) rather than guesses when a lesson's parts disagree, explains it, and offers a one-tap repair. "Treats teach; SUCCESS checks" still holds: ending a try is neither. If a treat depends on something the pet can't sense, the game says so and offers the *Done … yet?* sense, so lessons stay honest to the learner.

## Sound
Sound adds clarity first and charm second, and it is always redundant: every cue repeats something visible, so muted play loses nothing. It is sparse (no footsteps, no sound per training try, training samples are silent), cozy (soft attacks, no harsh failure sounds: a miss sounds curious, not punished) and consistent (one sound, one meaning: a splash in a replay is the farm's splash). Everything is synthesized on the device. The farm's background (birds by day, crickets at night, rain) changes with the clock and weather, so you can hear dusk coming. Each pet chirps in its own voice (a pitch from its name and colours), so two pets on the farm sound different. Music is an opt-in, generative music box that never repeats and dips under result jingles; it's off by default because many players bring their own (`docs/SOUND_PLAN.md`).

## Journal
Entries are grounded templates filled from real events: adoption, skill learned (with actual success counts), certification, first berry, first delivery, first pond dip and repeat dips, loopholes found, revisits, purchases and unlocks, plus later farm events (first eggs, gates, rain, requests done or missed) and **curiosities** noticed in a lesson's behaviour summary. A *Scrapbook* filter shows milestones. No made-up psychology.

## Content
- Two-plus pet palettes (Meadow, Plum, Sky, Moss) and seven name suggestions.
- Objects: berry, carrot, target, bin, pond, rock, tree, fence, plus farm-only home, berry bush and carrot patch.
- Objects added with watering and day/night: well, firefly. With Milestone 2: chicken, crow, egg, scarecrow, and the Area card. Berry bushes, carrot patches and home can now go in pens.
- Recipes: *Go to the berry*, *Bring it home*, *Avoid the pond*, *Treat for every pickup* (experiment), and custom-skill examples *Wait for it*, *Keep clear*, *Water the garden*, *Herd a chicken* and *Open the gate*, the experiment *Treat for every shoo*, and the routines *Bring it home (routine)* and *Morning chores*.
- Objects added with Milestone 5: gate (and the orchard and meadow areas of the expansion), rain puddles.
- Farm plan jobs: Forage, Deliver, Catch fireflies, Nap, Wander, Go to…, Run skill, Mind the gate.
