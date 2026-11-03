# Card reference

Every card in the game, by sheet. Generated from the card registry by `npm run cards:ref` — do not edit by hand.

Things (kinds) you can place or name: Berry, Carrot, Pumpkin, Sunflower, Target, Basket, Shed, Pond, Rock, Tree, Fence, Home, Berry bush, Empty soil, Carrot patch, Well, Chicken, Crow, Egg, Scarecrow, Gate, Other pet, Firefly.

## Conditions

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **All in area** `cond.allInArea` | What: Kind; Area: Area | — | Every one of them is inside the area (true if there are none). |
| **All of** `cond.and` | All of (several): Condition | — | True when every inner condition is true. |
| **Any of** `cond.any` | Any of (several): Condition | — | True when at least one inner condition is true. |
| **Can afford seeds** `cond.canAfford` | — | — | There are coins for the seed of some empty plot (always true in pens, where seed is free). |
| **Carrying something** `cond.carryingAny` | Who: Actor<Mobile, CanCarry> | — | {actor} carries something |
| **Compare** `cond.compare` | Measure: Quantity; Than (a measure) (optional): Quantity | Is: < / ≤ / = / ≠ / ≥ / >; Than (a number): 0–100 | A measure against a number — or against another measure (put one in “Than”): stored berries ≥ 3, steps to the basket < steps to the house. |
| **Energy below** `cond.energyBelow` | — | Energy: 1–100 | The working pet’s energy (on the farm, or in a pen with the Energy card; otherwise always false). |
| **Gates are…** `cond.gates` | — | Gates: all closed / any open | gates: {state} |
| **Got closer** `cond.closer` | Who: Actor<Mobile, CanCarry>; What: Kind | — | This step reduced the distance. Progress-based rewards are hard to exploit. |
| **Has delivered** `cond.delivered` | What: Kind<Carryable>; Into: Kind<Container> | At least: 1–8 | {count} {what} in {into} |
| **Has done…** `cond.happened` | What happened: Event | At least: 1–20 | Remembers events: true once this has happened at least N times in this try. |
| **Has stayed** `cond.stayedFor` | Who: Actor<Mobile, CanCarry> | Steps: 1–30 | Stayed still for at least N steps in a row. |
| **Has water** `cond.hasWater` | Who: Actor<Mobile, CanCarry> | — | {actor} has water |
| **In area** `cond.inArea` | What: Kind; Area: Area | At least: 1–8 | At least N of them are inside the area. |
| **Is at** `cond.at` | Who: Actor<Mobile, CanCarry>; What: Kind | — | Standing on the same tile. |
| **Is carrying** `cond.carrying` | Who: Actor<CanCarry>; What: Kind | — | {actor} carries {what} |
| **Is far from** `cond.farFrom` | Who: Actor<Mobile, CanCarry>; What: Kind | More than: 0–10 | More than N steps away (true if there is none). |
| **Is near** `cond.near` | Who: Actor<Mobile, CanCarry>; What: Kind | Steps: 0–10 | Within a few steps. |
| **Is night** `cond.night` | — | — | True at night (set by the Time of day card in pens, by the clock on the farm). |
| **Is raining** `cond.raining` | — | — | Rain waters every plot (farm weather, or the Weather card in pens). |
| **Just…** `cond.just` | What happened: Event | — | True on the step this happens. |
| **Next to** `cond.nextTo` | Who: Actor<Mobile, CanCarry>; What: Kind | — | On one of the 8 tiles around it (diagonals count), not on it. |
| **Not** `cond.not` | Condition: Condition | — | not ({inner}) |
| **Note says** `cond.note` | — | Note; Is: on (1 or more) / off (0) / at least / exactly / below; Value: 0–9 | Tests a note written by your rules this try (Write a note). |
| **Object is near** `cond.itNear` | Object: Object; What: Kind | Steps: 0–10 | {object} within {dist} of {what} |
| **Pet in area** `cond.petInArea` | Who: Actor<Mobile, CanCarry>; Area: Area | — | {actor} is in {area} |
| **Storage** `cond.storage` | — | Storage: has anything in it / is at least half full / is full / is all empty / basket has anything (the one carried, if any) | Baskets and sheds (on the farm, or stocked in a pen): anything waiting to be hauled to the house? “All empty” holds when nothing is stored anywhere. |
| **Storage of one** `cond.storageOf` | Which storage: Object | Is: empty / holding anything / at least half full / full | How full one particular basket or shed is — e.g. the nearest basket is full. |
| **Thing near thing** `cond.kindNear` | What: Kind; Near what: Kind | Steps: 0–10 | Any one of these within N steps of any one of those (e.g. a chicken within 1 of the coop’s rock). |
| **Time in try** `cond.time` | — | Is: before / after; Step: 1–120 | Which step of the try it is: reward finishing early, or give up on dawdling. |
| **Watered** `cond.watered` | What: Kind<Plot> | At least: 1–8 | {count}+ {what} watered |

