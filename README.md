# Pen Deck

A cozy, single-player pet-training farm game. You adopt a pet and teach it real skills in a training pen. You build each lesson out of typed cards and sleeves, and then put the pet to work on your farm. The learning is genuine: pets are trained with **local reinforcement learning (tabular Double Q-learning)** in a Web Worker on your CPU. Every number in the game comes from episodes the pet actually ran.

- **Offline only.** No accounts, servers, telemetry, hosted models or paid APIs. Fonts are system fonts and art is procedural SVG. After the first load, a service worker lets the game run with no network.
- **Real learning.** Untrained pets wander at random. Trained pets beat the random baseline on layouts held out from training. Scripted demos are always labelled as scripted, never as your pet.
- **Persistent and individual.** Each pet keeps its own versioned skill revisions, temperament, stats and journal. Training one pet never trains another.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Typecheck + production build into `dist/` (static files; host anywhere or open with `npm run preview`) |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint |
| `npm test` | Vitest suite: 95 tests in 15 files (sim, registry, learning, saves, farm, training loop, every milestone gate, the Field Guide, the card editor) |
| `npm run bench` | Trains every starter skill under 5 seeds and prints held-out results, hardware and timings |
| `npm run evidence` | Reproduces the measurements behind the Field Guide and the Trainer's notebook |
| `npm run e2e` | Browser test of the first three Field Guide lessons (run `npm run build` first; needs Playwright with Chromium) |

Requires Node 18+ (developed on Node 22). Needs no secrets or environment variables.

## How to play (first hour)

The **First lesson** banner (lesson 1 of the Field Guide) walks you through this, explaining *why* at each step:

1. **Adopt** a pet and choose its name and colours.
2. **Teach → Environment:** pick the *Berry* card and tap the pen. *Scatter* puts it somewhere new on every try, which teaches a skill that works anywhere.
3. **Rules:** build your first rule yourself. *+ Add rule*, WHEN *Reaches → Berry*, THEN *Treat* and *End try*. Then set **SUCCESS** to *Is at → Berry*. Treats teach; SUCCESS checks. (Stuck? A suggested recipe is one tap away.)
4. **Train Approach.** Watch the success line climb. Pause, cancel and speed controls are always available. Field Guide lessons cost no energy.
5. **Read the report.** Before vs random vs after vs transfer, measured on 20 layouts the pet never trained on. Replay any of them.
6. **Save skill.** It becomes revision r1 in the pet's repertoire.
7. **Farm → Forage berries.** The pet uses the Approach it just learned. Berries sell for 1 coin.
8. **Earn 5 coins** to unlock **Fetch** lessons (*Bring it home*), which reuse your saved Approach as their movement option. A certified Fetch unlocks carrot patches (3 coins per delivery). At 12 coins, **Avoid** lessons unlock, so your pet can stop splashing through the pond.

**Invent your own skills.** Once a pet has a certified Approach, *Your own skills* unlocks. In **Teach → Pet → + New skill…** you name a skill and choose:
- its **senses**, i.e. what it pays attention to: *Where is…*, *How far is…*, *Standing on…*, *Walls nearby*, *Hazards nearby*, *Last heading*, *Carrying?*, *Patience*. A meter shows how many situations it must learn.
- its **abilities**: Move, Stay, Pick up, Put down.
- whether success ends the try or is **judged when time is up**.

Then write its rules with the same cards, using *the target* to mean "whatever this skill is aimed at". The Curriculum has two examples, *Wait for it* and *Keep clear*. On the farm, **Run a skill** runs any of your skills aimed at anything (berry, bin, home, pond…), with no retraining.

