/**
 * The contrast DESIGN-UI section 6 promises (review VIS-3, VIS-M2, VIS-15, VIS-M5): in both palettes every text token
 * reaches WCAG 1.4.3's 4.5:1 on each surface it is drawn on, and every state mark 1.4.11's 3:1. A pair is listed here
 * when the app draws it; the ratio is WCAG 2.2's relative luminance formula. The "This device" pill, accent words on
 * the tint, is left out: dark mode draws it at 3.64:1 until the author picks its fix.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dark, light, type Palette } from './palette';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const v = parseInt(hex.slice(at, at + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Key = keyof Palette;
const PAGES: readonly Key[] = ['bg', 'surface', 'raised'];

/** [what it is, foreground, the backgrounds it sits on, the ratio it needs]. */
const PAIRS: readonly (readonly [string, Key, readonly Key[], number])[] = [
  ['ink text', 'ink', PAGES, 4.5],
  ['sub text', 'sub', PAGES, 4.5],
  ['faint text: the release day, gap rows, the player facts, "+N"', 'faint', PAGES, 4.5],
  ['link text: "View more", "Sign out", "Open on Bandcamp"', 'accentText', PAGES, 4.5],
  ['danger text', 'danger', PAGES, 4.5],
  ['words on a filled button', 'onAccent', ['accentText'], 4.5],
  ['the snackbar line on the inverse surface', 'bg', ['ink'], 4.5],
  ['the snackbar action on the inverse surface', 'inverseAccent', ['ink'], 4.5],
  ['the heart off', 'faint', PAGES, 3],
  ['the heart on or pending, its rim', 'wishlistEdge', PAGES, 3],
  ['a glyph on an accent disc', 'onAccent', ['accent'], 3],
  ['an accent mark on the page', 'accent', PAGES, 3],
];

for (const [name, palette] of [['light', light], ['dark', dark]] as const) {
  for (const [what, fg, backgrounds, needs] of PAIRS) {
    for (const bgKey of backgrounds) {
      test(`${name}: ${what} on ${bgKey} reaches ${needs}:1`, () => {
        const ratio = contrast(palette[fg], palette[bgKey]);
        assert.ok(ratio >= needs, `${fg} ${palette[fg]} on ${bgKey} ${palette[bgKey]} is ${ratio.toFixed(2)}:1`);
      });
    }
  }
}

test('dark faint stays a step below sub', () => {
  assert.ok(contrast(dark.sub, dark.faint) >= 1.25, `${contrast(dark.sub, dark.faint).toFixed(2)}:1`);
});
