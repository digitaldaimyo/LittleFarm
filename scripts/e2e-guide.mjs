/**
 * Browser test of the Field Guide: plays Chapter 1 and the "practice" and "scatter" lessons with real clicks.
 * Needs a build (`npm run build`) and Playwright with a Chromium browser available. Run: npm run e2e
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = require('playwright')); }

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const failures = [];
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failures.push(what); };

try {
  for (let i = 0; i < 50; i++) { try { await fetch(URL); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(URL)) external.push(r.url()); });
  const banner = async () => (await page.textContent('.tutorial').catch(() => '')).replace(/\s+/g, ' ');
  const report = async () => { await page.waitForSelector('text=Lesson report', { timeout: 90000 }); await page.waitForTimeout(300); };

  // Chapter 1
  await page.goto(URL);
  await page.click('text=Adopt Pip');
  check((await banner()).includes('Open the training pen'), 'Chapter 1 starts after adopting');
  await page.click('.nav-btn:has-text("Teach")');
  await page.click('[data-tut="env-berry"]');
  await page.click('rect.tile >> nth=20');
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
  const nums = [...cmp.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
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

  check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
  check(external.length === 0, `no requests to other origins ${external.length ? JSON.stringify(external) : ''}`);
  void nums;
  await browser.close();
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  server.kill();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll Field Guide browser checks passed');
process.exit(failures.length ? 1 : 0);
