# Tutorial review and update plan

**Goal:** turn the tutorial from "here are the buttons" into "here's how a good trainer thinks". By the end, a player should be able to set up a training pen for a behaviour *they* want, predict roughly whether it will work, read the evidence when it doesn't, and fix it.

Status: **All three phases shipped:** Chapter 1 revised; Field Guide engine and screen; lessons 2–9; notebook; glossary; coaching tips; requests-board side quests; a browser test (`npm run e2e`).

### Phase C: what shipped, and what we learned
- **Lesson 7, See what your pet learned** (offered once you've saved a skill you invented). The player opens the summary on Approach and on their own skill, uses "What does Pip do?" and taps a tile, reads the Journal's curiosities, and exports a skill card.
- **Lesson 8, Combine skills** (offered when routines unlock). A routine with a useless option (*Approach → rock*) that watches only "carrying" and "at the berry" scores **0% on 5/5 seeds, below random choices (15–20%)**: it can't tell when it's standing at the bin. Adding one watched condition, **"Is at → Bin"**, takes it to **85–95%**.
  - The fourth Fetch condition ("berry visible and empty-pawed") turned out to be unnecessary, so the lesson asks for just the one easy card.
  - Comparisons for routines use "random choices" as their baseline.
- **Lesson 9, Plan the farm** (offered after the routines lesson, or with 2 pets). The lesson adds a row, "Check on the well", at the bottom of the pet's plan, below "Otherwise wander". The preview shows it never runs. Moving it up and previewing again shows it runs. Then apply the plan and read a note about giving two pets different jobs.
- **Side quests:** every request on the neighbours' board shows a one-line "How:" and a link to the lesson that helps. The board also gets a new request, "Keep the orchard gate shut at nightfall", which points to the plans lesson.
- **Browser test** (`npm run e2e`, needs Playwright with Chromium): plays Chapter 1 card by card and the practice and scatter lessons with real clicks, and checks banners, comparisons, the Scattered layouts row, page errors and outside requests.
  - In one run: practice **55% → 80%**, scatter **25% → 90%**.
  - Real pets' curiosity varies, so the practice gap in play is smaller than in the headless measurements (36% → 96% at default temperament), but always clearly visible.

### Phase B: what shipped, and what we learned
- **Lesson 4, Pay for results** (offered when Fetch unlocks). The pickup experiment: **0% deliveries at ~100 treats per try**; after the "once per object" repair card, **~90% at ~11 treats per try**. The comparison card shows success *and* treats side by side.
- **Lesson 5, Practise where it works** (offered when Avoid unlocks and a pet has splashed through the pond). "Test my Approach here" (a button in the lesson banner, no training) vs Avoid trained in the pond pen: measured **40–60% vs 75–85%** on 5/5 seeds. It ends by switching the farm's "Move with" to Avoid.
- **Lesson 6, Invent a skill** (offered when your own skills unlock). The player adds the Stay ability and the Patience sense, uses the suggested rules, trains, then adds an unneeded sense and retrains.
  - **Surprise:** the planned extra sense, "Hazards nearby", costs *nothing* in a pen without ponds, because a sense that never changes never multiplies the situations. The lesson uses "How far is → Rock" instead (25,920 situations): 70–95% → 20–65% across seeds (mean −35 points).
  - Its pen uses training seed 202, where the gap is clearest (90% vs 20%). The text says "usually", since pets' curiosity varies.
- **Coaching tips** (`game/coach.ts`): pinned pen, loophole, below random, too little practice, poor transfer, too many situations, routine not beating random choices, and two pets on the same job. Each links to its lesson (hidden while you're in that lesson) and can be dismissed for good. The "too little practice" tip is suppressed when a loophole or pinning explains the score, because it misfired on the loophole experiment in testing.

### Phase A: what shipped, and what changed from the plan
- **Decisions taken:** contrast lessons, free Field Guide training, lessons offered in context, neutral voice, first treat rule built card by card (the suggested recipe sits behind "Stuck?").
- **Chapter 1** now has 10 steps. The tutorial pen starts with rocks but no berry, no rules and **no SUCCESS**, and the player builds all three. "Read the report" highlights the comparison rows and ends with "I've looked".
- **Lesson 3 (Scatter) needed a sharper contrast.** Pinning only the berry (with random rocks) gave 55–85% on new layouts, too unreliable for a lesson. A fully pinned pen (pet in one corner, berry in the other, rocks fixed) gives **15% on 5/5 seeds**, and scattering only the berry and start recovers **85–95%**.
- **A real gap found and fixed:** when a pen pins its target or start, every "new layout" is identical, so the report showed the pinned pet at ~100%. Reports now add a **Scattered layouts** row (target and start moved) plus a warning whenever pinning hides the problem, for every lesson, not only the tutorial.
- Old saves: a finished old tutorial maps to Chapter 1 done, and the Field Guide is offered. Settings has "Replay the first lesson", which resets its pen.

---

## 1. What the current tutorial does

Nine linear steps (`src/game/tutorial.ts`), shown as a banner with a step counter and *Skip tutorial*:

1. Adopt a pet → 2. Open the pen → 3. Put a berry in the pen → 4. Tap the suggested recipe → 5. Train Approach → 6. Compare before/after → 7. Save → 8. Assign *Forage* → 9. Earn 5 coins (unlocks Fetch).

### What works (keep)
- **It's real.** The player's own pet genuinely learns, and the report's numbers come from held-out layouts. That honesty is the game's best teacher.
- **Short and hands-on.** About 3 minutes to the first trained skill and the first coin.
- **It closes the loop:** teach → test → save → deploy → earn.
- **Scatter is the default**, and the step text says why in one line.

### What's missing
| Gap | Effect on the player |
|---|---|
| It teaches **which buttons**, not **why**. Rules come from one tap on a suggested recipe; the player never decides what earns a treat. | They copy recipes and get stuck the first time they invent something. |
| **Nothing goes wrong.** Every step succeeds, so the player never sees what a bad pen, bad reward or too little practice looks like. | When their own lesson fails, the report is unfamiliar territory. |
| The report is a step to tick off ("compare before/after"), not something to read. Random baseline, transfer, the success-vs-treats charts, the summary and the probe go unexplained. | The most important feedback in the game is skimmed. |
| It **stops at Fetch**. Avoid, your own skills (senses, abilities, survive lessons, "the target"), areas and creatures, routines, farm plans, two pets, skill cards and discovery tools are never introduced. | The deepest parts of the game are found by accident or not at all. |
| No **when**: it never connects "the farm has a problem" to "that's a reason to train something". | Training feels like a separate minigame rather than the way you run the farm. |
| One linear track, and **Skip is forever**. | Returning players can't brush up one topic. |
| **No reference** to come back to: no checklist, no glossary. | Players relearn the same lesson by failing twice. |
| Lessons cost energy, so a "try it the wrong way first" lesson would *cost* the player. | Experimentation feels punished, against the game's own principle. |

---

## 2. Evidence: what actually makes pens work in Pen Deck

Measured in this game, not borrowed from RL folklore. Training ran on 3 seeds, and testing used 30 held-out **scattered** layouts (the situations the pet meets for real). Reproduce with `npm run evidence` (`scripts/tutorial-evidence.ts`).

| Lesson | Evidence |
|---|---|
| **Scatter, don't pin.** Fixed positions teach *that* layout. | Scattered berry + random start: **96%**. Berry fixed + pet fixed (random rocks): **79%**. Berry fixed, pet random: **73%**. One fully pinned layout (pet, berry and rocks fixed): **15%** on 5/5 seeds; scattering just the berry and start recovers 85–95%. |
| **Pay for the result.** A treat for finishing is what matters; the "hurry up" nudge is a small helper. | Treat + nudge **96%**. Treat only **92%**. Nudge only, no treat: **12%**. |
| **Paying for effort misleads.** | "Treat for getting closer" (no step cost): **87%** vs 96%, and the rule checker warns (*shaping-loop*, *unbounded-reward*). Loophole recipes: *pay per pickup* → 0% deliveries (about 30 pickups per try); *pay per shoo* → 18% (about 30 shoos per try). "Once per object" fixes both (80–90%). |
| **Practice has a cliff.** Too few tries looks like failure. | 100 tries **33%** · 300 **36%** · 700 **83%** · 1,500 **96%** · 3,000 **96%**. |
| **Practise where it will work, with some variety, not maximum difficulty.** | Tested in cluttered pens (8 rocks): practised with 0 rocks **70%**, 3 rocks **86%**, 8 rocks **80%**. The orchard fence showed the same: Approach learned in open pens dithers beside fences. |
| **Fewer, better senses.** | *Water the garden*: adding "Walls nearby" dropped it from 60% to 10% at 4,000 tries. *Herd*: "where is chicken + where is coop" 55–70%; "where is a stray + coop seen from it" **85%**. |
| **Judge with the right baseline.** | *Morning chores*: the first version scored 85%, but so did random choices and the untrained routine. Only the "random choices" row exposed it. |
| **Plans: preview, then apply.** | The preview equals reality (tested), and it catches shadowed rows ("never ran") and fighting rows (switches per minute). |
| **Two pets: different jobs.** | Two foragers: 183 coins vs 178 for one. Forager + deliverer: **387**. |

These become the content of the lessons below, each experienced first-hand, and the **Trainer's notebook** (§5).

---

## 3. Design principles for the new tutorial

1. **Learn by contrast.** Where a mistake is instructive and cheap, the player makes it on purpose, sees the result in the report, then fixes it. The "aha" comes from their own numbers.
2. **One idea per lesson, 2–5 minutes each.** Every lesson ends with the pet more useful on the farm, not just with a lesson ticked off.
3. **Just in time.** Later lessons are *offered* when the farm creates the need (first pond splash → *Practise where it works*; first crow → *Invent a skill*; three saved skills → *Routines*), never forced.
4. **Never punish experiments.** Tutorial lessons cost no energy, contrast runs are labelled "experiment" (and not auto-saved), and nothing is lost by skipping.
5. **Teach to read the evidence.** Every lesson ends on the report, summary or preview with one specific thing to look at, highlighted.
6. **Plain words, consistent words.** *Treats* (reward), *success* (the SUCCESS condition), *new layouts* (held-out), *bigger pens* (transfer), *senses*, *practice tries*. Introduce each term once, at the moment it matters, and keep it in the glossary.
7. **Replayable and skippable per lesson,** from a **Field Guide** panel. Returning players can redo one topic.

---

## 4. Proposed structure

**Chapter 1: First lesson** (always on for new games; revised version of today's 9 steps) followed by the **Trainer's Field Guide**: eight short lessons, unlocked and offered in context. Every lesson lists its **trigger**, **what the player does**, the **contrast moment**, **what to notice** (highlighted in the UI) and a **done check** (state-based, like today).

### Chapter 1: First lesson (≈4 min)
Same arc as today, with the *why* added and one small contrast:
1. Adopt.
2. Open the pen. *"A pen is a practice world. What you put here is all your pet will ever see while learning."*
3. Put a berry in the pen (Scatter) and add a rock. *"The real farm has obstacles. Practise with some."*
4. **Decide what earns a treat** (no one-tap recipe): pick the *Reaches → Berry* event, then *+10 treats* and *End try (done)*. The recipe button stays available as a "show me" hint after 30 s.
5. Set SUCCESS: *"Treats are how your pet learns. SUCCESS is how **you** check it worked. They're different on purpose."*
6. Train, then **read the report together** (four highlighted callouts): new layouts never practised, Before vs Random vs After, Bigger pens (transfer), and the two charts rising together.
7. Save → Farm → Forage → earn 5 coins (as today).

### Field Guide lessons

| # | Lesson | Trigger (offered when…) | What the player does | Contrast moment | What to notice | Done when |
|---|---|---|---|---|---|---|
| 2 | **Read the report** | After Ch.1 | Train a 300-try experiment of the same lesson, then compare it with the 1,500-try one | 300 tries ≈ 35% vs ≈ 95% | The success chart's shape; "too little practice looks like failure"; *Refine* adds practice to an existing skill | Viewed both reports + used *Refine* or *Train fresh* once |
| 3 | **Scatter, don't pin** | After Ch.2 | Experiment: pin the berry and the start, train, check "new layouts", then switch back to Scatter | ≈75% vs ≈95% on new layouts; replay a failure | The probe ("What does Pip do?") on a layout where the pinned pet fails | Both runs viewed; probe opened |
| 4 | **Pay for results, not effort** | When Fetch unlocks | Train *Bring it home*, then the *Treat for every pickup* experiment, then apply the repair card | Treats rise while success falls; loophole replay | Ledger, "Loophole found!", the *Curious…* note, **limits** (once per object) | Repair applied and retrained; Fetch saved |
| 5 | **Practise where it works** | First pond splash on the farm (journal already notes it) | Avoid lesson: ponds in the pen, a FAIL condition, *Caution* temperament; switch the farm job to "Move with Avoid" | Farm preview: pond dips with Approach vs Avoid | Pond dips in the plan preview; transfer to bigger pens; "some variety, not maximum difficulty" | Avoid saved and in use; dips drop in a preview |
| 6 | **Invent a skill** | *Your own skills* unlocks | Build *Wait for it* from scratch: name it, choose senses (watch the situations meter), add Stay, write rules, train; then add one unnecessary sense and retrain | Extra sense → slower and worse learning at the same practice | Situations meter; *the target* (re-aim on the farm via *Run a skill*); *judge when time is up* for "keep doing" skills | Own skill certified and run on the farm |
| 7 | **See what your pet learned** | First own skill saved | Open the summary (heatmap, actions, endings, treat sources), the probe, and the journal's curiosities on two skills | Approach vs Wait for it heatmaps (on the target vs hovering on it) | Grey arrows = never practised exactly; exporting a skill card | Summary + probe viewed on 2 skills |
| 8 | **Combine skills (routines)** | 3+ saved skills | Build a routine with two useful and one useless option, watch one condition, train | Report row "Random choices" vs learned | Options use the **current** skill version; stale warnings | Routine certified above the random-choices row |
| 9 | **Plan the farm** | Routine saved, or 2 pets owned | Open the starter plan, preview, add a row, find the shadowed row, fix it, apply; then add a second pet on a *different* job | Preview before/after; two foragers vs forager + deliverer | "Never ran", "rows fight", guard; division of labour | Plan applied; second pet earning |

**Side quests via the requests board** (optional, no new tutorial UI): "herd the chicken back" (areas + *Area seen from…*), "keep the gate shut tonight" (Nudge + plan row), "water before the rain" (watering), each linking to the relevant Field Guide entry.

---

## 5. Trainer's notebook (in-game reference)

A Help panel reachable from the Teach screen, the report and the Farm, built from §2's evidence:

**Before you build:** *What job? Where will it run? What counts as done?*
1. **Pen:** Scatter things. Include what the job will meet (rocks, ponds, fences, gates, creatures), with some variety but not a maze.
2. **Treats:** pay for the result (+ end try). Add a small "hurry up" nudge. Be careful paying for actions (pick up, shoo, entering an area): add *once per object*.
3. **Success:** the condition *you* use to judge. It must mean the job is done.
4. **Senses** (your own skills): the fewest that decide the move. Watch the situations meter.
5. **Practice:** below ~700 tries most lessons look broken. Give time per try that fits the job.
6. **Judge:** new layouts vs random (and vs random choices for routines), bigger pens, then the summary and probe. If treats rise while success doesn't, look for a loophole.
7. **Deploy:** run it on the farm, preview plans, and retrain when the farm changes (expansions, new obstacles).

Plus a **glossary** (treats, success, try, new layouts, bigger pens, senses, abilities, situations, revision, routine, plan row).

---

## 6. Coaching tips (outside the lessons)

One-shot, dismissible, each linking to its Field Guide lesson. They are triggered by evidence the game already computes:

| Trigger | Tip |
|---|---|
| A movement or own skill trained with `place.fixed` for its target | "Pinned things teach one layout. Scatter them?" → Lesson 3 |
| After < bar **and** tries < 700 | "That may just be too little practice." → Lesson 2 |
| Transfer ≥ 25 points below After | "It struggles in bigger pens. Add variety to the practice pen?" → Lesson 5 |
| Loophole found / *Curious* note | Existing diagnostics plus a link → Lesson 4 / 7 |
| Situations meter > 50,000 | "Each sense multiplies practice." → Lesson 6 |
| Routine After within 10 points of Random choices | "The routine isn't choosing much yet." → Lesson 8 |
| Plan preview: rows never ran / fighting | Existing diagnostics plus a link → Lesson 9 |
| Two pets on the same job for 2 farm minutes | "They're sharing one supply. Different jobs earn more." → Lesson 9 |

---

## 7. Implementation outline

- **Model:** `game/tutorial.ts` → chapters `{ id, title, trigger(s), steps: {id, title, text, screen, highlight?, done(s)}[] }`. `progress.guide: Record<chapterId, 'locked'|'offered'|'active'|'done'|'skipped'>` plus the current step. Chapter 1 maps from today's `tutorialStep`, so existing saves migrate (v1 tutorial done → Ch.1 done, Field Guide offered).
- **Highlights:** `data-tut="…"` attributes on the key controls (Train, report rows, probe button, situations meter, preview), with a soft outline and an anchored callout replacing today's `pulse`.
- **Experiment runs:** the training session gains `experiment: true`, which costs no energy, isn't auto-saved, and shows an "Experiment" badge. Contrast pairs show side by side in the report ("Your 300-try run vs your 1,500-try run").
- **Field Guide panel:** a new Help/Guide screen (or a drawer from the top bar) with the lesson list, status, Start/Replay/Skip, the notebook and the glossary.
- **Coach tips:** `game/coach.ts`, pure functions from (stage, report, farm) → tips, with one-shot flags in `progress.flags`.
- **Tests:** each chapter's steps completed by a scripted game-level flow (as `farm.test.ts` does for today's tutorial); `npm run evidence` numbers recorded in `docs/TESTING.md`; a browser smoke test of Ch.1 and one Field Guide lesson.

## 8. Phasing

| Phase | Scope | Size |
|---|---|---|
| **A** | Chapter model, Field Guide panel, highlights, experiment runs; Ch.1 revised; Lessons 2–3; notebook + glossary | M |
| **B** | Lessons 4–6; coaching tips | M |
| **C** | Lessons 7–9; requests-board side quests; browser smoke tests | M |

Each phase ships on its own and keeps today's tutorial working until replaced.

## 9. Decisions needed
1. **Contrast lessons:** keep "do it the wrong way first" (recommended: it's the strongest teacher here, and experiments are free), or show the contrast pre-computed?
2. **Free tutorial training:** no energy cost for tutorial lessons and experiments? (Recommended.)
3. **Field Guide pacing:** *offered* in context (recommended), or a fixed sequence after Chapter 1?
4. **A guide character:** keep the neutral voice, or let one neighbour (e.g. Hazel) narrate the Field Guide for warmth?
5. **Chapter 1, step 4:** make players build the first reward rule card by card (recommended), or keep the one-tap recipe?
