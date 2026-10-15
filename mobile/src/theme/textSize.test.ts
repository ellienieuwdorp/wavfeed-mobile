/**
 * The iOS large title's size for each text size (review VIS-1): Apple's large title points per content size category,
 * reached through React Native's multiplier for that category, and capped at AX1's 44pt like every head. A caption
 * title under a cover or card holds the height of two lines once the text is larger, wrapped or not.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { captionTitle, largeTitleSize } from './textSize';

test('the large title follows Apple’s sizes up to AX1 and holds there', () => {
  const cases: readonly (readonly [string, number, number])[] = [
    ['extra small', 0.823, 31],
    ['large, the default', 1, 34],
    ['extra extra extra large', 1.353, 40],
    ['AX1', 1.786, 44],
    ['AX3', 2.643, 44],
    ['AX5', 3.571, 44],
  ];
  for (const [category, multiplier, points] of cases) assert.equal(largeTitleSize(multiplier), points, category);
});

test('a multiplier between categories takes the smaller category’s size', () => {
  assert.equal(largeTitleSize(1.2), 36);
});

test('a caption title is one line at the default size and holds two lines above it, sized to the row cap', () => {
  assert.deepEqual(captionTitle(1), { numberOfLines: 1, allowFontScaling: true, style: null });
  const unscaled = { numberOfLines: 2, allowFontScaling: false } as const;
  assert.deepEqual(captionTitle(1.2), { ...unscaled, style: { fontSize: 18, lineHeight: 24, minHeight: 48, includeFontPadding: false } });
  assert.deepEqual(captionTitle(2.643), { ...unscaled, style: { fontSize: 24, lineHeight: 32, minHeight: 64, includeFontPadding: false } });
});
