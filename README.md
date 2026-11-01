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
| `npm test` | Vitest suite (sim, registry, learning, saves, farm, training loop) |
| `npm run bench` | Trains every starter skill under 5 seeds and prints held-out results, hardware and timings |

Requires Node 18+ (developed on Node 22). Needs no secrets or environment variables.

## How to play (first hour)

1. **Adopt** a pet and choose its name and colours.
2. **Teach → Environment:** pick the *Berry* card and tap the pen. *Scatter* puts it somewhere new on every try, which teaches a skill that works anywhere.
3. **Rules:** tap the suggested recipe *Treat for reaching the berry*. This adds rules (WHEN pet reaches berry THEN +10 treats, end try; a small nudge every step) and a SUCCESS condition.
4. **Train Approach.** Watch the success line climb. Pause, cancel and speed controls are always available.
5. **Read the report.** Before vs random vs after vs transfer, measured on 20 layouts the pet never trained on. Replay any of them.
6. **Save skill.** It becomes revision r1 in the pet's repertoire.
7. **Farm → Forage berries.** The pet uses the Approach it just learned. Berries sell for 1 coin.
8. **Earn 5 coins** to unlock **Fetch** lessons (*Bring it home*), which reuse your saved Approach as their movement option. A certified Fetch unlocks carrot patches (3 coins per delivery). At 12 coins, **Avoid** lessons unlock, so your pet can stop splashing through the pond.

**Invent your own skills.** Once a pet has a certified Approach, *Your own skills* unlocks. In **Teach → Pet → + New skill…** you name a skill and choose:
- its **senses**, i.e. what it pays attention to: *Where is…*, *How far is…*, *Standing on…*, *Walls nearby*, *Hazards nearby*, *Last heading*, *Carrying?*, *Patience*. A meter shows how many situations it must learn.
- its **abilities**: Move, Stay, Pick up, Put down.
- whether success ends the try or is **judged when time is up**.

Then write its rules with the same cards, using *the target* to mean "whatever this skill is aimed at". The Curriculum has two examples, *Wait for it* and *Keep clear*. On the farm, **Run a skill** runs any of your skills aimed at anything (berry, bin, home, pond…), with no retraining.

Try the optional **Treat for every pickup** recipe to watch a pet discover a reward loophole, then fix it with a repair card.

**Watering and day/night.** The farm has a **well**. A pet with the *Water* ability fills up there (3 splashes), then waters a dry bush or carrot patch, and **watered plots regrow twice as fast** until their next crop appears. Teach it with the *Water the garden* example skill, then run it on the farm with **Run a skill** aimed at berry bushes or carrot patches.

A farm day lasts about 5½ minutes at 1×, and the last 30% is **night**. At night the farm darkens, pets on Auto prefer to nap (night naps are deeper, night work is more tiring), and **fireflies** appear. Pets catch them by walking into them (+1 coin each), and the uncaught ones leave at dawn. In pens, the **Time of day** card sets day, night or a coin flip each try. *Is night* (a condition) and *Day or night* (a sense) let you teach skills that behave differently after dark.

**Chickens, crows and areas.** The farm has a **coop** area. Buy **two chickens** in the shop: they wander, and they lay eggs (2 coins each when delivered by Fetch) *only while inside the coop*. From day 2, **crows** fly in by day to peck ripe crops. A pet with the new **Shoo** ability pushes a next-door chicken one tile away or sends a crow flying, and a **Scarecrow** keeps crows 2 tiles away. In pens, the **Area** card paints a named area (two taps; a fixed spot or a random spot each try). Senses like *Where is a stray…* and *Area seen from…* make herding learnable. Try the *Herd a chicken* example, and the *Treat for every shoo* loophole experiment.

The farm keeps running while you're in other screens. Use **Steer** to guide a pet by hand (tap tiles, or use the arrow keys, P to pick up, D to put down, W to water and X to shoo).

## Performance

Training is fast on any recent laptop CPU. Approach takes about 0.1 s and Avoid about 0.6 s of compute (see `docs/TESTING.md`). The *Normal* speed deliberately spreads that over a few seconds so you can watch. *Watch* is slower (~30–60 s, with replays). *Fast* runs flat out. The farm ticks at about 3.5 ticks/s at 1×, with 2× and 4× options.

## Limitations (honest list)

- Only one pet works on the farm at a time (the "on duty" pet); others nap and recover.
- No sound. Crows only visit by day and at most one at a time. Guarding crops means running a skill you taught (there's no built-in guard job yet).
- Thumbs up/down feedback applies to movement skills (Approach/Avoid), not to the Fetch controller.
- Templates are immutable named revisions you can instantiate. "Exposed parameters" are stored but have no editing UI yet.
- Avoid is the hardest skill: about 82% mean held-out success, with occasional runs at 75%. Use *Refine* to train more.
- Your own skills can be run on the farm one at a time ("Run a skill"). Using them inside Fetch-style routines or farm plans is Milestones 3–4 in `docs/ROADMAP.md`.
- No local language model (the spec's optional Level D). The executive is a rules baseline plus a small learned bandit.
- Static reward checks and the preflight random-rollout comparison are heuristics, not proofs that a reward can't be exploited.

See `docs/ARCHITECTURE.md`, `docs/GAME_DESIGN.md` and `docs/TESTING.md`.
