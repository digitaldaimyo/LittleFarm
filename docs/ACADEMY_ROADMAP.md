# Academy roadmap: from farm to creature-training puzzles

Status: **official** (all decisions agreed). It follows playtests by the developer, a reviewer and family members. It replaces the remaining phase 7 of `POLISH_ROADMAP.md`; phase 7's measures are folded in here.

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

8. **One currency, earned only in the Academy.** It comes from certifications and mastery stars, and is spent in the Homestead. Nothing else earns money, so nothing competes with the main loop.
9. **The Academy introduces cards; the Lab offers every card met so far.** There is no currency gate on Lab vocabulary. The Academy stays the teacher and the Lab stays free.
10. **Certification is reproducible.** A challenge trains and tests on fixed seeds, so the same lesson with the same pet gives the same result. A player never fails by luck. Each challenge ships with a reference solution that clears its bar with margin on several pets' temperaments, checked in tests (as the recipe sweep checks recipes).
11. **Show the destination from the start.** The Academy is a map of courses, with each rank exam visible but locked. Each pet has a certificate board and a rank. The Homestead shows what each certification unlocked. This answers "what am I working towards?" directly.
12. **No energy cost for challenges.** Practice time is the only pacing. Energy and naps remain Homestead flavour.
13. **A challenge may require a skill the pet already has, but only one an earlier challenge taught.** For example, a routine exam needs a certified Approach. The Academy always teaches it first, so the Lab is where a pet gets better, never where a player is forced to go. A requirement names the skill and the course that teaches it.

## The school (phase 0 framing)

- **Willowbrook Academy:** a small, cozy school at the edge of a village green, with a training yard, a library of cards and a ribbon wall.
- **Professor Hazel,** an old, unhurried tortoise who has trained pets for decades, is the mentor. She is warm and a little dry. She speaks when a course opens and when a new card appears, then steps back:
  > "Pip will only learn what you reward. Shall we see what you're rewarding?"
- **Ranks**, per pet: Novice → Apprentice → Journeypet → Adept → Master. A pet starts as a Novice and rises one rank with each course's exam.
- **Courses**, each ending in a rank exam that is visible from the start:

  | Course | About | Exam earns |
  |---|---|---|
  | First Steps | Going places, treats and SUCCESS | Apprentice |
  | Fetch and Carry | Carrying things where they belong | Journeypet |
  | Thinking Ahead | Senses, notes and measures | Adept |
  | Working Together | Routines that combine skills | Master |
  | A Day's Work | Responsibilities, several pets, a whole day | (an honour, not a rank) |

- **Certificates:** a passed challenge earns the pet a **rosette**. Each mastery star adds a **merit badge** to it. Rosettes hang on the pet's board at home.
- **Currency: acorns.** Earned from certificates and merit badges, spent in the Homestead.
- **Pets stay "pets":** no species names in the fiction.

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
**Status: done.**
- **The framing** is above (*The school*). `src/game/academy.ts` holds the school, ranks, courses, per-pet records and acorns.
- **New games are the academy edition:**
  - they open in Willowbrook Academy, whose map shows the five courses with their exams visible and locked;
  - each pet has a rank and a certificate board, and the header shows acorns;
  - tabs: Academy, Lab (the Teach screen), Homestead (the farm), Pets, Journal, Settings;
  - the Guide's notebook, glossary and card reference are the Academy's Library.
- **Saves** use the new `pen-deck-academy` format (v1) in a fresh storage slot; farm-edition saves are refused with a reason.
- **No farm economy in the academy edition:**
  - nothing sells, no requests board, no shop or Layout;
  - seeds are free, and nothing unlocks from coins;
  - practice in the Lab costs no energy;
  - adopting is free for now.

  Until the Academy introduces cards (phase 2), the Lab offers every card.
- **Kept until phase 6:** the farm edition stays reachable only from tests and benchmarks (`newGame()`), so existing tests keep guarding the shared engine.
- **Found and fixed:** with free seeds, pets never planted (an unset purse read as 0 coins).
- **Gate:** `tests/academy.test.ts` and the browser test (`npm run e2e`, part 1). A new game starts in the Academy; a skill saved in the Lab is on the pet's board, in its skills and usable at home; over a farm day no coins are earned, no requests posted, seeds are free, and produce still counts as flavour.

- Settle the proposed decisions above.
- Define the new save format (v1 of the Academy era).
- **The app shell:** Academy, Lab and Homestead tabs; pets and their skills shared across all three.
- **Gate:**
  - a new game starts in the Academy;
  - a skill saved in the Lab appears on the pet everywhere;
  - no farm-economy code runs.

### Phase 1: The challenge engine
**Status: done.**
- **`game/challenges.ts`:** a `ChallengeSpec` gives a base lesson whose pen, SUCCESS / FAIL, target, time per try and seeds are locked, the cards allowed, a bar, merit badges and a reference solution.
- **Locks:** the store restores a challenge's locked parts after any change, by any path, and certification refuses a lesson whose locked parts differ.
- **Allowed cards:** the hand offers only the challenge's cards (things, the pet, the target and "it" are always allowed). Certification also refuses others, so an imported lesson can't smuggle cards in.
- **Certification** refuses a run below the bar on the fixed test layouts, a flagged loophole, and an exam before the course's other rosettes.
- **Rewards:** a pass earns a rosette (5 acorns, plus 10 for an exam) and a merit badge per star: works in bigger pens, lean (senses), quick study (tries, in one fresh run), tidy (rules), 2 acorns each. Re-certifying pays only for new badges. An exam raises the pet's rank.
- **Course 1 (First Steps) ships four challenges:** *To the berry*, *Sit and stay*, *Keep clear*, and *The Apprentice exam* (berries among rocks in pens that change size). Phase 2 completes the track.
- **UI:** challenges are listed under their course on the Academy map. Open one in the Lab and it shows Hazel's brief, the locked pen and SUCCESS (🔒), and the badges to earn. Suggested rules are hidden in challenges. A finished report has **Certify**, which saves the skill on a pass.
- **Gate:** `tests/challenges.test.ts`:
  - the same lesson and pet give the same policy and result;
  - every shipped reference clears its bar by ≥ 10 points at three temperaments and certifies;
  - a flagged loophole is refused;
  - plus locks, allowed cards, badges, acorns and exam to rank.

  The browser test opens *To the berry*, is refused with no treats ("15% … the bar is 70%"), builds the rule, trains and certifies (a rosette, two badges, 9 acorns).
- **Found and fixed:**
  - the Keep clear reference needed *Far from* in course 1's cards and more practice for a margin at every temperament;
  - the certify result was lost on the store update (now kept in UI state per run);
  - opening a challenge now closes a finished report from another lesson.
- **For phase 2:** the Lab's Curriculum still lists the farm-era recipes, which contain challenge answers. Decide whether recipes open as challenges complete.

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

## Resolved questions

- **Hard limits or stars?** Stars (decision 5).
- **Certifications per pet or per player?** Per pet (decision 6).
- **Tone?** A school with ranks (decision 7).
- **Can a challenge require a skill from the Lab?** Yes, but only a skill an earlier challenge already taught (decision 13).
