# Academy roadmap: from farm to creature-training puzzles

Status: **draft for review** (decisions 1–7 agreed; 8–12 proposed). It follows playtests by the developer, a reviewer and family members. It replaces the remaining phase 7 of `POLISH_ROADMAP.md`; phase 7's measures are folded in here.

## Why

- **What works:** players love the teaching pens and training their pets.
- **What doesn't:** the game lacks direction and drive. Players couldn't picture where the farm was heading, or what they really wanted to do with it.
- **The cause:** the farm loop (build a farm → train pets to run it → expand it) has no destination. Coins only buy more farm.

## The new shape

**Train pets → solve increasingly interesting challenges → earn rewards → build a personal home for your pets → take on more ambitious challenges.**

The centre of gravity moves from farming simulation to a creature-training puzzle game, with three modes:

| Mode | Role | What it is |
|---|---|---|
| **Challenge Academy** | The main progression | Authored challenges: the pen and SUCCESS / FAIL are fixed; the player teaches the pet to meet them. Certifications, currency, unlocks, optional mastery stars. |
| **Training Laboratory** | Creative sandbox | The full Teach screen, with no economic pressure. Players build pens, invent tasks and train and save skills and routines, which they can then bring into challenges. |
| **Homestead** | Persistent personal space | Where progress shows. Decoration (the main currency sink), pets' personalities and collections, and pets doing what they have learned, naturally, in the world. |

The Academy teaches the systems players later use freely in the Lab. The Homestead gives progress a lasting, personal meaning.

## Decisions (agreed)

1. **A challenge fixes the pen and SUCCESS / FAIL.** The player may change everything else: rules, senses, abilities, practice, the learner, routine options.
2. **The farm economy does not survive.** Selling produce, the shop's farm items and requests go. The Homestead keeps farm life as rich flavour and is where currency is spent.
3. **Saves don't carry forward.** This is a clean break: a new save format, with no migration of farm-era saves.
4. **The Lab is the sandbox.** Skills and routines trained there are saved to the pet and can be used in challenges, e.g. a routine challenge that calls an Approach trained in the Lab.
5. **Stars over hard limits.** A challenge fixes only its pen and SUCCESS / FAIL. Constraints (sense or card budgets, practice budgets, transfer, no loophole) are optional mastery stars, so every challenge has a straightforward way through.
6. **Certifications are per pet.** Each pet earns its own certificates and rank, and shows them at home. Currency goes to the player's shared purse.
7. **A school with ranks.** The Academy is a school: courses (tracks) of challenges, each ending in a rank exam (the capstone, visible from the start). A mentor introduces each course and each new card. Pets rise in rank, e.g. Novice → Apprentice → Journeypet → Adept → Master, as they pass exams. Rank names and the mentor's character are settled in phase 0.

## Proposed decisions (to confirm)

8. **One currency, earned only in the Academy.** It comes from certifications and mastery stars, and is spent in the Homestead. Nothing else earns money, so nothing competes with the main loop.
9. **The Academy introduces cards; the Lab offers every card met so far.** There is no currency gate on Lab vocabulary. The Academy stays the teacher and the Lab stays free.
10. **Certification is reproducible.** A challenge trains and tests on fixed seeds, so the same lesson with the same pet gives the same result. A player never fails by luck. Each challenge ships with a reference solution that clears its bar with margin on several pets' temperaments, checked in tests (as the recipe sweep checks recipes).
11. **Show the destination from the start.** The Academy is a map of courses, with each rank exam visible but locked. Each pet has a certificate board and a rank. The Homestead shows what each certification unlocked. This answers "what am I working towards?" directly.
12. **No energy cost for challenges.** Practice time is the only pacing. Energy and naps remain Homestead flavour.

## Mapping what exists