## Effects

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **End try** `eff.end` | — | Counts as: judged by SUCCESS / a success ✓ / a miss ✗ | Finish this try. By default SUCCESS decides whether it counted; you can also make it count as a success or a miss outright. |
| **Nudge** `eff.penalty` | — | Amount: 0–50 | Small negative reward ("not that"). |
| **Treat** `eff.reward` | — | Treats: 0–50 | Positive reward. |
| **Write a note** `eff.note` | — | Note; Do: turn on / turn off / reset / count up by / count down by / set to; By / to: 0–9 | Your pet’s notebook for this try: a flag (on/off) or a counter (0–9). Notes start at 0 every try; the pet can sense them with the Note sense, and rules can test them. Rules that write notes also run on the farm. |

## Events

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **Bumps** `ev.bump` | Who: Actor<Mobile, CanCarry> | — | Walks into a wall, rock or edge. |
| **Delivered** `ev.deliver` | What: Kind<Carryable>; Into: Kind<Container> | — | A thing is dropped into a container. |
| **Empties** `ev.empty` | What: Kind<Portable>; Into: Kind<Container> | — | A carried basket is put down at the house or a shed, and what was in it goes in there (as much as fits). |
| **Enters area** `ev.entersArea` | What: Kind; Area: Area | — | Something (e.g. a chicken) moves into an area. |
| **Every step** `ev.tick` | — | — | Happens once per tick. Small penalties here say "hurry up". |
| **Fills up** `ev.fill` | Who: Actor<Mobile, CanCarry> | — | Uses Water while standing on a well. |
| **Leaves area** `ev.leavesArea` | What: Kind; Area: Area | — | {what} leaves {area} |
| **Lifts** `ev.lift` | Who: Actor<Mobile, CanCarry>; What: Kind<Portable> | — | The pet lifts a basket to carry it (needs the Lift ability). A carried basket can’t be filled. |
| **Nudges gate** `ev.gate` | Who: Actor<Mobile, CanCarry> | Gate: opens / closes | The pet opens or closes a gate. |
| **Pecked** `ev.peck` | Crop: Kind<Crop> | — | A crow pecks a crop and flies off with it. |
| **Picks up** `ev.pickup` | Who: Actor<CanCarry>; What: Kind<Carryable> | — | Lifts a carryable thing. |
| **Plants** `ev.plant` | Who: Actor<Mobile, CanCarry>; What: Kind<Crop> | — | The pet sows empty soil (needs the Plant ability; on the farm it costs the seed). |
| **Puts down** `ev.drop` | Who: Actor<CanCarry>; What: Kind<Carryable> | — | Sets a carried thing down anywhere. |
| **Reaches** `ev.reach` | Who: Actor<Mobile, CanCarry>; What: Kind | — | Steps onto a tile holding the thing. |
| **Shoos** `ev.shoo` | Who: Actor<Mobile, CanCarry>; Creature: Kind<Creature> | — | Shoos an adjacent creature (chickens step away, crows fly off). |
| **Stays put** `ev.stay` | Who: Actor<Mobile, CanCarry> | — | Chooses to stay still this step (needs the Stay ability). |
| **Steps into** `ev.enter` | Who: Actor<Mobile, CanCarry>; Hazard: Kind<Hazard> | — | Walks into a hazard like the pond. |
| **Waters** `ev.water` | Who: Actor<Mobile, CanCarry>; What: Kind<Plot> | — | Soaks a dry bush or patch it is standing on. |

## Jobs

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **Basket run** `job.tote` | Aimed at (default: the basket that needs it) (optional): Kind | Move with: Approach / Avoid | Runs the pet’s own Basket run routine: lift a half-full basket, empty it at the house, set it down by the crops. |
| **Catch fireflies** `job.catch` | — | Move with: Approach / Avoid | catch fireflies ({navigator}) |
| **Go to…** `job.goto` | Go to: Kind | Move with: Approach / Avoid | Walk to the nearest one using Approach or Avoid. |
| **Harvest** `job.forage` | Aimed at (default: any ripe crop) (optional): Kind | Move with: Approach / Avoid | Runs the pet’s own Harvest routine: a ripe crop to the house (or storage with room, with Harvest to storage). |
| **Haul** `job.deliver` | Aimed at (default: eggs or the fullest storage) (optional): Kind | Move with: Approach / Avoid | Runs the pet’s own Fetch: eggs and stored goods to the house, where they sell. |
| **Mind the gate** `job.gate` | — | Make it: closed / open; Move with: Approach / Avoid | Runs the pet’s own Open the gate / Shut the gate skill. |
| **Nap** `job.nap` | — | — | nap |
| **Plant** `job.plant` | Aimed at (default: any empty soil) (optional): Kind | Move with: Approach / Avoid | Runs the pet’s own Plant routine: empty soil gets its seed, paid from your coins. |
| **Run skill** `job.skill` | Aimed at (optional): Kind | Skill | Run one of your own skills or routines. |

