/**
 * How far text grows with the system text size (review VIS-1), Dynamic Type on iOS and the font scale on Android, both
 * read as React Native's `fontScale`. Each role caps the multiplier: row facts, captions and links at 1.6, heads at 1.3,
 * and words inside a box that does not grow, the player's m:ss times, at 1. The native large title takes Apple's
 * large title size for the text size, capped like a head, because react-native-screens builds it at a fixed 34pt
 * whenever the header sets a colour (RNSScreenStackHeaderConfig.mm), which react-navigation always does.
 */
export type TextScale = 'row' | 'head' | 'fixed';

export const SCALE_CAP: Readonly<Record<TextScale, number>> = { row: 1.6, head: 1.3, fixed: 1 };

/** `size` as it draws under `fontScale` in that role. */
export function scaledSize(size: number, fontScale: number, scale: TextScale): number {
  return size * Math.min(fontScale, SCALE_CAP[scale]);
}

/** A caption under a fixed-width cover or card takes a second line for its title once the text is larger than default. */
export function captionLines(fontScale: number): 1 | 2 {
  return fontScale > 1 ? 2 : 1;
}

/** Apple's large title points per content size category, against React Native's multiplier for it (RCTAccessibilityManager). */
const LARGE_TITLE: readonly (readonly [multiplier: number, points: number])[] = [
  [0.823, 31],
  [0.882, 32],
  [0.941, 33],
  [1, 34],
  [1.118, 36],
  [1.235, 38],
  [1.353, 40],
  [1.786, 44],
  [2.143, 48],
  [2.643, 52],
  [3.143, 56],
  [3.571, 60],
];
const LARGE_TITLE_BASE = 34;

/** The iOS large title's point size: the system's for the text size, at most 1.3 times the default (44pt, AX1). */
export function largeTitleSize(fontScale: number): number {
  let points = LARGE_TITLE[0][1];
  for (const [multiplier, size] of LARGE_TITLE) if (fontScale >= multiplier - 0.001) points = size;
  return Math.min(points, Math.round(LARGE_TITLE_BASE * SCALE_CAP.head));
}