After the first lesson, the **Guide** tab (the Trainer's Field Guide) offers short, free lessons that teach how to set up training that works, each by trying something the wrong way first and comparing your own pet's numbers. They are numbered in the Guide, and each one opens when it becomes useful (a locked lesson says what opens it): 2 *Read the report: practice* (300 vs 1,500 tries), 3 *Scatter, don't pin* (one perfect layout vs a scattered pen), 4 *Pay for results, not effort* (the pickup loophole and its repair), 5 *Practise where it works* (Approach vs Avoid in a pond pen), 6 *Invent a skill* (abilities, senses, and what one sense too many costs), 7 *See what your pet learned* (summaries, the probe, curiosities, skill cards), 8 *Combine skills* (a routine is only as good as what it watches) and 9 *Plan the farm* (preview, shadowed rows, two pets on different jobs). It also holds the **Trainer's notebook** (a checklist built from measured results) and a **glossary**. **Coaching tips** appear in lesson reports (and on the farm) when the evidence suggests a common mistake, each linking to the lesson that explains it. Requests on the neighbours' board say how they can be met and link to the lesson that helps (`docs/TUTORIAL_PLAN.md`).

Try the optional **Treat for every pickup** recipe to watch a pet discover a reward loophole, then fix it with a repair card.

**Watering and day/night.** The farm has a **well**. A pet with the *Water* ability fills up there (3 splashes), then waters a dry bush or carrot patch, and **watered plots regrow twice as fast** until their next crop appears. Teach it with the *Water the garden* example skill, then run it on the farm with **Run a skill** aimed at berry bushes or carrot patches.

A farm day lasts about 5½ minutes at 1×, and the last 30% is **night**. At night the farm darkens, pets on Auto prefer to nap (night naps are deeper, night work is more tiring), and **fireflies** appear. Pets catch them by walking into them (+1 coin each), and the uncaught ones leave at dawn. In pens, the **Time of day** card sets day, night or a coin flip each try. *Is night* (a condition) and *Day or night* (a sense) let you teach skills that behave differently after dark.

**Chickens, crows and areas.** The farm has a **coop** area. Buy **two chickens** in the shop: they wander, and they lay eggs (2 coins each when delivered by Fetch) *only while inside the coop*. From day 2, **crows** fly in by day to peck ripe crops. A pet with the new **Shoo** ability pushes a next-door chicken one tile away or sends a crow flying, and a **Scarecrow** keeps crows 2 tiles away. In pens, the **Area** card paints a named area (two taps; a fixed spot or a random spot each try). Senses like *Where is a stray…* and *Area seen from…* make herding learnable. Try the *Herd a chicken* example, and the *Treat for every shoo* loophole experiment.

**Routines.** Once a pet has a certified Approach and two saved skills, **+ New routine…** combines them. Options are *Use skill* cards (any saved movement or own skill, aimed at anything, with an optional *only when…* condition) and *Do action* cards. The routine **watches** up to 4 conditions and learns which option to use in which situation. Options always call each skill's *current* revision, so improving *Herd* improves every routine that uses it, and the game flags routines certified with an older revision. The Curriculum has *Bring it home (routine)* (Fetch rebuilt from cards) and *Morning chores* (pick the right skills from your deck). Run any routine on the farm with **Run a skill**.

**Farm plans.** On the Farm screen, **Farm plan** (or *Edit farm plan…*) opens a mat of **IF / DO** rows written with the same cards, for example "IF a crow is within 3 of me DO run Guard", "IF energy below 30 DO nap", "IF 2+ eggs in the coop DO deliver". Rows are tried top to bottom. A row is skipped when its job can't do anything right now. **Preview 300 ticks** dry-runs the plan on a copy of the farm and shows coins, energy, naps, pond dips, how often each row ran, and whether rows fight each other. Since the farm is deterministic, that preview is exactly what will happen if you apply the plan then. The **starter plan** is the built-in Auto rules, written out so you can edit them. *Learn among matches* lets the pet pick among the rows that apply. An **anti-dithering guard** steps in if rows start flip-flopping.

**A bigger, livelier farm.** The *Orchard expansion* (shop) grows the farm to 16×12, with a fenced orchard behind a **gate**. Closed gates block pets and chickens, and a pet with the **Nudge** ability opens or shuts one from next to it (plans have a *Mind the gate* job). From day 2, gentle **rain** showers water every plot, swell the pond by a tile and keep crows away. Each dawn, neighbours pin up to three small **requests** ("Deliver 2 eggs by nightfall", "No crow pecks today") that pay coins and sometimes gifts. Missing one costs nothing.

**Seeing what your pet learned.** Every lesson report (and every skill on the Pets screen) has **What it actually did**: a heatmap of where the pet spends its time around its target, its action mix, how tries ended, and which rules paid the treats. In the pen, **What does Pip do?** draws the learned choice on every tile (bigger arrow = surer, grey = never practised exactly). Tap a tile to watch the path from there. After each lesson the journal notes **curiosities**, such as "most treats came from one rule" or "spent 60% of the time standing still". **Export skill card** / **Import skill card…** share a single skill between saves or pets. Two pets can work at once (**Also on duty**): they never chase the same thing, and they earn the most when they do different jobs.

The farm keeps running while you're in other screens. Use **Steer** to guide a pet by hand (tap tiles, or use the arrow keys, P to pick up, D to put down, W to water, X to shoo and G to nudge a gate).

## Performance

Training is fast on any recent laptop CPU. Approach takes about 0.1 s and Avoid about 0.6 s of compute (see `docs/TESTING.md`). The *Normal* speed deliberately spreads that over a few seconds so you can watch. *Watch* is slower (~30–60 s, with replays). *Fast* runs flat out. The farm ticks at about 3.5 ticks/s at 1×, with 2× and 4× options.

## Limitations (honest list)

- No sound. Crows only visit by day and at most one at a time. Guarding crops means running a skill you taught (there's no built-in guard job yet).
- Thumbs up/down feedback applies to movement skills (Approach/Avoid), not to the Fetch controller.
- Templates are immutable named revisions you can instantiate. "Exposed parameters" are stored but have no editing UI yet.
- Avoid is the hardest preset: about 82% mean held-out success, with occasional runs at 75%. Use *Refine* to train more.
- Learned Approach is shaky right beside fences (8×8 practice pens rarely have walls there). Pets get through with the stuck-recovery, but retraining with fences in the pen helps.
- The browser test covers lessons 1–3; lessons 4–9 are covered by game-level tests (`tests/guide.test.ts`), not by clicking through.
- Up to two pets work the farm at once; others nap. Routines can't use Fetch or other routines as options yet. Plan previews always start from a fresh decision (the current job is dropped when you apply a plan).
- No local language model (the spec's optional Level D). The executive is a rules baseline plus a small learned bandit.
- Static reward checks and the preflight random-rollout comparison are heuristics, not proofs that a reward can't be exploited.

## Documentation

| Doc | What's in it |
|---|---|
| `docs/GAME_DESIGN.md` | The loop, economy, progression, the Field Guide, content |
| `docs/ARCHITECTURE.md` | Code layout, the typed spec, simulator, learners, farm, saves |
| `docs/TESTING.md` | Test suites, benchmark results, performance, browser checks |
| `docs/ROADMAP.md` | The expansion roadmap (all six milestones shipped) and what could come next |
| `docs/TUTORIAL_PLAN.md` | The Field Guide's design, the evidence behind each lesson, and what shipped |