## Limits

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **Cooldown** `lim.cooldown` | — | Wait: 1–60 | at most every {ticks} steps |
| **Every time** `lim.every` | — | — | No limit. Careful with repeatable events! |
| **Once per object** `lim.perObject` | — | — | Each object can only pay once. |
| **Once per try** `lim.once` | — | — | once per try |

## Measures

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **Count** `q.count` | What: Kind | — | How many are lying around (not stored, not carried). |
| **Distance** `q.distance` | Who: Actor<Mobile, CanCarry>; What: Kind | — | steps from {actor} to {what} |
| **Distance between** `q.between` | From: Kind; To: Kind | — | Steps between the closest pair: any {from} and any {what} (99 if either is missing). |
| **Energy** `q.energy` | — | — | The pet’s energy, 0–100 (in pens only with the Energy card; otherwise 100). |
| **Note value** `q.note` | — | Note | A note’s number (0–9), so notes can be compared with other measures. |
| **Pecks** `q.pecks` | — | — | crops pecked by crows |
| **Seed money** `q.seed` | — | — | Coins for seeds (the farm’s coins; in pens, the Seed money card — otherwise 100). |
| **Sold / delivered** `q.sold` | What: Kind | Counting: sold at the house / delivered anywhere (house or storage) | How many have been sold at the house (or delivered anywhere): this try in a pen; on the farm, since the skill started. |
| **Step** `q.step` | — | — | Which step of the try it is (on the farm: of the skill’s run). |
| **Stored** `q.stored` | What: Kind; In this one (e.g. the nearest basket) (optional): Object | In: any storage / baskets / sheds / the basket it carries | How many are in storage — baskets, sheds, or the basket in the pet’s paws. No counting by hand. |
| **Time until ripe** `q.ripe` | Crop: Kind<Crop> | — | Ticks until the next one is ripe (0 if one is ripe now; 99 if none is growing). Pens have no growing plots. |
| **Water carried** `q.water` | — | — | Splashes of water the pet is carrying (0–3). |

## Options

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **Do action** `opt.action` | Only when (optional): Condition | Action: pick up / put down / water / shoo / stay a moment / lift a basket / plant / nudge / step aside | One step of a basic action. |
| **Use skill** `opt.skill` | Aimed at (optional): Kind; Only when (optional): Condition | Skill | Run one of your saved skills (its current revision) until it finishes. |

## Placement

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **Area** `zone.rect` | — | Name; Position: fixed spot / random each try; Column: 0–15; Row: 0–15; Width: 1–8; Height: 1–8 | A named patch of ground (coop, garden…). Things are never scattered inside areas at the start. |
| **Energy** `place.energy` | — | Energy at the start: 0–100; Each try: exactly that / anywhere from 10 to 100 | The pet has energy in this pen, as on the farm: every step of work costs 0.12, staying put restores 1.5. Lets you teach “rest when tired” (with the Tired? sense or Energy below). |
| **Gates start** `place.gates` | — | Gates start: shut / open / open or shut (random each try) | Whether the pen’s gates start open or shut (without this card they start shut). Practise shutting an open gate, as on the farm at nightfall. |
| **Obstacles** `place.obstacles` | — | How many: a few / some / many; Made of: rocks / fences / rocks and fences | Scatters obstacles each try (a few ≈ 5% of tiles, some ≈ 10%, many ≈ 18%). Some variety helps more than none or lots. |
| **Pet start** `place.pet` | Away from: Kind; Area: Area | Start: anywhere / on a fixed tile / inside / away from; Column: 0–15; Row: 0–15 | Where the pet begins each try. |
| **Place here** `place.fixed` | Thing: Kind | Column: 0–15; Row: 0–15 | Always the same tile. |
| **Scatter** `place.random` | Thing: Kind; Next to / away from: Kind; Area: Area | How many: 1–8; Where: anywhere / left half / right half / top half / bottom half / middle / inside / next to / away from / far from the pet; Count varies: exactly / or 1 more / up to 2 more / up to 3 more; Every try?: every try / on about half the tries | Random spot each try — teaches skills that transfer. Vary the count, or make it appear only sometimes, for sturdier skills. |
| **Seed money** `place.purse` | — | Seed money: 0–50 | Planting costs the seed, as on the farm (carrot 1, sunflower 2, pumpkin 3); when the money runs out, Plant does nothing. Without this card, planting in pens is free. |
| **Stocked storage** `place.stocked` | Storage: Kind<Container>; Holding: Kind<Carryable> | How many inside: 1–10; Amount: exactly / anywhere from 1 to that; Where: anywhere / left half / right half / top half / bottom half / middle | A basket or shed that already holds things when the try starts (scattered each try). Practise taking stock out — e.g. a skill that empties the basket into the house. |
| **Time of day** `place.time` | — | Time: daytime / night / random each try | Day, night, or a coin flip each try. |
| **Weather** `place.weather` | — | Weather: dry / rain / random each try | Rain waters every bush and patch. |