| Existing | Becomes |
|---|---|
| Recipes, certification, held-out and transfer evaluation, loophole detection, report findings | The challenge engine and its feedback. Findings are the hint system. |
| Recipe sweep, layouts fixture | Proof that every challenge is solvable, and that its layouts don't drift |
| Field Guide lessons and comparisons | Academy track 1: the lessons become challenges, keeping their "try it the wrong way first" comparisons where they teach |
| Teach screen, lesson cards, skill cards, your cards | The Laboratory; lesson cards also become **challenge cards** (shareable player-made challenges) |
| Farm runtime, Layout, roster, pet cards, journal, sound | The Homestead: placement becomes decoration, and pets live there |
| Responsibilities, learned picks, "Check my order" | How pets spend their day at home, and the material for advanced Academy challenges (e.g. "run a farm day with these pets") |
| Temperament (curiosity, persistence, caution) | Visible personalities: they change how each pet learns, so which pet you choose matters |

Retired:
- the coin economy from produce;
- the shop's farm items and the requests board;
- the Field Guide as a separate tab (its lessons move into the Academy);
- energy costs for lessons;
- farm-era saves.

## Phases and gates

### Phase 0: Decisions and the new shell
- Settle the proposed decisions above.
- Define the new save format (v1 of the Academy era).
- **The app shell:** Academy, Lab and Homestead tabs; pets and their skills shared across all three.
- **Gate:**
  - a new game starts in the Academy;
  - a skill saved in the Lab appears on the pet everywhere;
  - no farm-economy code runs.

### Phase 1: The challenge engine
- **`ChallengeSpec`:** a locked pen and SUCCESS / FAIL; what the player may edit (cards allowed, budgets); a fixed seed set; a certification bar; mastery conditions; rewards; a reference solution.
- **Locked parts** are shown but can't be edited. The hand offers only allowed cards.
- **Mastery stars** come from things already measured:
  - certified;
  - within a sense or card budget;
  - passes the bigger transfer pens;
  - no loophole flagged;
  - within a practice budget.
- **Gate:**
  - the same lesson and pet always give the same certification result;
  - every shipped challenge's reference solution clears its bar with margin, at three temperaments, in tests;
  - a challenge can't be certified through a flagged loophole.

### Phase 2: Vertical slice, then playtest
- **Academy track 1:** about 8 challenges, each introducing one idea. Mostly existing recipes and Field Guide lessons, recast as challenges.
- **The Laboratory:** today's Teach screen.
- **A minimal Homestead:**
  - spend currency on a few decorations;
  - pets wander and do what they've certified;
  - each pet's certificate board.
- **Playtest measures (from polish phase 7):** local and opt-in. Time and tries per challenge, challenges abandoned or retried, findings shown and whether the next try improved. Exported only when the player chooses.
- **Gate:**
  - the browser test plays track 1 from a new game;
  - a playtest with the same group, compared against this round's feedback, especially on direction.

### Phase 3: Homestead depth
- **Decoration:** a catalogue, placement (reusing Layout's validation and previews), and themes.
- **Pets living there:**
  - they express certified skills through home responsibilities (tending, fetching, herding, patrolling);
  - personalities shown;
  - interactions (petting, play);
  - collections (things pets find or make).
- **Gate:**
  - every certified skill has a visible use at home;
  - decorations persist;
  - nothing at home affects challenge results.

### Phase 4: More Academy tracks
Tracks for:
- routines (bringing Lab-trained skills into challenges);
- notes and measures;
- qualifiers;
- several pets;
- capstones such as a full farm day with responsibilities and "Check my order".

Each track ends in a capstone that is visible from the start.

**Gate:** each track has a reference solution per challenge, and a difficulty curve checked by the playtest measures.

### Phase 5: Challenge cards
- Players export a Lab pen as a challenge (pen and SUCCESS fixed, with optional budgets) and play others' challenge cards. The engine is the same, but there's no currency from shared challenges.
- **Gate:** a challenge card round-trips. An imported challenge can't run code, and keeps its seeds and bar.

### Phase 6: Retire and document
- Remove the farm economy, the old Field Guide tab and the farm-era save paths.
- Rewrite `DESIGN.md` and `ARCHITECTURE.md` for the new shape, and move `POLISH_ROADMAP.md` to history.
- **Gate:**
  - no dead farm-economy code;
  - the docs test passes with the new list of retired behaviour.

## Open questions

1. **Can a challenge require a skill from the Lab?** E.g. a routine challenge that needs a certified Approach first. Or does the Academy always offer an in-challenge way to train it?

Resolved: stars over hard limits (5), certifications per pet (6), a school with ranks (7).
