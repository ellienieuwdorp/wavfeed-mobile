/**
 * The contrast DESIGN-UI section 6 promises (VIS-3, VIS-M2, VIS-15, VIS-M5): in both palettes every text token reaches
 * WCAG 1.4.3's 4.5:1 on each background the app draws it on, and every glyph or state mark 1.4.11's 3:1, by WCAG 2.2's
 * relative luminance. Every token is either in a pair or named in UNPAIRED with the reason, so a new one gets a test.
 * A failing pair waiting on the author's colour choice is a `todo` naming its measured ratio.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dark, light, type Palette } from './palette';

function luminance(hex: string): number {
  const channel = (at: number): number => {
    const v = parseInt(hex.slice(at, at + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Key = keyof Palette;
type Scheme = 'light' | 'dark';
const PAGES: readonly Key[] = ['bg', 'surface', 'raised'];
const TEXT = 4.5;
const GLYPH = 3;

/** [what it is, foreground, the backgrounds it sits on, the ratio it needs, the schemes still short of it]. */
const PAIRS: readonly (readonly [string, Key, readonly Key[], number, (readonly Scheme[])?])[] = [
  ['ink text', 'ink', PAGES, TEXT],
  ['sub text', 'sub', PAGES, TEXT],
  ['faint text: the release day, gap rows, the player facts, "+N"', 'faint', PAGES, TEXT],
  ['link text: "View more", "Sign out", "Open on Bandcamp"', 'accentText', PAGES, TEXT],
  ['danger text', 'danger', PAGES, TEXT],
  ["the Android mini player's lines on its dark-mode face", 'ink', ['borderLight'], TEXT],
  ["the Android mini player's artist line", 'sub', ['borderLight'], TEXT],
  ['words on a filled button', 'onAccent', ['accentText'], TEXT],
  ['words on a tonal button', 'ink', ['tint'], TEXT],
  ['the "Filtered by" pill\'s words', 'accentText', ['tint'], TEXT, ['dark']],
  ['initials on an avatar', 'avatarInk', ['avatarBg'], TEXT],
  ['the snackbar line on the inverse surface', 'bg', ['ink'], TEXT],
  ['the snackbar action on the inverse surface', 'inverseAccent', ['ink'], TEXT],
  ['the heart off', 'faint', PAGES, GLYPH],
  ['the heart on, its rim', 'wishlistEdge', PAGES, GLYPH],
  ['a glyph on an accent disc', 'onAccent', ['accent'], GLYPH],
  ['an accent mark on the page', 'accent', PAGES, GLYPH],
  ["the filter button's glyph, a slider's or progress bar's fill against its track", 'accent', ['tint'], GLYPH],
];

/** Tokens no pair covers, and why none needs to. */
const UNPAIRED: Partial<Record<Key, string>> = {
  border: 'hairlines and outlines beside a label, which carries the meaning',
  track: 'press highlights and ripples at 8 percent ink',
  wishlist: "the heart's fill inside its rim and the Settings dot beside its words; the swipe panel's words on it are WishlistSwipe's own white",
  online: 'the Settings dot beside the words that say signed in',
};

for (const [name, palette] of [['light', light], ['dark', dark]] as const) {
  for (const [what, fg, backgrounds, needs, short = []] of PAIRS) {
    for (const bgKey of backgrounds) {
      const ratio = contrast(palette[fg], palette[bgKey]);
      const todo = short.includes(name) ? `${ratio.toFixed(2)}:1, waiting on the author's colour choice` : undefined;
      test(`${name}: ${what} on ${bgKey} reaches ${needs}:1`, { todo }, () => {
        assert.ok(ratio >= needs, `${fg} ${palette[fg]} on ${bgKey} ${palette[bgKey]} is ${ratio.toFixed(2)}:1`);
      });
    }
  }
}

test('every palette token is in a contrast pair or says why it needs none', () => {
  const paired = new Set(PAIRS.flatMap(([, fg, backgrounds]) => [fg, ...backgrounds]));
  const missing = (Object.keys(light) as Key[]).filter((key) => !paired.has(key) && UNPAIRED[key] === undefined);
  assert.deepEqual(missing, [], 'add a pair to PAIRS for each, or a reason to UNPAIRED');
});

test('dark faint stays a step below sub', () => {
  assert.ok(contrast(dark.sub, dark.faint) >= 1.25, `${contrast(dark.sub, dark.faint).toFixed(2)}:1`);
});
