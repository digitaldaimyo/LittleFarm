# Farm life plan: storage, selling, planting, layout and a pet roster

**Goal:** make day-to-day farm life richer and more yours.
- Produce has to travel: crop → basket or shed → the house, where it finally earns coins.
- Field crops are replanted, for the price of the seed.
- You lay out the farm: plots, baskets, sheds and the rest.
- Pets still do all the work, managed from the farm itself: tap a pet for its details and controls, tap the house for the roster.

Status: **plan, not started.** Section 9 lists the decisions to take before phase A.

---

## 1. Where we start from

| Today | Where it lives |
|---|---|
| A fixed 12×9 farm: house (1,1), bin (drawn as a basket) at (2,3), well, pond, rocks, trees, coop. Bushes and carrot patches sit on fixed plots, some unlocked by the shop. | `createFarm`, `Plot[]` in `game/farm.ts` |
| **Coins appear where the work happens.** A foraged berry pays 1 coin when it's picked (it's never carried). Carrots (3) and eggs (2) pay when Fetch drops them in the bin. Fireflies pay 1 when caught. | `handleEvents`, `CROP_VALUE` |
| **Crops regrow by themselves** (bushes 28 ticks, carrots 44; twice as fast when watered). | `regrow` |
| **Jobs:** Auto, Farm plan, Forage (Approach), Deliver (Fetch), Catch fireflies, Nap, Wander, Go to, Run a skill, Mind the gate, Steer. | `executive.ts`, `plan.ts` |
| **Pets on duty:** one, plus an optional second through a special code path that swaps the second pet into the first's slots each tick. Managed with two dropdowns on the Farm screen; the full roster is on the Pets screen. | `farm.duty2PetId`, `secondTurn` |
| The shop adds bushes, a third patch, chickens, a scarecrow, the orchard expansion and more pets. | `progression.ts` |

The first lesson's last step ("earn 5 coins") and Fetch's place in the game both rest on coins appearing at the bush or the bin. That is exactly what this plan changes, so the tutorial needs care (section 6).

## 2. Principles

1. **Cozy, never stuck.**
   - No spoilage, no theft, no losses beyond time (crows peck crops, as today).
   - A farm with no coins must still be able to earn some. There's always free work, so you can never be unable to afford seeds with nothing to sell (see 3.3).
2. **Logistics is a teachable problem.** Every new step (carrying, storing, hauling, planting) is a job that uses a skill your pet learned, so better skills visibly mean a better-run farm.
3. **Your layout, your trade-offs.**
   - A basket next to the bushes speeds up harvesting, but someone has to haul it to the house.
   - A shed holds more, but costs more.
   - Placing things changes paths, ponds in the way, and what your skills have to cope with.
4. **Same simulator.** Storage, planting and selling are sim rules and events, so pens, previews, plans and replays all agree. Determinism stays (plan previews still equal reality).
5. **Old saves keep working.** One save migration (v5 → v6) maps today's farm onto the new rules (section 7).

## 3. Design

### 3.1 Produce travels; the house sells
- **Harvest** replaces Forage:
  - The pet reaches a ripe crop with its movement skill and picks it into its paws, one item at a time.
  - It then carries it to the **nearest storage with room**: a basket or shed that accepts the item, or the house.
  - Coins arrive **only when an item reaches the house** (sold at its price; see the table).
  - **Fireflies** are the exception: still +1 coin when caught (a night bonus, not a stored product). See decision 4.
- **Haul** replaces Deliver. A pet with **Fetch** moves stored items to the house: from a basket or shed, by default the fullest first. Fetch keeps its role, now moving goods between places rather than only crop → bin.
  - **Haul to a shed** (basket → shed) is a plan option for big farms.
