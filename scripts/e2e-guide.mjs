/**
 * Browser test of the whole Field Guide with real clicks.
 *  - Part 1 starts a new game and plays lessons 1–3 (first lesson, practice, scatter).
 *  - Part 2 imports a prepared save (built by scripts/e2e-save.ts: lessons 1–3 done, a certified Approach,
 *    Fetch/Avoid/own skills unlocked) and plays lessons 4–9.
 * Needs a build (`npm run build`) and Playwright with a Chromium browser available.
 * Run: npm run e2e            (both parts)
 *      npm run e2e -- --from=4 (part 2 only)
 *      npm run e2e:cards       (pen & card checks only, ~1 minute: editor, focus, your cards, sound)
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = require('playwright')); }

const PORT = 4179;
const CUE_COUNT = 45; // cues in src/audio/kit.ts
const URL = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
// --only=cards: just the pen & card checks (editor, focus, cards, sound) from the prepared save — no lessons.
const CARDS_ONLY = process.argv.includes('--only=cards');
const FROM = CARDS_ONLY ? 4 : Number(process.argv.find((a) => a.startsWith('--from='))?.slice(7) ?? 1);
const SAVE = join(mkdtempSync(join(tmpdir(), 'pen-deck-e2e-')), 'lessons-4-9.json');
const failures = [];
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failures.push(what); };
const errors = [], external = [];
let lastPage = null;
const watch = (page) => {
  lastPage = page;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(URL)) external.push(r.url()); });
};

try {
  console.log(execFileSync('npx', ['vite-node', 'scripts/e2e-save.ts', SAVE], { encoding: 'utf8' }).trim());
  for (let i = 0; i < 50; i++) { try { await fetch(URL); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const browser = await chromium.launch();
  if (FROM <= 3) {
  console.log('\nPart 1: lessons 1–3 from a new game');
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  watch(page);
  const banner = async () => (await page.textContent('.tutorial').catch(() => '')).replace(/\s+/g, ' ');
  const report = async () => { await page.waitForSelector('text=Lesson report', { timeout: 90000 }); await page.waitForTimeout(300); };

  // Chapter 1
  await page.goto(URL);
  const au = () => page.evaluate(() => window.__penDeckAudio);
  check((await au()).contexts === 0, 'sound: no AudioContext before the first click');
  await page.click('text=Adopt Pip');
  await page.waitForTimeout(300);
  const a0 = await au();
  check(a0.contexts === 1 && a0.cues.includes('pet.adopt'), 'sound: audio starts on the first click (adopt chirp)');
  check((await banner()).includes('Open the training pen'), 'Chapter 1 starts after adopting');
  await page.click('.nav-btn:has-text("Teach")');
  await page.click('[data-tut="env-berry"]');
  await page.click('rect.tile >> nth=20');
  check(await page.waitForSelector('.toast:has-text("Sound is on")', { timeout: 4000 }).then(() => true, () => false), 'sound: one-time “Sound is on” note with the first sound');
  await page.click('.tab:has-text("Rules")');
  check((await banner()).includes('Decide what earns a treat'), 'asks the player to build the treat rule');
  await page.click('[data-tut="add-rule"]');
  await page.click('.sleeve .card:has-text("Reaches")');
  await page.click('.sleeve .card:has-text("Berry")');
  await page.click('.rule-line:has-text("THEN") .slot');
  await page.click('.sleeve .card:has-text("Treat")');
  await page.click('.rule-line:has-text("THEN") .slot:has-text("+ effect")');
  await page.click('.sleeve .card:has-text("End try")');
  await page.click('[data-tut="success-slot"] .slot');
  await page.click('.sleeve .card:has-text("Is at")');
  await page.click('.sleeve .card:has-text("Berry")');
  check((await banner()).includes('Train Approach'), 'rule and SUCCESS built card by card');
  await page.click('[data-tut="train-btn"]');
  await report();
  check((await banner()).includes('Read the report'), 'report step after training');
  await page.click('.tutorial button:has-text("I’ve looked")');
  await page.click('[data-tut="save-skill"]');
  const waitBanner = (t) => page.waitForFunction((x) => document.querySelector('.tutorial')?.textContent?.includes(x), t, { timeout: 5000 }).then(() => true, () => false);
  check(await waitBanner('Next: teach it a job'), 'Chapter 1 ends by pointing to the first job');
  await page.click('.nav-btn:has-text("Farm")');
  check(/Can’t do any farm job yet/.test(await page.textContent('[data-tut="job-auto"]')), 'Auto can’t do any farm job until Harvest is taught (no built-in jobs)');
  await page.click('.tutorial button:has-text("I’ve looked")');
  // Teach a job: Harvest (learned farm) — a routine from cards, trained in its own pen.
  check(await waitBanner('A routine from cards'), 'Harvest lesson starts after the first lesson');
  await page.click('.nav-btn:has-text("Teach")');
  await page.click('[data-tut="train-btn"]');
  await report();
  await page.click('[data-tut="save-skill"]');
  check(await waitBanner('Put it to work'), 'Harvest saved; the lesson asks to put it to work');
  await page.click('.tutorial button:has-text("Go to the Farm")');
  check(/Can do: Harvest/.test(await page.textContent('[data-tut="job-auto"]')), 'Auto can harvest once Harvest is taught');
  await page.click('[data-tut="job-auto"]');
  await page.click('.speed button:has-text("4×")');
  // (The "Earn 5 coins" step itself mentions the Field Guide, so wait for the lesson-finished banner's button.)
  await page.waitForSelector('.tutorial button:has-text("Open the Guide")', { timeout: 120000 });
  check(true, 'Harvest lesson finished after earning 5 coins with the learned Harvest; a new lesson is offered');

  // Lesson: practice
  await page.click('.tutorial button:has-text("Open the Guide")');
  await page.click('.guide-item:has-text("practice") button:has-text("Start")');
  await page.click('.nav-btn:has-text("Teach")');
  await page.click('[data-tut="train-btn"]');
  await report();
  await page.click('.training button:has-text("Discard")');
  await page.click('.tab:has-text("Pet")');
  await page.locator('[data-tut="practice-slider"] input[type=range]').fill('1500');
  await page.click('[data-tut="train-btn"]');
  await report();
  await page.click('.tutorial button:has-text("Go to the Guide")');
  const cmp = await page.textContent('[data-tut="guide-compare"]');
  check(cmp.includes('300 tries') && cmp.includes('1500 tries'), 'practice comparison shows both runs');
  console.log('   practice comparison:', cmp.replace(/\s+/g, ' ').slice(0, 160));
  await page.click('[data-tut="guide-compare"] button:has-text("Got it")');

  // Lesson: scatter
  await page.click('.guide-item:has-text("Scatter") button:has-text("Start")');
  await page.click('.nav-btn:has-text("Teach")');
  await page.click('[data-tut="train-btn"]');
  await report();
  check((await page.textContent('.compare')).includes('Scattered layouts'), 'pinned pen report adds the Scattered layouts row');
  await page.click('[data-tut="replay-miss"]');
  await page.click('.training button:has-text("Discard")');
  await page.click('.tab:has-text("Environment")');
  await page.click('[data-tut="placements"] button:has-text("Scatter this")');
  await page.click('[data-tut="placements"] button:has-text("Random start")');
  await page.click('[data-tut="train-btn"]');
  await report();
  await page.click('.tutorial button:has-text("Go to the Guide")');
  const cmp2 = (await page.textContent('[data-tut="guide-compare"]')).replace(/\s+/g, ' ');
  console.log('   scatter comparison:', cmp2.slice(0, 160));
  check(cmp2.includes('Pinned pen') && cmp2.includes('Scattered pen'), 'scatter comparison shows both pens');
  await page.click('[data-tut="guide-compare"] button:has-text("Got it")');
  check((await page.textContent('.guide-list')).includes('Pay for results'), 'later lessons listed');
  const a1 = await au();
  check(a1.rendered === CUE_COUNT && a1.state === 'running', `sound: all ${CUE_COUNT} cues rendered, audio running (${a1.rendered}, ${a1.state})`);
  check(a1.quiet.length === 0, `sound: no cue renders as silence ${a1.quiet.length ? JSON.stringify(a1.quiet) : ''}`);
  const loops = a1.loops;
  check(['day', 'night', 'rain'].every((k) => loops[k] > 0.002 && loops[k] < 0.2), `sound: ambience loops rendered at a gentle level (RMS ${JSON.stringify(loops)})`);
  const want1 = ['card.flick', 'card.snap', 'pen.place', 'train.start', 'skill.save', 'farm.pickup', 'farm.coin', 'pet.chirp'];
  const missing1 = want1.filter((c) => !a1.cues.includes(c));
  check(!missing1.length && (a1.cues.includes('train.certified') || a1.cues.includes('train.notCertified')), `sound: lessons 1–3 cues played ${missing1.length ? `(missing ${missing1.join(', ')})` : ''}`);
  await page.close();
  }

  console.log(CARDS_ONLY ? '\nPen & card checks from a prepared save (no lessons)' : '\nPart 2: lessons 4–14 from a prepared save');
  // ── Lessons 4–9, from a prepared save (lessons 1–3 done, certified Approach, Fetch/Avoid/own skills unlocked)
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page);
    const report = async () => { await page.waitForSelector('text=Lesson report', { timeout: 180000 }); await page.waitForTimeout(300); };
    const nav = (n) => page.click(`.nav-btn:has-text("${n}")`);
    // Leave a finished report: "Discard" if unsaved, "Close" once saved.
    const discard = async () => { const d = page.locator('.training .actions button:has-text("Discard"), .training .actions button:has-text("Close")'); if (await d.count()) await d.first().click(); };
    const tab = async (n) => { await discard(); await page.click(`.tab:has-text("${n}")`); };
    const train = async () => { await discard(); await page.click('[data-tut="train-btn"]'); await report(); };
    const looked = () => page.click('.tutorial button:has-text("I’ve looked")');
    const start = async (title) => { await nav('Guide'); await page.click(`.guide-item:has-text("${title}") button:has-text("Start")`); };
    const compareInGuide = async () => {
      await nav('Guide');
      const t = (await page.textContent('[data-tut="guide-compare"]')).replace(/\s+/g, ' ');
      await page.click('[data-tut="guide-compare"] button:has-text("Got it")');
      return t;
    };
    // Steps can advance a moment after the click (e.g. <details> toggle events are async), so wait briefly.
    const step = async (title, what) => check(await page.waitForFunction((t) => document.querySelector('.tutorial')?.textContent?.includes(t), title, { timeout: 3000 }).then(() => true, () => false), what);
    const lessonDone = async (title) => { await nav('Guide'); check((await page.textContent(`.guide-item:has-text("${title}")`)).includes('done'), `lesson “${title}” marked done`); };

    await page.goto(URL);
    await page.click('text=Adopt Pip'); // the save import replaces this pet
    await nav('Settings');
    await page.setInputFiles('input[type=file]', SAVE);
    await page.waitForTimeout(400);
    await page.selectOption('label:has-text("Default training speed") select', 'fast');
    await nav('Guide');
    const list = await page.textContent('.guide-list');
    check(['Pay for results', 'Practise where it works', 'Invent a skill'].every((t) => list.includes(t)) && (await page.locator('.guide-item:has-text("Pay for results") button:has-text("Start")').count()) === 1, 'prepared save: lessons 4–6 offered');
    check(list.includes('Opens once you’ve saved a skill you invented'), 'locked lessons say what opens them');

    if (!CARDS_ONLY) { // lessons 4–14 and the roster (skipped by --only=cards)
    // Lesson 4: Pay for results, not effort
    await start('Pay for results');
    await nav('Teach');
    await train();
    check((await page.textContent('[data-tut="report-exploit"]')).includes('Loophole found'), 'L4: loophole run flagged “Loophole found!”');
    await page.waitForTimeout(3000); // watch the replay of the loophole for a moment (it plays with sound)
    const heard = await page.evaluate(() => window.__penDeckAudio.cues);
    check(heard.includes('farm.drop') && heard.includes('farm.pickup'), 'sound: the loophole replay is heard (pick up, put down, again…)');
    await step('Treats up, success down', 'L4: asks the player to read the loophole');
    await looked();
    await page.click('[data-tut="repair-card"]');
    await step('Train the repaired lesson', 'L4: repair card applied');
    await train();
    const c4 = await compareInGuide();
    console.log('   L4 comparison:', c4.slice(0, 170));
    check(c4.includes('Treat every pickup') && c4.includes('Once per object'), 'L4: comparison shows the loophole and repaired runs');
    const a4 = await page.evaluate(() => window.__penDeckAudio.cues);
    check(a4.includes('card.repair'), 'sound: the repair card clinks');
    await nav('Teach');
    await page.click('[data-tut="save-skill"]');
    await lessonDone('Pay for results');

    // Lesson 5: Practise where it works
    await start('Practise where it works');
    await nav('Teach');
    await page.click('.tutorial button:has-text("Test my Approach here")');
    await step('Train Avoid', 'L5: “Test my Approach here” runs the test from the banner');
    await train();
    const c5 = await compareInGuide();
    console.log('   L5 comparison:', c5.slice(0, 170));
    check(c5.includes('Approach') && c5.includes('Avoid'), 'L5: comparison shows tested Approach vs trained Avoid');
    await nav('Teach');
    await page.click('[data-tut="save-skill"]');
    await nav('Farm');
    await page.click('[data-tut="nav-avoid"]');
    await lessonDone('Practise where it works');

    // Lesson 6: Invent a skill
    await start('Invent a skill');
    await nav('Teach');
    await tab('Pet');
    await page.click('[data-tut="abilities"] button:has-text("Stay")');
    await page.click('[data-tut="senses"] .slot:has-text("+ sense")');
    await page.click('.sleeve .card:has-text("Patience")');
    await step('Add the rules', 'L6: Stay ability and Patience sense added');
    // Looser limits: the Big brain raises the situations budget; the estimate is shown; back to Standard.
    await page.click('[data-tut="brain"] button:has-text("Big")');
    check((await page.textContent('[data-tut="senses"] + .budget')).includes('of 2,000,000'), 'limits: the Big brain raises the budget to 2,000,000 situations');
    check((await page.locator('[data-tut="estimate"]').count()) === 1, 'limits: a training-time estimate is shown');
    await page.click('[data-tut="brain"] button:has-text("Standard")');
    await tab('Rules');
    await page.click('[data-tut="suggested"] .suggest');
    await train();
    await tab('Pet');
    await page.click('[data-tut="senses"] .slot:has-text("+ sense")');
    await page.click('.sleeve .card:has-text("How far is")');
    await page.click('.sleeve .card:has-text("Rock")');
    check((await page.textContent('[data-tut="senses"]')).includes('Rock'), 'L6: “How far is…” aimed at Rock (the playtest bug)');
    await train();
    const c6 = await compareInGuide();
    console.log('   L6 comparison:', c6.slice(0, 170));
    check(c6.includes('Lean senses') && c6.includes('With the extra sense'), 'L6: comparison shows lean vs extra sense');
    await nav('Teach');
    await tab('Pet');
    await page.click('[data-tut="senses"] .node-handle[aria-label^="Edit How far"]');
    await page.click('.sleeve button:has-text("Remove")');
    check(!(await page.textContent('[data-tut="senses"]')).includes('Rock'), 'L6: extra sense removed');
    await train();
    await page.click('[data-tut="save-skill"]');
    await lessonDone('Invent a skill');

    // Lesson 7: See what your pet learned
    await start('See what your pet learned');
    await nav('Pets');
    // Work out any missing summaries, then open every summary (Approach and the invented skills).
    for (let i = 0; i < 20 && (await page.locator('button[data-tut="summary"]').count()); i++) await page.locator('button[data-tut="summary"]').first().click();
    for (let i = 0; i < 20 && (await page.locator('details[data-tut="summary"]:not([open]) > summary').count()); i++) await page.locator('details[data-tut="summary"]:not([open]) > summary').first().click();
    await step('Ask “What does Pip do?”', 'L7: summaries opened for Approach and an invented skill');
    check(await page.locator('details[data-tut="summary"][open] svg').count() > 0, 'L7: a behaviour summary heatmap is drawn');
    await nav('Teach');
    await page.click('[data-tut="probe"]');
    await page.click('rect.tile >> nth=9');
    await step('Read the curiosities', 'L7: probe used and a tile tapped');
    await nav('Journal');
    await looked();
    await nav('Pets');
    const dl = page.waitForEvent('download');
    await page.click('[data-tut="export-card"] >> nth=0');
    const card = JSON.parse(await (await import('node:fs/promises')).readFile(await (await dl).path(), 'utf8'));
    check(card.format === 'pen-deck-skill', 'L7: skill card exported as a pen-deck-skill file');
    await lessonDone('See what your pet learned');

    // Lesson 8: Combine skills (routines)
    await start('Combine skills');
    await nav('Teach');
    await train();
    await step('Worse than random choices', 'L8: the 2-condition routine trained');
    const r8 = (await page.textContent('[data-tut="report-compare"]')).replace(/\s+/g, ' ');
    check(r8.includes('Random choices'), 'L8: report compares with random choices');
    await looked();
    await tab('Pet');
    await page.click('[data-tut="watches"] .slot:has-text("+ condition")');
    await page.click('.sleeve .card:has-text("Is at")');
    await page.click('.sleeve .card:has-text("Basket")');
    await step('Train it again', 'L8: “Is at → Basket” added to Watches');
    await train();
    const c8 = await compareInGuide();
    console.log('   L8 comparison:', c8.slice(0, 170));
    const pct = (label) => Number((c8.split(label)[1] ?? '').match(/(\d+)%/)?.[1] ?? -1);
    check(pct('Watching 3') > pct('Watching 2'), `L8: watching the bin beats watching 2 things (${pct('Watching 2')}% → ${pct('Watching 3')}%)`);
    await nav('Teach');
    await page.click('[data-tut="save-skill"]');
    await lessonDone('Combine skills');

    // Lesson 9: Responsibilities (the farm plan grew into them in learned-farm phase 4)
    await start('Responsibilities');
    await nav('Farm');
    await page.click('[data-tut="plan-edit"]');
    await page.click('[data-tut="plan-preview"]');
    const p1 = (await page.textContent('.plan-mat')).replace(/\s+/g, ' ');
    check(/Check on the well — never ran/.test(p1), 'L9: preview shows the shadowed row never runs');
    const rowNames = () => page.$$eval('[data-tut="plan-rows"] > li input[aria-label="Row name"]', (els) => els.map((e) => e.value));
    // Press ↑ on “Check on the well” and preview, until the preview shows it runs (as the lesson says).
    const wellRow = async () => page.locator('[data-tut="plan-rows"] > li').nth((await rowNames()).indexOf('Check on the well'));
    let ran = false, moves = 0;
    while (!ran && (await rowNames()).indexOf('Check on the well') > 0) {
      await (await wellRow()).locator('button[aria-label="Move up"]').click();
      moves++;
      if ((await rowNames()).indexOf('Check on the well') > (await rowNames()).indexOf('Otherwise nap')) continue;
      await page.click('[data-tut="plan-preview"]');
      ran = /Check on the well — ran \d+×/.test((await page.textContent('.plan-mat')).replace(/\s+/g, ' '));
    }
    console.log(`   moved up ${moves}×: ${(await rowNames()).join(' | ')}`);
    check(ran, 'L9: moved high enough, the row runs in the preview');
    await step('Tidy up and use them', 'L9: asks to tidy up the experiment responsibility');
    await (await wellRow()).locator('button[aria-label="Delete row"]').click();
    await page.click('[data-tut="plan-apply"]');
    check(!(await rowNames()).includes('Check on the well'), 'L9: experiment deleted and the responsibilities used');
    check(/Why Pip is doing what they do/.test(await page.textContent('.plan-mat')), 'L9: the decision trace explains what the pet is doing');
    await looked();
    await lessonDone('Responsibilities');

    // Lesson 10: Lay out the farm (farm life phase C)
    await start('Lay out the farm');
    await nav('Farm');
    await page.click('[data-tut="layout-btn"]');
    check((await page.textContent('.layout-panel')).includes('farm paused'), 'L10: layout mode opens and pauses the farm');
    const tick0 = await page.textContent('.clock');
    await page.click('[data-tut="layout-bin"]');
    for (const [x, y] of [[9, 2], [8, 1], [10, 1], [10, 4], [9, 5], [11, 5], [10, 6]]) {
      await page.click(`[aria-label="Layout: tile ${x},${y}"]`);
      if ((await page.textContent('.layout-panel')).includes('placed a basket')) break;
    }
    await step('Preview it', 'L10: a basket placed by the bushes');
    await page.click('[data-tut="layout-preview"]');
    const lp = (await page.textContent('.layout-preview')).replace(/\s+/g, ' ');
    console.log(`   ${lp}`);
    check(/as it is -?\d+ coins · your layout -?\d+ coins/.test(lp), 'L10: preview compares the farm as it is with the draft');
    check((await page.textContent('.clock')) === tick0, 'L10: the farm stayed paused while editing');
    await step('Bring a crop closer', 'L10: asks to bring a crop closer');
    await page.click('[data-tut="layout-remove"]');
    for (const [x, y] of [[9, 2], [8, 1], [10, 1], [10, 4], [9, 5], [11, 5], [10, 6]]) {
      await page.click(`[aria-label="Layout: tile ${x},${y}"]`);
      if ((await page.textContent('.layout-panel')).includes('removed a basket')) break;
    }
    check((await page.textContent('.layout-panel')).includes('Costs 0'), 'L10: removing the basket placed in this draft is free');
    await page.click('[data-tut="layout-move"]');
    await page.click('[aria-label="Layout: tile 9,1"]'); // a berry bush
    for (const [x, y] of [[2, 1], [2, 2], [3, 2], [1, 3], [3, 3]]) {
      await page.click(`[aria-label="Layout: tile ${x},${y}"]`);
      if ((await page.textContent('.layout-panel')).includes('moved the berry bush')) break;
    }
    await page.click('[data-tut="layout-preview"]');
    const lp2 = (await page.textContent('.layout-preview')).replace(/\s+/g, ' ');
    console.log(`   ${lp2}`);
    await step('Keep the better farm', 'L10: bush moved next to the house and previewed');
    if (await page.isEnabled('[data-tut="layout-apply"]')) {
      await page.click('[data-tut="layout-apply"]');
      check((await page.locator('.layout-panel').count()) === 0, 'L10: the layout is applied');
    } else await looked();
    await looked();
    await lessonDone('Lay out the farm');

    // Lesson 11: Give your pet a notebook (looser limits, phase B)
    await start('Give your pet a notebook');
    await nav('Teach');
    await train();
    await step('Lost at the well', 'L11: trained Patrol without the note');
    await looked();
    await tab('Pet');
    await page.click('[data-tut="senses"] .slot:has-text("+ sense")');
    await page.click('.sleeve .card:has-text("Note")');
    check((await page.inputValue('.sleeve input[list="note-names"]')) === 'leg', 'L11: the new Note sense is already named “leg”');
    await page.click('.sleeve button[aria-label="Increase Counts up to"]');
    await step('Train it again', 'L11: Note sense “leg” counting up to 2 added');
    await train();
    const c11 = await compareInGuide();
    console.log('   L11 comparison:', c11.slice(0, 170));
    check(c11.includes('Can’t read the note') && c11.includes('Reads the note'), 'L11: comparison shows without vs with the note');
    await nav('Teach');
    await page.click('[data-tut="save-skill"]');
    await lessonDone('Give your pet a notebook');

    // Lesson 14: Let them choose (learned-farm phase 5: the learned executive)
    await start('Let them choose');
    await nav('Farm');
    await page.click('[data-tut="job-auto"]');
    await page.click('[data-tut="exec-learned"]');
    await step('Practise deciding', 'L14: “Learns what pays off” chosen');
    // Polish phase 2: practice runs in a worker, with progress and Stop.
    await page.click('[data-tut="exec-practise"]');
    check(await page.waitForSelector('[data-tut="exec-progress"]', { timeout: 5000 }).then(() => true, () => false), 'L14: practice shows its progress');
    await page.click('[data-tut="exec-cancel"]');
    check(await page.waitForSelector('[data-tut="exec-note"]:has-text("Practice stopped")', { timeout: 5000 }).then(() => true, () => false) && !(await page.$('[data-tut="exec-compare"]')), 'L14: Stop ends practice with no comparison');
    // Gate: while it practises, no task on the page's thread takes over 100 ms.
    await page.evaluate(() => {
      window.__long = [];
      window.__longObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); });
      window.__longObs.observe({ type: 'longtask' });
    });
    await page.click('[data-tut="exec-practise"]');
    const cmpShown = await page.waitForSelector('[data-tut="exec-compare"]', { timeout: 60000 }).then(() => true, () => false);
    check(cmpShown, 'L14: practice runs and the comparison appears');
    const longTasks = await page.evaluate(() => { window.__longObs.disconnect(); return window.__long; });
    console.log('   L14 long tasks during practice (ms):', longTasks.length ? longTasks.join(', ') : 'none');
    check(longTasks.every((d) => d <= 100), 'L14: the page stays responsive while practising (no task over 100 ms)');
    const cmpText = cmpShown ? (await page.textContent('[data-tut="exec-compare"]')).replace(/\s+/g, ' ') : '';
    console.log('   L14 comparison:', cmpText.slice(0, 200));
    check(/In your order/.test(cmpText) && /Learned picks/.test(cmpText) && /Random picks/.test(cmpText), 'L14: comparison shows your order, learned picks and random picks');
    await step('Read the comparison', 'L14: asks to read the comparison');
    await looked();
    await lessonDone('Let them choose');
    await nav('Guide');
    check((await page.locator('.guide-item.done').count()) === 13, 'all 13 Field Guide lessons done');

    // Pet roster (farm life D): tap the house, adopt a second pet, put it on duty, see its card, tap a basket.
    await nav('Farm');
    await page.click('[aria-label="Farm tile 1,1"]');
    check((await page.locator('.modal.roster').count()) === 1, 'roster: tapping the house opens the roster');
    const coinsNow = Number((await page.textContent('.modal.roster .row.between .small'))?.match(/\d+/)?.[0] ?? 0);
    console.log(`   ${coinsNow} coins at the roster`);
    await page.click('.modal.roster button:has-text("Adopt another pet")');
    await page.fill('.modal input', 'Mochi');
    await page.click('.modal button:has-text("Adopt (20 coins)")');
    await page.click('[data-tut="roster-btn"]');
    await page.click('[data-tut="duty-Mochi"]');
    check((await page.textContent('.modal.roster')).includes('On duty (2/4)'), 'roster: Mochi is put on duty (2 of 4)');
    await page.click('.modal.roster button[aria-label="Close"]');
    await page.waitForTimeout(800);
    check((await page.locator('.world [aria-label="Mochi"]').count()) === 1, 'roster: Mochi appears on the farm');
    await page.click('.roster-chip:has-text("Mochi")');
    check((await page.textContent('[data-tut="pet-card"] .pet-name')) === 'Mochi', 'roster: the strip opens Mochi’s card');
    // The basket may have been carried next to the crops: find it by its count badge.
    const [bx, by] = await page.$eval('.store-badge', (g) => { const m = g.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/); return [Math.round((+m[1] - 10) / 40), Math.round((+m[2] - 1) / 40)]; });
    await page.click(`[aria-label="Farm tile ${bx},${by}"]`);
    check(/^Basket: /.test(await page.textContent('.inspect span')), 'farm: tapping the basket shows what is in it');
    await page.click('[data-tut="duty-toggle"]');
    check((await page.locator('.world [aria-label="Mochi"]').count()) === 0, 'roster: off duty, Mochi goes home');
    await page.click('.roster-chip:has-text("Pip")');
    check(!/Basket run/.test(await page.textContent('[data-tut="job-auto"]')), 'baskets: no basket runs without a Basket run routine (Fetch alone isn’t enough: no built-in jobs)');
    await page.click('[data-tut="pet-card"] button:has-text("Teach Pip")'); // Pip is the active pet again for what follows

    } // end of lessons 4–14 and the roster
    // Teaching polish (phase A): build "end on shoo chicken" the old way, get warned, repair it, train it.
    await nav('Teach');
    await tab('Curriculum');
    await page.click('.suggest:has-text("Herd a chicken")');
    await tab('Rules');
    await page.click('[data-tut="add-rule"]');
    await page.click('.sleeve .card:has-text("Shoos")');
    await page.click('.sleeve .card:has-text("Chicken")');
    const newRule = page.locator('.binder-body .rule:not(.success-row):not(.fail-row)').last();
    await newRule.locator('.slot:has-text("+ effect")').click();
    await page.click('.sleeve .card:has-text("End try")');
    check((await newRule.textContent()).includes('Reads: When Pip shoos chicken: end try (judged by SUCCESS)'), 'polish: a new rule reads back as a sentence');
    // Editor focus (pen & cards phase 4): IF Compare(Stored(…) ≥ …) built without closing anything by hand.
    const pickCard = async (title) => {
      const vis = page.locator(`.sleeve .hand-row .card:has-text("${title}")`).first();
      if (!(await vis.isVisible().catch(() => false))) await page.click('.sleeve details.more > summary');
      await page.locator(`.sleeve .card:has-text("${title}")`).first().click();
    };
    await newRule.locator('.slot:has-text("+ condition")').click();
    await pickCard('Compare');
    check(/Measure/.test(await page.textContent('.sleeve .eyebrow')), 'focus: picking Compare jumps into its Measure slot');
    await pickCard('Stored');
    check(/What/.test(await page.textContent('.sleeve .eyebrow')), 'focus: picking Stored jumps into its What slot (optional “In this one” is skipped)');
    await page.locator('.sleeve .hand-row .card:not([disabled])').first().click();
    check((await page.locator('[data-tut="sleeve-done"]').count()) === 1 && (await page.locator('.sleeve .hand').count()) === 0, 'focus: with nothing required left, only Compare’s settings stay (the hand is tucked away)');
    await page.click('[data-tut="sleeve-done"]');
    check((await page.locator('.sleeve').count()) === 0, 'focus: Done closes the picker');
    check(/stored in any storage/.test(await newRule.textContent()), 'focus: the nested condition reads back');
    await newRule.locator('.slot:has-text("+ condition")').click();
    await page.keyboard.press('Escape');
    check((await page.locator('.sleeve').count()) === 0, 'focus: Escape closes the picker');
    await newRule.locator('.slot:has-text("+ condition")').click();
    await page.mouse.click(5, 5);
    check((await page.locator('.sleeve').count()) === 0, 'focus: a tap outside closes the picker');
    // Leave the recipe as it was for what follows: remove the experiment condition.
    await newRule.locator('.node-handle[aria-label="Edit Compare"]').click();
    await page.click('.sleeve button:has-text("Remove")');
    await page.click('[data-tut="success-slot"] .node-handle');
    await page.click('.sleeve button:has-text("Remove")');
    await page.click('[data-tut="success-slot"] .slot');
    await page.click('.sleeve details.more > summary');
    await page.click('.sleeve .card:has-text("Is near")');
    await page.click('.sleeve .card:has-text("Chicken")');
    // The new rule is "Rule 3" (the recipe has two). Its warning is the one about the shoo.
    const warned = await page.waitForSelector('.diag:has-text("Rule 3"):has-text("ever fired")', { timeout: 5000 }).then(() => true, () => false);
    check(warned, 'polish: the measured check warns that SUCCESS ends tries before the shoo rule can fire');
    await page.click('.diag:has-text("Rule 3"):has-text("ever fired") button:has-text("Repair")');
    const reads = (await page.textContent('[data-tut="success-slot"]')).replace(/\s+/g, ' ');
    check(reads.includes('“Pip shoos chicken” has happened'), `polish: the repair makes SUCCESS “Has done… Pip shoos chicken” (${reads.slice(0, 90)})`);
    check(!(await page.locator('.diag:has-text("Rule 3"):has-text("ever fired")').count()), 'polish: the warning clears after the repair');
    // And the four-tap way from an empty SUCCESS: slot, Has done…, Shoos, Chicken.
    await page.click('[data-tut="success-slot"] .node-handle');
    await page.click('.sleeve button:has-text("Remove")');
    await page.click('[data-tut="success-slot"] .slot');
    const rec = (await page.textContent('.sleeve .hand-row')).replace(/\s+/g, ' ');
    check(rec.startsWith('Has done'), `polish: the hand recommends “Has done…” first for SUCCESS here (${rec.slice(0, 40)})`);
    await page.click('.sleeve .hand-row >> nth=0 >> .card:has-text("Has done")');
    check((await page.textContent('.sleeve .hand-row')).replace(/\s+/g, ' ').startsWith('Shoos'), 'polish: …then “Shoos” first for the event');
    await page.click('.sleeve .card:has-text("Shoos")');
    await page.click('.sleeve .card:has-text("Chicken")');
    check((await page.textContent('[data-tut="success-slot"]')).includes('“Pip shoos chicken” has happened'), 'polish: built in 4 taps from an empty SUCCESS');
    await train();
    const rep = (await page.textContent('[data-tut="report-compare"]')).replace(/\s+/g, ' ');
    const after = Number(rep.split('After')[1]?.match(/(\d{1,2})\/20/)?.[1] ?? -1), rnd = Number(rep.split('Random')[1]?.match(/(\d{1,2})\/20/)?.[1] ?? -1);
    check(after >= 0 && after > rnd, `polish: trained, it beats random wandering (${after}/20 vs ${rnd}/20)`);

    // Teaching polish (phase B): better pens, example layouts, play it yourself, rule housekeeping.
    await tab('Environment');
    await page.click('[data-tut="pen-size"] button:has-text("varies")');
    const boxes = await page.$$eval('[data-tut="layout-strip"] svg.thumb', (els) => els.map((e) => e.getAttribute('viewBox')));
    check(boxes.length === 6 && new Set(boxes).size >= 2, `pens: six example layouts, in different sizes (${[...new Set(boxes)].join(' / ')})`);
    await page.click('[data-tut="layout-strip"] button >> nth=2');
    await page.click('[data-tut="play-btn"]');
    for (const k of ['ArrowUp', 'ArrowLeft', 'ArrowDown']) await page.keyboard.press(k);
    const playing = (await page.textContent('[data-tut="play"]')).replace(/\s+/g, ' ');
    check(/step 3\/\d+/.test(playing) && playing.includes('SUCCESS now'), `pens: play it yourself steps the real lesson (${playing.slice(0, 80)})`);
    await page.click('.play-pad button:has-text("Stop")');
    await tab('Rules');
    const nRules = await page.locator('.binder-body .rule:not(.success-row):not(.fail-row)').count();
    await page.click('.binder-body .rule:not(.success-row):not(.fail-row) >> nth=0 >> button[aria-label="Duplicate rule"]');
    await page.click('.binder-body .rule:not(.success-row):not(.fail-row) >> nth=1 >> button[aria-label="Switch rule off"]');
    const copy = (await page.textContent('.binder-body .rule:not(.success-row):not(.fail-row) >> nth=1')).replace(/\s+/g, ' ');
    check((await page.locator('.binder-body .rule:not(.success-row):not(.fail-row)').count()) === nRules + 1 && copy.includes('(Switched off)'), 'pens: a rule duplicated and switched off (it stays on the mat)');

    // Teaching polish (phase C): save a card with a blank, share the lesson as a card, reuse the card.
    page.once('dialog', (d) => d.accept('Shooed a chicken'));
    await page.click('[data-tut="success-slot"] .node-handle');
    await page.click('.sleeve button:has-text("Save as one of your cards")');
    await tab('Curriculum');
    const shelf = page.locator('[data-tut="your-cards-shelf"]');
    check((await shelf.textContent()).includes('Shooed a chicken'), 'cards: the saved card is on the “Your cards” shelf, read as a sentence');
    await shelf.locator('li:has-text("Shooed a chicken") label:has-text("Chicken") input').check();
    const lessonDl = page.waitForEvent('download');
    await page.click('.curriculum li.sel [data-tut="export-lesson"]');
    const lessonFile = await (await lessonDl).path();
    await page.setInputFiles('[data-tut="import-lesson-file"]', lessonFile);
    await page.waitForTimeout(300);
    const lessonName = await page.$eval('select', (el) => el.options[el.selectedIndex].text);
    check(lessonName === 'Herd a chicken (2)', `cards: the exported lesson card imports as a new lesson (${lessonName})`);
    await page.click('.fail-row .slot');
    check((await page.textContent('.sleeve')).includes('Your cards'), 'cards: “Your cards” appear in the hand');
    await page.click('.sleeve [data-tut="your-cards"] .card:has-text("Shooed a chicken")');
    const blankHand = (await page.textContent('.sleeve .hand-row')).replace(/\s+/g, ' ');
    check(blankHand.startsWith('Chicken') || blankHand.includes('Chicken'), `cards: placing it jumps to its blank (the hand offers things: ${blankHand.slice(0, 40)})`);
    await page.click('.sleeve .card:has-text("Chicken")');
    const failRow = (await page.textContent('.fail-row')).replace(/\s+/g, ' ');
    check(failRow.includes('Shooed a chicken:') && failRow.includes('“Pip shoos chicken” has happened'), `cards: the placed card shows its name and reads back filled in (${failRow.slice(0, 90)})`);
    const a2 = await page.evaluate(() => window.__penDeckAudio);
    const want2 = ['train.loophole', 'train.certified', 'ui.unlock', 'skill.save', 'card.remove', 'guide.step', 'guide.offer', 'guide.done'];
    const missing2 = want2.filter((c) => !a2.cues.includes(c));
    if (!CARDS_ONLY) check(!missing2.length, `sound: lessons 4–9 cues played (loophole, certified, unlock, save) ${missing2.length ? `(missing ${missing2.join(', ')})` : ''}`);
    // The music box (off by default): switch it on, hear notes scheduled, switch it off.
    await nav('Settings');
    await page.check('[data-tut="music-on"]');
    await page.waitForTimeout(2500);
    const notes = await page.evaluate(() => window.__penDeckAudio.musicNotes);
    check(notes > 0, `sound: the music box plays when switched on (${notes} notes scheduled)`);
    await page.uncheck('[data-tut="music-on"]');
    await page.waitForTimeout(1000);
    const notes2 = await page.evaluate(() => window.__penDeckAudio.musicNotes);
    await page.waitForTimeout(1500);
    check((await page.evaluate(() => window.__penDeckAudio.musicNotes)) === notes2, 'sound: switching the music box off stops it');
    await nav('Farm');
    await page.waitForTimeout(500);
    const amb = (await page.evaluate(() => window.__penDeckAudio.ambience));
    check(amb.day + amb.night > 0 && amb.rain === 0, `sound: farm ambience playing (day ${amb.day}, night ${amb.night}, rain ${amb.rain})`);
    // Mute with the M key, then nothing more plays.
    await page.keyboard.press('m');
    const n = (await page.evaluate(() => window.__penDeckAudio.cues.length));
    await nav('Farm');
    await page.waitForTimeout(3000);
    const amb2 = (await page.evaluate(() => window.__penDeckAudio.ambience));
    check((await page.evaluate(() => window.__penDeckAudio.cues.length)) === n && (await page.getAttribute('.mute-btn', 'aria-pressed')) === 'true' && amb2.day + amb2.night === 0, 'sound: M mutes (no cues, ambience faded out)');
    await ctx.close();
  }

  check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
  check(external.length === 0, `no requests to other origins ${external.length ? JSON.stringify(external) : ''}`);
  await browser.close();
} catch (e) {
  failures.push(String(e));
  console.error(e);
  if (lastPage) { const shot = join(tmpdir(), 'pen-deck-e2e-failure.png'); await lastPage.screenshot({ path: shot }).catch(() => {}); console.error(`Screenshot of the failure: ${shot}`); }
} finally {
  server.kill();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll Field Guide browser checks passed');
process.exit(failures.length ? 1 : 0);
