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

Berry bushes regrow in 28 ticks and carrots in 44. A pond sits between the bushes and the bin, so a pet using Approach often splashes through and loses 3 ticks shaking dry. That's a visible reason to learn Avoid.

**Energy:** lessons cost 15 (Avoid costs 20). Farm work costs 0.12 per tick, and napping restores 1.5 per tick (3 with the Comfy bed). Off-duty pets recover 0.5 per tick. Pets are never punished: a pet with no energy simply naps.

## Progression
| Unlock | How |
|---|---|
| Fetch lessons | Certified Approach + 5 coins earned |
| Carrot patches | A certified Fetch |
| Avoid lessons | 12 coins earned (after Fetch) |
| Shop | Snack (+40 energy, 3), Tree cards (4), Fence cards (6), Two more bushes (8), Comfy bed (12), Third carrot patch (15), Adopt another pet (20) |

Unlocks add **vocabulary** (new cards and skills) and **problems** (carrots need carrying, ponds need avoiding), not grind.

## Reward hacking as discovery
The *Treat for every pickup* recipe pays +3 per pickup with no limit. Pets reliably learn to pick up and put down the berry over and over: about 30 pickups per try and 0% deliveries, while treats per try climb as success falls. The report says **Loophole found!**, shows a replay of the worst try, explains which rule paid, and offers the repair card *Pay only once per object*. After the repair, retraining delivers most of the time (the test suite requires at least +40 points). Nothing is ever lost: the stage has Undo, and saving an uncertified revision never replaces a certified active one.

## Mastery and curriculum
Lessons are promoted when held-out success meets the stage minimum (Approach/Avoid 80%, Fetch 65%, n=20 unseen layouts). The Curriculum binder shows **mastery** (at save time), **retention** (re-test with current skills), and **transfer** (10 bigger, unseen pens) separately. You can clone a stage without sharing node identity.

## Journal
Entries are grounded templates filled from real events: adoption, skill learned (with actual success counts), certification, first berry, first delivery, first pond dip and repeat dips, loopholes found, revisits, purchases and unlocks. A *Scrapbook* filter shows milestones. No made-up psychology.

## Content
- Two-plus pet palettes (Meadow, Plum, Sky, Moss) and seven name suggestions.
- Objects: berry, carrot, target, bin, pond, rock, tree, fence, plus farm-only home, berry bush and carrot patch.
- Recipes: *Go to the berry*, *Bring it home*, *Avoid the pond*, *Treat for every pickup* (experiment).