- **Storage objects:**

  | Object | Holds | Cost | Notes |
  |---|---|---|---|
  | **Basket** (today's bin) | 6 items, **one type at a time** (the first item sets the type; empty → any) | 6 coins | Cheap; place it near crops |
  | **Shed** | **4 slots × 10 items**, each slot one type | 25 coins, 2×2 tiles | Big; place it on the way to the house |
  | **House** | Unlimited; **sells** on arrival | — | One per farm, fixed (or movable once; decision 7) |

  A full basket (or one holding another type) is skipped, so produce flows on to the next storage or the house. Storage is shown on the map (a small count / type badge) and on tap (section 3.5).
- **Pens:** the *Bin* card (a basket) keeps working exactly as today. In lessons a container takes any delivery; capacity only matters on the farm. The card is renamed **Basket** in the UI (its art already is one); the internal id stays `bin`, so lessons, saves and skills are untouched. A **Shed** kind becomes placeable in pens later, for logistics lessons.

### 3.2 Crops: plant, grow, harvest, replant
- A crop plot cycles **empty soil → planted (growing) → ripe → harvested → empty soil**.
- Planting costs the seed price in coins, paid when the pet plants.
- **Planting is pet work:**
  - a new **Plant** ability (an action, like *Water*) plants on empty soil next to or under the pet when there are coins for the seed;
  - a new farm job **Plant** walks to empty soil with the pet's movement skill and plants, like Harvest. No new lesson is needed to use it;
  - your own skills can include *Plant* (for example a "plant the patches nearest the house first" skill), with events *Plants* and conditions *Empty plots* / *Can afford seeds*.
- **Crop types** (a few, each a reason for a different layout):

  | Crop | Seed | Grows (ticks) | Sells for | Notes |
  |---|---|---|---|---|
  | **Berry bush** | — | 28, then regrows | 1 | Perennial: never needs replanting (see 3.3) |
  | **Carrot** | 1 | 44 | 3 | Today's patch crop |
  | **Pumpkin** | 3 | 120 | 10 | Slow and valuable; heavy, so it uses one carry slot and the pet walks slower? (decision 6) |
  | **Sunflower** | 2 | 70 | 5 | Shown to crows from further away (a reason for the scarecrow) |

  Watering still halves growth time, rain still waters everything, and crows peck ripe crops (the plot goes back to empty soil).
- Numbers are a starting point. A balance test (section 8) checks that each crop's coins per tick, after seeds, is positive, and that pumpkins pay off only when someone waters them.

### 3.3 Never stuck
- **Berry bushes are perennial and free.** A farm can always earn from berries without spending, even at 0 coins.
- Planting is skipped (the job isn't possible) when you can't afford the seed; the pet just does something else.
- If the farm has 0 coins, nothing to sell and no perennial plots (only possible after the player removes all bushes), a neighbour leaves **a free seed packet** each dawn. A journal note explains.

### 3.4 Your farm layout
- A **Layout** mode on the Farm screen (the farm pauses while it's open):
  - tap an empty tile to **place**: crop plots by type, baskets, sheds, the scarecrow, fences and more;
  - tap something to **move** or **remove** it (a removed item refunds half its cost).
  - The shop's "Two more bushes" and "Third carrot patch" become a **budget of plots** plus coin costs, instead of fixed tiles.
- **Validation as you place**, with a red tile and a reason:
  - everything (well, house, plots, storage, coop) must stay reachable from the house;
  - nothing blocks the house's door tile;
  - the coop stays a 2×2 area;
  - the orchard gate stays where the expansion put it.
- **Previewable:** *Preview 300 ticks* (from farm plans) works on the edited layout, so you can compare "basket by the bushes" against "everything to the house" before committing.
- **The starting layout** stays recognisable: house, a basket at today's bin tile, two bushes, the pond between them, the well, the coop. Everything else is yours to add.

### 3.5 Pets: tap to manage, and more of them
- **Tap a pet on the farm** for a card:
  - name, energy, mood, current job and why;
  - **controls:** job, *Move with*, on duty / resting, *Steer*, *Edit farm plan…*;
  - shortcuts to its skills (Pets screen) and to teach it (Teach).
- **Tap the house** for the **roster**: every pet with status (working, resting, napping), energy and job.
  - **Put on duty / take off duty**, reorder, rename, adopt (the shop item moves here too).
  - A "who does what" summary, for example "2 harvesting, 1 hauling, 1 planting".
- **Tap storage** to see its contents; tap a plot to see its stage and timer.
- **More pets at work:**
  - The "second pet" code path becomes a general list of **workers** (up to 4 on duty; decision 5), each with its own runtime and claim. "Never chase the same thing" generalises to N pets.
  - Two-pet behaviour must stay identical (tested), and performance is re-measured with 4 workers.
- The Farm screen's side panel shrinks to the selected pet's card plus a compact roster strip. Phones get the same card as a bottom sheet.

## 4. Jobs and plans after the change

| Job | Needs | Does |
|---|---|---|
| **Harvest** (was Forage) | Approach or Avoid | ripe crop → nearest storage with room / house |
| **Haul** (was Deliver) | Fetch | stored items (and eggs in the coop) → house (or → shed) |
| **Plant** | movement skill + coins | empty soil → planted, paying for the seed |
| Water, Catch fireflies, Nap, Wander, Go to, Mind the gate, Run a skill, Steer | as today | as today |

- **Auto (the rules executive):**
  - nap when tired or at night;
  - catch fireflies at night;
  - otherwise harvest if anything is ripe and storage has room, haul if storage is ≥ half full (or anything is waiting and nothing is ripe), plant if there's empty soil and coins, else wander.
  - The **starter plan** is rewritten to match, and its "starter plan ≡ built-in rules, tick for tick" test is kept.
- **New plan conditions:** *Storage is ≥ N% full*, *Empty plots ≥ N*, *Coins ≥ N*. (*Has done…* already works in plans.)
- **Two or more pets:** the claim rule extends to storage, so two haulers don't empty the same basket, and to soil, so two planters don't plant the same plot.

## 5. What this does to existing systems

| System | Change |
|---|---|
| **Economy** | Coins arrive later (on reaching the house), so prices are re-balanced so a first-hour farm earns about the same per minute. Measured with the bench farm runs before and after. |
| **Requests board** | "Deliver 2 eggs by nightfall" becomes "Sell 2 eggs" (reach the house). New kinds: "Plant 3 carrots today", "Have a full shed". Hints and lesson links updated. |
| **Journal** | New firsts: first sale at the house, first replant, first shed, first pumpkin. Curiosities unchanged. |
| **Coaching tips** | New farm tips: "Your basket is full and nobody is hauling", "Empty soil and no planter", "The pond is between your bushes and your basket". |
| **Sound** | New cues: sale at the house (replaces the coin-at-pickup chime), store in basket/shed, plant, "storage full" (a soft dull tick). Coins merge as today. |
| **Two-pet tests and finding** | "Forager + deliverer earns 2× two foragers" is re-measured as harvester + hauler, which now matters more. |
| **Pens and lessons** | Unchanged: the *Bin* (renamed *Basket*) takes any delivery in a pen. Fetch lessons, the loophole lesson and Field Guide pens keep their numbers (the layout fingerprint test guards pens). |
| **Plans' preview** | Must include storage contents and seed spending in its summary (coins earned *and* spent). |

## 6. Tutorial and Field Guide impact

| Lesson | Today | After | Change |
|---|---|---|---|
| **1. First lesson**, steps "Put it to work" and "Earn 5 coins" | Forage pays at the bush | Harvest carries each berry to the basket at (2,3); nothing sells until it reaches the house | **Needs a change.** Either (a) the starting basket starts as a "sell basket" that a neighbour collects each dusk, or (b) the step becomes "Bring 5 berries home": the first harvests skip the basket and go straight to the house while the pet has no Fetch (decision 3). Step text and *why* updated either way. |
| **Unlock Fetch at 5 coins** | coins earned | coins earned at the house | Same rule; slower by the walk. Measured so the first hour still unlocks Fetch in about the same time. |
| **4. Pay for results** | Fetch pen | unchanged | — |
| **5. Practise where it works** | offered after pond splashes on the way to the bin | the pond still lies between the bushes and the basket/house | Text mentions the basket; check the trigger still fires. |
| **7. See what your pet learned** | unchanged | unchanged | — |
| **9. Plan the farm** | "Check on the well" row, preview | add a haul row in the example; the shadowed-row lesson is unchanged | Re-run its busy-farm test with the new jobs. |
| **New lesson 10, Lay out the farm** (offered after the first shed or the orchard) | — | Try "everything to the house" vs "a basket by the bushes + a hauler" in **preview**, then apply the better one | New; the comparison card uses preview coins per day. |
| **Notebook / glossary** | — | add Basket, Shed, House sells, Plant, Seed cost | Small. |

The browser test (`npm run e2e`) plays lessons 1–9, so it will catch any tutorial break. Lesson 1 is the one to watch.

## 7. Saves (v5 → v6)
- Today's bin becomes a **basket**: same tile, capacity 6, empty.
- Today's **plots** become crop plots: bushes perennial; carrot patches planted and growing (no seed charged); locked plots become **plot budget** the player has already "bought".
- `dutyPetId` / `duty2PetId` become `workers: [{ petId, … }]`.
- Coins, skills, journals and everything else are untouched.
- Tested with the v1 fixture all the way through, plus a v5 fixture captured before the change.

## 8. Testing
- **Determinism:** same seed and the same actions give the same farm (storage, planting, selling included). Plan previews still equal reality.
- **Never stuck:** from many random farm states (including 0 coins, empty storage, every plot empty), a pet on Auto earns coins within a day.
- **Balance:** each crop's net coins per tick is positive. A first-hour script (adopt → Approach → harvest) reaches 5 coins in a comparable time to today. Harvester + hauler beats two harvesters.
- **Storage rules:** one type per basket; slots in sheds; full storage is skipped; nothing is lost; the house sells exactly once per item.
- **Layout validation:** unreachable placements are refused, with the reason; refunds; preview on the edited layout.
- **N workers:** two-pet results identical to today; 3–4 pets never share a target; performance at 4 pets (60 fps phone budget).
- **Tutorial:** `npm run e2e` (lessons 1–9) plus new checks for tap-a-pet, the roster and layout mode.
- **Docs:** README, GAME_DESIGN (economy, progression), ARCHITECTURE, TESTING, TUTORIAL_PLAN (lesson 1 change and lesson 10).

## 9. Decisions needed
1. **Berry bushes:** perennial and free, never replanted (recommended: keeps the never-stuck guarantee and the first hour simple), or replanted like everything else?
2. **Where a harvest goes:** to the nearest storage with room (recommended: layout matters, and hauling becomes a job), or always straight to the house?
3. **First lesson:** (a) the starting basket is a "sell basket" a neighbour empties each dusk (simple, keeps the step as it is), or (b) without Fetch, harvests go straight to the house (recommended: no special object, and it teaches "coins come from the house" from the start; Fetch then visibly unlocks hauling)?
4. **Fireflies:** still instant coins (recommended), or a product to carry home?
5. **Pets on duty:** up to 4 (recommended for now; performance re-measured), or more?
6. **Pumpkins:** heavy (slower carrying) for a little texture, or plain (recommended for now: simpler)?
7. **The house:** fixed (recommended), or movable once in layout mode?
8. **Order:** storage and selling → planting → layout → pet UI and roster (recommended: each builds on the last), or the pet UI first (it's independent and helps everything after)?

## 10. Phasing

| Phase | Scope | Size |
|---|---|---|
| **A: produce travels** | House sells; baskets (capacity, one type) and sheds (slots); Harvest → nearest storage; Haul (Fetch); storage on the map; the v6 migration; first-lesson change (decision 3); re-balanced prices; requests, journal, sounds, tips updated; tests and e2e | L |
| **B: plant and replant** | Crop plot cycle; Plant ability, event, conditions and job; seed costs; carrot, pumpkin, sunflower; never-stuck guarantees; balance test | M |
| **C: your layout** | Layout mode (place / move / remove, costs, refunds, validation); plot budget replaces fixed shop plots; preview on the edited layout; Field Guide lesson 10 | M–L |
| **D: pets** | Tap a pet (card / bottom sheet), tap the house (roster), tap storage and plots; workers list generalising the second-pet path to up to 4; performance check | M–L |

Each phase ships on its own, keeps every existing test green (or updates it on purpose, documented), and ends with the browser test passing.
