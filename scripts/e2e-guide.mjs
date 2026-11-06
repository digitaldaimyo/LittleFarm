/**
 * Browser test with real clicks (Academy roadmap, phase 0).
 *  - Part 1 starts a new game: Willowbrook Academy's shell (tabs, the course map, ranks), a first skill built and
 *    trained in the Lab, and the Homestead without the farm economy.
 *  - Part 2 imports a prepared academy save (scripts/e2e-save.ts) and checks the card editor, pens, your cards,
 *    lesson cards, the card reference and sound.
 * The farm edition's Field Guide walkthrough (lessons 1–14) was removed with phase 0; its lessons return as
 * Academy challenges in phase 2 (the old script is in git history).
 * Needs a build (`npm run build`) and Playwright with a Chromium browser available.
 * Run: npm run e2e            (both parts)
 *      npm run e2e:cards       (part 2 only; CI runs this)
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
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGE ERROR:', e.message, (e.stack ?? '').split('\n').slice(0, 4).join(' | ')); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(URL)) external.push(r.url()); });
};

try {
  console.log(execFileSync('npx', ['vite-node', 'scripts/e2e-save.ts', SAVE], { encoding: 'utf8' }).trim());
  for (let i = 0; i < 50; i++) { try { await fetch(URL); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const browser = await chromium.launch();
  if (FROM <= 3) {
  console.log('\nPart 1: Willowbrook Academy from a new game (Academy roadmap, phase 0)');
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  watch(page);
  const report = async () => { await page.waitForSelector('text=Lesson report', { timeout: 90000 }); await page.waitForTimeout(300); };
  const nav = (n) => page.click(`.nav-btn:has-text("${n}")`);
  await page.goto(URL);
  const au = () => page.evaluate(() => window.__penDeckAudio);
  check((await au()).contexts === 0, 'sound: no AudioContext before the first click');
  check((await page.textContent('.modal')).includes('Welcome to Willowbrook Academy'), 'a new game welcomes you to Willowbrook Academy');
  await page.click('text=Adopt Pip');
  await page.waitForTimeout(300);
  const a0 = await au();
  check(a0.contexts === 1 && a0.cues.includes('pet.adopt'), 'sound: audio starts on the first click (adopt chirp)');
  // Gate: a new game starts in the Academy, with the three modes.
  const navs = await page.$$eval('.nav-btn', (els) => els.map((e) => e.textContent.trim()));
  check(JSON.stringify(navs) === JSON.stringify(['Academy', 'Lab', 'Homestead', 'Pets', 'Journal', 'Settings']), `tabs: Academy, Lab, Homestead (${navs.join(', ')})`);
  check((await page.getAttribute('.nav-btn:has-text("Academy")', 'aria-current')) === 'page' && (await page.locator('[data-tut="academy-map"]').count()) === 1, 'a new game starts in the Academy');
  const map = (await page.textContent('[data-tut="academy-map"]')).replace(/\s+/g, ' ');
  check(['First Steps', 'Fetch and Carry', 'Thinking Ahead', 'Working Together', 'A Day’s Work'].every((c) => map.includes(c)) && (await page.locator('.course .chip.locked').count()) === 5, 'the map shows all five courses, each exam visible and locked');
  check((await page.textContent('[data-tut="pet-board"]')).includes('Novice'), 'Pip starts as a Novice');
  check(!(await page.textContent('.top-res')).includes('coins') && (await page.textContent('.top-res')).includes('acorns'), 'the header shows acorns, not coins');
  // The Lab: build the first rule and SUCCESS card by card, train, save.
  await nav('Lab');
  await page.click('[data-tut="env-berry"]');
  await page.click('rect.tile >> nth=20');
  check(await page.waitForSelector('.toast:has-text("Sound is on")', { timeout: 4000 }).then(() => true, () => false), 'sound: one-time “Sound is on” note with the first sound');
  await page.click('.tab:has-text("Rules")');
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
  check(!(await page.textContent('.train-bar, [data-tut="train-btn"]').catch(() => '')).includes('sleepy'), 'the Lab costs no energy');
  await page.click('[data-tut="train-btn"]');
  await report();
  await page.click('[data-tut="save-skill"]');
  // Gate: a skill saved in the Lab is the pet’s everywhere.
  await nav('Academy');
  check((await page.textContent('[data-tut="pet-board"]')).includes('Approach'), 'the skill saved in the Lab is on Pip’s Academy board');
  await nav('Homestead');
  check((await page.locator('[data-tut="homestead-panel"]').count()) === 1, 'the Homestead says what it is');
  check(!(await page.locator('button:has-text("Open shop")').count()) && !(await page.locator('[data-tut="layout-btn"]').count()) && !(await page.locator('text=Requests board').count()), 'no shop, layout or requests board in the Homestead (no farm economy)');
  await page.click('.nav-btn:has-text("Pets")');
  check((await page.textContent('.main')).includes('Approach'), 'the skill saved in the Lab is in Pip’s skills');
  const a1 = await au();
  check(a1.rendered === CUE_COUNT && a1.state === 'running', `sound: all ${CUE_COUNT} cues rendered, audio running (${a1.rendered}, ${a1.state})`);
  check(a1.quiet.length === 0, `sound: no cue renders as silence ${a1.quiet.length ? JSON.stringify(a1.quiet) : ''}`);
  const loops = a1.loops;
  check(['day', 'night', 'rain'].every((k) => loops[k] > 0.002 && loops[k] < 0.2), `sound: ambience loops rendered at a gentle level (RMS ${JSON.stringify(loops)})`);
  const want1 = ['card.flick', 'card.snap', 'pen.place', 'train.start', 'skill.save'];
  const missing1 = want1.filter((c) => !a1.cues.includes(c));
  check(!missing1.length && (a1.cues.includes('train.certified') || a1.cues.includes('train.notCertified')), `sound: first-skill cues played ${missing1.length ? `(missing ${missing1.join(', ')})` : ''}`);
  await page.close();
  }

  console.log('\nPart 2: pen and card checks from a prepared academy save (a certified Approach and Harvest)');
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
    await page.goto(URL);
    await page.click('text=Adopt Pip'); // the save import replaces this pet
    await nav('Settings');
    await page.setInputFiles('input[type=file]', SAVE);
    await page.waitForTimeout(400);
    await page.selectOption('label:has-text("Default training speed") select', 'fast');
    await nav('Academy');
    check((await page.textContent('[data-tut="pet-board"]')).includes('Harvest'), 'prepared save imported: Pip knows Approach and Harvest');

    // Teaching polish (phase A): build "end on shoo chicken" the old way, get warned, repair it, train it.
    await nav('Lab');
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
    check((await newRule.locator('.extra-slot .slot:has-text("Than (a measure)")').count()) === 1 && (await newRule.locator('.extra-slot .slot:has-text("In this one")').count()) === 1, 'polish 4: optional slots the phrase leaves out (Than, In this one) are reachable');
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

    // Polish phase 4: the Guide's card reference finds cards by title or by a word in their hint.
    await nav('Academy');
    await page.click('[data-tut="academy-library"] > summary');
    await page.fill('[data-tut="card-search"]', 'stored');
    check((await page.locator('[data-tut="card-ref"] .card-ref li strong').first().textContent()) === 'Stored', 'card reference: “stored” finds Stored first');
    await page.fill('[data-tut="card-search"]', 'counting by hand');
    const byHint = (await page.textContent('[data-tut="card-ref"] .card-ref')).replace(/\s+/g, ' ');
    check(byHint.includes('Stored') && byHint.includes('Fits: Inside Compare') && byHint.includes('Reads like:'), 'card reference: found by a hint word, with where it fits and an example');
    await nav('Lab');
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
    await nav('Homestead');
    await page.waitForTimeout(500);
    const amb = (await page.evaluate(() => window.__penDeckAudio.ambience));
    check(amb.day + amb.night > 0 && amb.rain === 0, `sound: farm ambience playing (day ${amb.day}, night ${amb.night}, rain ${amb.rain})`);
    // Mute with the M key, then nothing more plays.
    await page.keyboard.press('m');
    const n = (await page.evaluate(() => window.__penDeckAudio.cues.length));
    await nav('Homestead');
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
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll browser checks passed');
process.exit(failures.length ? 1 : 0);
