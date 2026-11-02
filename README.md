# Pen Deck

A cozy, single-player pet-training farm game. You adopt a pet and teach it real skills in a training pen. You build each lesson out of typed cards and sleeves, and then put the pet to work on your farm. The learning is genuine: pets are trained with **local reinforcement learning (tabular Double Q-learning)** in a Web Worker on your CPU. Every number in the game comes from episodes the pet actually ran.

- **Offline only.** No accounts, servers, telemetry, hosted models or paid APIs. Fonts are system fonts, art is procedural SVG, and sound is synthesized on the device. After the first load, a service worker lets the game run with no network.
- **Real learning.** Untrained pets wander at random. Trained pets beat the random baseline on layouts held out from training. Scripted demos are always labelled as scripted, never as your pet.
- **Persistent and individual.** Each pet keeps its own versioned skill revisions, temperament, stats and journal. Training one pet never trains another.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run build` | Typecheck + production build into `dist/` (static files; host anywhere or open with `npm run preview`) |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint |
| `npm test` | Vitest: 158 tests in 21 files (sim, registry, learning, saves, farm, every milestone gate, the Field Guide, the card editor, sound, teaching polish, pens, cards, farm life, and a layout fingerprint that keeps existing lessons' layouts fixed) |
| `npm run bench` | Trains every starter skill under 5 seeds and prints held-out results, hardware and timings |
| `npm run evidence` | Reproduces the measurements behind the Field Guide and the Trainer's notebook |
| `npm run e2e` | Browser test that plays all ten Field Guide lessons and the newer editor features with real clicks, about a minute (run `npm run build` first; needs Playwright with Chromium). `npm run e2e -- --from=4` skips lessons 1–3 |

Requires Node 18+ (developed on Node 22). Needs no secrets or environment variables.

## Your first hour

The **First lesson** banner (lesson 1 of the Field Guide) walks you through this, explaining *why* at each step:

1. **Adopt** a pet and choose its name and colours.
2. **Teach → Environment:** pick the *Berry* card and tap the pen. *Scatter* puts it somewhere new on every try, which teaches a skill that works anywhere.
3. **Rules:** build your first rule yourself: *+ Add rule*, WHEN *Reaches → Berry*, THEN *Treat* and *End try*. Then set **SUCCESS** to *Is at → Berry*. Treats teach; SUCCESS checks. (Stuck? A suggested recipe is one tap away.)
4. **Train Approach.** Watch the success line climb. Pause, cancel and speed controls are always available. Field Guide lessons cost no energy.
5. **Read the report:** before vs random vs after vs transfer, measured on 20 layouts the pet never trained on. Replay any of them.
6. **Save skill.** It becomes revision r1 in the pet's repertoire.
7. **Farm → Harvest.** The pet uses the Approach it just learned to pick berries and carry them to the house, where each sells for 2 coins. Coins only come from the house.
8. **Earn 5 coins** to unlock **Fetch** lessons (*Bring it home*), which reuse your saved Approach to move. With Fetch, a pet stores harvests in the basket and **hauls** stored goods to the house. A certified Fetch unlocks carrot patches (5 coins per carrot sold). At 12 coins, **Avoid** lessons unlock, so your pet can stop splashing through the pond.

## Building lessons

**Rules and SUCCESS.** A rule is *WHEN event [IF conditions] THEN effects [LIMIT]*. SUCCESS (and an optional FAIL) decide whether a try counted.
- **Has done…** wraps any event and remembers it for the rest of the try ("“Pip shoos chicken” has happened at least once"). **Just…** is true on the step it happens. **Any of** sits next to *All of* and *Not*.
- **End try** says what the ending means: *judged by SUCCESS* (the default), *counts as a success ✓*, or *counts as a miss ✗*.
- **SUCCESS and FAIL** take one card, or several with **+ and…** and an *all of these / any of these* switch.
- Conditions include *Is at*, *Is near*, **Next to** (the 8 tiles around), **Thing near thing** (e.g. a chicken within 1 of the bin), *Is carrying*, areas, gates, night, rain, energy and **Time in try**.
- Every rule and condition **reads back as a sentence** under its cards ("When Pip shoos chicken: +10 treats, end try (judged by SUCCESS)").
- Rules can be **duplicated, reordered and switched off** (kept on the mat, but not used).

**A helpful editor.**
- The hand **recommends cards for this lesson**. In a lesson with Shoo, *Shoos* and *Has done…* come first, and "More cards" is sorted into short groups.
- **Measured checks** run about 30 quick random tries whenever the lesson changes. They warn, with a one-tap repair, when:
  - SUCCESS ends tries before your goal rule can ever fire;
  - a rule ends tries that never count;
  - SUCCESS is already true as tries start.
- If a treat depends on something the pet can't sense ("have I shooed yet?"), the game suggests the matching **Done … yet?** sense.
- Static checks flag repeatable rewards, pay-every-step rules and pickup/drop loops, with repair cards.

**Pens.**
- **Scatter** places things anywhere (or in one half), *inside* an area, *next to* or *away from* something, or *far from the pet*.
- Counts can vary ("2, or up to 2 more"), and things can appear *on about half the tries*. *Place here* pins a thing to one tile.
- **Pen size** is 6×6, 8×8, 10×10, or *varies* each try. **Obstacles** scatter a few, some or many rocks (or fences, from the shop).
- **Areas** are painted with two taps, at a fixed or a random spot. **Weather** and **Time of day** cards set rain and night.
- The pet starts anywhere, on a fixed tile, inside an area, or away from something.
- Six **example layouts** under the pen show the variety your pen produces.
- **Play it yourself** steers the pet through the lesson by hand (arrow keys or buttons). Rules light up as they fire, treats add up, and you see whether SUCCESS holds and how the try ends. It never counts as training.

**Your cards and lesson cards.**
- **Your cards:** open any card (✎) and press *Save as one of your cards*, or press ⧉ on a rule. It then appears first in the hand wherever it fits (rules, SUCCESS, routines, farm plans) under its own name, and placed copies carry the name as a tag. A saved condition is a **named condition** ("Chickens home").
- **Blanks:** in Teach → Curriculum → *Your cards*, tick the things a card should ask for each time ("Treat for reaching ___"). Placing it jumps straight to the blank.
- **Lesson cards:** *Export lesson card* / *Import lesson card…* share a whole lesson (pen, rules, SUCCESS, learner setup) between saves. They're validated like a save, and they don't carry what a pet learned (that's a skill card).

## Skills

- **Approach, Avoid, Fetch** are presets.
- **Your own skills** unlock with a certified Approach. In **Teach → Pet → + New skill…** you name a skill and choose:
  - its **senses**, a meter showing how many situations it must learn:
    - *Where is…*, *How far is…*, *Standing on…*, *Walls nearby*, *Hazards nearby*, *Last heading*;
    - *Carrying?*, *Patience*, *Where is a dry…*, *Has water?*, *Day or night*;
    - *Where is area…*, *Where is a stray…*, *Area seen from…*, *Gate state*, *Rain*, *Done … yet?*, *Stock*.
  - its **brain**: *Standard* (up to 5 senses and 100,000 situations) or *Big* (up to 8 senses and 2,000,000 situations, keeping only the ones the pet meets; it needs much more practice).
  - its **abilities**: Move, Stay, Pick up, Put down, Water, Shoo, Nudge gate, Plant, Lift basket.
  - **practice** up to 100,000 tries (Fetch and routines 20,000) and **time per try** up to 400 steps, with a training-time estimate for this device.
  - whether success ends the try or is **judged when time is up**.

  Write its rules with *the target* meaning "whatever this skill is aimed at". Examples in the Curriculum: *Wait for it*, *Keep clear*, *Water the garden*, *Herd a chicken*, *Open the gate*, *Empty the basket*.
- **Routines** (a certified Approach and two saved skills) choose between your skills (*Use skill*, aimed at anything, with an optional *only when…*) and actions (*Do action*). They **watch** up to 4 conditions and learn which option fits which situation. Options always call each skill's *current* revision, and the game flags routines certified with an older one. Examples: *Bring it home (routine)*, *Morning chores*.
- **Seeing what your pet learned:**
  - Every report and skill has **What it actually did**: a heatmap around the target, action mix, endings, and which rules paid.
  - In the pen, **What does Pip do?** draws the learned choice on every tile. Tap a tile to hear soft plucks along the path it would take.
  - The journal notes **curiosities** ("most treats came from one rule").
  - **Export / Import skill card** shares one skill between saves or pets.
- Try the experiments *Treat for every pickup* and *Treat for every shoo* to watch a pet find a reward loophole, then repair it.

## The farm

- **Produce travels; the house sells.** Coins come only from produce brought to the house (berry 2, carrot 5, sunflower 7, pumpkin 12, egg 3), plus fireflies. The **basket** stores 6 of one kind and a **shed** 4 kinds × 10; the map shows how full each is. A full basket gets a coaching tip.
- **Crops and replanting.** Berry bushes regrow by themselves; carrot, sunflower and pumpkin plots go back to empty soil after each harvest and must be **planted** again, buying a seed (1, 2 or 3 coins). A farm can't get stuck: bushes are free, and a neighbour's seed packet arrives at dawn when nothing is growing and seeds are unaffordable.
- **Your layout.** **Layout…** on the Farm pauses the farm and opens a draft: place berry bushes (4), carrot (3), sunflower (5) and pumpkin (6) patches, baskets (6), sheds (25), scarecrows (8) and fences (1); move things (free) or remove them (half the price back). Every change is checked as you go: the house's door stays clear, the coop stays whole, and everything must stay reachable from the house. **Preview half a day** races the farm as it is against the draft from the same moment, then **Apply** pays. Up to 8 crop plots (14 with the orchard).
- **Carrying baskets.** A pet can **lift** a basket with whatever is in it (a carried basket can't be filled). Put down at the house or a shed, it's emptied there; on open ground, it's set down. Pets with Fetch on Auto carry a basket next to the crops and, once it's half full, empty it at the house six at a time (**Basket run**). Over two farm days that lifts a one-pet farm with Fetch and carrots from about 247 to 271 coins.
- **Jobs:** Auto, **Harvest** (pick a ripe crop, carry it to storage with room, or the house), **Plant** (empty soil, paying for the seed), **Basket run**, **Haul** (Fetch: eggs and stored goods to the house), Nap, **Run a skill** (any of your skills or routines, aimed at anything), and **Steer** (tap tiles, or arrow keys, P pick up, D put down, W water, X shoo, G nudge a gate, L plant, B lift a basket). The farm keeps running while you're on other screens.
- **Day and night:** a day lasts about 5½ minutes at 1×, and the last 30% is night. Night darkens the farm, pets on Auto prefer to nap, and **fireflies** appear (+1 coin each, gone at dawn).
- **Watering:** a pet with *Water* fills up at the **well** (3 splashes) and waters dry bushes or patches, which then regrow twice as fast.
- **Creatures:**
  - **Chickens** (shop) lay eggs only inside the **coop** (3 coins each at the house, hauled with Fetch).
  - From day 2, **crows** peck ripe crops by day. **Shoo** pushes a chicken one tile or sends a crow flying, and a **Scarecrow** (placed in Layout) keeps crows 2 tiles away.
- **Expansion and weather:**
  - The *Orchard expansion* grows the farm to 16×12 with a **gate**; *Nudge* opens or shuts it.
  - From day 2, gentle **rain** waters every plot and keeps crows away.
  - Each dawn, neighbours pin up to three optional **requests**, each with a hint and a lesson link.
- **Farm plans:** IF / DO rows written with the same cards ("IF energy below 30 DO nap", "IF has picked up a berry DO nap").
  - Rows are tried top to bottom, skipping jobs that can't do anything right now. *Has done…* in a row counts from when the current job started.
  - **Preview 300 ticks** shows exactly what the plan would do (the farm is deterministic).
  - The **starter plan** is the built-in Auto rules written out. *Learn among matches* lets the pet choose among applicable rows, and an **anti-dithering guard** steps in when rows flip-flop.
- **Your pets on the farm:** tap a pet for its **card** (energy, mood, what it's doing and why, its job, *Move with*, on/off duty, *Make lead*, links to its skills and to Teach). Tap the **house** for the **roster**: every pet, who's on duty and doing what ("2 harvesting, 1 hauling"), rename, put on or take off duty, adopt. Tap anything else to see what it is (a basket's contents, a plot's stage and time to ripe). A strip of pets under the farm switches cards.
- **Up to 4 pets on duty.** They never chase the same thing (but may share the house and storage tiles), and a resting pet naps at the house rather than in someone's way. The **lead** is the pet you can steer. More pets earn more when there's work for them: over two farm days on the starting farm, 1 pet 191–247 coins, 4 pets 262–395 (more fields help more pets).

## The Field Guide

The **Guide** tab offers short, free lessons on setting up training that works, mostly by trying something the wrong way first and comparing your own pet's numbers. Each opens when it becomes useful (a locked lesson says what opens it):
1. *First lesson*
2. *Read the report: practice* (300 vs 1,500 tries)
3. *Scatter, don't pin*
4. *Pay for results, not effort* (a loophole and its repair)
5. *Practise where it works* (Approach vs Avoid with ponds)
6. *Invent a skill* (what one sense too many costs)
7. *See what your pet learned*
8. *Combine skills* (a routine is only as good as what it watches)
9. *Plan the farm*
10. *Lay out the farm* (a basket by the bushes vs a crop moved next to the house, in preview)

It also holds the **Trainer's notebook** (a checklist built from measured results) and a **glossary**. **Coaching tips** appear in reports and on the farm when the evidence suggests a common mistake, each linking to its lesson.

## Sound and music

- **Gentle sounds mark the moments worth noticing:**
  - cards snapping into place and training starting;
  - a certified skill, or a "Loophole found!" wobble;
  - pickups, coins, a splash in the pond, a bump into a wall;
  - the well, gates, chickens, crows and fireflies;
  - requests met and Field Guide steps.
- **Replays you watch make the same sounds**, so you can hear a pet bump or splash. Each pet **chirps in its own voice** when it picks something up, and sighs when it settles down for a nap.
- **Background sounds:** birdsong by day, crickets at night and soft rain, crossfading as the day turns.
- **Music box (off by default):** gentle generative tunes, brighter by day, sparser at night and lighter while teaching, dipping under result jingles.
- **Training ticks (optional):** soft ticks at 25%, 50% and 75% of practice.
- Everything is synthesized on the device (no audio files), and every sound repeats something you can see. Mute with 🔈 in the top bar or the **M** key. Settings has volumes for farm and pen sounds, cards and jingles, background and music.

## Performance

Training is fast on any recent laptop CPU. Approach takes about 0.1 s and Avoid about 0.6–0.8 s of compute (see `docs/TESTING.md`). *Normal* speed deliberately spreads that over a few seconds so you can watch; *Watch* is slower (~30–60 s, with replays); *Fast* runs flat out. The farm ticks at about 3.5 ticks/s at 1×, with 2× and 4× options. A phone-sized viewport holds 60 fps on the expanded farm at 4× CPU throttling, with or without sound.

## Limitations (honest list)

- Crows only visit by day and at most one at a time. Guarding crops means running a skill you taught (there's no built-in guard job yet).
- Thumbs up/down feedback applies to movement skills (Approach/Avoid), not to the Fetch controller.
- Your cards are copies: editing a saved card later doesn't change lessons that already used it (save a new revision and place it again). Blanks can be things (kinds), not numbers.
- Avoid is the hardest preset: about 82% mean held-out success, with occasional runs at 75%. Use *Refine* to train more.
- Learned Approach is shaky right beside fences (8×8 practice pens rarely have walls there). Pets get through with the stuck-recovery, but practising with *Obstacles* or fences helps.
- Up to two pets work the farm at once; others nap. Routines can't use Fetch or other routines as options yet. Plan previews always start from a fresh decision (the current job is dropped when you apply a plan).
- No local language model (the spec's optional Level D). The executive is a rules baseline plus a small learned bandit.
- Static reward checks and the measured random-try checks are heuristics, not proofs that a reward can't be exploited.

## Documentation

| Doc | What's in it |
|---|---|
| `docs/GAME_DESIGN.md` | The loop, economy, progression, the Field Guide, design principles for teaching and sound, content |
| `docs/ARCHITECTURE.md` | Code layout, the typed spec, simulator, learners, farm, saves, sound |
| `docs/TESTING.md` | Test suites, benchmark results, measurements, performance, browser checks |
| `docs/ROADMAP.md` | The expansion roadmap (all six milestones shipped), later work, and what could come next |
| `docs/TUTORIAL_PLAN.md` | The Field Guide's design, the evidence behind each lesson, and what shipped |
| `docs/TEACHING_PLAN.md` | Polishing rules, conditions and pens: the plan, and what phases A–C shipped |
| `docs/FARM_LIFE_PLAN.md` | Farm life: storage and selling at the house (A), replanting with seed costs (B) and your own layout (C) shipped; next, a pet roster (D) |
| `docs/LOOSER_LIMITS_PLAN.md` | Plan: a bigger brain, longer practice and more steps, and notes (counters and flags) that rules write and pets sense |
| `docs/SOUND_PLAN.md` | Sound effects, ambience, music and settings: the plan, and what phases A–C shipped |
