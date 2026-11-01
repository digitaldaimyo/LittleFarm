# Tutorial review and update plan

**Goal:** turn the tutorial from "here are the buttons" into "here's how a good trainer thinks". By the end, a player should be able to set up a training pen for a behaviour *they* want, predict roughly whether it will work, read the evidence when it doesn't, and fix it.

Status: **plan for review.** Nothing below is implemented yet.

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
| **Scatter, don't pin.** Fixed positions teach *that* layout. | Scattered berry + random start: **96%**. Berry fixed + pet fixed: **79%**. Berry fixed, pet random: **73%**. |
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