## Plan

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **Responsibility** `plan.row` | When (optional) (several): Condition; Use: Job; Or use (optional) (several): Job; Until (optional): Condition | Name; At night: sleep instead / keep at it | WHEN every condition holds, work on it with one of the jobs it may USE (the pet picks the one that has worked best). With UNTIL, the pet sticks with it until that holds; without, each finished job counts. Higher in the list = more important. |

## Rules

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **Rule** `rule` | When: Event; If (optional) (several): Condition; Then (several): Effect; Limit (optional): Limit | Name | WHEN something happens, IF conditions hold, THEN give an effect. |

## Senses

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **Area seen from…** `sense.areaFrom` | From: Kind; Area: Area | — | Which way the area lies from the nearest one still outside it (great for herding: get behind it!). |
| **Carrying?** `sense.carrying` | — | — | carrying something? |
| **Day or night** `sense.night` | — | — | day or night? |
| **Done … yet?** `sense.did` | What happened: Event | — | Whether something has happened yet this try. Lets a pet tell “before” from “after”. |
| **Gate state** `sense.gate` | — | — | Is the nearest gate open, closed — or is there none? |
| **Has water?** `sense.water` | — | — | has water? |
| **Hazards nearby** `sense.hazards` | — | — | Which neighbouring tiles are hazards like the pond. |
| **How far is…** `sense.distance` | What: Kind | — | Distance only (here, 1, 2–3, 4+, none) — cheaper than direction. |
| **Last heading** `sense.heading` | — | — | Which way it last moved — helps avoid dithering. |
| **Note** `sense.note` | — | Note; Counts up to: 1–9 | Lets the pet read a note your rules write (Write a note): on/off, or a count up to “Counts up to” (higher counts read as that). Each extra count multiplies the situations. |
| **Patience** `sense.still` | — | — | How long it has stayed still (0, 1–4, 5+ steps). |
| **Rain** `sense.rain` | — | — | is it raining? |
| **Standing on…** `sense.here` | What: Kind | — | standing on {what}? |
| **Stock** `sense.stock` | — | — | How full the nearest basket or shed is (or the basket it carries): empty, some, full. |
| **Storage of** `sense.stored` | What: Kind | — | How many of it are in storage (any basket or shed, or the one carried), in bands: none, 1–2, 3–5, 6 or more. |
| **Tired?** `sense.tired` | — | — | How much energy the pet has: rested (60+), fine, or tired (below 25). On the farm it reads the pet’s real energy; in a pen, the Energy card’s. |
| **Walls nearby** `sense.blocked` | — | — | Which of the 4 neighbouring tiles are blocked. |
| **Where is a dry…** `sense.nearestDry` | What: Kind<Plot> | — | Direction and distance to the nearest bush/patch that still needs water. |
| **Where is a stray…** `sense.outside` | What: Kind; Area: Area | — | Direction and distance to the nearest one that is NOT already inside the area. |
| **Where is area…** `sense.area` | Area: Area | — | Direction and distance to the nearest tile of an area (here = inside). |
| **Where is…** `sense.nearest` | What: Kind | — | Direction (8 ways) and rough distance to the nearest one. |

## Where

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **Area** `area.named` | — | Area | A named area from the Environment binder (on the farm: “coop”). |

## Which one

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **Emptiest storage** `obj.emptiest` | Which storage (default: any) (optional): Kind | — | The basket or shed holding the least (ties: the first placed). |
| **Fullest storage** `obj.fullest` | Which storage (default: any) (optional): Kind | — | The basket or shed holding the most (ties: the first placed). |
| **Furthest** `obj.furthest` | What: Kind; Furthest from (default: the pet) (optional): Kind | — | The one furthest from the pet (or from another thing, e.g. the furthest berry from the house). |
| **Nearest** `obj.nearest` | What: Kind; Nearest to (default: the pet) (optional): Kind | — | The one closest to the pet (or to another thing). Ties: the first placed. Careful: it changes as the pet moves. |
| **What it carries** `obj.carried` | — | — | Whatever is in the pet’s paws (nothing, if empty-pawed). |

## Who

| Card | Slots | Settings | What it does |
|---|---|---|---|
| **It** `ref.it` | — | — | The exact object the event happened to. |
| **The target** `ref.target` | — | — | Whatever this skill is aimed at. Re-aim it later (e.g. berry → carrot) without retraining. |
| **Your pet** `actor.pet` | — | — | The pet being trained. |
