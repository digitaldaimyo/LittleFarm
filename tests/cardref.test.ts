import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cardReference } from '../scripts/card-reference';

describe('card reference (pen & cards phase 5)', () => {
  it('docs/CARD_REFERENCE.md matches the card registry (run `npm run cards:ref` after changing cards)', () => {
    expect(readFileSync(new URL('../docs/CARD_REFERENCE.md', import.meta.url), 'utf8')).toBe(cardReference());
  });
});
