/**
 * Browser test of the whole Field Guide with real clicks.
 *  - Part 1 starts a new game and plays lessons 1–3 (first lesson, practice, scatter).
 *  - Part 2 imports a prepared save (built by scripts/e2e-save.ts: lessons 1–3 done, a certified Approach,
 *    Fetch/Avoid/own skills unlocked) and plays lessons 4–9.
 * Needs a build (`npm run build`) and Playwright with a Chromium browser available.
 * Run: npm run e2e            (both parts)
 *      npm run e2e -- --from=4 (part 2 only)
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
const CUE_COUNT = 38; // cues in src/audio/kit.ts
const URL = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const FROM = Number(process.argv.find((a) => a.startsWith('--from='))?.slice(7) ?? 1);
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
  await page.click('.tutorial button:has-text("Go to the Farm")');
  await page.click('[data-tut="job-forage"]');
  await page.click('.speed button:has-text("4×")');
  await page.waitForFunction(() => document.querySelector('.tutorial')?.textContent?.includes('Field Guide'), null, { timeout: 60000 });
  check(true, 'Chapter 1 finished after earning 5 coins; a new lesson is offered');

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
  const want1 = ['card.flick', 'card.snap', 'pen.place', 'train.start', 'skill.save', 'farm.pickup', 'farm.coin'];
  const missing1 = want1.filter((c) => !a1.cues.includes(c));
  check(!missing1.length && (a1.cues.includes('train.certified') || a1.cues.includes('train.notCertified')), `sound: lessons 1–3 cues played ${missing1.length ? `(missing ${missing1.join(', ')})` : ''}`);
  await page.close();
  }

  console.log('\nPart 2: lessons 4–9 from a prepared save');
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
    await page.click('.sleeve .card:has-text("Bin")');
    await step('Train it again', 'L8: “Is at → Bin” added to Watches');
    await train();
    const c8 = await compareInGuide();
    console.log('   L8 comparison:', c8.slice(0, 170));
    const pct = (label) => Number((c8.split(label)[1] ?? '').match(/(\d+)%/)?.[1] ?? -1);
    check(pct('Watching 3') > pct('Watching 2'), `L8: watching the bin beats watching 2 things (${pct('Watching 2')}% → ${pct('Watching 3')}%)`);
    await nav('Teach');
    await page.click('[data-tut="save-skill"]');
    await lessonDone('Combine skills');

    // Lesson 9: Plan the farm
    await start('Plan the farm');
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
      if ((await rowNames()).indexOf('Check on the well') > (await rowNames()).indexOf('Otherwise wander')) continue;
      await page.click('[data-tut="plan-preview"]');
      ran = /Check on the well — ran \d+×/.test((await page.textContent('.plan-mat')).replace(/\s+/g, ' '));
    }
    console.log(`   moved up ${moves}×: ${(await rowNames()).join(' | ')}`);
    check(ran, 'L9: moved high enough, the row runs in the preview');
    await step('Tidy up and use the plan', 'L9: asks to tidy up the experiment row');
    await (await wellRow()).locator('button[aria-label="Delete row"]').click();
    await page.click('[data-tut="plan-apply"]');
    check(!(await rowNames()).includes('Check on the well'), 'L9: experiment row deleted and the plan applied');
    await looked();
    await lessonDone('Plan the farm');
    await nav('Guide');
    check((await page.locator('.guide-item.done').count()) === 9, 'all 9 Field Guide lessons done');

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
    const a2 = await page.evaluate(() => window.__penDeckAudio);
    const want2 = ['train.loophole', 'train.certified', 'ui.unlock', 'skill.save', 'card.remove', 'guide.step', 'guide.offer', 'guide.done'];
    const missing2 = want2.filter((c) => !a2.cues.includes(c));
    check(!missing2.length, `sound: lessons 4–9 cues played (loophole, certified, unlock, save) ${missing2.length ? `(missing ${missing2.join(', ')})` : ''}`);
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
