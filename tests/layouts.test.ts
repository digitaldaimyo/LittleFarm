import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { layoutTable } from '../scripts/layout-fingerprint';

describe('layout generation stays put', () => {
  it('every recipe and the tutorial pen produce exactly the recorded layouts (and transfer pens)', () => {
    const expected = JSON.parse(readFileSync(new URL('./fixtures/layouts.json', import.meta.url), 'utf8'));
    expect(layoutTable()).toEqual(expected);
  });
});
