/**
 * The card reference (pen & cards roadmap, phase 5): every card in the registry, grouped by sheet, with its slots,
 * settings and hint — generated, so it never drifts. `npm run cards:ref` rewrites docs/CARD_REFERENCE.md;
 * tests/cardref.test.ts fails if the file is out of date.
 */
import { writeFileSync } from 'node:fs';
import { REGISTRY } from '../src/domain/registry';
import { typeToString } from '../src/domain/typecheck';

const esc = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function cardReference(): string {
  const bySheet = new Map<string, typeof cards>();
  const cards = [...REGISTRY.cards.values()].filter((c) => !c.retired && c.presentation.group !== 'kind');
  for (const c of cards) {
    const k = c.presentation.sheet;
    if (!bySheet.has(k)) bySheet.set(k, []);
    bySheet.get(k)!.push(c);
  }
  const out: string[] = [
    '# Card reference',
    '',
    'Every card in the game, by sheet. Generated from the card registry by `npm run cards:ref` — do not edit by hand.',
    '',
    `Things (kinds) you can place or name: ${[...REGISTRY.objects.values()].map((o) => o.name).join(', ')}.`,
    '',
  ];
  for (const [sheet, list] of [...bySheet].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(`## ${sheet}`, '', '| Card | Slots | Settings | What it does |', '|---|---|---|---|');
    for (const c of list.sort((a, b) => a.presentation.title.localeCompare(b.presentation.title))) {
      const slots = c.sockets.map((s) => `${s.label}${s.required ? '' : ' (optional)'}${s.many ? ' (several)' : ''}: ${typeToString(s.type)}`).join('; ') || '—';
      const params = (c.params ?? []).map((p) => (p.kind === 'choice' ? `${p.label}: ${p.choices!.map((x) => x.label).join(' / ')}` : p.kind === 'number' ? `${p.label}: ${p.min ?? ''}–${p.max ?? ''}` : p.label)).join('; ') || '—';
      out.push(`| **${esc(c.presentation.title)}** \`${c.id}\` | ${esc(slots)} | ${esc(params)} | ${esc(c.presentation.hint ?? c.presentation.phrase ?? '')} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

if (process.env.WRITE_CARD_REF) {
  writeFileSync('docs/CARD_REFERENCE.md', cardReference());
  console.log('Wrote docs/CARD_REFERENCE.md');
}
