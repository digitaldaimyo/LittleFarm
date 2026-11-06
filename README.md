# Pen Deck

A cozy, single-player pet-training farm game. You adopt a pet, teach it real skills in a training pen by building lessons out of typed cards, and put it to work on your farm. The learning is genuine: pets learn with **local reinforcement learning (tabular Double Q-learning)** in a Web Worker on your own device, and every number in the game comes from tries the pet actually ran, judged on layouts it never practised on.

- **Offline and private.** No accounts, servers, telemetry or paid APIs. Art is procedural SVG and sound is synthesized on the device. After the first load, the game runs with no network.
- **Real learning.** Untrained pets wander at random; trained pets beat the random baseline on held-out layouts. A pet does on the farm only what it has learned.
- **Your pets, their own skills.** Each pet keeps its own versioned skills, temperament and journal. Training one pet never trains another.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run build` | Typecheck and production build into `dist/` (static files; `npm run preview` serves them) |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm test` | Vitest: every unit and gate test (see `docs/TESTING.md`) |
| `npm run e2e:cards` / `npm run e2e` | Browser tests with real clicks: the card editor (about 20 s), or that plus all 13 Field Guide lessons (under 2 min). Run `npm run build` first; needs Playwright with Chromium |
| `npm run bench` / `npm run bench:farm -- --learned` | Pen and farm benchmarks on 5 seeds |
| `npm run cards:ref` | Regenerates `docs/CARD_REFERENCE.md` from the card registry |

Requires Node 18+ (developed on Node 22). No secrets or environment variables. CI runs typecheck, lint, the unit tests, a build and `e2e:cards` on every push.

## Your first hour

The Field Guide's *First lesson* walks you through it:
1. Adopt a pet.
2. Scatter a berry in the pen.
3. Build the treat rule and SUCCESS card by card, then train **Approach**.
4. Read the report: before, random and after, on 20 layouts your pet never saw. Then save the skill.
5. *Teach a job: Harvest* builds the farm's first job as a routine, and the first coins come in.
6. From there, lessons open as they become useful: Fetch, Avoid, your own skills, routines, responsibilities, the farm's layout, notes, and checking your order.

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/DESIGN.md`](docs/DESIGN.md) | What the game is and how it plays: teaching, the farm, responsibilities, progression, the Field Guide, principles and limitations |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How it's built: the typed spec and cards, the simulator, learning, the farm and its executive, saves, sound |
| [`docs/TESTING.md`](docs/TESTING.md) | Test suites, CI, the recipe sweep, benchmarks, performance and browser checks |
| [`docs/CARD_REFERENCE.md`](docs/CARD_REFERENCE.md) | Every card with its slots, settings and hint (generated; also searchable in the game's Guide) |
| [`docs/ACADEMY_ROADMAP.md`](docs/ACADEMY_ROADMAP.md) | The current roadmap: Challenge Academy, Training Laboratory and Homestead |
| [`docs/POLISH_ROADMAP.md`](docs/POLISH_ROADMAP.md) | The polish roadmap: phases 1–6 done; phase 7 folded into the Academy roadmap |
| [`docs/history/`](docs/history/README.md) | Finished plans and roadmaps, the architecture log and earlier measurements |
