/**
 * Polish phase 6 gate: the current docs don't describe retired behaviour as current, every markdown link in the
 * README and the docs resolves, and every file path a current doc names exists.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const CURRENT = ['README.md', 'docs/DESIGN.md', 'docs/ARCHITECTURE.md', 'docs/TESTING.md', 'docs/CARD_REFERENCE.md', 'docs/POLISH_ROADMAP.md'];
const allDocs = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(ROOT, p)).isDirectory() ? allDocs(p) : p.endsWith('.md') ? [p] : [];
});
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const files = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(ROOT, p)).isDirectory() ? files(p) : [f];
});
const NAMES = new Set(['src', 'tests', 'scripts', 'docs', '.github'].flatMap(files));

/** Retired behaviour, by how docs used to name it. */
const RETIRED: [string, RegExp][] = [
  ['direct jobs', /\bdirect jobs?\b/i],
  ['the Wander job', /\bWander\b|job\.wander|'wander'/],
  ['Forage / Deliver jobs', /\bforag(e|es|ing|er|ers)\b|\bDeliver job|job\.deliver|\bdeliverer\b/i],
  ['the old bandit', /\bbandit\b/i],
  ['plan mode', /\bplan mode\b/i],
  ['the rules executive', /rules executive|rulesSelect|learnedSelect|starter plan mirrors the rules|\bAuto rules\b/i],
  ['the tote job', /job\.tote|\b(behaviou?r|job) `?tote`?\b/i],
];
/** A line may name retired things when it says so. */
const PAST = /retired|removed|no longer|\bold\b|older|\bwas\b|\bwere\b|used to|replaced|renamed|instead of|before|earlier|history|kept so|still load|gone/i;

describe('docs (polish phase 6)', () => {
  it('current docs describe only today’s game', () => {
    const bad: string[] = [];
    for (const f of CURRENT) read(f).split('\n').forEach((line, i) => {
      for (const [what, re] of RETIRED) if (re.test(line) && !PAST.test(line)) bad.push(`${f}:${i + 1} (${what}): ${line.trim().slice(0, 100)}`);
    });
    expect(bad).toEqual([]);
  });

  it('every markdown link in the README and the docs resolves', () => {
    const broken: string[] = [];
    for (const f of ['README.md', ...allDocs('docs')]) {
      for (const m of read(f).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1].split('#')[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        if (!existsSync(join(ROOT, dirname(f), target))) broken.push(`${f} → ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('every file a current doc names exists', () => {
    const missing: string[] = [];
    for (const f of CURRENT) {
      for (const m of read(f).matchAll(/`([\w./-]+\.(?:ts|tsx|mjs|md|json|yml|css|js)|[\w./-]+\/)`/g)) {
        const p = m[1];
        if (p.startsWith('.') && !p.startsWith('./') && !p.startsWith('../')) continue;
        // A bare file name (`farm.ts`, `ci.yml`) may live anywhere in the project.
        const ok = [join(ROOT, p), join(ROOT, 'src', p), join(ROOT, dirname(f), p)].some(existsSync) || (!p.includes('/') && NAMES.has(p));
        if (!ok) missing.push(`${f}: ${p}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
